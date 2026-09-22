# org overlay: deterministic branch assignment, in-state placement, rollup totals,
# and the guard that keeps branch data out of the feature matrix.

from __future__ import annotations

import subprocess
import sys

import numpy as np
import pandas as pd
import pytest

from src.features.org_hierarchy import (
    BRANCH_REGISTRY,
    ORG_COLUMNS,
    REGION_BRANCHES,
    ZONE_STRUCTURE,
    attach_org,
    branch_for,
    branch_rollup,
)

STATES = ["MH", "GJ", "TN", "KA", "DL", "UP", "WB", "RJ", "TG", "PB", "MP", "KL"]


def _frame(n: int = 300) -> pd.DataFrame:
    rng = np.random.default_rng(0)
    return pd.DataFrame(
        {
            "loan_id": [f"IN{100000 + i}" for i in range(n)],
            "state": rng.choice(STATES, size=n),
            "pd": rng.random(n) * 0.6,
            "ecl": rng.random(n) * 50_000,
            "ticket_size": rng.random(n) * 2_000_000,
            "rag": rng.choice(["Green", "Amber", "Red"], size=n),
            "default_12m": rng.integers(0, 2, n),
        }
    )


# --------------------------------------------------------------------------- #
# Registry shape
# --------------------------------------------------------------------------- #

def test_registry_is_complete_and_unique():
    n_regions = sum(len(r) for z in ZONE_STRUCTURE.values() for r in z.values())
    assert n_regions == len(REGION_BRANCHES)
    assert len(BRANCH_REGISTRY) == n_regions * 3

    codes = [b["branch_code"] for b in BRANCH_REGISTRY]
    assert len(codes) == len(set(codes)), "branch codes must be unique"
    names = [b["branch_name"] for b in BRANCH_REGISTRY]
    assert len(names) == len(set(names)), "branch names must be unique"


def test_every_generator_state_has_branches():
    covered = {b["state"] for b in BRANCH_REGISTRY}
    assert set(STATES) <= covered, f"states without branches: {set(STATES) - covered}"


# --------------------------------------------------------------------------- #
# Assignment
# --------------------------------------------------------------------------- #

def test_branch_is_always_in_the_borrowers_own_state():
    df = attach_org(_frame())
    lookup = {b["branch_code"]: b["state"] for b in BRANCH_REGISTRY}
    assert (df["branch_code"].map(lookup) == df["state"]).all()


def test_assignment_is_deterministic_within_a_process():
    df = _frame()
    assert attach_org(df)["branch_code"].equals(attach_org(df)["branch_code"])


def test_assignment_is_stable_across_processes():
    snippet = (
        "from src.features.org_hierarchy import branch_for;"
        "print(branch_for('IN123456', 'MH')['branch_code'])"
    )
    runs = {
        subprocess.run(
            [sys.executable, "-c", snippet], capture_output=True, text=True, check=True
        ).stdout.strip()
        for _ in range(2)
    }
    assert len(runs) == 1, f"branch assignment drifted across processes: {runs}"


def test_unknown_state_falls_back_without_raising():
    out = branch_for("IN1", "XX")
    assert out["branch_code"] == "0000" and out["zone"] == "Unassigned"


def test_attach_org_tolerates_missing_columns():
    out = attach_org(pd.DataFrame({"x": [1, 2]}))
    assert all(c in out.columns for c in ORG_COLUMNS)


def test_all_rows_get_assigned():
    df = attach_org(_frame())
    for col in ORG_COLUMNS:
        assert df[col].notna().all() and (df[col] != "").all()


# --------------------------------------------------------------------------- #
# Leakage guard — the reason this module is display-only
# --------------------------------------------------------------------------- #

def test_org_columns_are_not_model_features():
    from src.features.india_features import ALL_FEATURES

    assert not set(ORG_COLUMNS) & set(ALL_FEATURES)


def test_engineered_features_ignore_org_columns():
    from src.features.india_features import engineer_india_features
    from src.ingestion.india_synth import generate_india_msme
    from src.features.notes_signals import extract_note_signals, generate_notes

    df = generate_india_msme(n=200, seed=5)
    df["officer_note"] = generate_notes(df, seed=5)
    df = pd.concat([df, extract_note_signals(df["officer_note"])], axis=1)

    before = engineer_india_features(df)
    after = engineer_india_features(attach_org(df))
    pd.testing.assert_frame_equal(before, after)


# --------------------------------------------------------------------------- #
# Rollup
# --------------------------------------------------------------------------- #

def test_branch_rollup_totals_reconcile():
    df = attach_org(_frame(500))
    rolled = branch_rollup(df)

    assert rolled["accounts"].sum() == len(df)
    assert rolled["ecl"].sum() == pytest.approx(df["ecl"].sum())
    assert (rolled["green"] + rolled["amber"] + rolled["red"] == rolled["accounts"]).all()
    assert rolled["flagged"].sum() == int((df["pd"] >= 0.16).sum())
    assert (rolled["flag_rate"].between(0, 1)).all()
    # sorted riskiest-first: that is the controlling office's reading order
    assert rolled["avg_pd"].is_monotonic_decreasing


def test_branch_rollup_requires_org_columns():
    with pytest.raises(ValueError, match="missing columns"):
        branch_rollup(_frame())


def test_branch_rollup_survives_optional_columns_absent():
    df = attach_org(_frame())[["loan_id", "state", "pd", *ORG_COLUMNS]]
    rolled = branch_rollup(df)
    assert "ecl" not in rolled.columns and rolled["accounts"].sum() == len(df)
