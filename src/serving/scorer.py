# the one scoring path behind the api, the batch job and the console. takes a raw
# record or a frame and returns PD, grade, watch bucket, action, ECL, reason codes,
# EWS triggers and a cure path.
#
# everything segment-specific lives in segments.py, not here.

from __future__ import annotations

import joblib
import pandas as pd

from src.config import MODELS_DIR
from src.explain.ews_rules import ews_summary
from src.explain.policy_vs_model import compare_policy_vs_model
from src.explain.recourse import SEGMENT_LEVERS, recommend_recourse
from src.explain.shap_explainer import ReasonCodeExplainer
from src.framework.interpretation import (
    DEFAULT_LGD,
    assign_ecl_stage,
    assign_grade,
    calculate_ind_as_109_ecl,
    enrich,
    expected_credit_loss,
    playbook,
    rag_bucket,
)
from src.serving.coverage import CoverageResult, assess_coverage
from src.serving.segments import SEGMENT_SPECS, SegmentSpec

# India overlay fields the EWS engine may consume if supplied on the request.
_INDIA_FIELDS = [
    "gst_filing_delay_days",
    "gst_turnover_trend_pct",
    "itc_mismatch_flag",
    "emi_bounce_6m",
    "cashflow_volatility",
    "balance_trend_pct",
    "current_ratio",
]

DEFAULT_SEGMENT = "msme_sba"

_SURVIVAL_PATH = MODELS_DIR / "survival" / "model.pkl"


def _coverage_payload(cov: CoverageResult) -> dict:
    return {
        "score": round(cov.score, 4),
        "status": cov.status,
        "provisional": cov.provisional,
        "families": dict(cov.families),
        "detail": cov.detail,
    }


def _resolve_ead(record: dict, feats: pd.DataFrame, ead_col: str) -> float | None:
    import math

    ead = record.get(ead_col)
    if ead is None and ead_col in feats.columns:
        ead = feats[ead_col].iloc[0]
    try:
        ead_f = float(ead)
    except (TypeError, ValueError):
        return None
    return ead_f if math.isfinite(ead_f) else None


class RiskScorer:
    def __init__(self, segment: str = DEFAULT_SEGMENT):
        if segment not in SEGMENT_SPECS:
            raise ValueError(f"Unknown segment '{segment}'. Known: {list(SEGMENT_SPECS)}")
        self.segment = segment
        self.spec: SegmentSpec = SEGMENT_SPECS[segment]
        model_path = self.spec.model_dir / "model.pkl"

        def _is_lfs_or_invalid(p: Path) -> bool:
            if not p.exists():
                return True
            try:
                with open(p, "rb") as f:
                    head = f.read(100)
                    if head.startswith(b"version https://git-lfs") or len(head) == 0:
                        return True
            except Exception:
                return True
            return False

        if _is_lfs_or_invalid(model_path):
            if self.segment == "msme_idbi":
                from src.pipelines.run_idbi import run as run_idbi
                run_idbi(n_trials=5, n_rows=2000)
            elif self.segment == "msme_india":
                from src.pipelines.run_india import run as run_india
                run_india(n_trials=3, run_ablation=False)

        try:
            self.bundle = joblib.load(model_path)
        except Exception:
            if self.segment == "msme_idbi":
                from src.pipelines.run_idbi import run as run_idbi
                run_idbi(n_trials=5, n_rows=2000)
                self.bundle = joblib.load(model_path)
            elif self.segment == "msme_india":
                from src.pipelines.run_india import run as run_india
                run_india(n_trials=3, run_ablation=False)
                self.bundle = joblib.load(model_path)
            else:
                raise
        self._explainer: ReasonCodeExplainer | None = None
        self._hazard = None  # lazy; False = checked, unavailable

    @property
    def explainer(self) -> ReasonCodeExplainer:
        if self._explainer is None:
            self._explainer = ReasonCodeExplainer(self.bundle.model, self.bundle.feature_cols)
        return self._explainer

    def _record_to_canonical(self, record: dict) -> dict:
        return {c: record.get(c, d) for c, d in self.spec.raw_defaults.items()}

    def _get_hazard(self):
        if self._hazard is False:
            return None
        if self._hazard is not None:
            return self._hazard
        if self.segment == "msme_sba" and _SURVIVAL_PATH.exists():
            self._hazard = joblib.load(_SURVIVAL_PATH)
            return self._hazard
        self._hazard = False
        return None

    def _stress_horizon(self, feats: pd.DataFrame, pd_hat: float) -> dict:
        from src.models.survival import estimated_stress_horizon

        hazard = self._get_hazard()
        if hazard is not None:
            cols = hazard.feature_cols
            if all(c in feats.columns for c in cols):
                return hazard.stress_horizon_payload(feats[cols])
        return estimated_stress_horizon(pd_hat)

    # --- Frame scoring (batch / console) ---------------------------------
    def score_frame(self, canonical: pd.DataFrame) -> pd.DataFrame:
        feats = self.spec.engineer(canonical)
        scored = feats.copy()
        scored["pd"] = self.bundle.predict_pd(feats)
        scored = enrich(scored, pd_col="pd", ead_col=self.spec.ead_col)
        if "loan_id" in canonical.columns:
            scored.insert(0, "loan_id", canonical["loan_id"].to_numpy())
        return scored

    # --- Single-record scoring (API) -------------------------------------
    def score_record(self, record: dict, explain: bool = True) -> dict:
        provided = [
            c for c in self.spec.raw_defaults
            if c in record and record[c] is not None
        ]
        cov = assess_coverage(self.segment, provided)
        coverage = _coverage_payload(cov)

        if cov.status == "insufficient_data":
            return {
                "segment": self.segment,
                "status": "insufficient_data",
                "coverage": coverage,
                "pd_12m": None,
                "message": (
                    "Refuse to score: insufficient feature-family coverage. "
                    + cov.detail
                ),
                "fields_provided": len(provided),
                "fields_defaulted": len(self.spec.raw_defaults) - len(provided),
                "recommended_action": None,
                "sma_watch": None,
            }

        canonical = pd.DataFrame([self._record_to_canonical(record)])
        feats = self.spec.engineer(canonical)
        pd_hat = float(self.bundle.predict_pd(feats)[0])
        grade = assign_grade(pd_hat)
        act = playbook(grade)
        rag = rag_bucket(grade)

        ead = _resolve_ead(record, feats, self.spec.ead_col)
        ecl_info = (
            calculate_ind_as_109_ecl(pd_hat, ead, grade=grade, lgd=DEFAULT_LGD)
            if ead is not None
            else None
        )
        result: dict = {
            "segment": self.segment,
            "status": "ok",
            "provisional": cov.provisional,
            "coverage": coverage,
            "pd_12m": round(pd_hat, 4),
            "risk_grade": grade,
            "rag": rag,
            "risk_band": act.band,
            "sma_watch": act.sma_watch,
            "recommended_action": act.action,
            "review_cadence": act.cadence,
            "action_owner": act.owner,
            "ecl": (
                round(ecl_info["ecl"], 2)
                if ecl_info is not None
                else None
            ),
            "ecl_stage": (
                ecl_info["ecl_stage"]
                if ecl_info is not None
                else assign_ecl_stage(grade)
            ),
            "lifetime_ecl": (
                round(ecl_info["lifetime_ecl"], 2)
                if ecl_info is not None
                else None
            ),
            "lgd_assumed": DEFAULT_LGD,
            "ead": ead,
            "currency": self.spec.currency,
            "fields_provided": len(provided),
            "fields_defaulted": len(self.spec.raw_defaults) - len(provided),
        }

        # EWS: base numeric features + any India overlay fields on the request.
        # EWS: engineered features + any raw record fields (e.g. lien_flag, restructuring_flag).
        ews_row = {
            c: (float(feats[c].iloc[0]) if c not in self.spec.categorical_features else feats[c].iloc[0])
            for c in feats.columns
        }
        for f in _INDIA_FIELDS:
            if f in record and record[f] is not None:
                ews_row[f] = record[f]
        for k, v in record.items():
            if v is not None:
                ews_row.setdefault(k, v)
        result["ews"] = ews_summary(ews_row)

        if explain:
            result["reason_codes"] = self.explainer.reason_codes(feats, top_k=6)

        result["policy_vs_model"] = compare_policy_vs_model(
            rag=rag,
            risk_grade=grade,
            ews_triggers=result["ews"].get("signals", []),
        )
        result["stress_horizon"] = self._stress_horizon(feats, pd_hat)

        if explain and self.segment in SEGMENT_LEVERS and pd_hat > 0.11:
            result["cure_path"] = recommend_recourse(
                self.bundle,
                feats,
                ead=ead if ead is not None else 0,
                levers=SEGMENT_LEVERS[self.segment],
            )
        return result
