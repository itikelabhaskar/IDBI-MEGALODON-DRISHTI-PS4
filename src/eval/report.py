# writes metrics.json and the plots. the confusion chart deliberately shows two
# operating points side by side, because a single tight threshold reads as "you miss
# most defaulters" when really that cut is the collections list and everything below
# it is still graded and monitored.

from __future__ import annotations

import json
from pathlib import Path

import matplotlib

matplotlib.use("Agg")  # headless / CPU-only safe
import matplotlib.pyplot as plt  # noqa: E402
import numpy as np  # noqa: E402
import pandas as pd  # noqa: E402
from sklearn.calibration import calibration_curve  # noqa: E402


def metrics_table(results: dict[str, dict]) -> pd.DataFrame:
    table = pd.DataFrame(results).T
    ordered = [
        "roc_auc",
        "gini",
        "ks",
        "pr_auc",
        "capture_top_decile",
        "capture_top_5pct",
        "lift_top_decile",
        "brier",
        "default_rate",
        "n",
    ]
    table = table[[c for c in ordered if c in table.columns]]
    return table.round(4)


def plot_calibration(
    probs_by_model: dict[str, np.ndarray],
    y_true: np.ndarray,
    out_path: Path,
    n_bins: int = 10,
) -> None:
    fig, ax = plt.subplots(figsize=(6, 6))
    curves = {}
    for name, prob in probs_by_model.items():
        curves[name] = calibration_curve(y_true, prob, n_bins=n_bins, strategy="quantile")
    # a low-default book never reaches PD 1.0, so a fixed 0-1 square leaves the
    # curve squashed into one corner. scale to the data and draw the diagonal
    # across that range instead.
    hi = max(max(float(mp.max()), float(fp.max())) for fp, mp in curves.values())
    hi = min(1.0, hi * 1.12)
    ax.plot([0, hi], [0, hi], "k--", label="perfect")
    for name, (frac_pos, mean_pred) in curves.items():
        ax.plot(mean_pred, frac_pos, marker="o", label=name)
    ax.set_xlim(0, hi)
    ax.set_ylim(0, hi)
    ax.set_xlabel("Mean predicted PD")
    ax.set_ylabel("Observed default rate")
    ax.set_title("Calibration (12-month stress)")
    ax.legend()
    fig.tight_layout()
    fig.savefig(out_path, dpi=160)
    plt.close(fig)


def plot_capture_curve(
    probs_by_model: dict[str, np.ndarray],
    y_true: np.ndarray,
    out_path: Path,
) -> None:
    y_true = np.asarray(y_true)
    total_bad = y_true.sum()
    fig, ax = plt.subplots(figsize=(6, 6))
    frac_axis = np.linspace(0, 1, 101)
    ax.plot(frac_axis, frac_axis, "k--", label="random")
    for name, prob in probs_by_model.items():
        order = np.argsort(prob)[::-1]
        cum_bad = np.cumsum(y_true[order]) / total_bad
        x = np.arange(1, len(order) + 1) / len(order)
        # Downsample for a light-weight plot.
        idx = np.linspace(0, len(x) - 1, 200).astype(int)
        ax.plot(x[idx], cum_bad[idx], label=name)
    ax.set_xlabel("Fraction of portfolio reviewed (riskiest first)")
    ax.set_ylabel("Fraction of defaulters captured")
    ax.set_title("Cumulative gains / capture curve")
    ax.legend()
    fig.tight_layout()
    fig.savefig(out_path, dpi=120)
    plt.close(fig)


def plot_pr_curve(
    probs_by_model: dict[str, np.ndarray],
    y_true: np.ndarray,
    out_path: Path,
) -> None:
    from sklearn.metrics import precision_recall_curve

    y_true = np.asarray(y_true)
    fig, ax = plt.subplots(figsize=(6, 6))
    ax.axhline(y_true.mean(), color="k", ls="--", lw=1, label="base rate")
    for name, prob in probs_by_model.items():
        precision, recall, _ = precision_recall_curve(y_true, prob)
        idx = np.linspace(0, len(recall) - 1, 300).astype(int)
        ax.plot(recall[idx], precision[idx], label=name)
    ax.set_xlabel("Recall (capture of defaulters)")
    ax.set_ylabel("Precision (flag quality)")
    ax.set_title("Precision-recall, default class")
    ax.legend()
    fig.tight_layout()
    fig.savefig(out_path, dpi=120)
    plt.close(fig)


def plot_confusion(
    y_true: np.ndarray,
    pd_scores: np.ndarray,
    thr_priority: float,
    thr_capacity: float,
    out_path: Path,
) -> None:
    from sklearn.metrics import confusion_matrix

    y = np.asarray(y_true).astype(int)
    p = np.asarray(pd_scores, dtype=float)
    base = y.mean()

    panels = [
        ("Collections priority (F1-optimal)", thr_priority),
        ("Review capacity (top 10% of book)", thr_capacity),
    ]
    fig, axes = plt.subplots(1, 2, figsize=(11.5, 5.4))
    fig.subplots_adjust(wspace=0.45, top=0.80, bottom=0.16)
    for ax, (name, thr) in zip(axes, panels):
        yhat = (p >= thr).astype(int)
        cm = confusion_matrix(y, yhat)
        tn, fp, fn, tp = cm.ravel()
        flagged = tp + fp
        hit = tp / flagged if flagged else 0.0
        recall = tp / (tp + fn) if (tp + fn) else 0.0
        lift = hit / base if base else 0.0

        ax.imshow(cm, cmap="Blues")
        for (i, j), v in np.ndenumerate(cm):
            ax.text(j, i, f"{v:,}\n({v / cm.sum():.1%})", ha="center", va="center",
                    color="white" if v > cm.max() / 2 else "black", fontsize=10.5)
        ax.set_xticks([0, 1], ["Predicted safe", "Flagged"])
        ax.set_yticks([0, 1], ["Actual safe", "Actual stress"])
        ax.set_title(f"{name}\nthreshold = {thr:.3f}", fontsize=10.5)
        ax.text(
            0.5, -0.16,
            f"{flagged:,}-account list · {hit:.0%} truly default "
            f"({lift:.1f}x base {base:.1%}) · catches {recall:.0%}",
            transform=ax.transAxes, ha="center", fontsize=9.5, color="#4a5550",
        )
    fig.suptitle(
        "Two ways the bank operates the same score — below-threshold accounts "
        "stay graded (Amber watch), never ignored",
        fontsize=11,
    )
    fig.savefig(out_path, dpi=120, bbox_inches="tight")
    plt.close(fig)


def save_report(
    out_dir: Path,
    table: pd.DataFrame,
    segment_table: pd.DataFrame | None = None,
    extra: dict | None = None,
) -> None:
    out_dir.mkdir(parents=True, exist_ok=True)
    payload: dict = {"overall": table.to_dict(orient="index")}
    if segment_table is not None:
        payload["by_sector"] = segment_table.to_dict(orient="index")
    if extra:
        payload["meta"] = extra
    (out_dir / "metrics.json").write_text(json.dumps(payload, indent=2))
    print(f"[report] wrote metrics.json -> {out_dir / 'metrics.json'}")
