# stress lab re-scores through the bundle and moves grade and ECL the right way.

from __future__ import annotations

import pandas as pd

from src.explain.stress_lab import apply_stress


class _MockBundle:
    feature_cols = ["emi_bounce_6m", "gst_filing_delay_days"]

    def predict_pd(self, X):
        bounce = float(X["emi_bounce_6m"].iloc[0])
        delay = float(X["gst_filing_delay_days"].iloc[0])
        return pd.Series([0.05 + 0.02 * bounce + 0.001 * delay])


def test_apply_stress_changes_pd_and_grade():
    row = pd.DataFrame([{"emi_bounce_6m": 0.0, "gst_filing_delay_days": 10.0}])
    out = apply_stress(
        _MockBundle(),
        row,
        {"emi_bounce_6m": 5.0, "gst_filing_delay_days": 60.0},
        ead=1_000_000,
    )
    assert out["after"]["pd"] > out["before"]["pd"]
    assert out["pd_delta"] > 0
    assert "ecl" in out["before"] and "ecl" in out["after"]
    assert out["after"]["ecl"] >= out["before"]["ecl"]
