# the fairness audit is the evidence a model risk committee asks for first, so the
# thing worth testing is not that it returns a number but that it returns the right
# one when a group really is treated differently, and that a passing headline cannot
# hide a failing cut.

import json

import numpy as np
import pandas as pd
import pytest

from src.explain.fairness import group_fairness


def _frame(flag_rates: dict[str, float], n: int = 400, seed: int = 0) -> pd.DataFrame:
    # builds a frame where each group has exactly the requested share of accounts
    # above the 0.16 flag threshold, so the expected ratio is known by construction.
    rng = np.random.default_rng(seed)
    rows = []
    for group, rate in flag_rates.items():
        k = int(round(n * rate))
        pds = np.concatenate([np.full(k, 0.40), np.full(n - k, 0.02)])
        rows.append(pd.DataFrame({
            "group_col": group,
            "pd": pds,
            "default_12m": rng.integers(0, 2, size=n),
        }))
    return pd.concat(rows, ignore_index=True)


def test_equal_treatment_scores_a_ratio_of_one():
    out = group_fairness(_frame({"micro": 0.20, "small": 0.20, "medium": 0.20}), "group_col")
    assert out["disparate_impact_ratio"] == pytest.approx(1.0)
    assert out["passes_80pct_rule"] is True


def test_ratio_is_min_over_max_selection_rate():
    out = group_fairness(_frame({"micro": 0.20, "small": 0.10}), "group_col")
    assert out["disparate_impact_ratio"] == pytest.approx(0.5, abs=1e-3)
    assert out["passes_80pct_rule"] is False


def test_eighty_percent_rule_boundary():
    # 0.16 / 0.20 is exactly 0.80, which the rule treats as passing
    out = group_fairness(_frame({"micro": 0.20, "small": 0.16}), "group_col")
    assert out["disparate_impact_ratio"] == pytest.approx(0.80, abs=1e-3)
    assert out["passes_80pct_rule"] is True


def test_groups_below_min_size_are_dropped():
    df = _frame({"micro": 0.50, "small": 0.50})
    tiny = pd.DataFrame({"group_col": "tiny", "pd": [0.9] * 10, "default_12m": [1] * 10})
    out = group_fairness(pd.concat([df, tiny], ignore_index=True), "group_col", min_group=100)
    assert {g["group"] for g in out["per_group"]} == {"micro", "small"}


def test_india_audit_artifact_is_consistent_with_itself():
    # the published artifact is what the console and the deck quote, so the headline
    # must actually be one of the audited attributes and must not contradict the
    # per-attribute verdicts.
    path = pytest.importorskip("pathlib").Path("models_store/india/fairness.json")
    if not path.exists():
        pytest.skip("fairness audit has not been run for this segment")
    f = json.loads(path.read_text())
    audits = f["audits"]
    assert f["headline_attribute"] in audits
    assert f["disparate_impact_ratio"] == audits[f["headline_attribute"]]["disparate_impact_ratio"]
    worst = min(audits, key=lambda a: audits[a]["disparate_impact_ratio"])
    assert f["worst_attribute"] == worst
    assert f["all_attributes_pass"] == all(v["passes_80pct_rule"] for v in audits.values())
    assert sorted(f["failing_attributes"]) == sorted(
        a for a, v in audits.items() if not v["passes_80pct_rule"]
    )
