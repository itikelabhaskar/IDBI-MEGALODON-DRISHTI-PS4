"""Batch upload bounds: oversize extracts are refused, unscorable rows are reported."""
from __future__ import annotations

import pytest
from fastapi.testclient import TestClient

import src.serving.api as api


@pytest.fixture
def client():
    return TestClient(api.app)


def test_batch_over_row_limit_is_413(client, monkeypatch):
    monkeypatch.setattr(api, "MAX_BATCH_ROWS", 2)
    rows = [{"loan_id": f"LIM_{i}", "sanction_limit": 1_000_000} for i in range(3)]
    res = client.post("/batch/upload", json={"records": rows, "persist": False})
    assert res.status_code == 413


class _RefusingScorer:
    def score_record(self, record, explain=False):
        return {"status": "insufficient_data", "pd_12m": None, "message": "Refuse to score: thin data"}


def test_refused_rows_are_reported_not_scored(client, monkeypatch):
    monkeypatch.setattr(api, "get_scorer", lambda segment="msme_idbi": _RefusingScorer())
    res = client.post("/batch/upload", json={"records": [{"loan_id": "THIN_1"}], "persist": False})
    # Before: float(None) raised and the whole request failed with a 500.
    assert res.status_code == 422
    assert res.json()["detail"]["refused"][0]["loan_id"] == "THIN_1"
