# three stage ECL staging, and that expected loss never falls as risk rises.

from __future__ import annotations

import pandas as pd
import pytest

from src.framework.interpretation import (
    assign_ecl_stage,
    calculate_ind_as_109_ecl,
    enrich,
    expected_credit_loss,
)


def test_assign_ecl_stage_mapping():
    # Stage 1: RG1 - RG4
    assert assign_ecl_stage("RG1") == 1
    assert assign_ecl_stage("RG2") == 1
    assert assign_ecl_stage("RG3") == 1
    assert assign_ecl_stage("RG4") == 1

    # Stage 2: RG5 - RG8 (SICR / SMA watch)
    assert assign_ecl_stage("RG5") == 2
    assert assign_ecl_stage("RG6") == 2
    assert assign_ecl_stage("RG7") == 2
    assert assign_ecl_stage("RG8") == 2

    # Stage 3: RG9 - RG10 (Impaired / Default / NPA)
    assert assign_ecl_stage("RG9") == 3
    assert assign_ecl_stage("RG10") == 3

    # Numeric PD inputs
    assert assign_ecl_stage(0.01) == 1  # RG1
    assert assign_ecl_stage(0.14) == 2  # RG5
    assert assign_ecl_stage(0.80) == 3  # RG10


def test_calculate_ind_as_109_ecl_stages():
    ead = 1_000_000.0
    lgd = 0.45

    # Stage 1 (RG3, PD = 0.05): ECL = 0.05 * 0.45 * 1,000,000 = 22,500
    res1 = calculate_ind_as_109_ecl(pd_value=0.05, ead=ead, grade="RG3", lgd=lgd)
    assert res1["ecl_stage"] == 1
    assert res1["ecl"] == pytest.approx(22_500.0)
    assert res1["ecl_12m"] == pytest.approx(22_500.0)

    # Stage 2 (RG6, PD = 0.20): Lifetime ECL = min(1.0, 2.5 * 0.20) * 0.45 * 1,000,000 = 0.50 * 0.45 * 1,000,000 = 225,000
    res2 = calculate_ind_as_109_ecl(pd_value=0.20, ead=ead, grade="RG6", lgd=lgd)
    assert res2["ecl_stage"] == 2
    assert res2["ecl"] == pytest.approx(225_000.0)
    assert res2["lifetime_ecl"] == pytest.approx(225_000.0)
    assert res2["ecl_12m"] == pytest.approx(90_000.0)

    # Stage 3 (RG9, PD = 0.50): Lifetime ECL (450,000) vs RBI Floor 25% (250,000)
    # Monotonicity: Stage 3 provision never drops below Stage 2 lifetime provision
    res3 = calculate_ind_as_109_ecl(pd_value=0.50, ead=ead, grade="RG9", lgd=lgd)
    assert res3["ecl_stage"] == 3
    assert res3["ecl"] == pytest.approx(450_000.0)

    # Stage 3 (RG10, PD = 0.90): RBI Floor 50% = 500,000 vs PD * LGD (0.90 * 0.45 = 0.405 -> 405,000)
    # Floor 50% dominates
    res4 = calculate_ind_as_109_ecl(pd_value=0.90, ead=ead, grade="RG10", lgd=lgd)
    assert res4["ecl_stage"] == 3
    assert res4["ecl"] == pytest.approx(500_000.0)


def test_expected_credit_loss_compatibility():
    # Backwards compatibility test
    ecl_flat = expected_credit_loss(0.10, 1_000_000, lgd=0.45)
    assert ecl_flat == pytest.approx(45_000.0)

    # Multi-stage test
    ecl_staged = expected_credit_loss(0.20, 1_000_000, lgd=0.45, multi_stage=True)
    assert ecl_staged == pytest.approx(225_000.0)


def test_enrich_frame_with_ecl_stage():
    df = pd.DataFrame({
        "pd": [0.03, 0.18, 0.85],
        "gr_appv": [1_000_000, 2_000_000, 500_000],
    })
    enriched = enrich(df, pd_col="pd", ead_col="gr_appv", lgd=0.45)

    assert "ecl_stage" in enriched.columns
    assert "lifetime_ecl" in enriched.columns
    assert list(enriched["ecl_stage"]) == [1, 2, 3]
    assert enriched.loc[0, "ecl"] == pytest.approx(0.03 * 0.45 * 1_000_000)
    assert enriched.loc[2, "ecl"] >= 0.50 * 500_000  # RBI RG10 floor
