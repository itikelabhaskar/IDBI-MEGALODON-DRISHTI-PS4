# distils the tabpfn teacher into a lightgbm student over an unlabelled transfer pool.
# the student learns the teacher's function, not the data's labels, and scores orders
# of magnitude faster, which is what makes it deployable.

from __future__ import annotations

import os  # noqa: E402

os.environ.setdefault("OMP_NUM_THREADS", "1")
os.environ.setdefault("KMP_DUPLICATE_LIB_OK", "TRUE")

import argparse  # noqa: E402
import json  # noqa: E402
import time  # noqa: E402

import matplotlib  # noqa: E402

matplotlib.use("Agg")
import matplotlib.pyplot as plt  # noqa: E402
import numpy as np  # noqa: E402
from lightgbm import LGBMClassifier, LGBMRegressor  # noqa: E402
from sklearn.metrics import roc_auc_score  # noqa: E402

from src.config import MODELS_DIR, SEED, SPLIT_KEY  # noqa: E402
from src.features.sba_features import engineer_sba_features  # noqa: E402
from src.ingestion.kaggle_download import download_sba  # noqa: E402
from src.ingestion.sba_adapter import build_canonical  # noqa: E402
from src.models.imbalance import scale_pos_weight  # noqa: E402
from src.models.tabpfn_router import tabpfn_pd, train_tabpfn  # noqa: E402
from src.models.train import time_based_split  # noqa: E402


def _lgbm_cls(y):
    return LGBMClassifier(
        n_estimators=400, learning_rate=0.05, num_leaves=31,
        scale_pos_weight=scale_pos_weight(y), random_state=SEED, verbosity=-1,
    )


def run(n_labeled: int = 1000, n_transfer: int = 20_000, test_cap: int = 5000) -> None:
    out_dir = MODELS_DIR / "distill"
    out_dir.mkdir(parents=True, exist_ok=True)

    canonical = build_canonical(download_sba())
    X = engineer_sba_features(canonical)
    y = canonical["default_12m"].to_numpy()
    tr, _, te = time_based_split(canonical, SPLIT_KEY)
    X_tr, y_tr = X[tr].reset_index(drop=True), y[tr]
    X_te_full, y_te_full = X[te].reset_index(drop=True), y[te]

    rng = np.random.default_rng(SEED)
    lab_idx = rng.choice(len(X_tr), n_labeled, replace=False)
    pool_idx = rng.choice(
        np.setdiff1d(np.arange(len(X_tr)), lab_idx), n_transfer, replace=False
    )
    te_idx = rng.choice(len(X_te_full), min(test_cap, len(X_te_full)), replace=False)
    X_lab, y_lab = X_tr.iloc[lab_idx], y_tr[lab_idx]
    X_pool = X_tr.iloc[pool_idx]           # labels deliberately unused
    X_te, y_te = X_te_full.iloc[te_idx], y_te_full[te_idx]

    print(f"[distill] labelled={n_labeled}, transfer pool={n_transfer}, test={len(X_te)}")

    # 1. Teacher ------------------------------------------------------------
    teacher = train_tabpfn(X_lab, y_lab)
    t0 = time.perf_counter()
    teacher_te = tabpfn_pd(teacher, X_te)
    teacher_ms = (time.perf_counter() - t0) / len(X_te) * 1000
    auc_teacher = roc_auc_score(y_te, teacher_te)

    # 2. Student: distil teacher soft-PDs over the unlabelled pool ----------
    soft_pool = tabpfn_pd(teacher, X_pool)
    student = LGBMRegressor(
        n_estimators=600, learning_rate=0.05, num_leaves=63,
        random_state=SEED, verbosity=-1,
    )
    student.fit(X_pool, soft_pool)
    t0 = time.perf_counter()
    student_te = student.predict(X_te)
    student_ms = (time.perf_counter() - t0) / len(X_te) * 1000
    auc_student = roc_auc_score(y_te, student_te)

    # 3. Stack: teacher PD as an extra LightGBM feature ---------------------
    X_lab_s = X_lab.copy()
    X_lab_s["tabpfn_pd"] = tabpfn_pd(teacher, X_lab)
    X_te_s = X_te.copy()
    X_te_s["tabpfn_pd"] = teacher_te
    stack = _lgbm_cls(y_lab)
    stack.fit(X_lab_s, y_lab)
    auc_stack = roc_auc_score(y_te, stack.predict_proba(X_te_s)[:, 1])

    # 4. Direct LightGBM baseline on the 1K labels --------------------------
    direct = _lgbm_cls(y_lab)
    direct.fit(X_lab, y_lab)
    auc_direct = roc_auc_score(y_te, direct.predict_proba(X_te)[:, 1])

    results = {
        "lgbm_direct_1k": round(float(auc_direct), 4),
        "tabpfn_teacher": round(float(auc_teacher), 4),
        "lgbm_student_distilled": round(float(auc_student), 4),
        "lgbm_stack_teacher_feature": round(float(auc_stack), 4),
        "latency_ms_per_row": {
            "tabpfn_teacher": round(teacher_ms, 3),
            "lgbm_student": round(student_ms, 4),
            "speedup_x": round(teacher_ms / max(student_ms, 1e-6), 1),
        },
    }
    print(json.dumps(results, indent=2))

    fig, ax = plt.subplots(figsize=(7, 4.5))
    names = ["LGBM direct\n(1K labels)", "TabPFN teacher", "LGBM student\n(distilled)",
             "LGBM + TabPFN\nfeature (stack)"]
    vals = [auc_direct, auc_teacher, auc_student, auc_stack]
    bars = ax.bar(names, vals, color=["#8da0cb", "#fc8d62", "#66c2a5", "#e78ac3"])
    ax.set_ylim(min(vals) - 0.02, max(vals) + 0.015)
    ax.set_ylabel("Test ROC AUC")
    ax.set_title(
        f"Distillation: student keeps the teacher's lift at "
        f"{results['latency_ms_per_row']['speedup_x']}x lower latency"
    )
    for b, v in zip(bars, vals):
        ax.annotate(f"{v:.3f}", (b.get_x() + b.get_width() / 2, v),
                    ha="center", va="bottom", fontsize=9)
    fig.tight_layout()
    fig.savefig(out_dir / "distill.png", dpi=120)
    plt.close(fig)

    (out_dir / "distill_metrics.json").write_text(json.dumps(
        {"results": results,
         "meta": {"n_labeled": n_labeled, "n_transfer": n_transfer,
                  "test": int(len(X_te)), "seed": SEED,
                  "note": "transfer-pool labels never used; student learns the "
                          "teacher's function, not the data's labels"}},
        indent=2,
    ))
    print(f"[distill] wrote {out_dir / 'distill_metrics.json'}")


def main() -> None:
    parser = argparse.ArgumentParser(description="TabPFN distillation experiment.")
    parser.add_argument("--labeled", type=int, default=1000)
    parser.add_argument("--transfer", type=int, default=20_000)
    parser.add_argument("--test-cap", type=int, default=5000)
    args = parser.parse_args()
    run(n_labeled=args.labeled, n_transfer=args.transfer, test_cap=args.test_cap)


if __name__ == "__main__":
    main()
