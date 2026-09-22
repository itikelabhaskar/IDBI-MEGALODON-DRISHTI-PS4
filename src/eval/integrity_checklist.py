# the checks the model health tab runs live: leakage guard, refuse-to-score, metrics
# artifacts, PSI receipts, survival anchor, model bundle. each returns pass/fail/skip.

from __future__ import annotations

import json

from src.config import MODELS_DIR
from src.framework.schema import assert_no_leakage
from src.models.survival import estimated_stress_horizon
from src.serving.coverage import assess_coverage

_SEGMENT_DIR = {
    "msme_india": "india",
    "msme_sba": "sba",
    "retail_homecredit": "homecredit",
    "retail_gmsc": "gmsc",
}


def _check(name: str, status: str, detail: str) -> dict:
    return {"name": name, "status": status, "detail": detail}


def run_checklist(segment: str = "msme_india") -> list[dict]:
    results: list[dict] = []

    # 1. Leakage guard
    try:
        assert_no_leakage(["term", "gst_filing_delay_days", "cmr"])
        results.append(_check("leakage_guard", "pass", "No leakage tokens in clean feature list"))
    except ValueError as exc:
        results.append(_check("leakage_guard", "fail", str(exc)))

    # 2. Coverage refuse
    cov = assess_coverage("msme_india", [])
    if cov.status == "insufficient_data":
        results.append(_check("coverage_refuse", "pass", "Empty payload refused"))
    else:
        results.append(_check("coverage_refuse", "fail", f"Expected insufficient_data, got {cov.status}"))

    # 3. Metrics artifact
    dir_name = _SEGMENT_DIR.get(segment, segment)
    metrics_path = MODELS_DIR / dir_name / "metrics.json"
    if metrics_path.exists():
        results.append(_check("metrics_artifacts", "pass", str(metrics_path)))
    else:
        results.append(_check("metrics_artifacts", "skip", f"No metrics at {metrics_path}"))

    # 4. PSI receipt
    if metrics_path.exists():
        payload = json.loads(metrics_path.read_text())
        psi = (payload.get("meta") or {}).get("psi_train_vs_test")
        if psi:
            results.append(_check("psi_receipt", "pass", f"{len(psi)} features with PSI"))
        else:
            results.append(_check("psi_receipt", "skip", "PSI not in metrics meta"))
    else:
        results.append(_check("psi_receipt", "skip", "No metrics file"))

    # 5. Survival anchor (estimated path sanity)
    surv_path = MODELS_DIR / "survival" / "model.pkl"
    if surv_path.exists():
        h = estimated_stress_horizon(0.20)
        if h.get("estimated") and h.get("stress_horizon_m") is not None:
            results.append(_check("survival_anchor", "pass", "Estimated horizon sane at PD=20%"))
        else:
            results.append(_check("survival_anchor", "fail", f"Unexpected horizon payload: {h}"))
    else:
        results.append(_check("survival_anchor", "skip", "No survival model.pkl"))

    # 6. Model bundle
    model_path = MODELS_DIR / dir_name / "model.pkl"
    if model_path.exists():
        results.append(_check("model_bundle", "pass", str(model_path)))
    else:
        results.append(_check("model_bundle", "skip", f"No bundle at {model_path}"))

    return results
