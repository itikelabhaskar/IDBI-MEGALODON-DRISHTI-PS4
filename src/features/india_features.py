# feature engineering for the india book. the groups are kept separate so the
# ablation can train structured -> +cashflow -> +notes -> +graph and attribute the
# lift honestly rather than claiming it all at once.
#
# DATA_SCOPE tags every feature to one of the three scopes the bank named:
# borrower behaviour, internal systems, public domain.

from __future__ import annotations

import numpy as np
import pandas as pd

from src.features.graph_signals import GRAPH_FEATURES
from src.features.notes_signals import NOTE_SIGNALS, extract_note_signals

BASE_NUMERIC: list[str] = [
    "ticket_size", "tenure_months", "vintage_months", "cmr", "enquiries_6m",
    "interest_spread_bps",
]
BASE_CATEGORICAL: list[str] = ["sub_segment", "sector", "state"]
BASE_FEATURES: list[str] = BASE_NUMERIC + BASE_CATEGORICAL

CASHFLOW_FEATURES: list[str] = [
    "gst_filing_delay_days", "gst_turnover_trend_pct", "itc_mismatch_flag",
    "emi_bounce_6m", "cashflow_volatility", "balance_trend_pct",
    "credit_turnover_ratio", "current_ratio",
    # Alt-data signals named in the problem statement's data-scope note.
    "electricity_consumption_trend_pct", "upi_inflow_stability",
]
NOTE_FEATURES: list[str] = list(NOTE_SIGNALS)

NUMERIC_FEATURES: list[str] = (
    BASE_NUMERIC + CASHFLOW_FEATURES + NOTE_FEATURES + GRAPH_FEATURES
)
CATEGORICAL_FEATURES: list[str] = list(BASE_CATEGORICAL)
ALL_FEATURES: list[str] = NUMERIC_FEATURES + CATEGORICAL_FEATURES

# The bank's own data-scope buckets, verbatim from the Track-4 AMA: the model
# "should encompass borrower behaviour, internal system/database, and data
# available in the public domain". Every feature maps to one of the three.
DATA_SCOPE: dict[str, list[str]] = {
    "borrower_behaviour": [
        "emi_bounce_6m", "cashflow_volatility", "balance_trend_pct",
        "credit_turnover_ratio", "upi_inflow_stability",
    ],
    "internal_systems": [
        "ticket_size", "tenure_months", "vintage_months", "cmr", "enquiries_6m",
        "interest_spread_bps", "sub_segment", "sector", "state",
        *NOTE_FEATURES,  # officer notes live in the bank's own systems
    ],
    "public_domain": [
        # GST filing status/turnover signals are verifiable on the public GST
        # portal; supplier links come from e-invoice/MCA public filings.
        "gst_filing_delay_days", "gst_turnover_trend_pct", "itc_mismatch_flag",
        "current_ratio", "electricity_consumption_trend_pct",
        *GRAPH_FEATURES,
    ],
}

# Monotone directions enforced at training (credit-officer intuition).
MONOTONE_DIRECTIONS: dict[str, int] = {
    "gst_filing_delay_days": 1,
    "gst_turnover_trend_pct": -1,
    "itc_mismatch_flag": 1,
    "emi_bounce_6m": 1,
    "cashflow_volatility": 1,
    "balance_trend_pct": -1,
    "current_ratio": -1,
    "cmr": 1,
    "enquiries_6m": 1,
    "interest_spread_bps": 1,
    "note_payment_promise_broken": 1,
    "note_business_disruption": 1,
    "note_stock_statement_delay": 1,
    "note_dispute_litigation": 1,
    "note_positive_outlook": -1,
    "note_sentiment": -1,
    "nbr_stress_score": 1,
    "nbr_bounce_share": 1,
    "electricity_consumption_trend_pct": -1,
    "upi_inflow_stability": -1,
}


def engineer_india_features(df: pd.DataFrame) -> pd.DataFrame:
    out = pd.DataFrame(index=df.index)

    for col in BASE_NUMERIC + CASHFLOW_FEATURES:
        out[col] = pd.to_numeric(df[col], errors="coerce") if col in df.columns else np.nan

    # Note signals: prefer precomputed columns; fall back to extracting from
    # raw text if only the note is present (e.g. an API request with a note).
    if all(c in df.columns for c in NOTE_FEATURES):
        for col in NOTE_FEATURES:
            out[col] = pd.to_numeric(df[col], errors="coerce")
    elif "officer_note" in df.columns:
        out[NOTE_FEATURES] = extract_note_signals(df["officer_note"])
    else:
        out[NOTE_FEATURES] = np.nan

    for col in GRAPH_FEATURES:
        out[col] = pd.to_numeric(df[col], errors="coerce") if col in df.columns else np.nan

    for col in BASE_CATEGORICAL:
        val = df[col] if col in df.columns else pd.Series("unknown", index=df.index)
        out[col] = val.astype("object").fillna("unknown").astype("category")

    return out[ALL_FEATURES]
