"""Action plan for one account: the recourse levers, in words an officer can hand over.

The console's action plan and its printable "how to improve your rating" note
both come from here, so they use exactly the levers the recourse search
(`src/explain/recourse.py`) uses. Borrower actions and bank actions are kept
apart: a limit cut is the bank's decision, not advice to the borrower.
"""

from __future__ import annotations

from typing import Any

from src.explain.recourse import SEGMENT_LEVERS, lever_actor, recommend_recourse
from src.framework.interpretation import assign_grade, rag_bucket
from src.serving.scorer import RiskScorer

# Plain wording for each lever. Keys must match the labels in recourse.py.
LEVER_PLAIN: dict[str, str] = {
    "Cure EMI bounces (standing-instruction move + buffer)":
        "Stop EMI and cheque returns: move the EMI standing instruction to the main operating account and keep one EMI as a buffer.",
    "Regularise GST filing (delay < 10 days)":
        "File GST returns on time, within 10 days of the due date.",
    "Resolve ITC mismatch":
        "Reconcile GST input credit with suppliers' filings so the claimed and available credit match.",
    "Reduce ticket size by 25% (partial limit cut)":
        "Reduce the sanctioned limit by 25%.",
    "Bridge Drawing Power erosion (reduce DP gap by 15%)":
        "Raise stock and receivables (or bring in margin) so drawing power covers the limit, closing the gap by 15 points; submit stock statements on time.",
    "Regularise demand collection (ratio to 0.98)":
        "Pay at least 98% of instalments and interest as they fall due, with no returned EMIs.",
    "Clear account lien encumbrance":
        "Clear the lien or attachment on the account by settling the dues behind it.",
    "Reduce sanctioned ticket size by 25%":
        "Reduce the sanctioned limit by 25%.",
}

TARGET_PD = 0.11  # first Amber grade (RG5) starts here


def _lever_rows(segment: str) -> list[dict[str, str]]:
    return [
        {"label": label, "actor": lever_actor(label), "plain": LEVER_PLAIN.get(label, label)}
        for label in SEGMENT_LEVERS.get(segment, {})
    ]


def _verdict(pd_value: float) -> dict[str, Any]:
    grade = assign_grade(pd_value)
    return {"pd_12m": round(pd_value, 4), "risk_grade": grade, "rag": rag_bucket(grade)}


def action_plan(scorer: RiskScorer, raw: dict[str, Any]) -> dict[str, Any]:
    if scorer.segment not in SEGMENT_LEVERS:
        return {"segment": scorer.segment, "levers": [], "suggested": None, "current": None}
    feats = scorer.features_for(raw)
    plan = recommend_recourse(scorer.bundle, feats, target_pd=TARGET_PD, levers=SEGMENT_LEVERS[scorer.segment])
    for step in plan["changes"]:
        step["plain"] = LEVER_PLAIN.get(step["change"], step["change"])
    return {
        "segment": scorer.segment,
        "target_pd": TARGET_PD,
        "current": _verdict(plan["baseline_pd"]),
        "levers": _lever_rows(scorer.segment),
        "suggested": plan,
    }


def apply_actions(scorer: RiskScorer, raw: dict[str, Any], actions: list[str]) -> dict[str, Any]:
    levers = SEGMENT_LEVERS.get(scorer.segment, {})
    unknown = [a for a in actions if a not in levers]
    if unknown:
        raise KeyError(", ".join(unknown))
    feats = scorer.features_for(raw)
    base = float(scorer.bundle.predict_pd(feats[scorer.bundle.feature_cols])[0])
    trial = feats.copy()
    for a in actions:
        levers[a](trial)
    after = float(scorer.bundle.predict_pd(trial[scorer.bundle.feature_cols])[0])
    return {"before": _verdict(base), "after": _verdict(after), "actions": actions}
