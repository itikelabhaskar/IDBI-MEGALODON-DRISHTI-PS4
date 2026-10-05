"""Days-past-due regulatory floor: RBI SMA buckets and Ind AS 109 stage backstops.

DPD is excluded from the PD model on purpose (circular leakage), so these tests
pin both halves of the contract: the classification follows DPD, and the
probability does not.
"""

from __future__ import annotations

import math

import pytest

from src.framework.interpretation import calculate_ind_as_109_ecl, dpd_regulatory_floor


@pytest.mark.parametrize(
    "dpd, bucket, stage",
    [
        (1, "SMA-0", 1),
        (30, "SMA-0", 1),
        (31, "SMA-1", 2),
        (60, "SMA-1", 2),
        (61, "SMA-2", 2),
        (90, "SMA-2", 2),
        (91, "NPA", 3),
        (365, "NPA", 3),
    ],
)
def test_rbi_bucket_boundaries(dpd, bucket, stage):
    floor = dpd_regulatory_floor(dpd)
    assert floor is not None
    assert floor.bucket == bucket
    assert floor.stage_floor == stage


@pytest.mark.parametrize("dpd", [0, -5, None, "n/a", math.nan, math.inf])
def test_current_or_unusable_dpd_sets_no_floor(dpd):
    assert dpd_regulatory_floor(dpd) is None


def test_stage_floor_raises_stage_but_never_lowers_it():
    ead = 1_000_000.0
    # RG2 on its own is Stage 1 / 12-month ECL.
    base = calculate_ind_as_109_ecl(0.03, ead, grade="RG2")
    assert base["ecl_stage"] == 1

    s2 = calculate_ind_as_109_ecl(0.03, ead, grade="RG2", stage_floor=2)
    assert s2["ecl_stage"] == 2
    assert s2["ecl"] == pytest.approx(s2["lifetime_ecl"])

    # Credit-impaired: the RBI sub-standard floor applies to a model grade of RG2.
    s3 = calculate_ind_as_109_ecl(0.03, ead, grade="RG2", stage_floor=3)
    assert s3["ecl_stage"] == 3
    assert s3["ecl"] == pytest.approx(0.25 * ead)

    # A floor below the grade's own stage changes nothing.
    rg9 = calculate_ind_as_109_ecl(0.5, ead, grade="RG9", stage_floor=1)
    assert rg9 == calculate_ind_as_109_ecl(0.5, ead, grade="RG9")


@pytest.fixture(scope="module")
def client():
    from fastapi.testclient import TestClient

    from src.serving.api import app
    from src.serving.segments import available_segments

    if "msme_idbi" not in available_segments():
        pytest.skip("msme_idbi model bundle not present")
    return TestClient(app)


_CLEAN = {
    "loan_id": "DPD-T",
    "ticket_size": 2_500_000,
    "sanction_limit": 2_500_000,
    "drawing_power": 2_500_000,
    "drawing_power_gap_pct": 0,
    "demanded_vs_collected_ratio": 0.98,
    "cibil_score": 740,
    "emi_bounce_6m": 0,
    "lien_flag": 0,
    "restructuring_flag": 0,
    "sector": "auto_ancillary",
    "sub_segment": "small",
    "state": "MH",
}


def test_dpd_drives_classification_not_probability(client):
    current = client.post("/score/msme_idbi", json={**_CLEAN, "dpd": 0}).json()
    overdue = client.post("/score/msme_idbi", json={**_CLEAN, "dpd": 75}).json()

    # the model is untouched ...
    assert overdue["pd_12m"] == current["pd_12m"]
    assert overdue["risk_grade"] == current["risk_grade"]
    # ... but a 75-DPD account is SMA-2, red, and at least Stage 2
    assert current["regulatory_overlay"] is None
    assert overdue["sma_watch"] == "Early watch 3"
    assert overdue["rag"] == "Red"
    assert overdue["ecl_stage"] >= 2
    assert overdue["ecl"] > current["ecl"]
    assert overdue["regulatory_overlay"]["applied"] is True
    assert overdue["regulatory_overlay"]["model_grade"] == current["risk_grade"]


def test_floor_never_softens_a_worse_model_verdict(client):
    stressed = {
        **_CLEAN,
        "cibil_score": 520,
        "demanded_vs_collected_ratio": 0.5,
        "cashflow_volatility": 0.8,
    }
    without = client.post("/score/msme_idbi", json={**stressed, "dpd": 0}).json()
    with_dpd = client.post("/score/msme_idbi", json={**stressed, "dpd": 10}).json()
    assert with_dpd["regulatory_overlay"]["applied"] is False
    for k in ("risk_grade", "rag", "sma_watch", "recommended_action", "ecl_stage", "ecl"):
        assert with_dpd[k] == without[k]
