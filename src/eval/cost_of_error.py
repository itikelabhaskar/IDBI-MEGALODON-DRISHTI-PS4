# translates capture rate into labelled rupee costs: missed defaults on one side,
# wasted monitoring on the other. illustrative, LGD and monitoring cost are stated
# assumptions, not a backtest of actual P&L.

from __future__ import annotations

import math


def illustrative_cost_of_error(
    *,
    n: float,
    default_rate: float,
    capture_top_decile: float,
    mean_ead: float,
    lgd: float = 0.45,
    fp_monitoring_cost: float = 5000.0,  # currency units per false watch
    top_frac: float = 0.10,
) -> dict:
    n_defaults = float(n) * float(default_rate)
    captured = n_defaults * float(capture_top_decile)
    missed = n_defaults - captured
    k = math.ceil(float(top_frac) * float(n))
    approx_false_watches = max(0.0, float(k) - captured)
    fn_cost = missed * float(lgd) * float(mean_ead)
    fp_cost = approx_false_watches * float(fp_monitoring_cost)

    return {
        "n": float(n),
        "default_rate": float(default_rate),
        "capture_top_decile": float(capture_top_decile),
        "lift_note": (
            "lift_top_decile (from metrics) = default rate in the top "
            f"{top_frac:.0%} bucket / portfolio default rate; used for EWS "
            "ranking narrative, not as a direct rupee multiplier here."
        ),
        "n_defaults": n_defaults,
        "captured_in_top": captured,
        "missed_outside_top": missed,
        "watchlist_size": int(k),
        "approx_false_watches": approx_false_watches,
        "fn_cost_ecl": fn_cost,
        "fp_cost_monitoring": fp_cost,
        "assumption": "Illustrative; LGD and monitoring cost are labelled assumptions.",
        "why_not_accuracy": (
            "Capture@top-10% and lift measure EWS usefulness; raw accuracy "
            "is dominated by the non-default majority."
        ),
    }


def from_metrics_payload(overall_calibrated: dict, mean_ead: float, **kwargs) -> dict:
    block = overall_calibrated
    # Allow passing overall={lightgbm_calibrated, lightgbm_raw, ...}
    if "capture_top_decile" not in block:
        block = (
            block.get("lightgbm_calibrated")
            or block.get("lightgbm_raw")
            or next(
                (v for v in block.values() if isinstance(v, dict) and "capture_top_decile" in v),
                block,
            )
        )
    return illustrative_cost_of_error(
        n=float(block["n"]),
        default_rate=float(block["default_rate"]),
        capture_top_decile=float(block["capture_top_decile"]),
        mean_ead=mean_ead,
        **kwargs,
    )
