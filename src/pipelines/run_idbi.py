# trains the segment shaped like the bank sandbox feed.

from __future__ import annotations

import argparse
import json
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
    NUMERIC_FEATURES,
    CATEGORICAL_FEATURES,
    MONOTONE_DIRECTIONS,
)
from src.framework.interpretation import enrich, grade_order  # noqa: E402
from src.ingestion.idbi_adapter import (  # noqa: E402
    engineer_idbi_features,
    generate_idbi_synthetic_canonical,
)
from src.models.imbalance import scale_pos_weight  # noqa: E402
from src.models.train import (  # noqa: E402
    build_monotone_constraints,
    train_lgbm,
    TrainedModel,
)


def run(n_trials: int = 15, n_rows: int = 4000) -> None:
    out_dir = MODELS_DIR / "idbi"
    out_dir.mkdir(parents=True, exist_ok=True)

    print(f"[run_idbi] generating {n_rows} IDBI Finacle canonical records...")
    canonical = generate_idbi_synthetic_canonical(n=n_rows, seed=SEED)
    X = engineer_idbi_features(canonical)
    y = canonical["default_12m"].to_numpy()
    print(f"[run_idbi] engineered features: {X.shape[1]} cols, default rate={y.mean():.3%}")

    # Chronological or stratified split
    rng = np.random.default_rng(SEED)
    indices = np.arange(len(canonical))
    rng.shuffle(indices)

    n_train = int(len(canonical) * 0.70)
    n_val = int(len(canonical) * 0.15)

    idx_tr = indices[:n_train]
    idx_va = indices[n_train : n_train + n_val]
    idx_te = indices[n_train + n_val :]

    X_tr, X_va, X_te = X.iloc[idx_tr], X.iloc[idx_va], X.iloc[idx_te]
    y_tr, y_va, y_te = y[idx_tr], y[idx_va], y[idx_te]
    print(f"[run_idbi] split -> train={len(X_tr):,} val={len(X_va):,} test={len(X_te):,}")

    constraints = build_monotone_constraints(ALL_FEATURES, MONOTONE_DIRECTIONS)
    print(f"[run_idbi] training monotone LightGBM with Beta calibration ({n_trials} trials)...")
    trained: TrainedModel = train_lgbm(
        X_tr,
        y_tr,
        X_va,
        y_va,
        n_trials=n_trials,
        monotone_constraints=constraints,
        calibration_method="beta",
    )

    final_raw = trained.predict_raw(X_te)
    final_pd = trained.predict_pd(X_te)

    results = {
        "lightgbm_raw": compute_metrics(y_te, final_raw),
        "lightgbm_calibrated": compute_metrics(y_te, final_pd),
    }
    table = metrics_table(results)
    print("\n=== IDBI Finacle MSME Test Metrics ===")
    print(table.to_string())

    # Subsegment breakdown
    seg = X_te["sub_segment"].astype(str).reset_index(drop=True)
    seg_rows = {}
    for level, idx in seg.groupby(seg).groups.items():
        pos = seg.index.get_indexer(idx)
        seg_rows[str(level)] = compute_metrics(y_te[pos], final_pd[pos])
    seg_table = pd.DataFrame(seg_rows).T.round(4)
    print("\n=== By Sub-Segment ===")
    print(seg_table.to_string())

    # Risk grade and Ind AS 109 Stage distribution
    scored = X_te.copy()
    scored["pd"] = final_pd
    scored = enrich(scored, pd_col="pd", ead_col="ticket_size")
    grade_dist = scored["risk_grade"].value_counts().reindex(grade_order()).fillna(0).astype(int)
    stage_dist = scored["ecl_stage"].value_counts().to_dict()
    print("\n=== Risk Grade Distribution ===")
    print(grade_dist.to_string())
    print("\n=== Ind AS 109 Stage Distribution ===")
    print(stage_dist)

    # Artifacts
    probs = {"lightgbm_calibrated": final_pd}
    plot_calibration(probs, y_te, out_dir / "calibration.png")
    plot_capture_curve(probs, y_te, out_dir / "capture_curve.png")

    save_report(
        out_dir,
        table,
        seg_table,
        extra={
            "seed": SEED,
            "n_trials": n_trials,
            "best_params": trained.best_params,
            "monotone_constraints": MONOTONE_DIRECTIONS,
            "calibration_method": "beta",
            "ind_as_109_stages": stage_dist,
            "psi_train_vs_test": psi_table(X_tr, X_te, NUMERIC_FEATURES),
            "data_note": (
                "IDBI Finacle Sandbox synthetic canonical dataset embodying APIs "
                "402 (overdue/dpd), 404 (demanded vs collected), 441 (DP erosion), "
                "362 (liens), 391 (restructuring), and 408 (CIBIL bureau)."
            ),
        },
    )

    # Save trained model bundle
    joblib.dump(trained, out_dir / "model.pkl")
    print(f"\n[run_idbi] saved native model bundle to {out_dir / 'model.pkl'}")


def main() -> None:
    parser = argparse.ArgumentParser(description="Train IDBI Finacle segment model")
    parser.add_argument("--trials", type=int, default=10, help="Optuna tuning trials")
    parser.add_argument("--rows", type=int, default=4000, help="Training rows")
    args = parser.parse_args()
    run(n_trials=args.trials, n_rows=args.rows)


if __name__ == "__main__":
    main()

