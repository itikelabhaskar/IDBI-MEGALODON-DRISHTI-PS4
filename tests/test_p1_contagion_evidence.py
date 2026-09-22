# contagion evidence stays quiet on clean accounts and speaks up on stressed ones.

from __future__ import annotations

from src.explain.contagion_evidence import evidence_from_row


def test_contagion_quiet_row():
    ev = evidence_from_row({"nbr_stress_score": 0.1, "nbr_bounce_share": 0.05})
    assert ev["material"] is False
    assert "No material" in ev["summary"]


def test_contagion_stressed_row():
    ev = evidence_from_row(
        {"nbr_stress_score": 0.72, "nbr_bounce_share": 0.4, "stressed_neighbors": 3}
    )
    assert ev["material"] is True
    assert "Upstream" in ev["summary"]
    assert ev["metrics"]["nbr_stress_score"] == 0.72
