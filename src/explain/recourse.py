# greedy search over the levers an officer can actually pull, re-scoring through the
# real model each time, to find the cheapest route back to a safer grade.
# immutable borrower attributes are never touched.

from __future__ import annotations

from typing import Callable

import numpy as np
import pandas as pd

from src.framework.interpretation import DEFAULT_LGD, expected_credit_loss

# Each lever: label -> function mutating a single-row feature frame in place.
_LEVERS: dict[str, Callable[[pd.DataFrame], None]] = {
    "Reduce sanctioned exposure by 25%": lambda f: f.__setitem__("gr_appv", f["gr_appv"] * 0.75),
    "Reduce sanctioned exposure by 50%": lambda f: f.__setitem__("gr_appv", f["gr_appv"] * 0.50),
    "Secure facility / extend to long-tenure (>=20y)": lambda f: (
        f.__setitem__("term", np.maximum(f["term"].fillna(0), 240)),
        f.__setitem__("real_estate_backed", 1.0),
    ),
    "Increase guarantee cover to 85%": lambda f: f.__setitem__("guarantee_ratio", 0.85),
}

# India MSME levers: cure paths a relationship manager can actually work.
_INDIA_LEVERS: dict[str, Callable[[pd.DataFrame], None]] = {
    "Cure EMI bounces (standing-instruction move + buffer)": lambda f: f.__setitem__("emi_bounce_6m", 0.0),
    "Regularise GST filing (delay < 10 days)": lambda f: f.__setitem__(
        "gst_filing_delay_days", np.minimum(f["gst_filing_delay_days"].fillna(10), 10.0)
    ),
    "Resolve ITC mismatch": lambda f: f.__setitem__("itc_mismatch_flag", 0.0),
    "Reduce ticket size by 25% (partial limit cut)": lambda f: f.__setitem__(
        "ticket_size", f["ticket_size"] * 0.75
    ),
}


def _idbi_reduce_dp_gap(f: pd.DataFrame) -> None:
    if "drawing_power_gap_pct" in f.columns:
        f["drawing_power_gap_pct"] = np.maximum(0.0, f["drawing_power_gap_pct"] - 15.0)
    if "cashflow_volatility" in f.columns:
        f["cashflow_volatility"] = np.maximum(0.1, f["cashflow_volatility"] - 0.20)


def _idbi_regularize_collection(f: pd.DataFrame) -> None:
    if "demanded_vs_collected_ratio" in f.columns:
        f["demanded_vs_collected_ratio"] = 0.98
    if "balance_trend_pct" in f.columns:
        f["balance_trend_pct"] = np.maximum(f["balance_trend_pct"], -2.0)
    if "emi_bounce_6m" in f.columns:
        f["emi_bounce_6m"] = 0.0


def _idbi_clear_lien(f: pd.DataFrame) -> None:
    if "lien_flag" in f.columns:
        f["lien_flag"] = 0
    if "lien_count" in f.columns:
        f["lien_count"] = 0
    if "cashflow_volatility" in f.columns:
        f["cashflow_volatility"] = np.maximum(0.1, f["cashflow_volatility"] - 0.10)


def _idbi_reduce_ticket(f: pd.DataFrame) -> None:
    if "ticket_size" in f.columns:
        f["ticket_size"] = f["ticket_size"] * 0.75
    if "sanction_limit" in f.columns:
        f["sanction_limit"] = f["sanction_limit"] * 0.75


# IDBI Sandbox Finacle levers: actionable operational interventions.
_IDBI_LEVERS: dict[str, Callable[[pd.DataFrame], None]] = {
    "Bridge Drawing Power erosion (reduce DP gap by 15%)": _idbi_reduce_dp_gap,
    "Regularise demand collection (ratio to 0.98)": _idbi_regularize_collection,
    "Clear account lien encumbrance": _idbi_clear_lien,
    "Reduce sanctioned ticket size by 25%": _idbi_reduce_ticket,
}

SEGMENT_LEVERS: dict[str, dict[str, Callable[[pd.DataFrame], None]]] = {
    "msme_sba": _LEVERS,
    "msme_india": _INDIA_LEVERS,
    "msme_idbi": _IDBI_LEVERS,
}


def _pd_of(bundle, feat_row: pd.DataFrame) -> float:
    return float(bundle.predict_pd(feat_row[bundle.feature_cols])[0])


def recommend_recourse(
    bundle,
    feat_row: pd.DataFrame,
    target_pd: float = 0.11,
    max_steps: int = 3,
    levers: dict[str, Callable[[pd.DataFrame], None]] | None = None,
    ead: float | None = None,
    lgd: float | None = None,
) -> dict:
    levers = levers if levers is not None else _LEVERS
    lgd_val = DEFAULT_LGD if lgd is None else float(lgd)
    current = feat_row[bundle.feature_cols].copy()
    base_pd = _pd_of(bundle, current)
    applied: list[dict] = []
    used: set[str] = set()
    baseline_ecl = (
        expected_credit_loss(base_pd, ead, lgd_val) if ead is not None else None
    )

    for _ in range(max_steps):
        if _pd_of(bundle, current) <= target_pd:
            break
        best_label, best_pd, best_frame = None, _pd_of(bundle, current), None
        for label, lever in levers.items():
            if label in used:
                continue
            trial = current.copy()
            lever(trial)
            trial_pd = _pd_of(bundle, trial)
            if trial_pd < best_pd - 1e-4:
                best_label, best_pd, best_frame = label, trial_pd, trial
        if best_label is None:
            break
        current = best_frame
        used.add(best_label)
        step: dict = {"change": best_label, "pd_after": round(best_pd, 4)}
        if ead is not None and baseline_ecl is not None:
            ecl_after = expected_credit_loss(best_pd, ead, lgd_val)
            step["ecl_after"] = round(ecl_after, 2)
            step["ecl_delta"] = round(ecl_after - baseline_ecl, 2)
        applied.append(step)

    achieved_pd = _pd_of(bundle, current)
    out: dict = {
        "baseline_pd": round(base_pd, 4),
        "target_pd": target_pd,
        "achieved_pd": round(achieved_pd, 4),
        "changes": applied,
        "target_met": achieved_pd <= target_pd,
    }
    if ead is not None and baseline_ecl is not None:
        achieved_ecl = expected_credit_loss(achieved_pd, ead, lgd_val)
        out["baseline_ecl"] = round(baseline_ecl, 2)
        out["achieved_ecl"] = round(achieved_ecl, 2)
        out["ecl_delta"] = round(achieved_ecl - baseline_ecl, 2)
    return out
