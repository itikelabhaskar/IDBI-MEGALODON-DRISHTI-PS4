# derives a CIBIL MSME rank from the calibrated PD and attaches the published
# stress rate for that band. simulated, in production CMR arrives from the bureau.

from __future__ import annotations

import pandas as pd

from src.framework.interpretation import assign_grade

# Reference stress/NPA magnitudes by CMR band (illustrative, per MSME Pulse).
_BANDS = [
    (1, 3, "CMR-1..3 (low risk)", 0.02),
    (4, 6, "CMR-4..6 (moderate)", 0.06),
    (7, 10, "CMR-7..10 (elevated/high)", 0.15),
]


def cmr_from_pd(pd_value: float) -> int:
    return int(assign_grade(pd_value)[2:])


def cmr_band(cmr: int) -> tuple[str, float]:
    for lo, hi, label, rate in _BANDS:
        if lo <= cmr <= hi:
            return label, rate
    return "CMR-unknown", float("nan")


def add_cmr(df: pd.DataFrame, pd_col: str = "pd") -> pd.DataFrame:
    out = df.copy()
    out["cmr"] = out[pd_col].map(cmr_from_pd)
    out["cmr_band"] = out["cmr"].map(lambda c: cmr_band(c)[0])
    return out
