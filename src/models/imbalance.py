# class weights vs SMOTE. weights are what we actually use, since they keep the
# probabilities calibratable and invent no synthetic borrowers. the SMOTE path is
# kept so the comparison is reproducible rather than asserted.

from __future__ import annotations

import numpy as np


def scale_pos_weight(y: np.ndarray) -> float:
    y = np.asarray(y)
    pos = max(1, int(y.sum()))
    neg = len(y) - pos
    return float(neg / pos)


def smote_resample(X, y, sample_cap: int = 60_000, seed: int = 42):
    import pandas as pd
    from imblearn.over_sampling import SMOTE

    if len(X) > sample_cap:
        rng = np.random.default_rng(seed)
        idx = rng.choice(len(X), size=sample_cap, replace=False)
        X = X.iloc[idx]
        y = np.asarray(y)[idx]

    X_num = pd.get_dummies(X, dummy_na=True)
    X_num = X_num.fillna(X_num.median(numeric_only=True))
    X_res, y_res = SMOTE(random_state=seed).fit_resample(X_num, y)
    return X_res, y_res
