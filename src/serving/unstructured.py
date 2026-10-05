"""Read unstructured inputs for one account: an officer note, a bank statement.

Backs the console's "Read unstructured inputs" panel. Nothing here is saved:
each call masks and reads the text or statement, re-scores the account's
stored inputs with the derived signals, and returns before / after, so an
officer (or a jury) can see unstructured data move a score.

What is real and what is not, stated where it matters:
- Notes: deterministic keyword extraction of six signals (the same function the
  model was trained with). FinBERT, when its weights are already on this machine,
  adds a second tone reading for the officer; the PD keeps the keyword tone the
  model was trained on. Nothing is downloaded at request time. The msme_idbi model was trained without notes (the bank supplies none),
  so on those accounts the signals are shown but cannot move the PD.
- Statements: `src/ingestion/aa_parser.py` reads Sahamati AA (FI JSON) or
  core-banking statement shapes. The sample statements are generated, not bank data.
- GST returns: not available in the bank's sandbox (only a GSTIN search),
  so there is no GST parser to show.
"""

from __future__ import annotations

from datetime import datetime, timedelta, timezone
from typing import Any

import numpy as np
import pandas as pd

from src.features.notes_signals import NOTE_SIGNALS, extract_note_signals, sanitize_pii
from src.ingestion.aa_parser import extract_transactions, parse_aa_statement
from src.serving.scorer import RiskScorer

# Segments whose training data carried officer notes. msme_idbi's generator has
# no notes, so its note features were constant in training and carry no weight.
NOTE_TRAINED_SEGMENTS = {"msme_india"}

# Statement-derived inputs the PD models take (aa_parser output -> model input).
STATEMENT_MODEL_INPUTS = ("emi_bounce_6m", "cashflow_volatility", "balance_trend_pct", "upi_inflow_stability")

NOTE_SIGNAL_LABELS = {
    "note_payment_promise_broken": "Broken repayment promise",
    "note_business_disruption": "Business disruption (idle units, cancelled orders, slowdown)",
    "note_stock_statement_delay": "Stock statement delayed",
    "note_dispute_litigation": "Dispute or litigation",
    "note_positive_outlook": "Positive outlook (orders, capacity, expansion)",
    "note_sentiment": "Overall tone (positive minus negative)",
}


def _verdict(res: dict[str, Any]) -> dict[str, Any]:
    return {
        "pd_12m": res.get("pd_12m"),
        "risk_grade": res.get("risk_grade"),
        "rag": res.get("rag"),
        "ecl_stage": res.get("ecl_stage"),
        "ecl": res.get("ecl"),
        "status": res.get("status"),
    }


_FINBERT = None  # loaded once, on first use


def _finbert_sentiment_if_installed(text: str) -> tuple[float | None, str]:
    """FinBERT P(positive) - P(negative) when the weights are cached locally."""
    global _FINBERT
    try:
        if _FINBERT is None:
            import os  # noqa: PLC0415

            # Never download at request time: use only weights already cached.
            os.environ.setdefault("HF_HUB_OFFLINE", "1")
            from transformers import pipeline  # noqa: PLC0415

            _FINBERT = pipeline("text-classification", model="ProsusAI/finbert", top_k=None)
        scores = {r["label"]: r["score"] for r in _FINBERT([text[:1000]])[0]}
        return float(scores.get("positive", 0.0) - scores.get("negative", 0.0)), "FinBERT (self-hosted)"
    except Exception:
        return None, "keyword (FinBERT weights not installed on this server)"


def _raw_score(scorer: RiskScorer, raw: dict[str, Any]) -> float | None:
    """Uncalibrated model score. Isotonic calibration maps it to PD in steps, so a
    real change in the score can leave the PD on the same step; showing both
    keeps a "no change" from reading as "the input was ignored"."""
    try:
        feats = scorer.features_for(raw)
        return round(float(scorer.bundle.predict_raw(feats[scorer.bundle.feature_cols])[0]), 5)
    except Exception:
        return None


def analyse_note(scorer: RiskScorer, raw: dict[str, Any], text: str, use_finbert: bool = False) -> dict[str, Any]:
    masked = sanitize_pii(text)
    signals = extract_note_signals(pd.Series([masked])).iloc[0].to_dict()
    method = "keyword"
    finbert_tone = None
    if use_finbert:
        # Shown beside the keyword tone, not swapped in: the models were trained on
        # the keyword tone, so the PD below still uses it.
        finbert_tone, method = _finbert_sentiment_if_installed(masked)

    before = scorer.score_record(dict(raw), explain=False)
    # The model reads the note text itself (its feature step runs the same
    # extractor), so the masked note is what goes in.
    noted = {**raw, "officer_note": masked}
    after = scorer.score_record(noted, explain=False)
    return {
        "masked_text": masked,
        "pii_masked": masked != text,
        "method": method,
        "signals": [
            {"key": k, "label": NOTE_SIGNAL_LABELS[k], "value": round(float(signals[k]), 3)}
            for k in NOTE_SIGNALS
        ],
        "finbert_tone": None if finbert_tone is None else round(finbert_tone, 3),
        "model_uses_notes": scorer.segment in NOTE_TRAINED_SEGMENTS,
        "before": _verdict(before),
        "after": _verdict(after),
        "raw_score": {"before": _raw_score(scorer, raw), "after": _raw_score(scorer, noted)},
    }


def analyse_statement(scorer: RiskScorer, raw: dict[str, Any], payload: Any) -> dict[str, Any]:
    txs = extract_transactions(payload)
    derived = parse_aa_statement(payload)
    before = scorer.score_record(dict(raw), explain=False)
    updates = {k: derived[k] for k in STATEMENT_MODEL_INPUTS}
    updated = {**raw, **updates}
    after = scorer.score_record(updated, explain=False)
    # What the model used before the statement: stored values, or ones the
    # adapter inferred from the account's other inputs when none were stored.
    # A statement milder than those lowers the PD, and the officer should see why.
    try:
        stored = scorer.features_for(raw).iloc[0]
        stored_inputs = {
            k: (None if pd.isna(stored.get(k)) else round(float(stored.get(k)), 3)) for k in STATEMENT_MODEL_INPUTS
        }
    except Exception:
        stored_inputs = {k: None for k in STATEMENT_MODEL_INPUTS}
    dates = [str(t.get("transactionTimestamp") or t.get("date") or t.get("txnDate") or "")[:10] for t in txs]
    dates = sorted(d for d in dates if d)
    return {
        "transactions": len(txs),
        "period": {"from": dates[0] if dates else None, "to": dates[-1] if dates else None},
        "derived": derived,
        "model_inputs_updated": updates,
        "stored_inputs": stored_inputs,
        "inputs_were_inferred": [k for k in STATEMENT_MODEL_INPUTS if raw.get(k) in (None, "")],
        "before": _verdict(before),
        "after": _verdict(after),
        "raw_score": {"before": _raw_score(scorer, raw), "after": _raw_score(scorer, updated)},
    }


def sample_statement(kind: str = "stressed", seed: int = 7) -> dict[str, Any]:
    """A generated 90-day statement in Sahamati AA FI-JSON shape (not bank data).

    "healthy": steady UPI / NEFT receipts from buyers, EMI paid on time, rising
    balance. "stressed": thinning and irregular receipts, three EMI / cheque
    returns, falling balance, and two same-day round trips of over Rs 50,000.
    """
    rng = np.random.default_rng(seed + (0 if kind == "healthy" else 1))
    start = datetime(2026, 7, 1, 10, 0, tzinfo=timezone.utc)
    balance = 1_850_000.0 if kind == "healthy" else 1_150_000.0
    txs: list[dict[str, Any]] = []

    def add(day: int, kind_: str, amount: float, narration: str, mode: str) -> None:
        nonlocal balance
        amount = round(float(amount), 2)
        balance += amount if kind_ == "CREDIT" else -amount
        txs.append({
            "txnId": f"T{len(txs) + 1:05d}",
            "type": kind_,
            "mode": mode,
            "amount": f"{amount:.2f}",
            "currentBalance": f"{balance:.2f}",
            "transactionTimestamp": (start + timedelta(days=day, hours=int(rng.integers(0, 8)))).isoformat(),
            "narration": narration,
        })

    buyers = ["SHREE AUTO PARTS", "KAVERI TRADERS", "MEHTA ENGINEERING", "SUNRISE RETAIL", "PATIL DISTRIBUTORS"]
    for day in range(90):
        receipt_p = 0.75 if kind == "healthy" else max(0.15, 0.6 - day / 200)
        if rng.random() < receipt_p:
            size = rng.normal(85_000, 15_000) if kind == "healthy" else rng.normal(55_000, 30_000)
            add(day, "CREDIT", max(5_000, size), f"UPI/{rng.choice(buyers)}/INV{int(rng.integers(1000, 9999))}", "UPI")
        if rng.random() < 0.5:
            spend = rng.normal(52_000, 12_000) if kind == "healthy" else rng.normal(30_000, 8_000)
            add(day, "DEBIT", abs(spend), "NEFT/RAW MATERIAL SUPPLIER", "NEFT")
        if day % 30 == 5:
            add(day, "DEBIT", 145_000, "NACH/IDBI TERM LOAN EMI", "NACH")
        if day % 30 == 25:
            add(day, "DEBIT", 210_000, "SALARY/STAFF PAYROLL", "NEFT")
    if kind != "healthy":
        for day, narration in [(35, "NACH RTN INSUFFICIENT FUNDS/IDBI EMI"), (61, "CHQ RETURN/SUPPLIER CHQ 004512"),
                               (65, "ECS RETURN/IDBI EMI")]:
            add(day, "DEBIT", 0.0, narration, "OTHERS")
        for day in (48, 77):
            add(day, "CREDIT", 260_000, "IMPS/ASSOCIATE CONCERN", "IMPS")
            add(day, "DEBIT", 260_000, "IMPS/ASSOCIATE CONCERN", "IMPS")
    txs.sort(key=lambda t: t["transactionTimestamp"])
    return {
        "_note": "Synthetic sample in Sahamati AA FI-JSON shape, generated for the demo; not bank data.",
        "Account": {
            "type": "deposit",
            "maskedAccNumber": "XXXXXXXX4821",
            "Profile": {"Holders": {"type": "SINGLE", "Holder": {"name": "[masked]"}}},
            "Summary": {"type": "CURRENT", "currency": "INR"},
            "Transactions": {"startDate": "2026-07-01", "endDate": "2026-09-28", "Transaction": txs},
        },
    }
