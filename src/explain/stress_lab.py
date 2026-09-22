# mutate a borrower's features and re-score. every slider goes through predict_pd,
# so before/after grades and ECL stay honest instead of being rescaled heuristically.

from __future__ import annotations

import pandas as pd

from src.framework.interpretation import (
    DEFAULT_LGD,
    assign_grade,
    expected_credit_loss,
    playbook,
)


def _snapshot(pd_val: float, ead: float | None, lgd: float) -> dict:
    grade = assign_grade(pd_val)
    act = playbook(grade)
    out = {
        "pd": round(float(pd_val), 4),
        "risk_grade": grade,
        "sma_watch": act.sma_watch,
        "recommended_action": act.action,
    }
    if ead is not None:
        out["ecl"] = round(expected_credit_loss(pd_val, ead, lgd=lgd), 2)
    return out


def apply_stress(
    bundle,
    feat_row: pd.DataFrame,
    mutations: dict,
    *,
    ead: float | None = None,
    lgd: float = DEFAULT_LGD,
) -> dict:
    base = feat_row.copy()
    base_pd = float(bundle.predict_pd(base[bundle.feature_cols])[0])
    before = _snapshot(base_pd, ead, lgd)

    trial = base.copy()
    applied: dict = {}
    for col, val in mutations.items():
        if col in trial.columns:
            trial[col] = val
            applied[col] = val

    after_pd = float(bundle.predict_pd(trial[bundle.feature_cols])[0])
    after = _snapshot(after_pd, ead, lgd)

    return {
        "before": before,
        "after": after,
        "mutations_applied": applied,
        "pd_delta": round(after_pd - base_pd, 4),
    }
