# the bench card pipeline writes valid html.

from __future__ import annotations

import json

import pytest

from src.config import DOCS_DIR, MODELS_DIR
from src.pipelines import make_bench_card


def test_bench_card_main_writes_html(tmp_path, monkeypatch):
    if not (MODELS_DIR / "india" / "metrics.json").exists():
        pytest.skip("No trained metrics")
    out = tmp_path / "bench_card.html"
    monkeypatch.setattr(make_bench_card, "DOCS_DIR", tmp_path)
    make_bench_card.main()
    assert out.exists()
    text = out.read_text()
    assert "capture" in text.lower() and "auc" in text.lower()


def test_bench_card_repo_output(tmp_path, monkeypatch):
    if not any((MODELS_DIR / k / "metrics.json").exists() for k in ("india", "sba")):
        pytest.skip("No metrics")
    monkeypatch.setattr(make_bench_card, "DOCS_DIR", tmp_path)
    make_bench_card.main()
    out = tmp_path / "bench_card.html"
    assert out.exists()
