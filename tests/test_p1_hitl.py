# officer decision trail: logging, filtering by loan, ordering.

from __future__ import annotations

from src.explain.hitl_audit import init_db, list_decisions, log_decision


def test_hitl_log_and_list(tmp_path):
    db = tmp_path / "hitl.sqlite"
    init_db(db)
    rid = log_decision(
        loan_id="L1",
        segment="msme_india",
        proposed_action="Monthly review",
        proposed_sma="SMA-0 watch",
        pd=0.18,
        risk_grade="RG6",
        decision="accept",
        reason="Agree with model",
        path=db,
    )
    assert rid == 1
    log_decision(
        loan_id="L1",
        segment="msme_india",
        proposed_action="Monthly review",
        proposed_sma="SMA-0 watch",
        pd=0.18,
        risk_grade="RG6",
        decision="override",
        override_action="Quarterly review only",
        reason="Relationship strong",
        path=db,
    )
    log_decision(
        loan_id="L2",
        segment="msme_sba",
        proposed_action="Watch",
        proposed_sma="Standard",
        pd=0.05,
        risk_grade="RG2",
        decision="defer",
        path=db,
    )
    by_loan = list_decisions("L1", path=db)
    assert len(by_loan) == 2
    assert by_loan[0]["decision"] == "override"
    all_rows = list_decisions(limit=2, path=db)
    assert len(all_rows) == 2
