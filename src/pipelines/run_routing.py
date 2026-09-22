# tabpfn against lightgbm on shrinking training samples, to find the row count below
# which the foundation model is worth routing to.

from __future__ import annotations

# Must run before numpy/lightgbm/torch import their OpenMP runtimes. LightGBM and
# PyTorch each bundle libomp; on macOS loading both deadlocks at the first
# parallel region (process sits at 0% CPU). Single-threaded OMP + allowing the
# duplicate runtime avoids it.
import os  # noqa: E402

os.environ.setdefault("OMP_NUM_THREADS", "1")
os.environ.setdefault("KMP_DUPLICATE_LIB_OK", "TRUE")
os.environ.setdefault("TOKENIZERS_PARALLELISM", "false")

import argparse  # noqa: E402
import json  # noqa: E402

import matplotlib  # noqa: E402

matplotlib.use("Agg")
import matplotlib.pyplot as plt  # noqa: E402
import numpy as np  # noqa: E402
import pandas as pd  # noqa: E402
from lightgbm import LGBMClassifier  # noqa: E402

from src.config import MODELS_DIR, SEED, SPLIT_KEY  # noqa: E402
from src.eval.metrics import compute_metrics  # noqa: E402
from src.features.sba_features import engineer_sba_features  # noqa: E402
from src.ingestion.kaggle_download import download_sba  # noqa: E402
from src.ingestion.sba_adapter import build_canonical  # noqa: E402
from src.models.imbalance import scale_pos_weight  # noqa: E402
from src.models.tabpfn_router import tabpfn_pd, train_tabpfn  # noqa: E402
from src.models.train import time_based_split  # noqa: E402


def _small_lgbm(X_s: pd.DataFrame, y_s: np.ndarray) -> LGBMClassifier:
    clf = LGBMClassifier(
        n_estimators=400,
        learning_rate=0.05,
        num_leaves=31,
        scale_pos_weight=scale_pos_weight(y_s),
        random_state=SEED,
        verbosity=-1,
    )
    clf.fit(X_s, y_s)
    return clf


def run(
    train_sizes: tuple[int, ...] = (150, 300, 600, 1000),
    test_cap: int = 2500,
    n_estimators: int = 8,
    seeds: tuple[int, ...] = (SEED,),
) -> None:
    out_dir = MODELS_DIR / "routing"
    out_dir.mkdir(parents=True, exist_ok=True)

    canonical = build_canonical(download_sba())
    X = engineer_sba_features(canonical)
    y = canonical["default_12m"].to_numpy()

    tr, _, te = time_based_split(canonical, SPLIT_KEY)
    X_tr, y_tr = X[tr].reset_index(drop=True), y[tr]
    X_te_full, y_te_full = X[te].reset_index(drop=True), y[te]

    # Fixed evaluation slice (constant across sizes/seeds) so numbers compare.
    fixed_rng = np.random.default_rng(SEED)
    te_idx = fixed_rng.choice(
        len(X_te_full), size=min(test_cap, len(X_te_full)), replace=False
    )
    X_te, y_te = X_te_full.iloc[te_idx], y_te_full[te_idx]
    print(
        f"[routing] test slice: {len(X_te):,} rows, default rate={y_te.mean():.3%}; "
        f"seeds={seeds}, n_estimators={n_estimators}"
    )

    results: dict[str, dict] = {}
    for size in train_sizes:
        tab_aucs, lgbm_aucs = [], []
        for sd in seeds:
            rng = np.random.default_rng(sd)
            s_idx = rng.choice(len(X_tr), size=size, replace=False)
            X_s, y_s = X_tr.iloc[s_idx], y_tr[s_idx]

            lgbm = _small_lgbm(X_s, y_s)
            lgbm_aucs.append(compute_metrics(y_te, lgbm.predict_proba(X_te)[:, 1])["roc_auc"])

            tab = train_tabpfn(X_s, y_s, n_estimators=n_estimators)
            tab_aucs.append(compute_metrics(y_te, tabpfn_pd(tab, X_te))["roc_auc"])

        tab_m, tab_s = float(np.mean(tab_aucs)), float(np.std(tab_aucs))
        lg_m, lg_s = float(np.mean(lgbm_aucs)), float(np.std(lgbm_aucs))
        results[str(size)] = {
            "tabpfn_auc_mean": round(tab_m, 4),
            "tabpfn_auc_std": round(tab_s, 4),
            "lgbm_auc_mean": round(lg_m, 4),
            "lgbm_auc_std": round(lg_s, 4),
            "delta_tabpfn_minus_lgbm": round(tab_m - lg_m, 4),
        }
        print(
            f"[routing] size={size:>5}: TabPFN {tab_m:.4f}±{tab_s:.4f} | "
            f"LGBM {lg_m:.4f}±{lg_s:.4f} | delta={tab_m - lg_m:+.4f}"
        )

    table = pd.DataFrame(results).T
    print("\n=== TabPFN v2 vs LightGBM by training-sample size (mean over seeds) ===")
    print(table.to_string())

    wins = [int(s) for s in results if results[s]["delta_tabpfn_minus_lgbm"] > 0]
    threshold = max(wins) if wins else 0
    rule = (
        f"route segments with < ~{threshold} training rows to TabPFN, "
        "else calibrated LightGBM"
    )
    print(f"\n[routing] recommendation: {rule}")

    _plot(results, out_dir / "routing_auc.png")
    (out_dir / "routing_metrics.json").write_text(
        json.dumps(
            {
                "results": results,
                "routing_rule": rule,
                "meta": {
                    "seeds": list(seeds),
                    "n_estimators": n_estimators,
                    "test_slice": int(len(X_te)),
                    "model": "TabPFN v2 (Prior-Labs/TabPFN-v2-clf) vs LightGBM",
                },
            },
            indent=2,
        )
    )
    print(f"[routing] wrote {out_dir / 'routing_metrics.json'}")


def _plot(results: dict[str, dict], path) -> None:
    sizes = [int(s) for s in results]
    tab = [results[str(s)]["tabpfn_auc_mean"] for s in sizes]
    tab_e = [results[str(s)]["tabpfn_auc_std"] for s in sizes]
    lgbm = [results[str(s)]["lgbm_auc_mean"] for s in sizes]
    lgbm_e = [results[str(s)]["lgbm_auc_std"] for s in sizes]
    fig, ax = plt.subplots(figsize=(6, 4.5))
    ax.errorbar(sizes, tab, yerr=tab_e, marker="o", capsize=3, label="TabPFN v2")
    ax.errorbar(sizes, lgbm, yerr=lgbm_e, marker="s", capsize=3, label="LightGBM")
    ax.set_xlabel("Training-sample size (rows)")
    ax.set_ylabel("Test ROC AUC")
    ax.set_title("Small-segment routing: TabPFN v2 vs LightGBM")
    ax.legend()
    fig.tight_layout()
    fig.savefig(path, dpi=120)
    plt.close(fig)


def main() -> None:
    parser = argparse.ArgumentParser(description="TabPFN vs LightGBM routing experiment.")
    parser.add_argument("--sizes", type=int, nargs="+", default=[150, 300, 600, 1000])
    parser.add_argument("--seeds", type=int, nargs="+", default=[SEED])
    parser.add_argument("--test-cap", type=int, default=2500)
    parser.add_argument("--n-estimators", type=int, default=8)
    args = parser.parse_args()
    run(
        train_sizes=tuple(args.sizes),
        test_cap=args.test_cap,
        n_estimators=args.n_estimators,
        seeds=tuple(args.seeds),
    )


if __name__ == "__main__":
    main()
