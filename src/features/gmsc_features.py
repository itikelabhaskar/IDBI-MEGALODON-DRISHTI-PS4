# feature engineering for the unsecured retail book. the 96 and 98 values in the
# delinquency columns are sentinels, not counts, so they are treated as missing.

from __future__ import annotations

import numpy as np
import pandas as pd

NUMERIC_FEATURES: list[str] = [
    "revolving_utilization", "age", "debt_ratio", "monthly_income",
    "open_credit_lines", "real_estate_loans", "dependents",
    "dpd_30_59", "dpd_60_89", "times_90_late", "total_past_due", "worst_dpd",
    "income_per_dependent", "exposure_proxy",
]
CATEGORICAL_FEATURES: list[str] = ["age_band"]


def engineer_gmsc_features(df: pd.DataFrame) -> pd.DataFrame:
    out = pd.DataFrame(index=df.index)
    out["revolving_utilization"] = df["revolving_utilization"].astype(float).clip(0, 20)
    out["age"] = df["age"].astype(float)
    out["debt_ratio"] = df["debt_ratio"].astype(float).clip(0, 100)
    inc = df["monthly_income"].astype(float)
    out["monthly_income"] = inc
    out["open_credit_lines"] = df["open_credit_lines"].astype(float)
    out["real_estate_loans"] = df["real_estate_loans"].astype(float)
    dep = df["dependents"].astype(float)
    out["dependents"] = dep

    d30 = df["dpd_30_59"].replace([96, 98], np.nan).astype(float)
    d60 = df["dpd_60_89"].replace([96, 98], np.nan).astype(float)
    d90 = df["times_90_late"].replace([96, 98], np.nan).astype(float)
    out["dpd_30_59"], out["dpd_60_89"], out["times_90_late"] = d30, d60, d90
    out["total_past_due"] = d30.fillna(0) + d60.fillna(0) + d90.fillna(0)
    out["worst_dpd"] = pd.concat([d30, d60, d90], axis=1).max(axis=1)

    out["income_per_dependent"] = inc / (dep.fillna(0) + 1)
    out["exposure_proxy"] = (inc * out["debt_ratio"] * 12).clip(lower=0)

    band = pd.cut(out["age"], [0, 30, 45, 60, 200], labels=["<30", "30-45", "45-60", "60+"])
    out["age_band"] = band.astype("object").fillna("missing").astype("category")

    return out[NUMERIC_FEATURES + CATEGORICAL_FEATURES]
