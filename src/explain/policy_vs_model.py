# compares where the model says elevated against where the rules say elevated, and
# surfaces the disagreements. governance is not the same thing as AUC.

from __future__ import annotations

_ELEVATED_RAG = frozenset({"Amber", "Red"})
_ELEVATED_SEVERITY = frozenset({"medium", "high"})
_ELEVATED_GRADE_IDX = 5  # RG5+


def _grade_index(risk_grade: str) -> int:
    g = str(risk_grade).strip().upper()
    if g.startswith("RG"):
        g = g[2:]
    return int(g)


def _severity(signal) -> str:
    if isinstance(signal, dict):
        return str(signal.get("severity", "")).lower()
    return str(getattr(signal, "severity", "")).lower()


def compare_policy_vs_model(
    *,
    rag: str,
    risk_grade: str,
    ews_triggers: list[dict] | list,
) -> dict:
    model_elevated = (
        str(rag) in _ELEVATED_RAG
        or _grade_index(risk_grade) >= _ELEVATED_GRADE_IDX
    )
    policy_elevated = any(
        _severity(sig) in _ELEVATED_SEVERITY for sig in (ews_triggers or [])
    )
    agree = model_elevated == policy_elevated
    conflicts: list[str] = []
    if model_elevated and not policy_elevated:
        conflicts.append(
            "Model elevated (Amber/Red or RG5+) but no medium/high EWS triggers"
        )
    elif policy_elevated and not model_elevated:
        conflicts.append(
            "Policy EWS elevated (medium/high) but model RAG/grade not elevated"
        )
    return {
        "agree": agree,
        "model_elevated": model_elevated,
        "policy_elevated": policy_elevated,
        "conflicts": conflicts,
    }
