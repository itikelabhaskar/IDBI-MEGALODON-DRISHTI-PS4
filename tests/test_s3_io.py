# s3 uri parsing, and that every call falls back to a local path when s3 is absent.

from __future__ import annotations

from pathlib import Path
import pandas as pd
import pytest

from src.storage.s3_io import (
    is_s3_uri,
    load_parquet,
    parse_s3_uri,
    save_parquet,
    upload_file,
)


def test_s3_uri_parsing():
    assert is_s3_uri("s3://my-bucket/models/bundle.pkl") is True
    assert is_s3_uri("/local/path/models.parquet") is False

    bucket, key = parse_s3_uri("s3://drishti-idbi-sandbox/data/processed/msme.parquet")
    assert bucket == "drishti-idbi-sandbox"
    assert key == "data/processed/msme.parquet"

    with pytest.raises(ValueError):
        parse_s3_uri("https://example.com/file.parquet")


def test_parquet_local_save_and_load(tmp_path: Path):
    df = pd.DataFrame({
        "loan_id": ["L1", "L2", "L3"],
        "pd": [0.01, 0.05, 0.12],
        "risk_grade": ["RG1", "RG3", "RG6"],
    })
    target = tmp_path / "test_portfolio.parquet"

    saved_path = save_parquet(df, target)
    assert Path(saved_path).exists()

    loaded_df = load_parquet(saved_path)
    assert len(loaded_df) == 3
    assert list(loaded_df.columns) == ["loan_id", "pd", "risk_grade"]
    assert loaded_df["pd"].iloc[1] == 0.05


def test_local_upload_fallback_when_s3_not_configured(tmp_path: Path):
    f = tmp_path / "sample.txt"
    f.write_text("dummy content")

    res = upload_file(f, "raw/sample.txt")
    assert res == str(f)
