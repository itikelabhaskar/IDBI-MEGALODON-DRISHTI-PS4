# SBA 7(a) csv -> canonical frame. the raw file is messy: money as "$1,234.00"
# strings, day-month-year dates, fiscal years like "1976A". anything that knows
# the outcome (charge-off date, MIS_Status) is dropped here, before features exist.

from __future__ import annotations

from pathlib import Path

import numpy as np
import pandas as pd

from src.config import PROCESSED_DIR, SEGMENTS
from src.framework.schema import validate_canonical

# Raw columns that leak the outcome — never carried into the canonical frame.
_LEAKAGE_RAW = ["ChgOffDate", "BalanceGross", "ChgOffPrinGr", "MIS_Status"]

# Raw currency columns stored as "$1,234.00" strings.
_MONEY_COLS = ["DisbursementGross", "GrAppv", "SBA_Appv"]


def _parse_money(series: pd.Series) -> pd.Series:
    cleaned = (
        series.astype(str)
        .str.replace(r"[$,\s]", "", regex=True)
        .replace({"": np.nan, "nan": np.nan})
    )
    return pd.to_numeric(cleaned, errors="coerce")


def _parse_fy(series: pd.Series) -> pd.Series:
    # Values like "1976A" appear; keep leading digits only.
    digits = series.astype(str).str.extract(r"(\d{4})", expand=False)
    return pd.to_numeric(digits, errors="coerce")


def load_raw_sba(csv_path: Path) -> pd.DataFrame:
    return pd.read_csv(csv_path, low_memory=False)


def to_canonical(raw: pd.DataFrame) -> pd.DataFrame:
    df = raw.copy()

    # --- Label: CHGOFF -> 1, P I F -> 0; drop anything else (unlabeled) -----
    status = df["MIS_Status"].astype(str).str.strip().str.upper()
    label = status.map({"CHGOFF": 1, "P I F": 0})
    df = df.loc[label.notna()].copy()
    label = label.loc[df.index]

    # --- Dates: origination = disbursement, fall back to approval ----------
    disb = pd.to_datetime(df.get("DisbursementDate"), format="%d-%b-%y", errors="coerce")
    appr = pd.to_datetime(df.get("ApprovalDate"), format="%d-%b-%y", errors="coerce")
    origination_date = disb.fillna(appr)

    money = {c: _parse_money(df[c]) for c in _MONEY_COLS if c in df.columns}

    out = pd.DataFrame(
        {
            "loan_id": df["LoanNr_ChkDgt"].astype(str),
            "segment": "msme_sba",
            "origination_date": origination_date,
            "default_12m": label.astype("int64"),
            "approval_fy": _parse_fy(df["ApprovalFY"]),
            # Retained raw features (renamed to snake_case) --------------------
            "naics": df["NAICS"].astype(str),
            "state": df["State"].astype("string"),
            "bank_state": df["BankState"].astype("string"),
            "term": pd.to_numeric(df["Term"], errors="coerce"),
            "no_emp": pd.to_numeric(df["NoEmp"], errors="coerce"),
            "new_exist": pd.to_numeric(df["NewExist"], errors="coerce"),
            "create_job": pd.to_numeric(df["CreateJob"], errors="coerce"),
            "retained_job": pd.to_numeric(df["RetainedJob"], errors="coerce"),
            "franchise_code": pd.to_numeric(df["FranchiseCode"], errors="coerce"),
            "urban_rural": pd.to_numeric(df["UrbanRural"], errors="coerce"),
            "rev_line_cr": df["RevLineCr"].astype("string"),
            "low_doc": df["LowDoc"].astype("string"),
            "disbursement_gross": money.get("DisbursementGross"),
            "gr_appv": money.get("GrAppv"),
            "sba_appv": money.get("SBA_Appv"),
        }
    )

    # Drop rows with no usable origination date or fiscal year (needed for split).
    out = out.loc[out["origination_date"].notna() & out["approval_fy"].notna()].copy()
    out = out.reset_index(drop=True)

    # Sanity: none of the leakage raw columns should have leaked through.
    assert not any(c in out.columns for c in _LEAKAGE_RAW), "leakage column survived"

    return validate_canonical(out)


def build_canonical(csv_path: Path, save: bool = True) -> pd.DataFrame:
    processed = PROCESSED_DIR / SEGMENTS["msme_sba"]["processed_file"]
    if processed.exists():
        print(f"[adapter] loading cached canonical frame: {processed}")
        return pd.read_parquet(processed)

    canonical = to_canonical(load_raw_sba(csv_path))
    if save:
        canonical.to_parquet(processed, index=False)
        print(f"[adapter] wrote canonical frame ({len(canonical):,} rows): {processed}")
    return canonical
