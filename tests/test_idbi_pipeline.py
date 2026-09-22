# the sandbox segment trains and scores end to end.

import pytest
from src.serving.scorer import RiskScorer


def test_idbi_native_model_bundle():
    scorer = RiskScorer("msme_idbi")
    assert scorer.segment == "msme_idbi"
    assert scorer.spec.model_dir_name == "idbi"

    # Prime borrower
    prime = scorer.score_record({
        "ticket_size": 2000000.0,
        "sanction_limit": 2000000.0,
        "drawing_power": 2000000.0,
        "drawing_power_gap_pct": 0.0,
        "demanded_vs_collected_ratio": 1.0,
        "cibil_score": 780.0,
        "dpd": 0.0,
        "lien_flag": 0,
        "restructuring_flag": 0,
    })
    assert prime["status"] == "ok"
    assert prime["risk_grade"] in ("RG1", "RG2")
    assert prime["ecl_stage"] == 1
    assert prime["ews"]["n_triggers"] == 0

    # Stressed borrower
    stressed = scorer.score_record({
        "ticket_size": 2000000.0,
        "drawing_power_gap_pct": 35.0,
        "demanded_vs_collected_ratio": 0.70,
        "cibil_score": 580.0,
        "dpd": 60.0,
        "lien_flag": 1,
    })
    assert stressed["status"] == "ok"
    assert stressed["risk_grade"] in ("RG9", "RG10")
    assert stressed["ecl_stage"] in (2, 3)
    codes = [sig["code"] for sig in stressed["ews"]["signals"]]
    assert "EWS18" in codes  # Drawing power gap >= 25%
    assert "EWS19" in codes  # Collection shortfall < 80%

