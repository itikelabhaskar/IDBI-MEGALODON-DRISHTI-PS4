# one line of officer-readable copy when a borrower's supplier network stress is
# material enough to matter, so the contagion tab is explanatory rather than a toy.

from __future__ import annotations

from typing import Mapping

_NBR_STRESS_THRESHOLD = 0.5
_NBR_BOUNCE_THRESHOLD = 0.3
_STRESSED_NEIGHBORS_THRESHOLD = 2


def _num(row: Mapping, key: str) -> float | None:
    if key not in row:
        return None
    try:
        v = float(row[key])
    except (TypeError, ValueError):
        return None
    return v


def evidence_from_row(row: Mapping) -> dict:
    metrics: dict[str, float | int] = {}
    for key in (
        "nbr_stress_score",
        "nbr_bounce_share",
        "stressed_neighbors",
        "n_links",
        "dependence_concentration",
        "pagerank",
    ):
        v = _num(row, key)
        if v is not None:
            metrics[key] = int(v) if key in {"stressed_neighbors", "n_links"} else round(v, 4)

    nbr_stress = _num(row, "nbr_stress_score")
    nbr_bounce = _num(row, "nbr_bounce_share")
    stressed_n = _num(row, "stressed_neighbors")

    material = False
    if nbr_stress is not None and nbr_stress >= _NBR_STRESS_THRESHOLD:
        material = True
    if nbr_bounce is not None and nbr_bounce >= _NBR_BOUNCE_THRESHOLD:
        material = True
    if stressed_n is not None and stressed_n >= _STRESSED_NEIGHBORS_THRESHOLD:
        material = True

    if not material:
        return {
            "material": False,
            "summary": "No material upstream supplier-network stress signal on this account.",
            "metrics": metrics,
        }

    parts: list[str] = []
    if nbr_stress is not None:
        parts.append(f"neighbour stress score {nbr_stress:.2f}")
    if nbr_bounce is not None:
        parts.append(f"bounce share {nbr_bounce:.0%}")
    if stressed_n is not None and stressed_n >= 1:
        parts.append(f"{int(stressed_n)} stressed neighbour(s)")
    detail = "; ".join(parts) if parts else "elevated graph stress"
    summary = f"Upstream supplier-network stress elevated ({detail})."

    return {"material": True, "summary": summary, "metrics": metrics}
