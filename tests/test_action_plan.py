"""Action plan: same levers as the recourse search, borrower and bank apart."""
from __future__ import annotations

import pytest
from fastapi.testclient import TestClient

from src.serving.api import app


@pytest.fixture
def client():
    return TestClient(app)


def _stressed(client, segment: str) -> str:
    rows = client.get(f"/portfolio?limit=2000&segment={segment}").json()["borrowers"]
    return next(r["loan_id"] for r in rows if r["pd"] > 0.2)


@pytest.mark.parametrize("segment", ["msme_india", "msme_idbi"])
def test_plan_puts_borrower_actions_before_bank_actions(client, segment):
    plan = client.get(f"/action-plan/{_stressed(client, segment)}").json()
    actors = {lever["actor"] for lever in plan["levers"]}
    assert actors == {"borrower", "bank"}
    assert all(lever["plain"] for lever in plan["levers"])
    steps = [s["actor"] for s in plan["suggested"]["changes"]]
    assert steps == sorted(steps, key=lambda a: a != "borrower")  # borrower steps come first
    assert plan["suggested"]["achieved_pd"] <= plan["current"]["pd_12m"]


def test_applying_the_suggested_route_reproduces_its_pd(client):
    loan_id = _stressed(client, "msme_idbi")
    plan = client.get(f"/action-plan/{loan_id}").json()
    route = [s["change"] for s in plan["suggested"]["changes"]]
    res = client.post(f"/action-plan/{loan_id}/apply", json={"actions": route}).json()
    assert res["after"]["pd_12m"] == pytest.approx(plan["suggested"]["achieved_pd"], abs=1e-3)


def test_unknown_action_is_rejected(client):
    loan_id = _stressed(client, "msme_idbi")
    res = client.post(f"/action-plan/{loan_id}/apply", json={"actions": ["Pray"]})
    assert res.status_code == 422
