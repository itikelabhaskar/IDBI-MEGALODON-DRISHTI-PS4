# the decisions endpoints write and read back without disturbing drift history.

from __future__ import annotations

from fastapi.testclient import TestClient
import pytest

from src.serving.api import app


@pytest.fixture
def client():
    return TestClient(app)


def test_score_msme_idbi_endpoint(client):
    payload = {
        "loan_id": "IDBI_TEST_999",
        "drawing_power_gap_pct": 15.0,
        "demanded_vs_collected_ratio": 0.92,
        "cibil_score": 720.0,
        "ticket_size": 2_500_000.0,
        "lien_flag": 0,
        "restructuring_flag": 0,
    }
    res = client.post("/score/msme_idbi", json=payload)
    assert res.status_code == 200
    data = res.json()
    assert data["segment"] == "msme_idbi"
    assert "pd_12m" in data
    assert "risk_grade" in data
    assert "ecl" in data
    assert "ecl_stage" in data
    assert data["ecl_stage"] in (1, 2, 3)


def test_score_msme_idbi_insufficient_fields(client):
    # Less than 2 fields -> 422 Unprocessable Entity
    res = client.post("/score/msme_idbi", json={"loan_id": "TEST_01"})
    assert res.status_code == 422


def test_decision_crud_lifecycle(client):
    loan_id = "LN_DECISION_TEST_01"

    # 1. Accept decision
    p1 = {
        "loan_id": loan_id,
        "decision": "accept",
        "segment": "msme_idbi",
        "proposed_action": "Standard monitoring",
        "pd": 0.03,
        "risk_grade": "RG2",
        "rationale": "Financials verified and healthy",
        "decided_by": "officer_drishti",
    }
    r1 = client.post("/decisions", json=p1)
    assert r1.status_code == 200
    d1 = r1.json()
    assert d1["id"] > 0
    assert d1["decision"] == "accept"
    assert d1["status"] == "persisted"

    # 2. Override decision via /api/decisions
    p2 = {
        "loan_id": loan_id,
        "decision": "override",
        "segment": "msme_idbi",
        "original_grade": "RG5",
        "revised_grade": "RG3",
        "rationale": "Secondary collateral pledged",
        "decided_by": "cro_senior",
    }
    r2 = client.post("/api/decisions", json=p2)
    assert r2.status_code == 200
    d2 = r2.json()
    assert d2["decision"] == "override"
    assert d2["details"]["revised_grade"] == "RG3"

    # 3. Reject decision
    p3 = {
        "loan_id": loan_id,
        "decision": "reject",
        "rationale": "High drawing power erosion and tax default",
    }
    r3 = client.post("/decisions", json=p3)
    assert r3.status_code == 200
    assert r3.json()["decision"] == "reject"

    # 4. Query decisions for loan_id
    res_list = client.get(f"/decisions/{loan_id}")
    assert res_list.status_code == 200
    records = res_list.json()
    assert len(records) >= 3
    assert records[0]["loan_id"] == loan_id

    # 5. Query all decisions
    all_res = client.get("/api/decisions")
    assert all_res.status_code == 200
    assert len(all_res.json()) >= 3


def test_decision_invalid_type_raises_400(client):
    payload = {
        "loan_id": "LN_FAIL",
        "decision": "invalid_decision_type",
    }
    res = client.post("/decisions", json=payload)
    assert res.status_code == 400


def test_decision_defer(client):
    payload = {
        "loan_id": "LN_DEFER_TEST",
        "decision": "defer",
        "rationale": "Pending Q3 GST reconciliation",
        "officer": "officer_defer",
    }
    res = client.post("/decisions", json=payload)
    assert res.status_code == 200
    data = res.json()
    assert data["decision"] == "defer"
    assert data["loan_id"] == "LN_DEFER_TEST"


def test_score_msme_idbi_triggers_ews18_19(client):
    payload = {
        "loan_id": "IDBI_EWS_TEST",
        "drawing_power_gap_pct": 32.0,
        "demanded_vs_collected_ratio": 0.65,
        "cibil_score": 640.0,
        "ticket_size": 3_000_000.0,
    }
    res = client.post("/score/msme_idbi", json=payload)
    assert res.status_code == 200
    data = res.json()
    ews_codes = [s["code"] for s in data.get("ews", {}).get("signals", [])]
    assert "EWS18" in ews_codes
    assert "EWS19" in ews_codes


def test_portfolio_endpoints(client):
    # 1. GET /portfolio
    res = client.get("/portfolio?limit=10")
    assert res.status_code == 200
    data = res.json()
    assert "borrowers" in data
    assert "total" in data
    assert len(data["borrowers"]) <= 10

    # 2. GET /api/portfolio with filtering
    res_filtered = client.get("/api/portfolio?rag=Amber&limit=5")
    assert res_filtered.status_code == 200
    amber_data = res_filtered.json()
    for b in amber_data["borrowers"]:
        assert b["rag"] == "Amber"

    # 3. GET /portfolio/summary
    res_summary = client.get("/portfolio/summary")
    assert res_summary.status_code == 200
    summary = res_summary.json()
    assert "total_accounts" in summary
    assert "total_sanctioned_book" in summary
    assert "total_ecl" in summary
    assert "model_card" in summary

    # 4. GET /branches
    res_branches = client.get("/branches")
    assert res_branches.status_code == 200
    branches = res_branches.json()
    assert isinstance(branches, list)
    if branches:
        b0 = branches[0]
        assert "branch_code" in b0
        assert "avg_pd" in b0
        assert "accounts" in b0


def test_borrower_detail_endpoint(client):
    # Fetch first borrower from portfolio
    res_port = client.get("/portfolio?limit=1")
    assert res_port.status_code == 200
    items = res_port.json().get("borrowers", [])
    if items:
        loan_id = items[0]["loan_id"]
        res_borrower = client.get(f"/borrowers/{loan_id}")
        assert res_borrower.status_code == 200
        b_data = res_borrower.json()
        assert b_data["loan_id"] == loan_id
        assert "pd" in b_data
        assert "risk_grade" in b_data

    # 404 for non-existent borrower
    res_404 = client.get("/borrowers/NON_EXISTENT_LOAN_ID_XYZ")
    assert res_404.status_code == 404


def test_underwrite_submit_endpoint(client):
    loan_id = "UW_TEST_2026_01"
    payload = {
        "loan_id": loan_id,
        "segment": "msme_idbi",
        "sanction_limit": 3000000.0,
        "drawing_power": 2400000.0,
        "cibil_score": 710.0,
        "demanded_vs_collected_ratio": 0.95,
        "dpd": 12.0,
        "emi_bounce_6m": 1,
        "lien_flag": 0,
        "restructuring_flag": 0,
        "gst_filing_delay_days": 8.0,
        "itc_mismatch_flag": 0,
        "sector": "auto_ancillary",
        "sub_segment": "small",
        "state": "MH",
        "branch_code": "1019",
        "decision": "override",
        "revised_grade": "RG3",
        "override_action": "Override to RG3 with increased monitoring",
        "rationale": "High promoter equity contribution verified",
        "officer": "officer_uw_test",
    }
    res = client.post("/underwrite/submit", json=payload)
    assert res.status_code == 200
    res_data = res.json()
    assert res_data["status"] == "success"
    assert res_data["loan_id"] == loan_id
    assert "borrower" in res_data
    assert res_data["decision"]["decision"] == "override"
    assert res_data["decision"]["revised_grade"] == "RG3"

    # Verify borrower now retrievable via GET /borrowers/{loan_id}
    res_get = client.get(f"/borrowers/{loan_id}")
    assert res_get.status_code == 200
    saved = res_get.json()
    assert saved["loan_id"] == loan_id
    assert saved["sanction_limit"] == 3000000.0

    # Verify decision logged in audit trail
    res_decs = client.get(f"/decisions/{loan_id}")
    assert res_decs.status_code == 200
    assert len(res_decs.json()) >= 1


def test_batch_upload_endpoint(client):
    records = [
        {
            "loan_id": "BATCH_ACC_01",
            "sanction_limit": 2000000.0,
            "drawing_power": 1800000.0,
            "cibil_score": 750.0,
            "demanded_vs_collected_ratio": 0.98,
            "dpd": 0.0,
            "emi_bounce_6m": 0,
            "sector": "auto_ancillary",
            "state": "MH",
        },
        {
            "loan_id": "BATCH_ACC_02",
            "sanction_limit": 4500000.0,
            "drawing_power": 3000000.0,
            "cibil_score": 620.0,
            "demanded_vs_collected_ratio": 0.80,
            "dpd": 35.0,
            "emi_bounce_6m": 2,
            "sector": "textiles",
            "state": "TN",
        },
    ]
    res = client.post("/batch/upload", json={"records": records, "segment": "msme_idbi"})
    assert res.status_code == 200
    data = res.json()
    assert data["status"] == "success"
    assert data["total_accounts"] == 2
    assert "run_id" in data
    assert len(data["scored_records"]) == 2

    # Verify accounts saved to database
    b1 = client.get("/borrowers/BATCH_ACC_01")
    assert b1.status_code == 200
    assert b1.json()["loan_id"] == "BATCH_ACC_01"


def test_governance_endpoints(client):
    from src.db.session import log_drift_fairness_run, get_db
    import sqlalchemy as sa

    run_id = "test_governance_drift_run"
    log_drift_fairness_run(
        segment="msme_idbi",
        overall_psi=0.042,
        run_id=run_id,
        max_feature_psi=0.086,
        alert_triggered=False,
    )

    try:
        # 1. GET /governance/drift
        res_drift = client.get("/governance/drift")
        assert res_drift.status_code == 200
        drift_list = res_drift.json()
        assert isinstance(drift_list, list)
        assert len(drift_list) >= 1
        assert any(r.get("run_id") == run_id for r in drift_list)

        # 2. GET /governance/metrics
        res_metrics = client.get("/governance/metrics")
        assert res_metrics.status_code == 200
        metrics = res_metrics.json()
        assert "auc" in metrics
        assert "brier" in metrics
        assert "psi_overall" in metrics
        assert "fairness_status" in metrics
    finally:
        with get_db() as db:
            db.execute(
                sa.text("DELETE FROM drift_fairness_history WHERE run_id = :r"),
                {"r": run_id},
            )




def test_scenario_simulate_endpoint(client):
    # 1. Baseline scenario (0 bps hike, 0% GDP shock) -> 0% uplift
    res_base = client.post("/scenario/simulate", json={"repo_bps": 0.0, "gdp_shock_pct": 0.0})
    assert res_base.status_code == 200
    base_data = res_base.json()
    assert base_data["status"] == "success"
    assert base_data["total_accounts"] > 0
    assert base_data["baseline_ecl"] > 0
    assert base_data["ecl_uplift_pct"] == 0.0
    assert len(base_data["by_grade"]) == 10
    assert base_data["by_grade"][0]["grade"] == "RG1"
    assert base_data["by_grade"][-1]["grade"] == "RG10"

    # 2. Stress scenario (150 bps hike, 1.5% GDP shock, 10% sector stress) -> positive uplift
    res_stress = client.post(
        "/scenario/simulate",
        json={"repo_bps": 150.0, "gdp_shock_pct": 1.5, "sector_stress": 0.10},
    )
    assert res_stress.status_code == 200
    stress_data = res_stress.json()
    assert stress_data["status"] == "success"
    assert stress_data["stressed_ecl"] > stress_data["baseline_ecl"]
    assert stress_data["ecl_uplift_pct"] > 0.0
    assert len(stress_data["by_sector"]) > 0

    # 3. Branch filter on scenario simulation
    res_branch = client.post(
        "/scenario/simulate",
        json={"repo_bps": 100.0, "gdp_shock_pct": 1.0, "branch_code": "1019"},
    )
    assert res_branch.status_code == 200
    assert res_branch.json()["total_accounts"] > 0

    # 4. Zero accounts / empty branch boundary (should not divide by zero or emit -100%)
    res_empty = client.post(
        "/scenario/simulate",
        json={"repo_bps": 100.0, "gdp_shock_pct": 1.0, "branch_code": "NON_EXISTENT_BRANCH"},
    )
    assert res_empty.status_code == 200
    assert res_empty.json()["total_accounts"] == 0
    assert res_empty.json()["ecl_uplift_pct"] == 0.0

    # 5. GET /api/scenario/simulate variant
    res_get = client.get("/api/scenario/simulate?repo_bps=200&gdp_shock_pct=2.0")
    assert res_get.status_code == 200
    assert res_get.json()["ecl_uplift_pct"] > 0.0


def test_contagion_simulate_endpoint(client):
    # 1. POST /contagion/simulate
    res = client.post(
        "/contagion/simulate",
        json={"transmission_rate": 0.35, "stress_threshold": 0.16, "max_rounds": 5},
    )
    assert res.status_code == 200
    data = res.json()
    assert data["status"] == "success"
    assert data["total_nodes"] > 0
    assert data["total_edges"] > 0
    assert "contagion_spread_count" in data
    assert "cascade_ecl_delta" in data
    assert len(data["rounds_history"]) >= 1
    assert len(data["top_contagion_hubs"]) <= 10
    assert len(data["communities"]) > 0
    assert len(data["scatter"]) == data["total_nodes"]

    # Verify scatter item schema
    pt = data["scatter"][0]
    assert "id" in pt
    assert "x" in pt
    assert "y" in pt
    assert "z" in pt
    assert "status" in pt
    assert pt["status"] in ("initial_stressed", "contagion_infected", "stable")

    # 2. Shock seed test: shock a low PD facility and verify elevated PD, spread, and ECL delta
    port = client.get("/portfolio?rag=Green&limit=5").json()
    green_loan = port["borrowers"][0]["loan_id"]
    res_seed = client.post(
        "/contagion/simulate",
        json={"transmission_rate": 0.50, "stress_threshold": 0.16, "shock_seeds": [green_loan]},
    )
    assert res_seed.status_code == 200
    seed_data = res_seed.json()
    seed_pt = next(p for p in seed_data["scatter"] if p["id"] == green_loan)
    assert seed_pt["status"] == "initial_stressed"
    assert seed_pt["y"] >= 16.0  # Seed PD properly elevated to distress threshold
    assert seed_data["cascade_ecl_delta"] >= 0

    # 3. Branch filter on contagion simulation
    res_branch = client.post(
        "/contagion/simulate",
        json={"transmission_rate": 0.35, "branch_code": "1019"},
    )
    assert res_branch.status_code == 200
    assert res_branch.json()["total_nodes"] > 0

    # 4. GET /api/contagion/simulate with shock_seeds query param
    res_get = client.get(f"/api/contagion/simulate?transmission_rate=0.20&max_rounds=3&shock_seeds={green_loan}")
    assert res_get.status_code == 200
    assert res_get.json()["status"] == "success"



