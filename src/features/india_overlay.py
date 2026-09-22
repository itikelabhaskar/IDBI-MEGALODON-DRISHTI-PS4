# simulated GST and bank-statement signals for the non-india books, so the console
# has something realistic to show. these are label-informed and therefore kept OUT
# of every reported metric.

from __future__ import annotations

import numpy as np
import pandas as pd

from src.config import SEED

INDIA_FEATURES: list[str] = [
    "gst_filing_delay_days",
    "gst_turnover_trend_pct",
    "itc_mismatch_flag",
    "emi_bounce_6m",
    "cashflow_volatility",
    "balance_trend_pct",
    "current_ratio",
]


def simulate_india_features(
    canonical: pd.DataFrame,
    label_col: str = "default_12m",
    strength: float = 0.6,
    seed: int = SEED,
) -> pd.DataFrame:
    rng = np.random.default_rng(seed)
    n = len(canonical)
    y = canonical[label_col].to_numpy().astype(float) if label_col in canonical else np.zeros(n)
    bad = y  # 1 for defaulters

    def _mix(good_loc, good_scale, bad_loc, bad_scale):
        base = rng.normal(good_loc, good_scale, n)
        shift = rng.normal(bad_loc, bad_scale, n)
        return base + strength * bad * (shift - base + (bad_loc - good_loc))

    out = pd.DataFrame(index=canonical.index)
    out["gst_filing_delay_days"] = np.clip(
        _mix(3, 4, 22, 12), 0, 120
    ).round(0)
    out["gst_turnover_trend_pct"] = np.clip(_mix(6, 10, -18, 14), -70, 80).round(1)
    out["itc_mismatch_flag"] = (rng.random(n) < (0.05 + strength * 0.35 * bad)).astype(int)
    out["emi_bounce_6m"] = np.clip(
        rng.poisson(0.2 + strength * 2.5 * bad, n), 0, 12
    ).astype(int)
    out["cashflow_volatility"] = np.clip(_mix(0.18, 0.08, 0.55, 0.22), 0.02, 1.5).round(3)
    out["balance_trend_pct"] = np.clip(_mix(4, 9, -15, 12), -60, 60).round(1)
    out["current_ratio"] = np.clip(_mix(1.7, 0.5, 0.9, 0.4), 0.1, 4.0).round(2)
    return out[INDIA_FEATURES]
