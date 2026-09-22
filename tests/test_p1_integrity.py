# the integrity checklist returns the expected named checks.

from __future__ import annotations

from src.eval.integrity_checklist import run_checklist
from src.serving.coverage import assess_coverage


def test_coverage_refuse_empty():
    cov = assess_coverage("msme_india", [])
    assert cov.status == "insufficient_data"


def test_run_checklist_returns_named_checks():
    rows = run_checklist("msme_india")
    names = {r["name"] for r in rows}
    assert "leakage_guard" in names
    assert "coverage_refuse" in names
    assert all(r["status"] in {"pass", "fail", "skip"} for r in rows)
