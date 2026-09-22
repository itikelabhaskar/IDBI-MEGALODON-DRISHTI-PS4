# the contract every data source has to satisfy before the rest of the pipeline
# will touch it. one shape in, so features/models/serving never care where the
# rows came from

from __future__ import annotations

import pandas as pd


# column -> expected dtype family. checked loosely, exact numpy dtype is not enforced
MANDATORY_COLUMNS: dict[str, str] = {
    "loan_id": "object",
    "segment": "object",
    "origination_date": "datetime",
    "default_12m": "integer",
}

# substrings that mean a column knows the outcome already. a feature named like
# any of these would leak the label and make the metrics meaningless
LEAKAGE_TOKENS: tuple[str, ...] = (
    "chgoff",
    "chg_off",
    "balance_gross",
    "mis_status",
)


def _dtype_ok(series: pd.Series, family: str) -> bool:
    if family == "datetime":
        return pd.api.types.is_datetime64_any_dtype(series)
    if family == "integer":
        return pd.api.types.is_integer_dtype(series)
    if family == "object":
        return pd.api.types.is_object_dtype(series) or pd.api.types.is_string_dtype(series)
    return True


# raises instead of returning a flag, so a broken adapter fails at the source
# rather than silently producing a model
def validate_canonical(df: pd.DataFrame) -> pd.DataFrame:
    missing = [c for c in MANDATORY_COLUMNS if c not in df.columns]
    if missing:
        raise ValueError(f"Canonical frame missing mandatory columns: {missing}")

    for col, family in MANDATORY_COLUMNS.items():
        if not _dtype_ok(df[col], family):
            raise ValueError(
                f"Column '{col}' has dtype {df[col].dtype}, expected {family} family"
            )

    bad_target = set(pd.unique(df["default_12m"].dropna())) - {0, 1}
    if bad_target:
        raise ValueError(f"default_12m must be binary 0/1, found extra values: {bad_target}")

    if df["default_12m"].isna().any():
        raise ValueError("default_12m contains nulls; drop unlabeled rows in the adapter")

    return df


# run this on the feature matrix, not the canonical frame, since that is where a
# leaked column would actually do damage
def assert_no_leakage(feature_columns: list[str]) -> None:
    offenders = [
        c for c in feature_columns
        if any(tok in c.lower() for tok in LEAKAGE_TOKENS)
    ]
    if offenders:
        raise ValueError(f"Leakage columns present in feature matrix: {offenders}")
