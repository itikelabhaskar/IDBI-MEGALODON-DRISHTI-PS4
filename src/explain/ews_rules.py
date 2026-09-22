# deterministic early warning rules modelled on the RBI master directions, run
# alongside the ML score rather than inside it. a rule whose input is missing simply
# never fires, so the same set works across segments.

from __future__ import annotations

import math
from dataclasses import dataclass
from typing import Callable, Mapping

Severity = str  # "low" | "medium" | "high"


@dataclass(frozen=True)
class Rule:
    code: str
    label: str  # RBI-aligned description
    severity: Severity
    predicate: Callable[[Mapping], bool]


@dataclass(frozen=True)
class TriggeredSignal:
    code: str
    label: str
    severity: Severity


def _num(row: Mapping, key: str):
    if key not in row:
        return None
    val = row[key]
    try:
        f = float(val)
    except (TypeError, ValueError):
        return None
    return None if math.isnan(f) else f


def _ge(row, key, thr):
    v = _num(row, key)
    return v is not None and v >= thr


def _le(row, key, thr):
    v = _num(row, key)
    return v is not None and v <= thr


def _lt(row, key, thr):
    v = _num(row, key)
    return v is not None and v < thr


# Ordered by severity for display. Each maps to an RBI EWS indicator.
RULES: list[Rule] = [
    Rule("EWS01", "Frequent cheque/EMI bounces (>=2 in 6 months)", "high",
         lambda r: _ge(r, "emi_bounce_6m", 2)),
    Rule("EWS02", "Sharp decline in turnover (GST YoY < -15%)", "high",
         lambda r: _le(r, "gst_turnover_trend_pct", -15)),
    Rule("EWS03", "Delay in statutory / GST return filing (>30 days)", "medium",
         lambda r: _ge(r, "gst_filing_delay_days", 30)),
    Rule("EWS04", "Input-tax-credit mismatch / tax irregularity", "medium",
         lambda r: _ge(r, "itc_mismatch_flag", 1)),
    Rule("EWS05", "Liquidity stress (current ratio < 1.0)", "medium",
         lambda r: _le(r, "current_ratio", 1.0)),
    Rule("EWS06", "Declining bank balances (trend < -10%)", "medium",
         lambda r: _le(r, "balance_trend_pct", -10)),
    Rule("EWS07", "Erratic cash flows (high volatility)", "medium",
         lambda r: _ge(r, "cashflow_volatility", 0.5)),
    Rule("EWS08", "New business carrying large exposure", "low",
         lambda r: (_ge(r, "new_business", 1) or (_num(r, "vintage_months") is not None and _num(r, "vintage_months") <= 12))
         and (_ge(r, "gr_appv", 500_000) or _ge(r, "ticket_size", 5_000_000))),
    Rule("EWS09", "High reliance on SBA/credit guarantee (>85%)", "low",
         lambda r: _ge(r, "guarantee_ratio", 0.85)),
    # --- Extended coverage of the July 2024 Master Directions EWS list ------
    # Rules whose input fields are absent on a segment simply never fire.
    Rule("EWS10", "Delay in submission of stock / book-debt statement (>30 days)", "medium",
         lambda r: _ge(r, "stock_statement_delay_days", 30)
         or _ge(r, "note_stock_statement_delay", 1)),
    Rule("EWS11", "Devolvement of LC / invocation of bank guarantee", "high",
         lambda r: _ge(r, "lc_devolvement_count", 1)),
    Rule("EWS12", "Resignation / frequent change of auditor or key director", "medium",
         lambda r: _ge(r, "auditor_change_flag", 1) or _ge(r, "director_resignation_flag", 1)),
    Rule("EWS13", "Dispute or litigation noted against the borrower", "medium",
         lambda r: _ge(r, "note_dispute_litigation", 1) or _ge(r, "litigation_flag", 1)),
    Rule("EWS14", "Broken repayment promise recorded by the officer", "high",
         lambda r: _ge(r, "note_payment_promise_broken", 1)),
    Rule("EWS15", "Persistent over-utilisation of working-capital limits (>95%)", "medium",
         lambda r: _ge(r, "limit_utilisation_pct", 95)
         or _ge(r, "revolving_utilization", 0.95)
         or _ge(r, "cc_od_utilisation_pct", 95)),

    Rule("EWS16", "Active lien, encumbrance or statutory attachment on account", "high",
         lambda r: _ge(r, "lien_count", 1) or _ge(r, "lien_flag", 1) or _ge(r, "account_lien_amt", 1)),
    Rule("EWS17", "Prior loan restructuring / rescheduling history flagged", "high",
         lambda r: _ge(r, "restructuring_flag", 1) or _ge(r, "resched_amt_flag", 1)),
    Rule("EWS18", "Significant drawing-power erosion vs sanction limit (>=25%)", "high",
         lambda r: _ge(r, "drawing_power_gap_pct", 25.0)),
    Rule("EWS19", "Severe debt-service collection shortfall (<80% collected)", "high",
         lambda r: _lt(r, "demanded_vs_collected_ratio", 0.80)),
]

EWS_DP_EROSION = "EWS18"
EWS_COLLECTION_SHORTFALL = "EWS19"

ALL_EWS_RULES = RULES

_SEVERITY_RANK = {"high": 3, "medium": 2, "low": 1}


def evaluate_ews(row: Mapping) -> list[TriggeredSignal]:
    hits: list[TriggeredSignal] = []
    for rule in RULES:
        try:
            if rule.predicate(row):
                hits.append(TriggeredSignal(rule.code, rule.label, rule.severity))
        except Exception:  # a malformed field must never break scoring
            continue
    hits.sort(key=lambda s: _SEVERITY_RANK[s.severity], reverse=True)
    return hits


def ews_summary(row: Mapping) -> dict:
    hits = evaluate_ews(row)
    top = max((s.severity for s in hits), key=lambda s: _SEVERITY_RANK[s], default="none")
    return {
        "n_triggers": len(hits),
        "max_severity": top,
        "signals": [{"code": s.code, "label": s.label, "severity": s.severity} for s in hits],
    }
