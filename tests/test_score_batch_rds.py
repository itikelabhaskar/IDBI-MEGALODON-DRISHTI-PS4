# the batch job persists its run and its scored rows.

from __future__ import annotations

from pathlib import Path
import pytest

from src.db.session import get_drift_history, get_recent_watchlist_runs
from src.pipelines.score_batch import run


def test_score_batch_persists_to_db(tmp_path: Path):
    db_file = tmp_path / "test_score_batch.sqlite"
    input_file = Path("data/processed/msme_india.parquet")
    if not input_file.exists():
        pytest.skip("data/processed/msme_india.parquet not present")

    output_file = tmp_path / "scored_india.parquet"

    res = run(
        input_path=input_file,
        output_path=output_file,
        raw=False,
        segment="msme_india",
        db_url_or_path=db_file,
    )

    assert output_file.exists()
    assert res["total_accounts"] > 0
    assert res["segment"] == "msme_india"
    assert "batch_" in res["run_id"]

    # Verify run logged in DB
    runs = get_recent_watchlist_runs(segment="msme_india", url_or_path=db_file)
    assert len(runs) >= 1
    assert runs[0]["run_id"] == res["run_id"]
    assert runs[0]["total_accounts"] == res["total_accounts"]

    # Verify drift logged in DB
    drift = get_drift_history(segment="msme_india", url_or_path=db_file)
    assert len(drift) >= 1
    assert drift[0]["run_id"] == res["run_id"]
