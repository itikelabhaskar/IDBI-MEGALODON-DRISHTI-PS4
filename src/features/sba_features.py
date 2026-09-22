# feature engineering for the SBA book. numerics keep their NaNs since lightgbm
# handles them natively, categoricals come back as pandas category dtype.
#
# origination-year macro features were tried here and reverted: under a time split
# they are near-constant in the test years and just proxy vintage default waves,
# which cost about 3 AUC points.

from __future__ import annotations

import numpy as np
import pandas as pd

# NAICS 2-digit sector code -> short label (kept as readable category values).
_NAICS_SECTOR = {
    "11": "agriculture",
    "21": "mining",
    "22": "utilities",
    "23": "construction",
    "31": "manufacturing",
    "32": "manufacturing",
    "33": "manufacturing",
    "42": "wholesale_trade",
    "44": "retail_trade",
    "45": "retail_trade",
    "48": "transport",
    "49": "transport",
    "51": "information",
    "52": "finance_insurance",
    "53": "real_estate",
    "54": "professional_svc",
    "55": "mgmt_of_companies",
    "56": "admin_support",
    "61": "education",
    "62": "health_care",
    "71": "arts_recreation",
    "72": "accommodation_food",
    "81": "other_services",
    "92": "public_admin",
}

NUMERIC_FEATURES: list[str] = [
    "term",
    "no_emp",
    "create_job",
    "retained_job",
    "guarantee_ratio",
    "disbursement_gross",
    "gr_appv",
    "sba_appv",
    "real_estate_backed",
    "new_business",
    "has_franchise",
    "same_state",
]

CATEGORICAL_FEATURES: list[str] = [
    "sector",
    "state",
    "urban_rural",
    "rev_line_cr",
    "low_doc",
]


def engineer_sba_features(df: pd.DataFrame) -> pd.DataFrame:
    out = pd.DataFrame(index=df.index)

    # --- Numeric --------------------------------------------------------------
    out["term"] = df["term"].astype(float)
    out["no_emp"] = df["no_emp"].astype(float)
    out["create_job"] = df["create_job"].astype(float)
    out["retained_job"] = df["retained_job"].astype(float)

    guarantee = df["sba_appv"] / df["gr_appv"]
    out["guarantee_ratio"] = guarantee.replace([np.inf, -np.inf], np.nan).clip(0, 1)
    out["disbursement_gross"] = df["disbursement_gross"].astype(float)
    out["gr_appv"] = df["gr_appv"].astype(float)
    out["sba_appv"] = df["sba_appv"].astype(float)

    # Plain object strings (no pandas pd.NA) so both sklearn and LightGBM cope.
    state = df["state"].astype("object").fillna("unknown")
    bank_state = df["bank_state"].astype("object").fillna("unknown")

    # Long terms (>= 20 years) proxy real-estate-backed loans.
    out["real_estate_backed"] = (df["term"] >= 240).astype(float)
    # NewExist: 1 = existing, 2 = new business.
    out["new_business"] = (df["new_exist"] == 2).astype(float)
    # FranchiseCode 0/1 mean "no franchise".
    out["has_franchise"] = (df["franchise_code"] > 1).astype(float)
    out["same_state"] = (state == bank_state).astype(float)

    # NOTE: origination-year US macro features were tried and REVERTED as model
    # inputs: under a chronological split they are near-constant in the test
    # cohort and proxy vintage default waves in training, degrading AUC by ~3
    # points (documented distribution-shift trap). Macro series still power the
    # scenario engine (src/features/macro_overlay.py).

    # --- Categorical (object-string values, then category dtype) -------------
    naics2 = df["naics"].astype(str).str[:2]
    out["sector"] = naics2.map(_NAICS_SECTOR).fillna("unknown").astype("category")
    out["state"] = state.astype("category")

    urban = df["urban_rural"].map({0: "undefined", 1: "urban", 2: "rural"})
    out["urban_rural"] = urban.fillna("undefined").astype("category")

    rev = df["rev_line_cr"].astype("object")
    out["rev_line_cr"] = rev.where(rev.isin(["Y", "N"]), "other").astype("category")

    low = df["low_doc"].astype("object")
    out["low_doc"] = low.where(low.isin(["Y", "N"]), "other").astype("category")

    return out[NUMERIC_FEATURES + CATEGORICAL_FEATURES]
