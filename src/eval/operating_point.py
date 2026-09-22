# sweeps the threshold and reports accuracy, precision, recall and flag rate at each
# named cut. exists so the bank's ">90% accuracy" ask can be answered at a concrete
# operating point with the trade-off visible next to it, rather than as one number.

from __future__ import annotations

import numpy as np
from sklearn.metrics import accuracy_score, f1_score, precision_score, recall_score


def _point(y: np.ndarray, p: np.ndarray, thr: float, name: str) -> dict:
    yhat = (p >= thr).astype(int)
    return {
        "operating_point": name,
        "threshold": round(float(thr), 4),
        # Exact cutoff for downstream reuse: calibrated scores carry isotonic
        # ties, so a rounded threshold can silently exclude a whole tie block.
        "threshold_exact": float(thr),
        "accuracy": round(float(accuracy_score(y, yhat)), 4),
        "precision": round(float(precision_score(y, yhat, zero_division=0)), 4),
        "recall_capture": round(float(recall_score(y, yhat, zero_division=0)), 4),
        "f1": round(float(f1_score(y, yhat, zero_division=0)), 4),
        "flag_rate": round(float(yhat.mean()), 4),
    }


def operating_points(y_true, pd_scores) -> dict:
    y = np.asarray(y_true).astype(int)
    p = np.asarray(pd_scores, dtype=float)

    grid = np.unique(np.quantile(p, np.linspace(0.01, 0.99, 197)))
    accs = [(thr, accuracy_score(y, p >= thr)) for thr in grid]
    f1s = [(thr, f1_score(y, p >= thr, zero_division=0)) for thr in grid]
    acc_best = max(accs, key=lambda t: t[1])
    f1_best = max(f1s, key=lambda t: t[1])
    # Rank-based capacity cutoff: a plain quantile under-flags when calibrated
    # scores carry isotonic ties (a "top 10%" that flags 6% of the book).
    k = max(1, int(round(0.10 * len(p))))
    top10_thr = float(np.partition(p, -k)[-k])

    # High-propensity operating point (mentor-clarified: precision >= 90% among flagged)
    precisions = [
        (thr, precision_score(y, p >= thr, zero_division=0))
        for thr in grid
        if (p >= thr).sum() >= 5
    ]
    p90 = [t for t in precisions if t[1] >= 0.90]
    if p90:
        best_p90_thr = min(p90, key=lambda t: t[0])[0]
        prec_point = _point(y, p, best_p90_thr, "high-propensity (precision >= 90%)")
    elif precisions:
        max_p = max(precisions, key=lambda t: t[1])
        prec_point = _point(y, p, max_p[0], f"max-precision ({max_p[1]:.1%})")
    else:
        prec_point = _point(y, p, 0.9, "high-propensity")

    rows = [
        _point(y, p, 0.5, "default (PD >= 50%)"),
        _point(y, p, f1_best[0], "F1-optimal"),
        _point(y, p, acc_best[0], "accuracy-optimal"),
        _point(y, p, top10_thr, "top-10% review capacity"),
        prec_point,
    ]
    base_rate = float(y.mean())
    dummy_accuracy = max(base_rate, 1.0 - base_rate)
    return {
        "points": rows,
        "max_accuracy": round(float(acc_best[1]), 4),
        "meets_90pct_accuracy": bool(acc_best[1] >= 0.90),
        "base_default_rate": round(base_rate, 4),
        # Flag-nothing majority-class baseline: the honest floor any accuracy
        # claim must clear. On imbalanced books the accuracy-optimal point is
        # close to this by construction — hence the capture columns beside it.
        "dummy_accuracy": round(dummy_accuracy, 4),
        "note": (
            "Accuracy reported at explicit operating points per the bank's "
            "stated >=90% requirement; capture (recall) and flag rate shown "
            "beside it so the accuracy figure stays honest about trade-offs. "
            "dummy_accuracy is what a predict-nothing classifier scores."
        ),
    }
