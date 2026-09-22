# turns loan officer note text into model features. generation is synthetic-world
# only; extraction is a plain keyword pass so it stays auditable and runs offline.
#
# sentiment can optionally come from finbert running locally. deliberately not an
# api model, since the bank runs nothing external in production.

from __future__ import annotations

import numpy as np
import pandas as pd

from src.config import SEED
from src.explain.llm import LLMClient

NOTE_SIGNALS: list[str] = [
    "note_payment_promise_broken",
    "note_business_disruption",
    "note_stock_statement_delay",
    "note_dispute_litigation",
    "note_positive_outlook",
    "note_sentiment",
]

# --- Phrase banks ------------------------------------------------------------
_NEG_INSIGHT = [
    "Unit visit revealed inventory piling up and two idle machines.",
    "Major buyer reportedly cancelled orders; promoter evasive on receivables.",
    "Promoter cited a family partition dispute affecting the business.",
    "Key customer payments stuck; unit works only one shift now.",
    "Factory operating at low utilisation; staff strength reduced.",
    "Promoter repeatedly unreachable; neighbouring unit reports slowdown.",
    "Litigation notice from supplier observed at premises.",
]
_POS_INSIGHT = [
    "Unit running full capacity; strong order book for next two quarters.",
    "New export order received; promoter investing own funds in expansion.",
    "Showroom recently renovated; walk-ins visibly healthy.",
    "Promoter maintains excellent records; long-standing anchor customer.",
]
_NEUTRAL = [
    "Routine monitoring visit completed; operations appear normal.",
    "Documents collected for annual review; nothing adverse noted.",
    "Unit functioning as per last visit; no material change observed.",
]
_BROKEN_PROMISE = [
    "Promoter had promised clearance of overdue EMI by month-end; commitment not honoured.",
    "Earlier assurance to regularise the account was not kept.",
]
_STOCK_DELAY = [
    "Stock statement for the last quarter still awaited despite reminders.",
    "Stock and book-debt statement submission delayed beyond 30 days.",
]
_BOUNCE_LINE = [
    "Multiple EMI bounces observed in recent months.",
    "Cheque returns noted on the operating account.",
]

_NEG_KEYWORDS = [
    "idle", "cancelled", "evasive", "dispute", "stuck", "slowdown", "litigation",
    "not honoured", "not kept", "bounce", "returns", "delayed", "overdue",
    "piling", "reduced", "unreachable",
]
_POS_KEYWORDS = [
    "full capacity", "strong order", "export order", "expansion", "healthy",
    "excellent", "renovated", "normal", "nothing adverse", "no material change",
]


def generate_notes(df: pd.DataFrame, seed: int = SEED) -> pd.Series:
    rng = np.random.default_rng(seed + 1)
    insight = df["officer_insight"].to_numpy()
    bounces = df["emi_bounce_6m"].to_numpy()
    gst_delay = df["gst_filing_delay_days"].to_numpy()

    notes = []
    for i in range(len(df)):
        parts: list[str] = []
        # Hidden-factor phrasing (with noise: sometimes the officer writes bland).
        r = rng.random()
        if insight[i] > 0.55 and r < 0.85:
            parts.append(str(rng.choice(_NEG_INSIGHT)))
        elif insight[i] < -0.55 and r < 0.85:
            parts.append(str(rng.choice(_POS_INSIGHT)))
        else:
            parts.append(str(rng.choice(_NEUTRAL)))
        # Observable-signal phrasing.
        if bounces[i] >= 2 and rng.random() < 0.9:
            parts.append(str(rng.choice(_BOUNCE_LINE)))
            if rng.random() < 0.5:
                parts.append(str(rng.choice(_BROKEN_PROMISE)))
        if gst_delay[i] > 30 and rng.random() < 0.8:
            parts.append(str(rng.choice(_STOCK_DELAY)))
        notes.append(" ".join(parts))
    return pd.Series(notes, index=df.index, name="officer_note")


def _keyword_extract(note: str) -> dict[str, float]:
    low = note.lower()
    neg = sum(1 for k in _NEG_KEYWORDS if k in low)
    pos = sum(1 for k in _POS_KEYWORDS if k in low)
    return {
        "note_payment_promise_broken": float("not honoured" in low or "not kept" in low),
        "note_business_disruption": float(
            any(k in low for k in ["idle", "cancelled", "stuck", "slowdown", "piling", "reduced"])
        ),
        "note_stock_statement_delay": float("stock" in low and ("awaited" in low or "delayed" in low)),
        "note_dispute_litigation": float("dispute" in low or "litigation" in low),
        "note_positive_outlook": float(any(k in low for k in _POS_KEYWORDS[:5])),
        "note_sentiment": float(pos - neg),
    }


def finbert_sentiment(notes: pd.Series, batch_size: int = 64) -> pd.Series:
    import torch
    from transformers import pipeline

    device = "mps" if torch.backends.mps.is_available() else (
        "cuda" if torch.cuda.is_available() else "cpu"
    )
    clf = pipeline(
        "text-classification", model="ProsusAI/finbert",
        top_k=None, truncation=True, max_length=256, device=device,
    )
    scores: list[float] = []
    texts = [str(n)[:1000] for n in notes]
    for i in range(0, len(texts), batch_size):
        for res in clf(texts[i:i + batch_size], batch_size=batch_size):
            d = {r["label"]: r["score"] for r in res}
            scores.append(float(d.get("positive", 0.0) - d.get("negative", 0.0)))
    return pd.Series(scores, index=notes.index, name="note_sentiment")


def extract_note_signals(
    notes: pd.Series, llm: LLMClient | None = None, use_finbert: bool = False
) -> pd.DataFrame:
    if llm is not None:
        schema = {s: "float" for s in NOTE_SIGNALS}
        rows = []
        for note in notes:
            try:
                rows.append({k: float(v) for k, v in llm.extract(str(note), schema).items()})
            except Exception:
                rows.append(_keyword_extract(str(note)))
        return pd.DataFrame(rows, index=notes.index)[NOTE_SIGNALS]

    out = pd.DataFrame(
        [_keyword_extract(str(n)) for n in notes], index=notes.index
    )[NOTE_SIGNALS]
    if use_finbert:
        out["note_sentiment"] = finbert_sentiment(notes)
    return out
