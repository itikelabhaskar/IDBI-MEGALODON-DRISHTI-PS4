# feature engineering for the home credit book. leans on the external credit scores
# and the affordability ratios, plus the bureau and repayment rollups.

from __future__ import annotations

import numpy as np
import pandas as pd

NUMERIC_FEATURES: list[str] = [
    "amt_income", "amt_credit", "amt_annuity", "amt_goods",
    "credit_income_ratio", "annuity_income_ratio", "credit_goods_ratio",
    "age_years", "employed_years", "employed_to_age_ratio",
    "cnt_children", "cnt_fam_members",
    "ext_source_1", "ext_source_2", "ext_source_3", "ext_source_mean",
    "region_population", "region_rating",
    "id_publish_years", "phone_change_years",
    "own_car", "own_realty",
    # Bureau aggregates (other-credit behaviour known at application time).
    "bureau_credit_count", "bureau_active_count", "bureau_debt_credit_ratio",
    "bureau_overdue_max", "bureau_dpd_max", "bureau_prolonged_count",
    "bureau_recency_years",
    # Repayment behaviour from installments history + prior applications —
    # the month-over-month "borrower behaviour" layer.
    "inst_count", "inst_late_share", "inst_dpd_mean", "inst_dpd_max",
    "inst_payment_ratio_mean", "inst_underpay_share", "inst_late_share_12m",
    "prev_app_count", "prev_refused_share", "prev_approved_share",
    "prev_credit_application_ratio",
]

CATEGORICAL_FEATURES: list[str] = [
    "contract_type", "gender", "income_type", "education",
    "family_status", "housing_type", "occupation", "organization",
]


def _yn(series: pd.Series) -> pd.Series:
    return (series.astype("object") == "Y").astype(float)


def engineer_homecredit_features(df: pd.DataFrame) -> pd.DataFrame:
    out = pd.DataFrame(index=df.index)

    income = df["amt_income_total"].astype(float)
    credit = df["amt_credit"].astype(float)
    annuity = df["amt_annuity"].astype(float)
    goods = df["amt_goods_price"].astype(float)

    out["amt_income"] = income
    out["amt_credit"] = credit
    out["amt_annuity"] = annuity
    out["amt_goods"] = goods
    out["credit_income_ratio"] = (credit / income).replace([np.inf, -np.inf], np.nan)
    out["annuity_income_ratio"] = (annuity / income).replace([np.inf, -np.inf], np.nan)
    out["credit_goods_ratio"] = (credit / goods).replace([np.inf, -np.inf], np.nan)

    age = (-df["days_birth"].astype(float)) / 365.25
    # DAYS_EMPLOYED sentinel 365243 means "not employed" (pensioners) -> NaN.
    days_emp = df["days_employed"].replace(365243, np.nan).astype(float)
    employed = (-days_emp) / 365.25
    out["age_years"] = age
    out["employed_years"] = employed
    out["employed_to_age_ratio"] = (employed / age).replace([np.inf, -np.inf], np.nan)

    out["cnt_children"] = df["cnt_children"].astype(float)
    out["cnt_fam_members"] = df["cnt_fam_members"].astype(float)

    for i in (1, 2, 3):
        out[f"ext_source_{i}"] = df[f"ext_source_{i}"].astype(float)
    out["ext_source_mean"] = out[["ext_source_1", "ext_source_2", "ext_source_3"]].mean(axis=1)

    out["region_population"] = df["region_population_relative"].astype(float)
    out["region_rating"] = df["region_rating_client"].astype(float)
    out["id_publish_years"] = (-df["days_id_publish"].astype(float)) / 365.25
    out["phone_change_years"] = (-df["days_last_phone_change"].astype(float)) / 365.25
    out["own_car"] = _yn(df["flag_own_car"])
    out["own_realty"] = _yn(df["flag_own_realty"])

    # Bureau aggregates: absent columns (e.g. single-record scoring without a
    # bureau pull) stay NaN — LightGBM treats that as its own signal.
    for col in ["bureau_credit_count", "bureau_active_count",
                "bureau_debt_credit_ratio", "bureau_overdue_max",
                "bureau_dpd_max", "bureau_prolonged_count",
                "inst_count", "inst_late_share", "inst_dpd_mean", "inst_dpd_max",
                "inst_payment_ratio_mean", "inst_underpay_share",
                "inst_late_share_12m", "prev_app_count", "prev_refused_share",
                "prev_approved_share", "prev_credit_application_ratio"]:
        out[col] = pd.to_numeric(df[col], errors="coerce") if col in df.columns else np.nan
    out["bureau_recency_years"] = (
        pd.to_numeric(df["bureau_recency_days"], errors="coerce") / 365.25
        if "bureau_recency_days" in df.columns
        else np.nan
    )

    def _cat(col: str) -> pd.Series:
        return df[col].astype("object").fillna("missing").astype("category")

    out["contract_type"] = _cat("name_contract_type")
    out["gender"] = _cat("code_gender")
    out["income_type"] = _cat("name_income_type")
    out["education"] = _cat("name_education_type")
    out["family_status"] = _cat("name_family_status")
    out["housing_type"] = _cat("name_housing_type")
    out["occupation"] = _cat("occupation_type")
    out["organization"] = _cat("organization_type")

    return out[NUMERIC_FEATURES + CATEGORICAL_FEATURES]
