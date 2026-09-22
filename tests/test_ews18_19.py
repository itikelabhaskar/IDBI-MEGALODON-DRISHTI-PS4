# the two newer early warning rules fire on the right inputs and stay silent otherwise.

from __future__ import annotations

from src.explain.ews_rules import (
    ALL_EWS_RULES,
    EWS_COLLECTION_SHORTFALL,
    EWS_DP_EROSION,
    RULES,
    evaluate_ews,
    ews_summary,
)


def test_all_ews_rules_export():
    assert len(ALL_EWS_RULES) >= 19
    codes = {r.code for r in ALL_EWS_RULES}
    assert "EWS18" in codes
    assert "EWS19" in codes
    assert ALL_EWS_RULES is RULES
    assert EWS_DP_EROSION == "EWS18"
    assert EWS_COLLECTION_SHORTFALL == "EWS19"


def test_ews18_dp_erosion_trigger():
    # Exactly at threshold 25.0% -> fires
    hits_at_thr = evaluate_ews({"drawing_power_gap_pct": 25.0})
    assert any(h.code == "EWS18" for h in hits_at_thr)

    # Above threshold -> fires
    hits_above = evaluate_ews({"drawing_power_gap_pct": 35.5})
    assert any(h.code == "EWS18" and h.severity == "high" for h in hits_above)

    # Below threshold -> does not fire
    hits_below = evaluate_ews({"drawing_power_gap_pct": 24.9})
    assert not any(h.code == "EWS18" for h in hits_below)

    # Missing or NaN -> does not fire
    assert not any(h.code == "EWS18" for h in evaluate_ews({}))
    assert not any(h.code == "EWS18" for h in evaluate_ews({"drawing_power_gap_pct": None}))


def test_ews19_collection_shortfall_trigger():
    # Below threshold 0.80 -> fires
    hits_below = evaluate_ews({"demanded_vs_collected_ratio": 0.75})
    assert any(h.code == "EWS19" and h.severity == "high" for h in hits_below)

    # At threshold 0.80 -> does not fire (< 0.80)
    hits_at_thr = evaluate_ews({"demanded_vs_collected_ratio": 0.80})
    assert not any(h.code == "EWS19" for h in hits_at_thr)

    # Above threshold -> does not fire
    hits_above = evaluate_ews({"demanded_vs_collected_ratio": 0.95})
    assert not any(h.code == "EWS19" for h in hits_above)

    # Missing or NaN -> does not fire
    assert not any(h.code == "EWS19" for h in evaluate_ews({}))


def test_combined_finacle_signals_in_ews_summary():
    row = {
        "drawing_power_gap_pct": 32.0,
        "demanded_vs_collected_ratio": 0.65,
        "lien_flag": 1,
        "restructuring_flag": 1,
    }
    summary = ews_summary(row)
    codes = {s["code"] for s in summary["signals"]}

    assert "EWS18" in codes
    assert "EWS19" in codes
    assert "EWS16" in codes
    assert "EWS17" in codes
    assert summary["max_severity"] == "high"
