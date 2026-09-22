# the demo borrower fixture loads and scores.

from __future__ import annotations

import pytest

from src.config import MODELS_DIR
from src.demo.walkthrough import WALKTHROUGH_LOAN_ID, load_narmada, score_narmada


def test_load_narmada():
    rec = load_narmada()
    assert rec["loan_id"] == WALKTHROUGH_LOAN_ID
    assert "officer_note" in rec
    assert rec["emi_bounce_6m"] >= 2


def test_score_narmada_when_model_present():
    if not (MODELS_DIR / "india" / "model.pkl").exists():
        pytest.skip("India model not trained")
    out = score_narmada()
    assert out.get("status") == "ok"
    codes = out.get("reason_codes") or []
    assert codes and "code" in codes[0]
