# the metric bundle. plain accuracy is meaningless at a 4% default rate, so this
# reports discrimination (AUC, gini, KS), usefulness (PR-AUC, capture and lift at
# the top decile) and calibration (brier) side by side.
#
# psi is the drift check: below 0.10 stable, 0.10-0.25 watch, above 0.25 recalibrate.

from __future__ import annotations

import numpy as np
from sklearn.metrics import (
    average_precision_score,
    brier_score_loss,
    roc_auc_score,
    roc_curve,
)


def ks_statistic(y_true: np.ndarray, y_prob: np.ndarray) -> float:
    fpr, tpr, _ = roc_curve(y_true, y_prob)
    return float(np.max(tpr - fpr))


def capture_at_top(y_true: np.ndarray, y_prob: np.ndarray, frac: float = 0.10) -> float:
    y_true = np.asarray(y_true)
    total_bad = y_true.sum()
    if total_bad == 0:
        return float("nan")
    k = max(1, int(np.ceil(frac * len(y_prob))))
    top_idx = np.argsort(y_prob)[::-1][:k]
    return float(y_true[top_idx].sum() / total_bad)


def lift_at_top(y_true: np.ndarray, y_prob: np.ndarray, frac: float = 0.10) -> float:
    y_true = np.asarray(y_true)
    base = y_true.mean()
    if base == 0:
        return float("nan")
    k = max(1, int(np.ceil(frac * len(y_prob))))
    top_idx = np.argsort(y_prob)[::-1][:k]
    return float(y_true[top_idx].mean() / base)


def psi(expected: np.ndarray, actual: np.ndarray, n_bins: int = 10) -> float:
    expected = np.asarray(expected, dtype=float)
    actual = np.asarray(actual, dtype=float)
    expected = expected[~np.isnan(expected)]
    actual = actual[~np.isnan(actual)]
    if len(expected) == 0 or len(actual) == 0:
        return float("nan")
    edges = np.unique(np.quantile(expected, np.linspace(0, 1, n_bins + 1)))
    if len(edges) < 3:  # near-constant feature
        return 0.0
    edges[0], edges[-1] = -np.inf, np.inf
    e_frac = np.histogram(expected, bins=edges)[0] / len(expected)
    a_frac = np.histogram(actual, bins=edges)[0] / len(actual)
    e_frac = np.clip(e_frac, 1e-6, None)
    a_frac = np.clip(a_frac, 1e-6, None)
    return float(np.sum((a_frac - e_frac) * np.log(a_frac / e_frac)))


def psi_table(
    train_df, test_df, columns: list[str], n_bins: int = 10
) -> dict[str, float]:
    out: dict[str, float] = {}
    for col in columns:
        try:
            out[col] = round(psi(train_df[col].to_numpy(dtype=float),
                                 test_df[col].to_numpy(dtype=float), n_bins), 4)
        except (TypeError, ValueError):
            continue
    return out


def compute_metrics(
    y_true: np.ndarray,
    y_prob: np.ndarray,
    top_frac: float = 0.10,
) -> dict[str, float]:
    y_true = np.asarray(y_true)
    y_prob = np.asarray(y_prob)
    auc = roc_auc_score(y_true, y_prob)
    return {
        "roc_auc": float(auc),
        "gini": float(2 * auc - 1),
        "ks": ks_statistic(y_true, y_prob),
        "pr_auc": float(average_precision_score(y_true, y_prob)),
        "capture_top_decile": capture_at_top(y_true, y_prob, top_frac),
        "capture_top_5pct": capture_at_top(y_true, y_prob, 0.05),
        "lift_top_decile": lift_at_top(y_true, y_prob, top_frac),
        "brier": float(brier_score_loss(y_true, y_prob)),
        "default_rate": float(y_true.mean()),
        "n": int(len(y_true)),
    }
