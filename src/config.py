# every path, seed and segment name lives here so nothing downstream hardcodes a
# folder, and so a run is reproducible from one place

from __future__ import annotations

from pathlib import Path


SEED = 42

ROOT = Path(__file__).resolve().parents[1]
DATA_DIR = ROOT / "data"
RAW_DIR = DATA_DIR / "raw"
PROCESSED_DIR = DATA_DIR / "processed"
MODELS_DIR = ROOT / "models_store"
DOCS_DIR = ROOT / "docs"

# the one label column every adapter must produce, whatever the source data looks like
TARGET = "default_12m"

# column the chronological train/val/test split is cut on
SPLIT_KEY = "approval_fy"

# optuna budget. tuning runs on a subsample to stay CPU-friendly, then the best
# params get refit on the full training slice
N_TRIALS = 30
MAX_TUNE_ROWS = 150_000


# one entry per loan book. adding a new source means adding an adapter and a row
# here, nothing else changes downstream
SEGMENTS: dict[str, dict[str, str]] = {
    "msme_sba": {
        "kaggle_dataset": "mirbektoktogaraev/should-this-loan-be-approved-or-denied",
        "raw_file": "SBAnational.csv",
        "processed_file": "msme_sba.parquet",
    },
    "retail_homecredit": {
        "kaggle_dataset": "megancrenshaw/home-credit-default-risk",
        "dataset_file": "home-credit-default-risk/application_train.csv",
        "raw_file": "application_train.csv",
        "bureau_dataset_file": "bureau.csv",
        "bureau_raw_file": "bureau.csv",
        "installments_dataset_file": "installments_payments.csv",
        "installments_raw_file": "installments_payments.csv",
        "prevapp_dataset_file": "previous_application.csv",
        "prevapp_raw_file": "previous_application.csv",
        "processed_file": "retail_homecredit.parquet",
    },
    "retail_gmsc": {
        "kaggle_dataset": "brycecf/give-me-some-credit-dataset",
        "dataset_file": "cs-training.csv",
        "raw_file": "cs-training.csv",
        "processed_file": "retail_gmsc.parquet",
    },
    # generated locally, no download. calibrated to published MSME Pulse stress rates
    "msme_india": {
        "processed_file": "msme_india.parquet",
    },
    # shaped like the bank sandbox loan APIs, see src/ingestion/idbi_adapter.py
    "msme_idbi": {
        "processed_file": "msme_idbi.parquet",
    },
}


def ensure_dirs() -> None:
    for d in (RAW_DIR, PROCESSED_DIR, MODELS_DIR, DOCS_DIR):
        d.mkdir(parents=True, exist_ok=True)


# called on import so a fresh clone can run a pipeline without a setup step
ensure_dirs()
