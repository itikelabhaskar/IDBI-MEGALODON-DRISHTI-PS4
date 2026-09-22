# one named borrower used for the demo path, so the story is the same every time it
# is shown. structured profile looks fine, the cashflow and note signals flip it.

from __future__ import annotations

import json
from pathlib import Path

import pandas as pd

from src.config import ROOT
from src.serving.scorer import RiskScorer

WALKTHROUGH_LOAN_ID = "NARMADA-001"
_FIXTURE = ROOT / "data" / "walkthrough" / "narmada_precision.json"


def load_narmada() -> dict:
    return json.loads(_FIXTURE.read_text())


def score_narmada(*, explain: bool = True) -> dict:
    scorer = RiskScorer("msme_india")
    return scorer.score_record(load_narmada(), explain=explain)


def narmada_scored_row(scorer: RiskScorer) -> pd.Series:
    import pandas as pd

    from src.explain.ews_rules import ews_summary

    rec = load_narmada()
    canon = pd.DataFrame([rec])
    scored = scorer.score_frame(canon).iloc[0].copy()
    scored["loan_id"] = rec["loan_id"]
    scored["officer_note"] = rec.get("officer_note", "")
    scored["default_12m"] = 0
    scored["breakdown"] = str(rec.get("sector", "unknown"))
    ews = ews_summary(scored)
    scored["ews_triggers"] = ews["n_triggers"]
    scored["ews_severity"] = ews["max_severity"]
    return scored
