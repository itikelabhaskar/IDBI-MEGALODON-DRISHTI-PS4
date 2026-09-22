# s3 helpers for artifacts and scored portfolios. every call degrades to a local
# path when s3 is not configured, so nothing breaks off-cloud.

from __future__ import annotations

import os
import shutil
from pathlib import Path
from typing import Any
from urllib.parse import urlparse

import pandas as pd

_DEFAULT_REGION = os.environ.get("AWS_DEFAULT_REGION", "ap-south-1")


def get_default_bucket() -> str | None:
    return os.environ.get("AWS_S3_BUCKET") or os.environ.get("DRISHTI_S3_BUCKET")


def is_s3_uri(uri: str | Path) -> bool:
    return str(uri).startswith("s3://")


def parse_s3_uri(uri: str) -> tuple[str, str]:
    parsed = urlparse(uri)
    if parsed.scheme != "s3":
        raise ValueError(f"Not an S3 URI: {uri}")
    bucket = parsed.netloc
    key = parsed.path.lstrip("/")
    return bucket, key


def _get_s3_client() -> Any:
    try:
        import boto3
        return boto3.client("s3", region_name=_DEFAULT_REGION)
    except Exception:
        return None


def upload_file(
    local_path: Path | str,
    s3_key_or_uri: str,
    bucket: str | None = None,
) -> str:
    local_p = Path(local_path)
    if not local_p.exists():
        raise FileNotFoundError(f"Local file not found: {local_p}")

    target_bucket = bucket or get_default_bucket()
    key = s3_key_or_uri

    if is_s3_uri(s3_key_or_uri):
        parsed_bucket, parsed_key = parse_s3_uri(s3_key_or_uri)
        target_bucket = parsed_bucket
        key = parsed_key

    client = _get_s3_client()
    if client and target_bucket:
        client.upload_file(str(local_p), target_bucket, key)
        return f"s3://{target_bucket}/{key}"

    # Fallback to local destination if not in S3 mode
    return str(local_p)


def download_file(
    s3_key_or_uri: str,
    local_path: Path | str,
    bucket: str | None = None,
) -> Path:
    local_dest = Path(local_path)
    local_dest.parent.mkdir(parents=True, exist_ok=True)

    if not is_s3_uri(s3_key_or_uri) and Path(s3_key_or_uri).exists():
        if local_dest != Path(s3_key_or_uri):
            shutil.copyfile(s3_key_or_uri, local_dest)
        return local_dest

    target_bucket = bucket or get_default_bucket()
    key = s3_key_or_uri

    if is_s3_uri(s3_key_or_uri):
        target_bucket, key = parse_s3_uri(s3_key_or_uri)

    client = _get_s3_client()
    if client and target_bucket:
        client.download_file(target_bucket, key, str(local_dest))
        return local_dest

    raise RuntimeError(
        f"Cannot download {s3_key_or_uri}: S3 client or bucket not available"
    )


def save_parquet(
    df: pd.DataFrame,
    target_path_or_uri: str | Path,
    **kwargs: Any,
) -> str:
    target_str = str(target_path_or_uri)

    if is_s3_uri(target_str):
        bucket, key = parse_s3_uri(target_str)
        client = _get_s3_client()
        if client:
            # Direct write via pyarrow s3fs or tempfile upload
            import tempfile
            with tempfile.NamedTemporaryFile(suffix=".parquet", delete=False) as tmp:
                tmp_path = Path(tmp.name)
            try:
                df.to_parquet(tmp_path, index=False, **kwargs)
                client.upload_file(str(tmp_path), bucket, key)
                return target_str
            finally:
                if tmp_path.exists():
                    tmp_path.unlink()
        else:
            raise RuntimeError(f"S3 client not available to write {target_str}")

    local_p = Path(target_str)
    local_p.parent.mkdir(parents=True, exist_ok=True)
    df.to_parquet(local_p, index=False, **kwargs)

    # Optional auto-sync to S3 if default bucket configured
    default_bucket = get_default_bucket()
    client = _get_s3_client()
    if default_bucket and client and not is_s3_uri(target_str):
        rel_key = str(local_p).lstrip("/")
        try:
            client.upload_file(str(local_p), default_bucket, rel_key)
            return f"s3://{default_bucket}/{rel_key}"
        except Exception:
            pass

    return str(local_p)


def load_parquet(
    source_path_or_uri: str | Path,
    **kwargs: Any,
) -> pd.DataFrame:
    source_str = str(source_path_or_uri)

    if is_s3_uri(source_str):
        bucket, key = parse_s3_uri(source_str)
        client = _get_s3_client()
        if client:
            import tempfile
            with tempfile.NamedTemporaryFile(suffix=".parquet", delete=False) as tmp:
                tmp_path = Path(tmp.name)
            try:
                client.download_file(bucket, key, str(tmp_path))
                return pd.read_parquet(tmp_path, **kwargs)
            finally:
                if tmp_path.exists():
                    tmp_path.unlink()
        else:
            raise RuntimeError(f"S3 client not available to read {source_str}")

    return pd.read_parquet(source_str, **kwargs)
