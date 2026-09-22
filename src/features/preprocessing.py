# imputation and encoding for the logistic baseline only. the tree models eat the
# raw frame directly, so this exists to give the linear model a fair shot.

from __future__ import annotations

from sklearn.compose import ColumnTransformer
from sklearn.impute import SimpleImputer
from sklearn.pipeline import Pipeline
from sklearn.preprocessing import OneHotEncoder, StandardScaler


def build_preprocessor(
    numeric_cols: list[str],
    categorical_cols: list[str],
    scale: bool = True,
) -> ColumnTransformer:
    numeric_steps: list = [("impute", SimpleImputer(strategy="median", add_indicator=True))]
    if scale:
        numeric_steps.append(("scale", StandardScaler(with_mean=False)))

    numeric_pipe = Pipeline(numeric_steps)
    categorical_pipe = Pipeline(
        [
            ("impute", SimpleImputer(strategy="most_frequent")),
            ("onehot", OneHotEncoder(handle_unknown="ignore", min_frequency=50)),
        ]
    )

    return ColumnTransformer(
        [
            ("num", numeric_pipe, numeric_cols),
            ("cat", categorical_pipe, categorical_cols),
        ],
        remainder="drop",
    )
