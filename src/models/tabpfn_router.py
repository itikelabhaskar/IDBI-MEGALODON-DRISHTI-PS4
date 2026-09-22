# tabpfn for small or brand new segments. it predicts in context with no training,
# and beats a freshly trained GBM when there are only a few hundred labelled rows.
# large books stay on the calibrated lightgbm path.

from __future__ import annotations

import numpy as np
import pandas as pd

from src.config import SEED
from src.features.sba_features import CATEGORICAL_FEATURES, NUMERIC_FEATURES

# Fixed column order so category indices are stable across fit/predict.
FEATURE_ORDER: list[str] = NUMERIC_FEATURES + CATEGORICAL_FEATURES
CATEGORICAL_INDICES: list[int] = [FEATURE_ORDER.index(c) for c in CATEGORICAL_FEATURES]

# CPU training limit for TabPFN (rows). Keep the router in its sweet spot.
CPU_TRAIN_CAP = 1000


def to_numeric_matrix(X: pd.DataFrame) -> np.ndarray:
    Xc = X[FEATURE_ORDER].copy()
    for col in CATEGORICAL_FEATURES:
        codes = Xc[col].cat.codes.astype(float)
        codes[codes < 0] = np.nan  # -1 code marks missing
        Xc[col] = codes
    return Xc.astype(float).to_numpy()


def train_tabpfn(
    X_train: pd.DataFrame,
    y_train,
    n_estimators: int = 8,
    device: str = "cpu",
):
    from tabpfn import TabPFNClassifier
    from tabpfn.constants import ModelVersion

    clf = TabPFNClassifier.create_default_for_version(
        ModelVersion.V2,
        n_estimators=n_estimators,
        categorical_features_indices=CATEGORICAL_INDICES,
        device=device,
        ignore_pretraining_limits=True,
        random_state=SEED,
        # Single-threaded: default multiprocessing deadlocks under fork on macOS.
        n_jobs=1,
        n_preprocessing_jobs=1,
    )
    clf.fit(to_numeric_matrix(X_train), np.asarray(y_train))
    return clf


def tabpfn_pd(clf, X: pd.DataFrame) -> np.ndarray:
    return clf.predict_proba(to_numeric_matrix(X))[:, 1]
