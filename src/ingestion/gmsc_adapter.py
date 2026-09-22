# give me some credit -> canonical frame. all-numeric behavioural scoring data,
# point in time, so origination_date is NaT and the split is stratified.

from __future__ import annotations

import zipfile
from pathlib import Path

import pandas as pd

from src.config import PROCESSED_DIR, RAW_DIR, SEGMENTS
from src.framework.schema import validate_canonical

_RAW_MAP = {
    "RevolvingUtilizationOfUnsecuredLines": "revolving_utilization",
    "age": "age",
    "NumberOfTime30-59DaysPastDueNotWorse": "dpd_30_59",
    "DebtRatio": "debt_ratio",
    "MonthlyIncome": "monthly_income",
    "NumberOfOpenCreditLinesAndLoans": "open_credit_lines",
    "NumberOfTimes90DaysLate": "times_90_late",
    "NumberRealEstateLoansOrLines": "real_estate_loans",
    "NumberOfTime60-89DaysPastDueNotWorse": "dpd_60_89",
    "NumberOfDependents": "dependents",
}


def download_gmsc(force: bool = False) -> Path:
    seg = SEGMENTS["retail_gmsc"]
    raw_file = RAW_DIR / seg["raw_file"]
    if raw_file.exists() and not force:
        print(f"[ingestion] GMSC raw file already present: {raw_file}")
        return raw_file

    from kaggle.api.kaggle_api_extended import KaggleApi

    api = KaggleApi()
    api.authenticate()
    print(f"[ingestion] downloading {seg['kaggle_dataset']}::{seg['dataset_file']}")
    api.dataset_download_file(seg["kaggle_dataset"], seg["dataset_file"], path=str(RAW_DIR))

    for zp in RAW_DIR.rglob("*.zip"):
        try:
            with zipfile.ZipFile(zp) as zf:
                zf.extractall(RAW_DIR)
            zp.unlink(missing_ok=True)
        except zipfile.BadZipFile:
            continue

    if not raw_file.exists():
        found = next(iter(RAW_DIR.rglob("cs-training.csv")), None)
        if found is None:
            raise FileNotFoundError(
                f"cs-training.csv not found after downloading {seg['kaggle_dataset']}"
            )
        found.replace(raw_file)
    return raw_file


def load_raw_gmsc(csv_path: Path) -> pd.DataFrame:
    return pd.read_csv(csv_path)


def to_canonical(raw: pd.DataFrame) -> pd.DataFrame:
    df = raw.copy()
    ids = df["Unnamed: 0"].astype(str) if "Unnamed: 0" in df.columns else df.index.astype(str)
    out = pd.DataFrame(
        {
            "loan_id": ids.to_numpy(),
            "segment": "retail_gmsc",
            "origination_date": pd.Series(pd.NaT, index=df.index, dtype="datetime64[ns]"),
            "default_12m": df["SeriousDlqin2yrs"].astype("int64").to_numpy(),
        }
    )
    for raw_c, new_c in _RAW_MAP.items():
        out[new_c] = pd.to_numeric(df[raw_c], errors="coerce").to_numpy()
    out = out.reset_index(drop=True)
    return validate_canonical(out)


def build_canonical(csv_path: Path, save: bool = True) -> pd.DataFrame:
    processed = PROCESSED_DIR / SEGMENTS["retail_gmsc"]["processed_file"]
    if processed.exists():
        print(f"[adapter] loading cached canonical frame: {processed}")
        return pd.read_parquet(processed)
    canonical = to_canonical(load_raw_gmsc(csv_path))
    if save:
        canonical.to_parquet(processed, index=False)
        print(f"[adapter] wrote canonical frame ({len(canonical):,} rows): {processed}")
    return canonical
