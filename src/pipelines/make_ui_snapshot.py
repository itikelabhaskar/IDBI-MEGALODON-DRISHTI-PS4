# scores a sample of the book through the trained bundle and writes the json the web
# console reads. includes the explained payload, so the console works with nothing
# running, and the raw fields so it can re-score live against the api when it is up.

from __future__ import annotations

import argparse
import json
import sys
from pathlib import Path

ROOT = Path(__file__).resolve().parents[2]
sys.path.insert(0, str(ROOT))

import numpy as np  # noqa: E402
import pandas as pd  # noqa: E402

from src.features.org_hierarchy import attach_org, branch_rollup  # noqa: E402
from src.ingestion.india_synth import india_split  # noqa: E402
from src.serving.scorer import RiskScorer  # noqa: E402
from src.serving.segments import SEGMENT_SPECS  # noqa: E402

OUT = ROOT / "web" / "src" / "lib" / "data" / "portfolio-snapshot.json"
SEGMENT = "msme_india"
SAMPLE_N = 400
TARGET = "default_12m"

# PD at/above which the console treats an account as flagged. RG5 is the first
# Amber grade in framework.interpretation, so this is the model↔policy handover
# point rather than an arbitrary cutoff.
FLAG_THRESHOLD = 0.16

# Raw canonical fields echoed into the snapshot so the console can POST them
# back to /score/{segment} for a live re-score.
RAW_FIELDS = [
    "sub_segment", "sector", "state", "ticket_size", "tenure_months",
    "vintage_months", "cmr", "enquiries_6m", "interest_spread_bps",
    "gst_filing_delay_days", "gst_turnover_trend_pct", "itc_mismatch_flag",
    "emi_bounce_6m", "cashflow_volatility", "balance_trend_pct",
    "credit_turnover_ratio", "current_ratio",
    "electricity_consumption_trend_pct", "upi_inflow_stability",
    "nbr_stress_score", "nbr_bounce_share", "officer_note",
    "drawing_power_gap_pct", "demanded_vs_collected_ratio", "lien_flag",
    "restructuring_flag", "cibil_score", "sanction_limit", "drawing_power",
    "dpd", "overdue_amt",
]


def _clean(value):
    if value is None:
        return None
    if isinstance(value, (np.integer,)):
        return int(value)
    if isinstance(value, (np.floating,)):
        return None if np.isnan(value) else round(float(value), 6)
    if isinstance(value, (np.bool_, bool)):
        return bool(value)
    if isinstance(value, float):
        return None if pd.isna(value) else round(value, 6)
    return value


def _reason_codes(result: dict) -> list[dict]:
    out = []
    for r in result.get("reason_codes") or []:
        out.append(
            {
                "feature": r.get("feature", ""),
                "label": r.get("label") or r.get("feature", ""),
                "direction": (
                    "raises_risk" if "increases" in str(r.get("effect", "")) else "lowers_risk"
                ),
                "impact": _clean(r.get("shap", 0.0)),
                "taxonomy_code": r.get("code", "OTHER"),
            }
        )
    return out


def _ews(result: dict) -> list[dict]:
    sev_detail = {
        "high": "High-severity RBI early-warning signal — act now.",
        "medium": "Medium-severity signal — verify at the next review.",
        "low": "Low-severity signal — monitor.",
    }
    return [
        {
            "code": s.get("code", ""),
            "name": s.get("label", ""),
            "severity": s.get("severity", "low"),
            "detail": sev_detail.get(s.get("severity", "low"), ""),
        }
        for s in (result.get("ews") or {}).get("signals", [])
    ]


def _model_card(pds: np.ndarray, actuals: np.ndarray | None, flagged: np.ndarray) -> dict:
    mdir = ROOT / "models_store" / "india"
    metrics_path, op_path = mdir / "metrics.json", mdir / "operating_points.json"
    metrics = json.loads(metrics_path.read_text(encoding="utf-8")) if metrics_path.exists() else {}
    op = json.loads(op_path.read_text(encoding="utf-8")) if op_path.exists() else {}

    overall = metrics.get("overall", {})
    raw = overall.get("lightgbm_raw") or overall.get("blend_raw") or {}
    cal = overall.get("lightgbm_calibrated") or overall.get("blend_calibrated") or raw

    if not raw:
        raise SystemExit(
            f"No usable metrics in {metrics_path}. Train the India segment first:\n"
            "  uv run python -m src.pipelines.run_india"
        )

    propensity = None
    if actuals is not None and flagged.any():
        propensity = float(np.asarray(actuals)[flagged].mean())

    return {
        "auc": round(float(raw["roc_auc"]), 4),
        "capture_top10": round(float(raw["capture_top_decile"]), 4),
        "lift_top10": round(float(raw["lift_top_decile"]), 2),
        "brier_calibrated": round(float(cal["brier"]), 4),
        "base_default_rate": round(
            float(op.get("base_default_rate", raw.get("default_rate", 0.0))), 4
        ),
        "propensity_at_threshold": round(propensity, 4) if propensity is not None else None,
        "flag_rate": round(float(flagged.mean()), 4),
        "threshold": FLAG_THRESHOLD,
        "n_test": int(raw.get("n", 0)),
        # the console reads this snapshot when no API is up, which is the only mode a
        # static deployment has. carry the measured fairness verdict so the governance
        # page never has to fall back to a number nobody computed.
        "fairness": _fairness_card(mdir),
    }


def _fairness_card(mdir) -> dict:
    path = mdir / "fairness.json"
    if not path.exists():
        return {"status": "not audited", "disparate_impact_ratio": None}
    f = json.loads(path.read_text(encoding="utf-8"))
    return {
        "status": "compliant" if f.get("all_attributes_pass") else "review",
        "disparate_impact_ratio": f.get("disparate_impact_ratio"),
        "headline_attribute": f.get("headline_attribute"),
        "worst_attribute": f.get("worst_attribute"),
        "worst_disparate_impact_ratio": f.get("worst_disparate_impact_ratio"),
        "failing_attributes": f.get("failing_attributes") or [],
        "all_attributes_pass": bool(f.get("all_attributes_pass")),
    }


def _branch_summary(scorer: RiskScorer, canonical: pd.DataFrame, spec) -> list[dict]:
    _, _, te = india_split(canonical)
    cohort = canonical[te].reset_index(drop=True)

    scored = scorer.score_frame(cohort)
    scored["loan_id"] = cohort["loan_id"].to_numpy()
    scored["state"] = cohort["state"].astype(str).to_numpy()
    scored["default_12m"] = cohort[TARGET].to_numpy()

    rolled = branch_rollup(attach_org(scored), flag_threshold=FLAG_THRESHOLD)
    print(
        f"[snapshot] branch rollup: {len(rolled)} branches over {len(cohort):,} "
        f"held-out accounts (~{len(cohort) // max(len(rolled), 1)} per branch)"
    )

    out: list[dict] = []
    for _, r in rolled.iterrows():
        out.append(
            {
                "zone": r["zone"],
                "region": r["region"],
                "branch_code": r["branch_code"],
                "branch_name": r["branch_name"],
                "accounts": int(r["accounts"]),
                "avg_pd": round(float(r["avg_pd"]), 4),
                "max_pd": round(float(r["max_pd"]), 4),
                "flagged": int(r["flagged"]),
                "flag_rate": round(float(r["flag_rate"]), 4),
                "ecl": round(float(r.get("ecl", 0.0)), 0),
                "ead": round(float(r.get("ead", 0.0)), 0),
                "green": int(r.get("green", 0)),
                "amber": int(r.get("amber", 0)),
                "red": int(r.get("red", 0)),
                "actual_default_rate": round(float(r.get("actual_default_rate", 0.0)), 4),
            }
        )
    return out


def main() -> None:
    ap = argparse.ArgumentParser(description="Build the web console portfolio snapshot.")
    ap.add_argument("--sample", type=int, default=SAMPLE_N)
    ap.add_argument("--no-explain", action="store_true",
                    help="skip SHAP/EWS per borrower (much faster, empty panels)")
    args = ap.parse_args()

    spec = SEGMENT_SPECS[SEGMENT]
    scorer = RiskScorer(SEGMENT)
    canonical = spec.load_canonical()

    sample = canonical.sample(
        n=min(args.sample, len(canonical)), random_state=42
    ).reset_index(drop=True)
    # Organisational overlay — display/routing only, never a model input.
    sample = attach_org(sample)

    explain = not args.no_explain
    print(f"[snapshot] scoring {len(sample)} borrowers from {SEGMENT} (explain={explain}) …")

    def _score_records(cohort: pd.DataFrame, seg_name: str, cohort_spec, cohort_scorer) -> list[dict]:
        res_list: list[dict] = []
        for i, (_, row) in enumerate(cohort.iterrows()):
            rec = row.to_dict()
            result = cohort_scorer.score_record(rec, explain=explain)
            if result.get("status") != "ok":
                continue

            raw_fields = {f: _clean(rec.get(f)) for f in RAW_FIELDS if f in rec}
            res_list.append(
                {
                    "loan_id": str(rec.get("loan_id", i)),
                    "segment": seg_name,
                    "pd": _clean(result["pd_12m"]),
                    "risk_grade": result["risk_grade"],
                    "rag": result["rag"],
                    "sma_status": result["sma_watch"],
                    "action": result["recommended_action"],
                    "cadence": result["review_cadence"],
                    "owner": result["action_owner"],
                    "ead": _clean(rec.get(cohort_spec.ead_col, 0.0)),
                    "ecl": _clean(result.get("ecl", 0.0)),
                    "ecl_stage": _clean(result.get("ecl_stage", 1)),
                    "lifetime_ecl": _clean(result.get("lifetime_ecl")),
                    "currency": result.get("currency", cohort_spec.currency),
                    "coverage": result.get("coverage", {}).get("status", "full"),
                    "fields_defaulted": [],
                    "reason_codes": _reason_codes(result),
                    "ews_triggers": _ews(result),
                    "stress_horizon": {
                        "expected_stress_month": (result.get("stress_horizon") or {}).get(
                            "stress_horizon_m"
                        ),
                        "quarter": "",
                        "estimated": bool(
                            (result.get("stress_horizon") or {}).get("estimated", True)
                        ),
                    },
                    "actual_default": (
                        int(rec[TARGET]) if TARGET in rec and pd.notna(rec[TARGET]) else None
                    ),
                    "sector": _clean(rec.get("sector")),
                    "state": _clean(rec.get("state")),
                    "ticket_size": _clean(rec.get("ticket_size")),
                    "sub_segment": _clean(rec.get("sub_segment")),
                    "zone": _clean(rec.get("zone")),
                    "region": _clean(rec.get("region")),
                    "branch_code": _clean(rec.get("branch_code")),
                    "branch_name": _clean(rec.get("branch_name")),
                    "raw": raw_fields,
                }
            )
        return res_list

    india_borrowers = _score_records(sample, SEGMENT, spec, scorer)

    idbi_borrowers: list[dict] = []
    if "msme_idbi" in SEGMENT_SPECS:
        try:
            idbi_spec = SEGMENT_SPECS["msme_idbi"]
            idbi_can = idbi_spec.load_canonical()
            idbi_s = idbi_can.sample(n=min(150, len(idbi_can)), random_state=42).reset_index(drop=True)
            idbi_s = attach_org(idbi_s)
            idbi_scorer = RiskScorer("msme_idbi")
            idbi_borrowers = _score_records(idbi_s, "msme_idbi", idbi_spec, idbi_scorer)
            print(f"[snapshot] scored {len(idbi_borrowers)} IDBI Finacle borrowers")
        except Exception as exc:
            print(f"[snapshot] warning: could not include IDBI cohort: {exc}")

    borrowers = idbi_borrowers + india_borrowers

    pds = np.array([b["pd"] for b in borrowers], dtype=float)
    flagged = pds >= FLAG_THRESHOLD
    actuals = np.array(
        [b["actual_default"] for b in borrowers], dtype=float
    ) if all(b["actual_default"] is not None for b in borrowers) else None

    snapshot = {
        "generated_at": pd.Timestamp.now(tz="UTC").isoformat(),
        "segment": SEGMENT,
        "model_card": _model_card(pds, actuals, flagged),
        "branches": _branch_summary(scorer, canonical, spec),
        "borrowers": borrowers,
    }

    OUT.parent.mkdir(parents=True, exist_ok=True)
    OUT.write_text(json.dumps(snapshot, indent=1), encoding="utf-8")

    card = snapshot["model_card"]
    n_reasons = sum(1 for b in borrowers if b["reason_codes"])
    n_ews = sum(1 for b in borrowers if b["ews_triggers"])
    print(
        f"[snapshot] wrote {OUT}\n"
        f"           {len(borrowers)} borrowers · {n_reasons} with reason codes · "
        f"{n_ews} with EWS triggers\n"
        f"           {len(snapshot['branches'])} branches rolled up\n"
        f"           AUC {card['auc']} · capture@10% {card['capture_top10']} · "
        f"propensity@{card['threshold']} {card['propensity_at_threshold']}"
    )


if __name__ == "__main__":
    main()
