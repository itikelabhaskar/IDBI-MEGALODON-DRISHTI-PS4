# logistic regression scorecard. the number every other model has to beat, and the
# one a credit team can read line by line.

from __future__ import annotations

import pandas as pd
from sklearn.linear_model import LogisticRegression
from sklearn.pipeline import Pipeline

from src.config import SEED
from src.features.preprocessing import build_preprocessor
from src.features.sba_features import CATEGORICAL_FEATURES, NUMERIC_FEATURES


def train_baseline(X_train: pd.DataFrame, y_train) -> Pipeline:
    pre = build_preprocessor(NUMERIC_FEATURES, CATEGORICAL_FEATURES, scale=True)
    model = LogisticRegression(
        max_iter=1000,
        class_weight="balanced",
        random_state=SEED,
    )
    pipe = Pipeline([("pre", pre), ("clf", model)])
    pipe.fit(X_train, y_train)
    return pipe
