# scored rows, decisions and batch runs survive a round trip through the database.

from __future__ import annotations

import os
from pathlib import Path
import pytest

from src.db.session import (
    get_db_engine,
    get_db_url,
    get_drift_history,
    get_recent_decisions,
    get_recent_watchlist_runs,
    init_db,
    log_decision,
    log_drift_fairness_run,
    log_watchlist_run,
)


@pytest.fixture
def test_db_path(tmp_path: Path):
    return tmp_path / "test_drishti.sqlite"


def test_db_url_resolution(tmp_path: Path, monkeypatch):
    p = tmp_path / "custom.sqlite"
    assert get_db_url(p).startswith("sqlite:///")

    # PostgreSQL URL rewrite
    monkeypatch.setenv("DATABASE_URL", "postgres://user:pass@host:5432/db")
    assert get_db_url().startswith("postgresql://")


def test_hitl_decision_logging_and_filtering(test_db_path: Path):
    init_db(test_db_path)

    id1 = log_decision(
        loan_id="LN_001",
        segment="msme_idbi",
        proposed_action="Review limit",
        proposed_sma="SMA-1",
        pd=0.045,
        risk_grade="RG3",
        decision="accept",
        officer="officer_alice",
        url_or_path=test_db_path,
    )
    assert id1 > 0

    id2 = log_decision(
        loan_id="LN_002",
        segment="msme_india",
        proposed_action="Request collateral",
        proposed_sma="SMA-2",
        pd=0.12,
        risk_grade="RG6",
        decision="override",
        override_action="Enhance monitoring",
        reason="Promoter injected capital",
        officer="officer_bob",
        url_or_path=test_db_path,
    )
    assert id2 > id1

    # Fetch all
    all_decs = get_recent_decisions(limit=10, url_or_path=test_db_path)
    assert len(all_decs) == 2
    assert all_decs[0]["loan_id"] == "LN_002"  # ordered by desc

    # Filter by loan_id
    filtered = get_recent_decisions(loan_id="LN_001", url_or_path=test_db_path)
    assert len(filtered) == 1
    assert filtered[0]["proposed_sma"] == "SMA-1"
    assert filtered[0]["decision"] == "accept"


def test_watchlist_run_metadata_tracking(test_db_path: Path):
    init_db(test_db_path)

    run_id = "batch_20260919_01_idbi"
    res_id = log_watchlist_run(
        run_id=run_id,
        segment="msme_idbi",
        total_accounts=250,
        high_severe_count=18,
        total_ecl=14500000.0,
        mean_pd=0.038,
        max_pd=0.45,
        grade_distribution={"RG1": 80, "RG2": 110, "RG3": 42, "RG7": 18},
        storage_path="s3://drishti-idbi-sandbox/portfolios/batch_20260919_01_idbi.parquet",
        url_or_path=test_db_path,
    )
    assert res_id == run_id

    runs = get_recent_watchlist_runs(segment="msme_idbi", url_or_path=test_db_path)
    assert len(runs) == 1
    assert runs[0]["total_accounts"] == 250
    assert runs[0]["high_severe_count"] == 18
    assert "RG7" in runs[0]["grade_distribution"]


def test_drift_fairness_history_tracking(test_db_path: Path):
    init_db(test_db_path)

    entry_id = log_drift_fairness_run(
        segment="msme_idbi",
        overall_psi=0.082,
        run_id="batch_20260919_01_idbi",
        max_feature_psi=0.14,
        alert_triggered=False,
        features_drifted=["drawing_power_gap_pct"],
        fairness_disparate_impact={"micro_vs_medium": 0.92, "textiles_vs_pharma": 0.88},
        url_or_path=test_db_path,
    )
    assert entry_id > 0

    history = get_drift_history(segment="msme_idbi", url_or_path=test_db_path)
    assert len(history) == 1
    assert history[0]["overall_psi"] == pytest.approx(0.082)
    assert history[0]["alert_triggered"] is False
    assert "drawing_power_gap_pct" in history[0]["features_drifted"]
