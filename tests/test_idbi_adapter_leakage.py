# guards the sandbox-shaped generator against label leaking into its own features.

from __future__ import annotations

import pandas as pd
import pytest

from src.ingestion.idbi_adapter import (
    engineer_idbi_features,
    generate_idbi_synthetic_canonical,
    to_canonical_frame,
)


def test_t0_dpd_filtering():
    records = [
        {"loan_id": "LN_01", "segment": "msme_idbi", "dpd": 15, "default_12m": 0, "origination_date": "2023-01-01"},
        {"loan_id": "LN_02", "segment": "msme_idbi", "dpd": 60, "default_12m": 1, "origination_date": "2023-01-01"},
        {"loan_id": "LN_03", "segment": "msme_idbi", "dpd": 90, "default_12m": 1, "origination_date": "2023-01-01"},
        {"loan_id": "LN_04", "segment": "msme_idbi", "dpd": 120, "default_12m": 1, "origination_date": "2023-01-01"},
    ]
    df = to_canonical_frame(records)
    # LN_03 and LN_04 must be pruned because DPD >= 90 at T0
    assert len(df) == 2
    assert set(df["loan_id"]) == {"LN_01", "LN_02"}
    assert (df["dpd"] < 90).all()


def test_no_dpd_circular_leakage_in_emi_bounce():
    # If two borrowers have identical demand collection ratios but different DPD,
    # emi_bounce_6m must NOT be influenced by DPD (purely cashflow stress driven).
    df = pd.DataFrame([
        {
            "loan_id": "A",
            "segment": "msme_idbi",
            "demanded_vs_collected_ratio": 0.98,
            "dpd": 0,
            "cibil_score": 750,
            "ticket_size": 1_000_000,
        },
        {
            "loan_id": "B",
            "segment": "msme_idbi",
            "demanded_vs_collected_ratio": 0.98,
            "dpd": 60,
            "cibil_score": 750,
            "ticket_size": 1_000_000,
        },
    ])
    feats = engineer_idbi_features(df)
    # Both have excellent debt collection (0.98), so neither should have synthetic DPD-derived bounces
    assert feats.loc[0, "emi_bounce_6m"] == 0.0
    assert feats.loc[1, "emi_bounce_6m"] == 0.0


def test_synthetic_canonical_cohort_has_no_defaulted_accounts():
    df = generate_idbi_synthetic_canonical(n=100, seed=42)
    assert len(df) == 100
    assert (df["dpd"] < 90).all()
    assert "default_12m" in df.columns


def test_build_idbi_canonical_strict_t0():
    from src.ingestion.idbi_adapter import build_idbi_canonical
    df = build_idbi_canonical()
    assert len(df) >= 100
    assert "dpd" in df.columns
    assert (df["dpd"] < 90).all(), "Loaded canonical dataset must have 0 accounts with DPD >= 90"


def test_mixed_nan_batch_feature_engineering():
    # If a batch has row 0 with emi_bounce_6m provided and row 1 missing,
    # row 1 must be correctly derived from demanded_vs_collected_ratio.
    df = pd.DataFrame([
        {
            "loan_id": "ROW_0",
            "segment": "msme_idbi",
            "emi_bounce_6m": 1.0,
            "demanded_vs_collected_ratio": 0.99,
            "drawing_power_gap_pct": 10.0,
            "cibil_score": 750,
            "ticket_size": 1_000_000,
        },
        {
            "loan_id": "ROW_1",
            "segment": "msme_idbi",
            "emi_bounce_6m": None,
            "demanded_vs_collected_ratio": 0.60,
            "drawing_power_gap_pct": 35.0,
            "cibil_score": 620,
            "ticket_size": 2_000_000,
        },
    ])
    feats = engineer_idbi_features(df)
    assert feats.loc[0, "emi_bounce_6m"] == 1.0
    assert feats.loc[1, "emi_bounce_6m"] == 3.0  # < 0.70 ratio maps to 3 bounces
    assert feats.loc[1, "cashflow_volatility"] == pytest.approx(0.70)

