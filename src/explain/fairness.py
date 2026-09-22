# group fairness across a sensitive attribute, including the 80% rule disparate
# impact ratio. this is the evidence a model risk committee asks for first.

from __future__ import annotations

import numpy as np
import pandas as pd
from sklearn.metrics import roc_auc_score


def group_fairness(
    df: pd.DataFrame,
    group_col: str,
    pd_col: str = "pd",
    label_col: str = "default_12m",
    flag_threshold: float = 0.16,
    min_group: int = 100,
) -> dict:
    rows = []
    for level, g in df.groupby(group_col):
        if len(g) < min_group:
            continue
        flag_rate = float((g[pd_col] >= flag_threshold).mean())
        rec = {
            "group": str(level),
            "n": int(len(g)),
            "flag_rate": round(flag_rate, 4),
            "mean_pd": round(float(g[pd_col].mean()), 4),
        }
        if label_col in g and g[label_col].nunique() == 2:
            rec["auc"] = round(float(roc_auc_score(g[label_col], g[pd_col])), 4)
            rec["default_rate"] = round(float(g[label_col].mean()), 4)
        rows.append(rec)

    table = pd.DataFrame(rows).sort_values("flag_rate", ascending=False)
    flag_rates = table["flag_rate"].replace(0, np.nan)
    di_ratio = (
        round(float(flag_rates.min() / flag_rates.max()), 4)
        if len(flag_rates.dropna()) >= 2
        else None
    )
    return {
        "attribute": group_col,
        "flag_threshold": flag_threshold,
        "per_group": table.to_dict(orient="records"),
        "disparate_impact_ratio": di_ratio,
        "passes_80pct_rule": (di_ratio is not None and di_ratio >= 0.8),
    }
