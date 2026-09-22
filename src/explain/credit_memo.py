# turns a scored borrower into a short plain-english note an officer can paste into
# a file. deterministic template by default so it works with no provider wired up.

from __future__ import annotations

from src.explain.llm import LLMClient


def _template_memo(result: dict, borrower_id: str = "the borrower") -> str:
    pd_pct = result["pd_12m"] * 100
    reasons = result.get("reason_codes", [])
    top = ", ".join(
        f"{r.get('label') or r.get('code') or r['feature']} "
        f"({'↑' if 'increases' in r['effect'] else '↓'})"
        for r in reasons[:3]
    ) or "no dominant single driver"
    ews = result.get("ews", {})
    ews_line = (
        f"{ews.get('n_triggers', 0)} RBI early-warning signal(s), "
        f"max severity {ews.get('max_severity', 'none')}"
    )
    return (
        f"Credit note — {borrower_id}\n"
        f"1. 12-month stress probability is {pd_pct:.1f}% → risk grade "
        f"{result['risk_grade']} ({result['risk_band']}), {result['sma_watch']}.\n"
        f"2. Principal drivers: {top}.\n"
        f"3. Early-warning check: {ews_line}.\n"
        f"4. Estimated 12-month expected credit loss ≈ "
        f"{result.get('currency', '')} {result.get('ecl') or 0:,.0f}.\n"
        f"5. Recommended action: {result['recommended_action']} "
        f"({result['review_cadence']}, owner: {result['action_owner']})."
    )


def _llm_prompt(result: dict, borrower_id: str) -> str:
    return (
        "You are a credit risk officer. Write a concise 5-line credit note for "
        f"{borrower_id} using ONLY these facts:\n{result}\n"
        "Lines: (1) PD, grade, SMA watch; (2) top drivers; (3) EWS check; "
        "(4) expected credit loss; (5) recommended action. Plain, factual, no speculation."
    )


def generate_memo(
    result: dict,
    borrower_id: str = "the borrower",
    llm: LLMClient | None = None,
) -> str:
    if llm is not None:
        try:
            return llm.generate(_llm_prompt(result, borrower_id))
        except Exception:
            pass  # fall back to template on any provider error
    return _template_memo(result, borrower_id)
