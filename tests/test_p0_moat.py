# reason taxonomy, coverage gate, policy vs model, recourse ECL and cost of error.
# all on mock bundles, so this runs without a trained model.

from __future__ import annotations

from types import SimpleNamespace

import numpy as np
import pandas as pd
import pytest


# --------------------------------------------------------------------------- #
# Taxonomy
# --------------------------------------------------------------------------- #

def test_code_for_feature_known_and_unknown():
    from src.explain.reason_taxonomy import code_for_feature

    assert code_for_feature("emi_bounce_6m") == "REPAYMENT_BEHAVIOUR"
    assert code_for_feature("emi_bounce_6m") != "OTHER"
    assert code_for_feature("totally_unknown_feature_xyz") == "OTHER"


def test_annotate_reason_has_code_and_label():
    from src.explain.reason_taxonomy import REASON_CODES, annotate_reason

    row = annotate_reason("emi_bounce_6m", shap=0.12, effect="increases_risk")
    assert row["code"] == "REPAYMENT_BEHAVIOUR"
    assert row["label"] == REASON_CODES["REPAYMENT_BEHAVIOUR"]
    assert row["feature"] == "emi_bounce_6m"
    assert row["shap"] == 0.12
    assert row["effect"] == "increases_risk"


# --------------------------------------------------------------------------- #
# Coverage
# --------------------------------------------------------------------------- #

def test_assess_coverage_empty_insufficient():
    from src.serving.coverage import assess_coverage

    out = assess_coverage("msme_india", [])
    assert out.status == "insufficient_data"
    assert out.score == 0.0
    assert out.provisional is False


def test_assess_coverage_full_when_all_families_present():
    from src.serving.coverage import assess_coverage

    # One key per msme_india family: base, cashflow, notes, graph.
    keys = ["ticket_size", "emi_bounce_6m", "officer_note", "nbr_stress_score"]
    out = assess_coverage("msme_india", keys)
    assert out.status == "full"
    assert out.score == 1.0
    assert all(out.families.values())


def test_assess_coverage_partial_provisional_or_insufficient():
    from src.serving.coverage import assess_coverage

    # 1/4 families → score 0.25 < 0.35 → insufficient_data
    one = assess_coverage("msme_india", ["ticket_size"])
    assert one.status == "insufficient_data"
    assert one.score == pytest.approx(0.25)

    # 2/4 families → score 0.50 → provisional (0.35 <= score < 0.55)
    two = assess_coverage("msme_india", ["ticket_size", "emi_bounce_6m"])
    assert two.status == "provisional"
    assert two.provisional is True
    assert two.score == pytest.approx(0.5)


# --------------------------------------------------------------------------- #
# Policy vs model
# --------------------------------------------------------------------------- #

def test_policy_vs_model_green_high_ews_disagree():
    from src.explain.policy_vs_model import compare_policy_vs_model

    out = compare_policy_vs_model(
        rag="Green",
        risk_grade="RG2",
        ews_triggers=[{"severity": "high", "code": "EWS01"}],
    )
    assert out["agree"] is False
    assert out["policy_elevated"] is True
    assert out["model_elevated"] is False
    assert out["conflicts"]


def test_policy_vs_model_red_high_ews_agree():
    from src.explain.policy_vs_model import compare_policy_vs_model

    out = compare_policy_vs_model(
        rag="Red",
        risk_grade="RG9",
        ews_triggers=[{"severity": "high", "code": "EWS01"}],
    )
    assert out["agree"] is True
    assert out["model_elevated"] is True
    assert out["policy_elevated"] is True
    assert out["conflicts"] == []


# --------------------------------------------------------------------------- #
# Recourse ECL (mock bundle — no models_store)
# --------------------------------------------------------------------------- #

def test_recommend_recourse_baseline_ecl_with_mock_bundle():
    from src.explain.recourse import SEGMENT_LEVERS, recommend_recourse

    cols = ["emi_bounce_6m", "gst_filing_delay_days", "itc_mismatch_flag", "ticket_size"]
    feat = pd.DataFrame(
        [{
            "emi_bounce_6m": 4.0,
            "gst_filing_delay_days": 45.0,
            "itc_mismatch_flag": 1.0,
            "ticket_size": 800_000.0,
        }]
    )

    def predict_pd(X: pd.DataFrame) -> np.ndarray:
        # Higher bounces / delay / mismatch → higher PD; smaller ticket helps a bit.
        bounce = X["emi_bounce_6m"].to_numpy(dtype=float)
        delay = X["gst_filing_delay_days"].to_numpy(dtype=float)
        itc = X["itc_mismatch_flag"].to_numpy(dtype=float)
        ticket = X["ticket_size"].to_numpy(dtype=float)
        raw = 0.05 + 0.04 * bounce + 0.001 * delay + 0.08 * itc + ticket / 5e7
        return np.clip(raw, 0.01, 0.95)

    bundle = SimpleNamespace(feature_cols=cols, predict_pd=predict_pd)
    out = recommend_recourse(
        bundle,
        feat,
        target_pd=0.05,
        max_steps=3,
        levers=SEGMENT_LEVERS["msme_india"],
        ead=100_000,
    )
    assert "baseline_ecl" in out
    assert out["baseline_ecl"] >= 0
    assert "achieved_ecl" in out
    assert "ecl_delta" in out


def test_recommend_recourse_msme_idbi():
    from src.explain.recourse import SEGMENT_LEVERS, recommend_recourse

    cols = ["cashflow_volatility", "balance_trend_pct", "emi_bounce_6m", "ticket_size"]
    feat = pd.DataFrame(
        [{
            "cashflow_volatility": 0.8,
            "balance_trend_pct": -15.0,
            "emi_bounce_6m": 3.0,
            "ticket_size": 2_000_000.0,
            "drawing_power_gap_pct": 35.0,
            "demanded_vs_collected_ratio": 0.70,
            "lien_flag": 1,
        }]
    )

    def predict_pd(X: pd.DataFrame) -> np.ndarray:
        vol = X["cashflow_volatility"].to_numpy(dtype=float)
        b = X["emi_bounce_6m"].to_numpy(dtype=float)
        return np.clip(0.05 + 0.1 * vol + 0.05 * b, 0.01, 0.95)

    bundle = SimpleNamespace(feature_cols=cols, predict_pd=predict_pd)
    out = recommend_recourse(
        bundle,
        feat,
        target_pd=0.10,
        max_steps=3,
        levers=SEGMENT_LEVERS["msme_idbi"],
        ead=500_000,
    )
    assert out["baseline_pd"] > 0.10
    assert len(out["changes"]) > 0
    assert out["achieved_pd"] < out["baseline_pd"]
    assert out["ecl_delta"] < 0



# --------------------------------------------------------------------------- #
# Estimated stress horizon
# --------------------------------------------------------------------------- #

def test_estimated_stress_horizon_high_pd_sets_onset():
    from src.models.survival import estimated_stress_horizon

    out = estimated_stress_horizon(pd_12m=0.2)
    assert out["estimated"] is True
    assert out["onset_month"] is not None
    assert 1 <= out["onset_month"] <= 12
    assert out["stress_horizon_m"] == 12


def test_estimated_stress_horizon_low_pd_no_stress():
    from src.models.survival import estimated_stress_horizon

    out = estimated_stress_horizon(pd_12m=0.01)
    assert out["estimated"] is True
    assert out["stress_horizon_m"] is None


# --------------------------------------------------------------------------- #
# Cost of error
# --------------------------------------------------------------------------- #

def test_illustrative_cost_of_error_small_n():
    from src.eval.cost_of_error import illustrative_cost_of_error

    out = illustrative_cost_of_error(
        n=100,
        default_rate=0.05,
        capture_top_decile=0.4,
        mean_ead=500_000,
    )
    assert out["fn_cost_ecl"] >= 0
    assert isinstance(out["why_not_accuracy"], str)
    assert len(out["why_not_accuracy"]) > 0
