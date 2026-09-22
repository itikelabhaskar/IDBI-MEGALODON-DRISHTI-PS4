# maps bank sandbox loan api responses onto the canonical frame. each parse_api_*
# function takes one endpoint's payload and pulls out the fields we actually model.
# also carries a synthetic generator so the segment is runnable before real data lands.

from __future__ import annotations

from typing import Any, Mapping
import numpy as np
import pandas as pd

from src.framework.schema import validate_canonical


def _safe_float(val: Any, default: float = 0.0) -> float:
    try:
        if val is None or str(val).strip() == "":
            return default
        return float(val)
    except (ValueError, TypeError):
        return default


def parse_api_402_label(resp_402: Mapping[str, Any]) -> dict[str, Any]:
    result = resp_402.get("result", {})
    overdue = result.get("overdueDetails", {})
    if isinstance(overdue, list) and len(overdue) > 0:
        overdue = overdue[0]
    elif not isinstance(overdue, dict):
        overdue = {}

    npa_status = str(overdue.get("npaStatus", "")).strip().upper()
    dpd = _safe_float(overdue.get("dpd", overdue.get("daysPastDue", 0)), 0.0)

    # Binary default definition: Marked NPA or DPD >= 90
    is_default = 1 if (npa_status in ("Y", "YES", "NPA", "TRUE", "1") or dpd >= 90) else 0

    return {
        "npa_status": npa_status,
        "dpd": dpd,
        "default_12m": is_default,
        "overdue_amt": _safe_float(overdue.get("overdueAmount", 0), 0.0),
    }


def parse_api_404_debt_service(resp_404: Mapping[str, Any]) -> dict[str, Any]:
    result = resp_404.get("result", {})
    records = result.get("loanOvduRec", [])
    if not records or not isinstance(records, list):
        return {
            "demanded_vs_collected_ratio": 1.0,
            "total_int_ovdu": 0.0,
            "total_p_ovdu": 0.0,
        }

    rec = records[0]

    def _amt(sub: Any) -> float:
        val = sub.get("amountValue", 0) if isinstance(sub, dict) else (sub or 0)
        return _safe_float(val, 0.0)

    int_coll = _amt(rec.get("totalIntColl"))
    int_dmd = _amt(rec.get("totalIntDmd"))
    int_ovdu = _amt(rec.get("totalIntOvdu"))
    p_coll = _amt(rec.get("pTotalColl"))
    p_dmd = _amt(rec.get("pTotalDmd"))
    p_ovdu = _amt(rec.get("pTotalOvdu"))

    tot_dmd = int_dmd + p_dmd
    tot_coll = int_coll + p_coll
    ratio = tot_coll / max(1.0, tot_dmd) if tot_dmd > 0 else 1.0

    return {
        "demanded_vs_collected_ratio": round(float(ratio), 4),
        "total_int_ovdu": int_ovdu,
        "total_p_ovdu": p_ovdu,
    }


def parse_api_441_limits(resp_441: Mapping[str, Any]) -> dict[str, Any]:
    result = resp_441.get("result", {})
    details = result.get("accountLimitDetails", {})
    if not isinstance(details, dict):
        return {"drawing_power_gap_pct": 0.0, "sanction_limit": 0.0, "drawing_power": 0.0}

    # Extract historical or latest sanction & DP limits
    sanct_list = details.get("acctSanctLimitHistMsg", [])
    dp_list = details.get("acctDrwngPowerLimitHistMsgInq", [])

    def _get_val(lst: Any, key: str) -> float:
        if isinstance(lst, list) and len(lst) > 0:
            first = lst[0]
            if isinstance(first, dict):
                return _safe_float(first.get(key, 0), 0.0)
        return 0.0

    sanct = _get_val(sanct_list, "sanctLimit")
    dp = _get_val(dp_list, "drwngPower")

    gap_pct = ((sanct - dp) / max(1.0, sanct) * 100.0) if sanct > 0 else 0.0
    return {
        "sanction_limit": sanct,
        "drawing_power": dp,
        "drawing_power_gap_pct": round(max(0.0, float(gap_pct)), 2),
    }


def parse_api_391_profile(resp_391: Mapping[str, Any]) -> dict[str, Any]:
    result = resp_391.get("result", {})
    raw_dt = result.get("acctOpenDt")
    acct_open = raw_dt if (raw_dt and raw_dt != "date") else "2022-01-01"
    
    gen_details = result.get("loanGenDetails", {})
    resched = gen_details.get("reschedParams", {})
    
    # Rescheduling / restructuring flags
    resched_amt = str(resched.get("reschedAmtFlg", "")).strip().upper()
    has_resched = 1 if resched_amt in ("Y", "YES", "1") else 0

    loan_amt = gen_details.get("loanAmt", {})
    ticket = _safe_float(loan_amt.get("amountValue") if isinstance(loan_amt, dict) else loan_amt, 1_000_000.0)

    return {
        "origination_date": acct_open,
        "ticket_size": ticket if ticket > 0 else 1_000_000.0,
        "restructuring_flag": has_resched,
    }


def to_canonical_record(
    loan_id: str,
    resp_402: Mapping[str, Any],
    resp_404: Mapping[str, Any] | None = None,
    resp_391: Mapping[str, Any] | None = None,
    resp_441: Mapping[str, Any] | None = None,
    resp_362: Mapping[str, Any] | None = None,
    resp_408: Mapping[str, Any] | None = None,
) -> dict[str, Any]:
    record: dict[str, Any] = {
        "loan_id": str(loan_id),
        "segment": "msme_idbi",
    }

    # 1. Label & DPD (402)
    l_info = parse_api_402_label(resp_402)
    record["default_12m"] = l_info["default_12m"]
    record["dpd"] = l_info["dpd"]
    record["overdue_amt"] = l_info["overdue_amt"]

    # 2. Debt Service Ratio (404)
    if resp_404:
        ds_info = parse_api_404_debt_service(resp_404)
        record.update(ds_info)
    else:
        record["demanded_vs_collected_ratio"] = 1.0

    # 3. Profile & Restructuring (391)
    if resp_391:
        p_info = parse_api_391_profile(resp_391)
        record["origination_date"] = pd.to_datetime(p_info["origination_date"])
        record["ticket_size"] = p_info["ticket_size"]
        record["restructuring_flag"] = p_info["restructuring_flag"]
    else:
        record["origination_date"] = pd.to_datetime("2022-01-01")
        record["ticket_size"] = 1_000_000.0
        record["restructuring_flag"] = 0

    # 4. Limits & Drawing Power (441)
    if resp_441:
        lim_info = parse_api_441_limits(resp_441)
        record.update(lim_info)
    else:
        record["drawing_power_gap_pct"] = 0.0

    # 5. Liens (362)
    if resp_362:
        res_362 = resp_362.get("result", {})
        has_lien = 1 if (res_362.get("acctId") or res_362.get("lienAmount")) else 0
        record["lien_flag"] = has_lien
    else:
        record["lien_flag"] = 0

    # 6. CIBIL Bureau (408)
    if resp_408:
        cibil_res = resp_408.get("fetchCibilScoreResponse", {})
        score = cibil_res.get("cibilScore") or 650
        try:
            record["cibil_score"] = float(score)
        except (ValueError, TypeError):
            record["cibil_score"] = 650.0
    else:
        record["cibil_score"] = 650.0

    return record


def to_canonical_frame(records: list[dict[str, Any]]) -> pd.DataFrame:
    df = pd.DataFrame(records)
    if "origination_date" in df.columns:
        df["origination_date"] = pd.to_datetime(df["origination_date"])
    if "dpd" in df.columns:
        df = df[pd.to_numeric(df["dpd"], errors="coerce").fillna(0) < 90].reset_index(drop=True)
    return validate_canonical(df)


def cibil_to_cmr(score: float | None) -> float:
    if score is None or pd.isna(score):
        return np.nan
    try:
        s = float(score)
    except (ValueError, TypeError):
        return np.nan
    if s >= 750:
        return 1.0 + max(0.0, min(1.0, (800.0 - s) / 50.0))
    elif s >= 700:
        return 3.0 + max(0.0, min(1.0, (750.0 - s) / 50.0))
    elif s >= 650:
        return 5.0 + max(0.0, min(1.0, (700.0 - s) / 50.0))
    elif s >= 600:
        return 7.0 + max(0.0, min(1.0, (650.0 - s) / 50.0))
    else:
        return 9.0 + min(1.0, max(0.0, (600.0 - s) / 100.0))


def engineer_idbi_features(df: pd.DataFrame) -> pd.DataFrame:
    from src.features.india_features import engineer_india_features

    df_in = df.copy()

    # 1. Map CIBIL score to CMR if CMR not explicitly provided
    if "cibil_score" in df_in.columns:
        derived_cmr = df_in["cibil_score"].apply(cibil_to_cmr)
        if "cmr" in df_in.columns:
            df_in["cmr"] = df_in["cmr"].fillna(derived_cmr)
        else:
            df_in["cmr"] = derived_cmr
    elif "cmr" not in df_in.columns:
        df_in["cmr"] = np.nan

    # 2. Map debt servicing & cashflow stress to emi_bounce_6m if not provided.
    # Decoupled from contemporaneous DPD to eliminate circular leakage.
    derived_bounces = pd.Series(0.0, index=df_in.index, dtype="float64")
    if "demanded_vs_collected_ratio" in df_in.columns:
        ratio = pd.to_numeric(df_in["demanded_vs_collected_ratio"], errors="coerce").fillna(1.0)
        derived_bounces = pd.Series(
            np.where(ratio < 0.70, 3.0, np.where(ratio < 0.85, 2.0, np.where(ratio < 0.95, 1.0, 0.0))),
            index=df_in.index,
            dtype="float64",
        )
    if "emi_bounce_6m" in df_in.columns:
        df_in["emi_bounce_6m"] = pd.to_numeric(df_in["emi_bounce_6m"], errors="coerce").fillna(derived_bounces)
    else:
        df_in["emi_bounce_6m"] = derived_bounces

    # 3. Map Drawing Power gap to cashflow volatility
    if "drawing_power_gap_pct" in df_in.columns:
        gap = pd.to_numeric(df_in["drawing_power_gap_pct"], errors="coerce").fillna(0.0)
        derived_vol = pd.Series(np.clip(gap / 50.0, 0.1, 0.9), index=df_in.index, dtype="float64")
        if "cashflow_volatility" in df_in.columns:
            df_in["cashflow_volatility"] = pd.to_numeric(df_in["cashflow_volatility"], errors="coerce").fillna(derived_vol)
        else:
            df_in["cashflow_volatility"] = derived_vol

    # 4. Map demanded_vs_collected_ratio to balance_trend_pct
    if "demanded_vs_collected_ratio" in df_in.columns:
        ratio = pd.to_numeric(df_in["demanded_vs_collected_ratio"], errors="coerce").fillna(1.0)
        derived_trend = pd.Series(np.clip((ratio - 1.0) * 100.0, -50.0, 20.0), index=df_in.index, dtype="float64")
        if "balance_trend_pct" in df_in.columns:
            df_in["balance_trend_pct"] = pd.to_numeric(df_in["balance_trend_pct"], errors="coerce").fillna(derived_trend)
        else:
            df_in["balance_trend_pct"] = derived_trend

    # 5. Tenure and vintage defaults
    if "tenure_months" not in df_in.columns:
        df_in["tenure_months"] = 36.0
    if "vintage_months" not in df_in.columns:
        if "origination_date" in df_in.columns:
            try:
                orig = pd.to_datetime(df_in["origination_date"])
                ref = pd.Timestamp("2026-03-31")
                df_in["vintage_months"] = (
                    (ref.year - orig.dt.year) * 12 + (ref.month - orig.dt.month)
                ).clip(lower=1)
            except Exception:
                df_in["vintage_months"] = 24.0
        else:
            df_in["vintage_months"] = 24.0

    # 6. MSME Subsegment classification
    if "sub_segment" not in df_in.columns:
        if "ticket_size" in df_in.columns:
            ts = pd.to_numeric(df_in["ticket_size"], errors="coerce").fillna(1_000_000.0)
            df_in["sub_segment"] = np.where(
                ts < 10_000_000, "micro", np.where(ts < 50_000_000, "small", "medium")
            )
        else:
            df_in["sub_segment"] = "small"

    if "sector" not in df_in.columns:
        df_in["sector"] = "manufacturing"
    if "state" not in df_in.columns:
        df_in["state"] = "MH"

    return engineer_india_features(df_in)


def generate_idbi_synthetic_canonical(n: int = 500, seed: int = 42) -> pd.DataFrame:
    rng = np.random.default_rng(seed)
    sectors = [
        "textiles", "food_processing", "auto_components", "pharma",
        "retail_trade", "construction", "it_services",
    ]
    states = ["MH", "GJ", "TN", "KA", "DL", "UP"]
    subsegs = ["micro", "small", "medium"]

    records = []
    base_date = pd.Timestamp("2022-01-01")

    for i in range(n):
        loan_id = f"IDBI_LN_{100000 + i}"
        sub = rng.choice(subsegs, p=[0.55, 0.35, 0.10])
        sector = rng.choice(sectors)
        state = rng.choice(states)

        ticket = float(
            rng.lognormal(
                14.0 if sub == "micro" else 15.5 if sub == "small" else 17.0, 0.5
            )
        )
        ticket = round(ticket, -4)

        risk = rng.beta(1.8, 6.0)

        is_default = 1 if risk > 0.45 else 0
        # Add label noise to reflect idiosyncratic shocks and cures
        if rng.random() < 0.05:
            is_default = 1 - is_default

        # At snapshot T_0, loans are performing or incipiently stressed (Standard / SMA-0 / SMA-1).
        # Accounts with DPD >= 90 at T_0 are already in default and pruned from forward 12m prediction.
        # Overlap conditional distributions between defaults and non-defaults
        if is_default:
            dpd = int(rng.choice([0, 15, 30, 45, 60], p=[0.25, 0.20, 0.25, 0.18, 0.12]))
            ratio = round(float(np.clip(rng.normal(0.84, 0.13), 0.45, 1.0)), 4)
            dp_gap = round(float(np.clip(rng.normal(20.0, 13.0), 0.0, 50.0)), 2)
            cibil = int(np.clip(rng.normal(660, 65), 300, 850))
        else:
            dpd = int(rng.choice([0, 15, 30, 45], p=[0.72, 0.16, 0.09, 0.03]))
            ratio = round(float(np.clip(rng.normal(0.93, 0.09), 0.65, 1.0)), 4)
            dp_gap = round(float(np.clip(rng.normal(10.0, 9.0), 0.0, 45.0)), 2)
            cibil = int(np.clip(rng.normal(700, 58), 300, 850))

        ovdu_amt = round(ticket * float(rng.uniform(0.02, 0.10)), 2) if dpd > 0 else 0.0
        sanct_lim = ticket
        dp_val = round(sanct_lim * (1.0 - dp_gap / 100.0), 2)

        lien_flag = 1 if (risk > 0.5 and rng.random() > 0.6) else 0
        restruct = 1 if (risk > 0.45 and rng.random() > 0.7) else 0
        months_ago = int(rng.integers(6, 48))
        orig_dt = (base_date + pd.DateOffset(months=months_ago)).strftime("%Y-%m-%d")

        rec = {
            "loan_id": loan_id,
            "segment": "msme_idbi",
            "origination_date": orig_dt,
            "default_12m": is_default,
            "dpd": dpd,
            "overdue_amt": ovdu_amt,
            "demanded_vs_collected_ratio": ratio,
            "total_int_ovdu": round(ovdu_amt * 0.3, 2),
            "total_p_ovdu": round(ovdu_amt * 0.7, 2),
            "ticket_size": ticket,
            "restructuring_flag": restruct,
            "sanction_limit": sanct_lim,
            "drawing_power": dp_val,
            "drawing_power_gap_pct": dp_gap,
            "lien_flag": lien_flag,
            "cibil_score": float(cibil),
            "sub_segment": sub,
            "sector": sector,
            "state": state,
        }
        records.append(rec)

    return to_canonical_frame(records)


def build_idbi_canonical(force_regenerate: bool = False) -> pd.DataFrame:
    from src.config import PROCESSED_DIR, SEGMENTS

    path = PROCESSED_DIR / SEGMENTS["msme_idbi"]["processed_file"]
    if path.exists() and not force_regenerate:
        df = pd.read_parquet(path)
        if "dpd" in df.columns and (pd.to_numeric(df["dpd"], errors="coerce").fillna(0) >= 90).any():
            df = df[pd.to_numeric(df["dpd"], errors="coerce").fillna(0) < 90].reset_index(drop=True)
            df.to_parquet(path, index=False)
        return df

    df = generate_idbi_synthetic_canonical(n=500, seed=42)
    path.parent.mkdir(parents=True, exist_ok=True)
    df.to_parquet(path, index=False)
    return df


def idbi_canonical() -> pd.DataFrame:
    return build_idbi_canonical()


def idbi_sample(canonical: pd.DataFrame, n: int, seed: int) -> pd.DataFrame:
    if len(canonical) > n:
        return canonical.sample(n, random_state=seed).reset_index(drop=True)
    return canonical.reset_index(drop=True)

