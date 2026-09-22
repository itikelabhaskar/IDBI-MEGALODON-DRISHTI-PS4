# pulls the SBA csv off kaggle. needs ~/.kaggle/kaggle.json or the KAGGLE_* env vars.

from __future__ import annotations

from pathlib import Path

from src.config import RAW_DIR, SEGMENTS


def download_sba(force: bool = False) -> Path:
    seg = SEGMENTS["msme_sba"]
    raw_file = RAW_DIR / seg["raw_file"]

    if raw_file.exists() and not force:
        print(f"[ingestion] SBA raw file already present: {raw_file}")
        return raw_file

    # Import lazily so the rest of the pipeline works even if kaggle is absent.
    from kaggle.api.kaggle_api_extended import KaggleApi

    api = KaggleApi()
    api.authenticate()
    print(f"[ingestion] downloading {seg['kaggle_dataset']} -> {RAW_DIR}")
    api.dataset_download_files(seg["kaggle_dataset"], path=str(RAW_DIR), unzip=True)

    if not raw_file.exists():
        # Some mirrors name the file differently; fall back to first CSV found.
        candidates = sorted(RAW_DIR.glob("*.csv"))
        if not candidates:
            raise FileNotFoundError(
                f"Expected {raw_file} after download but found no CSV in {RAW_DIR}"
            )
        raw_file = candidates[0]
        print(f"[ingestion] using downloaded CSV: {raw_file.name}")

    return raw_file
