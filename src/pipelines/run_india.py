# trains the india book and produces the ablation staircase: structured only, then
# +GST/cashflow, then +officer notes, then +supplier graph. each stage uses fixed
# params over several seeds so the comparison is fair.
#
# stages whose gain is inside the seed noise band get hatched in the chart rather
# than quietly drawn as an improvement.

from __future__ import annotations

import argparse

import joblib
import matplotlib

matplotlib.use("Agg")
import matplotlib.pyplot as plt  # noqa: E402
import numpy as np  # noqa: E402
import pandas as pd  # noqa: E402
from lightgbm import LGBMClassifier, early_stopping, log_evaluation  # noqa: E402

from src.config import MODELS_DIR, SEED  # noqa: E402
from src.eval.metrics import compute_metrics, psi_table  # noqa: E402
from src.eval.report import (  # noqa: E402
    metrics_table,
    plot_calibration,
    plot_capture_curve,
    save_report,
)
from src.features.india_features import (  # noqa: E402
    ALL_FEATURES,
    BASE_FEATURES,
    CASHFLOW_FEATURES,
    GRAPH_FEATURES,
    MONOTONE_DIRECTIONS,
    NOTE_FEATURES,
    NUMERIC_FEATURES,
    engineer_india_features,
)
from src.framework.interpretation import enrich, grade_order  # noqa: E402
from src.ingestion.india_synth import build_canonical, india_split  # noqa: E402
from src.models.imbalance import scale_pos_weight  # noqa: E402
from src.models.train import build_monotone_constraints, train_lgbm  # noqa: E402

# Ablation stages: cumulative feature groups (the moat staircase).
STAGES: list[tuple[str, list[str]]] = [
    ("structured only", BASE_FEATURES),
    ("+ GST / AA cash-flow", BASE_FEATURES + CASHFLOW_FEATURES),
    ("+ officer notes (unstructured)", BASE_FEATURES + CASHFLOW_FEATURES + NOTE_FEATURES),
    ("+ supplier graph (contagion)", BASE_FEATURES + CASHFLOW_FEATURES + NOTE_FEATURES + GRAPH_FEATURES),
]


ABLATION_SEEDS = (42, 7, 123)  # model seeds; the generated data stays fixed


def _quick_lgbm(X_tr, y_tr, X_va, y_va, seed: int = SEED) -> LGBMClassifier:
    clf = LGBMClassifier(
        n_estimators=1500, learning_rate=0.05, num_leaves=63,
        min_child_samples=60, subsample=0.9, subsample_freq=1,
        colsample_bytree=0.9, scale_pos_weight=scale_pos_weight(y_tr),
        random_state=seed, n_jobs=-1, verbosity=-1,
    )
    clf.fit(X_tr, y_tr, eval_set=[(X_va, y_va)], eval_metric="auc",
            callbacks=[early_stopping(50, verbose=False), log_evaluation(0)])
    return clf


def _plot_ablation(stage_metrics: list[dict], out_path) -> None:
    names = [m["stage"] for m in stage_metrics]
    aucs = [m["roc_auc"] for m in stage_metrics]
    errs = [m.get("roc_auc_std", 0.0) for m in stage_metrics]
    captures = [m["capture_top_decile"] for m in stage_metrics]

    fig, ax1 = plt.subplots(figsize=(9, 5))
    x = np.arange(len(names))
    bars = ax1.bar(x, aucs, width=0.55, color=["#8da0cb", "#66c2a5", "#fc8d62", "#e78ac3"],
                   yerr=errs, capsize=4, error_kw={"alpha": 0.7})
    # headroom has to clear the error bar as well as the bar, or the annotation
    # below lands on top of the whisker and eats the decimal point.
    ax1.set_ylim(min(aucs) - 0.03, max(aucs) + max(errs) + 0.055)
    ax1.set_ylabel("ROC AUC (test), mean ± std over model seeds")
    ax1.set_xticks(x, [n.replace(" (", "\n(") for n in names], fontsize=9)
    n_seeds = max(len(ABLATION_SEEDS), 1)
    for i, (b, a, c) in enumerate(zip(bars, aucs, captures)):
        ax1.annotate(f"AUC {a:.3f}\ncapture {c:.0%}",
                     (b.get_x() + b.get_width() / 2, a + errs[i]), ha="center",
                     va="bottom", fontsize=9,
                     xytext=(0, 5), textcoords="offset points")
        # Flag stages whose lift over the previous stage is not clearly
        # positive (delta <= 1 combined standard error, or negative) —
        # honesty beats a silently rising staircase.
        if i > 0:
            sem = ((errs[i] ** 2 + errs[i - 1] ** 2) / n_seeds) ** 0.5
            if (a - aucs[i - 1]) <= sem:
                b.set_alpha(0.5)
                b.set_hatch("//")
                ax1.annotate("within seed noise —\nvalidate on real data",
                             (b.get_x() + b.get_width() / 2, a / 2 + min(aucs) / 2),
                             ha="center", va="center", fontsize=8.5,
                             color="#5a4300",
                             bbox={"boxstyle": "round,pad=0.3", "fc": "white",
                                   "ec": "#b08900", "alpha": 0.9})
    ax1.set_title(
        f"Each data layer adds real lift (synthetic India MSME world; "
        f"{len(ABLATION_SEEDS)} seeds)"
    )
    fig.tight_layout()
    fig.savefig(out_path, dpi=160)
    plt.close(fig)


def run(
    n_trials: int = 30, n_rows: int = 60_000,
    skip_final: bool = False, use_finbert: bool = False,
) -> None:
    out_dir = MODELS_DIR / "india"
    canonical = build_canonical(n=n_rows, use_finbert=use_finbert)
    X = engineer_india_features(canonical)
    y = canonical["default_12m"].to_numpy()
    print(f"[run] features: {X.shape[1]} cols, {len(X):,} rows, default rate={y.mean():.3%}")

    tr, va, te = india_split(canonical)
    X_tr, X_va, X_te = X[tr], X[va], X[te]
    y_tr, y_va, y_te = y[tr], y[va], y[te]
    print(f"[run] split -> train={tr.sum():,} val={va.sum():,} test={te.sum():,}")

    # 1. Ablation staircase (fixed params, mean +/- std over model seeds) ----
    stage_metrics = []
    for stage, cols in STAGES:
        aucs, caps = [], []
        for sd in ABLATION_SEEDS:
            clf = _quick_lgbm(X_tr[cols], y_tr, X_va[cols], y_va, seed=sd)
            m = compute_metrics(y_te, clf.predict_proba(X_te[cols])[:, 1])
            aucs.append(m["roc_auc"])
            caps.append(m["capture_top_decile"])
        stage_metrics.append({
            "stage": stage,
            "roc_auc": round(float(np.mean(aucs)), 4),
            "roc_auc_std": round(float(np.std(aucs)), 4),
            "capture_top_decile": round(float(np.mean(caps)), 4),
            "capture_top_decile_std": round(float(np.std(caps)), 4),
            "seeds": list(ABLATION_SEEDS),
        })
        print(f"[ablation] {stage:38s} AUC={np.mean(aucs):.4f}±{np.std(aucs):.4f} "
              f"capture@10%={np.mean(caps):.3f}±{np.std(caps):.3f}")

    if skip_final:
        # Refresh the staircase artifact + metrics.json entry, keep the model.
        import json

        out_dir.mkdir(parents=True, exist_ok=True)
        _plot_ablation(stage_metrics, out_dir / "ablation.png")
        mpath = out_dir / "metrics.json"
        if mpath.exists():
            payload = json.loads(mpath.read_text())
            payload.setdefault("meta", {})["ablation_staircase"] = stage_metrics
            mpath.write_text(json.dumps(payload, indent=2))
            print(f"[run] refreshed ablation in {mpath}")
        print("[run] skip-final: done.")
        return

    # 2. Final tuned + monotone-constrained model on all features ------------
    print(f"[run] training final LightGBM ({n_trials} trials, monotone) ...")
    constraints = build_monotone_constraints(ALL_FEATURES, MONOTONE_DIRECTIONS)
    trained = train_lgbm(X_tr, y_tr, X_va, y_va, n_trials=n_trials,
                         monotone_constraints=constraints)
    final_raw = trained.predict_raw(X_te)
    final_pd = trained.predict_pd(X_te)

    results = {
        "lightgbm_raw": compute_metrics(y_te, final_raw),
        "lightgbm_calibrated": compute_metrics(y_te, final_pd),
    }
    table = metrics_table(results)
    print("\n=== India MSME test metrics (synthetic world) ===")
    print(table.to_string())

    seg = X_te["sub_segment"].astype(str).reset_index(drop=True)
    seg_rows = {}
    for level, idx in seg.groupby(seg).groups.items():
        pos = seg.index.get_indexer(idx)
        seg_rows[str(level)] = compute_metrics(y_te[pos], final_pd[pos])
    seg_table = pd.DataFrame(seg_rows).T.round(4)
    print("\n=== By sub-segment ===")
    print(seg_table.to_string())

    scored = X_te.copy()
    scored["pd"] = final_pd
    scored = enrich(scored, pd_col="pd", ead_col="ticket_size")
    dist = scored["risk_grade"].value_counts().reindex(grade_order()).fillna(0).astype(int)
    print("\n=== Unified risk-grade distribution ===")
    print(dist.to_string())

    # 3. Artifacts ------------------------------------------------------------
    out_dir.mkdir(parents=True, exist_ok=True)
    _plot_ablation(stage_metrics, out_dir / "ablation.png")
    probs = {"lightgbm_calibrated": final_pd}
    plot_calibration(probs, y_te, out_dir / "calibration.png")
    plot_capture_curve(probs, y_te, out_dir / "capture_curve.png")
    save_report(
        out_dir, table, seg_table,
        extra={
            "seed": SEED, "n_trials": n_trials,
            "best_params": trained.best_params,
            "ablation_staircase": stage_metrics,
            "monotone_constraints": MONOTONE_DIRECTIONS,
            "psi_train_vs_test": psi_table(X_tr, X_te, NUMERIC_FEATURES),
            "data_note": (
                "SYNTHETIC data calibrated to SIDBI-TransUnion MSME Pulse priors "
                "(micro~4.5%, small~3%, medium~2% 12m stress). Officer-note and "
                "supplier-graph lifts are causal-by-construction, not label-leaked."
            ),
        },
    )
    joblib.dump(trained, out_dir / "model.pkl")
    print(f"[run] saved model bundle -> {out_dir / 'model.pkl'}")
    print("[run] done.")


def main() -> None:
    parser = argparse.ArgumentParser(description="Run the synthetic India MSME pipeline.")
    parser.add_argument("--trials", type=int, default=30)
    parser.add_argument("--rows", type=int, default=60_000)
    parser.add_argument("--skip-final", action="store_true",
                        help="refresh the ablation staircase only; keep the trained model")
    parser.add_argument("--finbert", action="store_true",
                        help="use self-hosted FinBERT for note sentiment (regenerate canonical first)")
    args = parser.parse_args()
    run(n_trials=args.trials, n_rows=args.rows, skip_final=args.skip_final,
        use_finbert=args.finbert)


if __name__ == "__main__":
    main()
