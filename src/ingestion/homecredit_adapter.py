# home credit application data -> canonical frame, plus the three side tables
# (bureau, installments, previous applications) rolled up per applicant.
# no origination date in this book, so the pipeline falls back to a stratified split.

from __future__ import annotations

import zipfile
from pathlib import Path

import pandas as pd

from src.config import PROCESSED_DIR, RAW_DIR, SEGMENTS
from src.framework.schema import validate_canonical

# Curated column subset (application_train has 122 columns).
_RAW_KEEP = [
    "SK_ID_CURR", "TARGET", "NAME_CONTRACT_TYPE", "CODE_GENDER",
    "FLAG_OWN_CAR", "FLAG_OWN_REALTY", "CNT_CHILDREN", "CNT_FAM_MEMBERS",
    "AMT_INCOME_TOTAL", "AMT_CREDIT", "AMT_ANNUITY", "AMT_GOODS_PRICE",
    "NAME_INCOME_TYPE", "NAME_EDUCATION_TYPE", "NAME_FAMILY_STATUS",
    "NAME_HOUSING_TYPE", "OCCUPATION_TYPE", "ORGANIZATION_TYPE",
    "DAYS_BIRTH", "DAYS_EMPLOYED", "DAYS_ID_PUBLISH", "DAYS_LAST_PHONE_CHANGE",
    "EXT_SOURCE_1", "EXT_SOURCE_2", "EXT_SOURCE_3",
    "REGION_POPULATION_RELATIVE", "REGION_RATING_CLIENT",
]


def download_homecredit(force: bool = False) -> Path:
    seg = SEGMENTS["retail_homecredit"]
    raw_file = RAW_DIR / seg["raw_file"]
    if raw_file.exists() and not force:
        print(f"[ingestion] Home Credit raw file already present: {raw_file}")
        return raw_file

    from kaggle.api.kaggle_api_extended import KaggleApi

    api = KaggleApi()
    api.authenticate()
    print(f"[ingestion] downloading {seg['kaggle_dataset']}::{seg['dataset_file']}")
    api.dataset_download_file(
        seg["kaggle_dataset"], seg["dataset_file"], path=str(RAW_DIR)
    )

    # Unpack any zip Kaggle delivered, then locate application_train.csv anywhere
    # under data/raw (the mirror nests it in a subfolder).
    for zp in RAW_DIR.rglob("*.zip"):
        try:
            with zipfile.ZipFile(zp) as zf:
                zf.extractall(RAW_DIR)
            zp.unlink(missing_ok=True)
        except zipfile.BadZipFile:
            continue

    if not raw_file.exists():
        found = next(iter(RAW_DIR.rglob("application_train.csv")), None)
        if found is None:
            raise FileNotFoundError(
                f"application_train.csv not found after downloading {seg['kaggle_dataset']}"
            )
        found.replace(raw_file)
    return raw_file


def _download_aux(dataset_file_key: str, raw_file_key: str, force: bool = False) -> Path:
    seg = SEGMENTS["retail_homecredit"]
    raw_file = RAW_DIR / seg[raw_file_key]
    if raw_file.exists() and not force:
        print(f"[ingestion] {raw_file.name} already present")
        return raw_file

    from kaggle.api.kaggle_api_extended import KaggleApi

    api = KaggleApi()
    api.authenticate()
    print(f"[ingestion] downloading {seg['kaggle_dataset']}::{seg[dataset_file_key]}")
    api.dataset_download_file(
        seg["kaggle_dataset"], seg[dataset_file_key], path=str(RAW_DIR)
    )
    for zp in RAW_DIR.rglob("*.zip"):
        try:
            with zipfile.ZipFile(zp) as zf:
                zf.extractall(RAW_DIR)
            zp.unlink(missing_ok=True)
        except zipfile.BadZipFile:
            continue
    if not raw_file.exists():
        found = next(iter(RAW_DIR.rglob(raw_file.name)), None)
        if found is None:
            raise FileNotFoundError(f"{raw_file.name} not found after download")
        found.replace(raw_file)
    return raw_file


def download_bureau(force: bool = False) -> Path:
    return _download_aux("bureau_dataset_file", "bureau_raw_file", force)


# Bureau aggregate columns added to the canonical frame (all leakage-safe:
# they describe the applicant's OTHER credits as reported at application time).
BUREAU_AGG_COLS = [
    "bureau_credit_count", "bureau_active_count", "bureau_debt_sum",
    "bureau_credit_sum", "bureau_debt_credit_ratio", "bureau_overdue_max",
    "bureau_dpd_max", "bureau_prolonged_count", "bureau_recency_days",
]


def aggregate_bureau(bureau_csv: Path) -> pd.DataFrame:
    cols = [
        "SK_ID_CURR", "CREDIT_ACTIVE", "CREDIT_DAY_OVERDUE", "DAYS_CREDIT",
        "AMT_CREDIT_MAX_OVERDUE", "CNT_CREDIT_PROLONG",
        "AMT_CREDIT_SUM", "AMT_CREDIT_SUM_DEBT",
    ]
    b = pd.read_csv(bureau_csv, usecols=cols)
    g = b.groupby("SK_ID_CURR")
    out = pd.DataFrame(
        {
            "bureau_credit_count": g.size(),
            "bureau_active_count": g["CREDIT_ACTIVE"].apply(lambda s: (s == "Active").sum()),
            "bureau_debt_sum": g["AMT_CREDIT_SUM_DEBT"].sum(min_count=1),
            "bureau_credit_sum": g["AMT_CREDIT_SUM"].sum(min_count=1),
            "bureau_overdue_max": g["AMT_CREDIT_MAX_OVERDUE"].max(),
            "bureau_dpd_max": g["CREDIT_DAY_OVERDUE"].max(),
            "bureau_prolonged_count": g["CNT_CREDIT_PROLONG"].sum(),
            # DAYS_CREDIT is negative days-before-application; max = most recent.
            "bureau_recency_days": -g["DAYS_CREDIT"].max(),
        }
    )
    import numpy as np

    ratio = out["bureau_debt_sum"] / out["bureau_credit_sum"]
    out["bureau_debt_credit_ratio"] = ratio.replace([np.inf, -np.inf], np.nan).astype(float)
    return out.reset_index()


# Repayment-behaviour aggregates from installments_payments.csv — the true
# month-over-month "borrower behaviour" layer (late payments, DPD, underpay).
INSTALLMENT_AGG_COLS = [
    "inst_count", "inst_late_share", "inst_dpd_mean", "inst_dpd_max",
    "inst_payment_ratio_mean", "inst_underpay_share", "inst_late_share_12m",
]


def aggregate_installments(csv_path: Path) -> pd.DataFrame:
    cols = ["SK_ID_CURR", "DAYS_INSTALMENT", "DAYS_ENTRY_PAYMENT",
            "AMT_INSTALMENT", "AMT_PAYMENT"]
    df = pd.read_csv(csv_path, usecols=cols)
    dpd = (df["DAYS_ENTRY_PAYMENT"] - df["DAYS_INSTALMENT"]).clip(lower=0)
    df = df.assign(
        _late=(dpd > 0).astype(float),
        _dpd=dpd,
        _ratio=(df["AMT_PAYMENT"] / df["AMT_INSTALMENT"]).replace(
            [float("inf"), -float("inf")], float("nan")
        ).clip(0, 2),
        _underpay=(df["AMT_PAYMENT"] < 0.99 * df["AMT_INSTALMENT"]).astype(float),
        _recent=(df["DAYS_INSTALMENT"] >= -365).astype(bool),
    )
    g = df.groupby("SK_ID_CURR")
    out = pd.DataFrame(
        {
            "inst_count": g.size(),
            "inst_late_share": g["_late"].mean(),
            "inst_dpd_mean": g["_dpd"].mean(),
            "inst_dpd_max": g["_dpd"].max(),
            "inst_payment_ratio_mean": g["_ratio"].mean(),
            "inst_underpay_share": g["_underpay"].mean(),
        }
    )
    recent = df[df["_recent"]].groupby("SK_ID_CURR")["_late"].mean()
    out["inst_late_share_12m"] = recent
    return out.reset_index()


PREVAPP_AGG_COLS = [
    "prev_app_count", "prev_refused_share", "prev_approved_share",
    "prev_credit_application_ratio",
]


def aggregate_prevapp(csv_path: Path) -> pd.DataFrame:
    cols = ["SK_ID_CURR", "NAME_CONTRACT_STATUS", "AMT_APPLICATION", "AMT_CREDIT"]
    df = pd.read_csv(csv_path, usecols=cols)
    ratio = (df["AMT_CREDIT"] / df["AMT_APPLICATION"]).replace(
        [float("inf"), -float("inf")], float("nan")
    ).clip(0, 3)
    df = df.assign(
        _refused=(df["NAME_CONTRACT_STATUS"] == "Refused").astype(float),
        _approved=(df["NAME_CONTRACT_STATUS"] == "Approved").astype(float),
        _ratio=ratio,
    )
    g = df.groupby("SK_ID_CURR")
    return pd.DataFrame(
        {
            "prev_app_count": g.size(),
            "prev_refused_share": g["_refused"].mean(),
            "prev_approved_share": g["_approved"].mean(),
            "prev_credit_application_ratio": g["_ratio"].mean(),
        }
    ).reset_index()


def load_raw_homecredit(csv_path: Path) -> pd.DataFrame:
    return pd.read_csv(csv_path, usecols=lambda c: c in _RAW_KEEP)


def _merge_agg(out: pd.DataFrame, agg: pd.DataFrame) -> pd.DataFrame:
    return out.merge(
        agg.assign(loan_id=agg["SK_ID_CURR"].astype(str)).drop(columns="SK_ID_CURR"),
        on="loan_id",
        how="left",
    )


def to_canonical(
    raw: pd.DataFrame,
    bureau_agg: pd.DataFrame | None = None,
    inst_agg: pd.DataFrame | None = None,
    prev_agg: pd.DataFrame | None = None,
) -> pd.DataFrame:
    df = raw.copy()
    out = pd.DataFrame(
        {
            "loan_id": df["SK_ID_CURR"].astype(str),
            "segment": "retail_homecredit",
            # No origination date in application data -> NaT (schema slot kept).
            "origination_date": pd.Series(
                pd.NaT, index=df.index, dtype="datetime64[ns]"
            ),
            "default_12m": df["TARGET"].astype("int64"),
        }
    )
    for col in _RAW_KEEP:
        if col in ("SK_ID_CURR", "TARGET"):
            continue
        out[col.lower()] = df[col]

    if bureau_agg is not None:
        out = _merge_agg(out, bureau_agg)
        # Applicants absent from the bureau file genuinely have zero tradelines.
        out["bureau_credit_count"] = out["bureau_credit_count"].fillna(0)
    if inst_agg is not None:
        out = _merge_agg(out, inst_agg)
        out["inst_count"] = out["inst_count"].fillna(0)
    if prev_agg is not None:
        out = _merge_agg(out, prev_agg)
        out["prev_app_count"] = out["prev_app_count"].fillna(0)

    out = out.reset_index(drop=True)
    return validate_canonical(out)


def build_canonical(csv_path: Path, save: bool = True) -> pd.DataFrame:
    processed = PROCESSED_DIR / SEGMENTS["retail_homecredit"]["processed_file"]
    if processed.exists():
        cached = pd.read_parquet(processed)
        if all(c in cached.columns
               for c in ("bureau_credit_count", "inst_late_share", "prev_app_count")):
            print(f"[adapter] loading cached canonical frame: {processed}")
            return cached
        print("[adapter] cached frame lacks behavioural aggregates -> rebuilding")

    bureau_agg = aggregate_bureau(download_bureau())
    inst_agg = aggregate_installments(
        _download_aux("installments_dataset_file", "installments_raw_file")
    )
    prev_agg = aggregate_prevapp(
        _download_aux("prevapp_dataset_file", "prevapp_raw_file")
    )
    canonical = to_canonical(load_raw_homecredit(csv_path), bureau_agg, inst_agg, prev_agg)
    if save:
        canonical.to_parquet(processed, index=False)
        print(f"[adapter] wrote canonical frame ({len(canonical):,} rows): {processed}")
    return canonical
