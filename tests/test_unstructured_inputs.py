"""Officer-note and bank-statement reading for one account (nothing is saved)."""
from __future__ import annotations

import pytest
from fastapi.testclient import TestClient

from src.serving.api import app


@pytest.fixture
def client():
    return TestClient(app)


def _account(client, segment: str, rag: str = "Green") -> dict:
    rows = client.get(f"/portfolio?limit=2000&segment={segment}").json()["borrowers"]
    return next(r for r in rows if r["rag"] == rag)


def test_stressed_statement_raises_pd_and_healthy_does_not(client):
    acct = _account(client, "msme_idbi")
    stressed = client.get("/unstructured/sample-statement?kind=stressed").json()
    healthy = client.get("/unstructured/sample-statement?kind=healthy").json()

    s = client.post("/unstructured/statement", json={"loan_id": acct["loan_id"], "statement": stressed}).json()
    h = client.post("/unstructured/statement", json={"loan_id": acct["loan_id"], "statement": healthy}).json()

    assert s["transactions"] > 50 and s["derived"]["emi_bounce_6m"] > 0
    assert s["derived"]["circular_tx_flag"] == 1
    assert s["after"]["pd_12m"] > s["before"]["pd_12m"]
    assert h["after"]["pd_12m"] <= h["before"]["pd_12m"] + 1e-9


def test_note_is_masked_read_and_not_saved(client):
    acct = _account(client, "msme_india", rag="Amber")
    before = client.get(f"/borrowers/{acct['loan_id']}").json()
    res = client.post(
        "/unstructured/note",
        json={
            "loan_id": acct["loan_id"],
            "text": "Promoter (PAN ABCDE1234F, 98765 43210): buyer cancelled orders, machines idle; "
                    "promise to clear overdue not honoured; litigation notice seen.",
        },
    ).json()
    assert "ABCDE1234F" not in res["masked_text"] and res["pii_masked"] is True
    signals = {s["key"]: s["value"] for s in res["signals"]}
    assert signals["note_business_disruption"] == 1 and signals["note_dispute_litigation"] == 1
    assert res["model_uses_notes"] is True
    # The uncalibrated score is returned so a PD left on the same calibration
    # step can still show whether the note registered; a stressed note never lowers it.
    assert res["raw_score"]["after"] >= res["raw_score"]["before"] > 0
    after_call = client.get(f"/borrowers/{acct['loan_id']}").json()
    assert after_call["pd"] == before["pd"]  # analysis only, the loan master is untouched


def test_idbi_note_reports_that_model_has_no_note_inputs(client):
    acct = _account(client, "msme_idbi")
    res = client.post("/unstructured/note", json={"loan_id": acct["loan_id"], "text": "Machines idle."}).json()
    assert res["model_uses_notes"] is False


def test_unknown_loan_is_404(client):
    assert client.post("/unstructured/note", json={"loan_id": "NOPE", "text": "x"}).status_code == 404
