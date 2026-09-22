# the walkthrough borrower end to end: coverage, scoring, reason codes, stress,
# decision logging and the integrity checklist.

from __future__ import annotations

import tempfile
from pathlib import Path

import pandas as pd
import pytest

from src.config import MODELS_DIR
from src.demo.walkthrough import load_narmada, score_narmada
from src.eval.integrity_checklist import run_checklist
from src.explain.contagion_evidence import evidence_from_row
from src.explain.hitl_audit import init_db, list_decisions, log_decision
from src.explain.policy_vs_model import compare_policy_vs_model
from src.explain.stress_lab import apply_stress
from src.serving.coverage import assess_coverage


def test_integration_narmada_flow(tmp_path, monkeypatch):
  if not (MODELS_DIR / "india" / "model.pkl").exists():
    pytest.skip("India model not trained")

  rec = load_narmada()
  keys = [k for k, v in rec.items() if v is not None and k != "loan_id"]
  cov = assess_coverage("msme_india", keys)
  assert cov.status in {"full", "provisional"}

  out = score_narmada()
  assert out.get("status") == "ok"
  assert out.get("reason_codes")
  assert "code" in out["reason_codes"][0]

  cmp = compare_policy_vs_model(
    rag=out["rag"],
    risk_grade=out["risk_grade"],
    ews_triggers=out.get("ews", {}).get("signals", []),
  )
  assert "agree" in cmp

  from src.serving.scorer import RiskScorer

  scorer = RiskScorer("msme_india")
  feats = scorer.spec.engineer(pd.DataFrame([rec]))
  stress = apply_stress(
    scorer.bundle,
    feats,
    {"emi_bounce_6m": float(rec["emi_bounce_6m"]) + 2},
    ead=float(rec["ticket_size"]),
  )
  assert stress["after"]["pd"] >= stress["before"]["pd"]

  db = tmp_path / "hitl.sqlite"
  monkeypatch.setattr("src.explain.hitl_audit._DEFAULT_DB", db)
  init_db(db)
  log_decision(
    loan_id=rec["loan_id"],
    segment="msme_india",
    proposed_action=out["recommended_action"],
    proposed_sma=out["sma_watch"],
    pd=out["pd_12m"],
    risk_grade=out["risk_grade"],
    decision="accept",
    path=db,
  )
  assert len(list_decisions(rec["loan_id"], path=db)) == 1

  chk = run_checklist("msme_india")
  assert len(chk) >= 4

  ev = evidence_from_row(
    {"nbr_stress_score": 0.8, "nbr_bounce_share": 0.35, "stressed_neighbors": 2}
  )
  assert ev["material"] is True
