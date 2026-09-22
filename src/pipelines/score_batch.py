# nightly job. scores a portfolio file into a graded, actionable output and prints
# the grade distribution, watchlist size and total ECL.

from __future__ import annotations

import argparse
from datetime import datetime, timezone
from pathlib import Path
from typing import Any

import pandas as pd

from src.config import MODELS_DIR
from src.db.session import log_drift_fairness_run, log_watchlist_run
from src.eval.metrics import psi
from src.framework.interpretation import grade_order
from src.ingestion.sba_adapter import load_raw_sba, to_canonical
from src.serving.scorer import RiskScorer
from src.storage.s3_io import is_s3_uri, load_parquet, save_parquet


def run(
    input_path: Path | str,
    output_path: Path | str,
    raw: bool = False,
    segment: str = "msme_sba",
    db_url_or_path: Path | str | None = None,
) -> dict[str, Any]:
    input_str = str(input_path)

    if raw and segment == "msme_sba":
        canonical = to_canonical(load_raw_sba(Path(input_str)))
    elif is_s3_uri(input_str) or input_str.endswith(".parquet"):
        canonical = load_parquet(input_str)
    elif input_str.endswith(".csv"):
        canonical = pd.read_csv(input_str)
    else:
        canonical = pd.read_parquet(input_str)

    scorer = RiskScorer(segment)
    scored = scorer.score_frame(canonical)

    keep = [
        c for c in [
            "loan_id", "pd", "risk_grade", "risk_band", "sma_watch",
            "recommended_action", "review_cadence", "action_owner", "ecl",
        ]
        if c in scored.columns
    ]
    out = scored[keep]

    # Save to S3 or local path
    saved_loc = save_parquet(out, output_path)

    # Compute execution telemetry
    now_str = datetime.now(timezone.utc).strftime("%Y%m%d_%H%M%S")
    run_id = f"batch_{now_str}_{segment}"

    total_accs = len(out)
    high_severe = int(out["risk_band"].isin(["high", "severe"]).sum()) if "risk_band" in out.columns else 0
    total_ecl = float(out["ecl"].sum()) if "ecl" in out.columns else 0.0
    mean_pd = float(out["pd"].mean()) if "pd" in out.columns else 0.0
    max_pd = float(out["pd"].max()) if "pd" in out.columns else 0.0

    grade_counts = {}
    if "risk_grade" in out.columns:
        grade_counts = out["risk_grade"].value_counts().to_dict()

    # 1. Log run metadata to RDS PostgreSQL
    log_watchlist_run(
        run_id=run_id,
        segment=segment,
        total_accounts=total_accs,
        high_severe_count=high_severe,
        total_ecl=total_ecl,
        mean_pd=mean_pd,
        max_pd=max_pd,
        grade_distribution=grade_counts,
        storage_path=saved_loc,
        status="completed",
        url_or_path=db_url_or_path,
    )

    # 2. Automated drift (PSI) check against benchmark validation distribution
    # Alert triggered if PSI exceeds 0.25 (model-risk note threshold)
    drift_alert = False
    drift_val = 0.0
    if len(out) > 50 and "pd" in out.columns:
        pds = out["pd"].to_numpy()
        ref_pds = None
        ref_candidates = [
            scorer.spec.model_dir / "scored_portfolio.parquet",
            MODELS_DIR / segment / "scored_portfolio.parquet",
            MODELS_DIR / segment / "baseline_pd.parquet",
        ]
        for cand in ref_candidates:
            if cand.exists() and cand.resolve() != Path(output_path).resolve():
                try:
                    ref_df = pd.read_parquet(cand)
                    if "pd" in ref_df.columns and len(ref_df) >= 50:
                        ref_pds = ref_df["pd"].to_numpy()
                        break
                except Exception:
                    continue

        if ref_pds is not None and len(ref_pds) >= 50:
            drift_val = float(psi(ref_pds, pds))
        else:
            mid = len(pds) // 2
            drift_val = float(psi(pds[:mid], pds[mid:]))

        drift_alert = bool(drift_val > 0.25)
        log_drift_fairness_run(
            run_id=run_id,
            segment=segment,
            overall_psi=drift_val,
            alert_triggered=drift_alert,
            url_or_path=db_url_or_path,
        )

    print(f"[score_batch] scored {total_accs:,} accounts -> {saved_loc}")
    if "risk_grade" in out.columns:
        dist = out["risk_grade"].value_counts().reindex(grade_order()).fillna(0).astype(int)
        print("\nRisk-grade distribution:")
        print(dist.to_string())

    print(f"\nHigh/severe watchlist: {high_severe:,} accounts")
    print(f"Total portfolio ECL: {total_ecl:,.0f} (segment currency units)")
    print(f"Watchlist Run ID: {run_id} (logged to RDS)")
    if drift_alert:
        print(f"WARNING: Model drift alert! PSI={drift_val:.4f} > 0.25")

    return {
        "run_id": run_id,
        "segment": segment,
        "total_accounts": total_accs,
        "high_severe_count": high_severe,
        "total_ecl": total_ecl,
        "mean_pd": mean_pd,
        "storage_path": saved_loc,
        "psi": drift_val,
        "drift_alert": drift_alert,
    }


def main() -> None:
    parser = argparse.ArgumentParser(description="Batch-score a loan portfolio.")
    parser.add_argument("--input", required=True, type=str)
    parser.add_argument(
        "--output", type=str, default=None
    )
    parser.add_argument("--raw", action="store_true", help="input is a raw SBA CSV export")
    parser.add_argument("--segment", default="msme_sba", help="segment model to score with")
    parser.add_argument("--db-url", default=None, help="Database connection URL (PostgreSQL or SQLite)")
    args = parser.parse_args()

    out_path = args.output
    if not out_path:
        out_path = str(MODELS_DIR / args.segment / "scored_portfolio.parquet")

    run(args.input, out_path, args.raw, args.segment, args.db_url)


if __name__ == "__main__":
    main()
