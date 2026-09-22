# trains the SBA book end to end: ingest, features, time split, logistic baseline,
# tuned lightgbm, catboost blend, and a SMOTE comparison for the record.

from __future__ import annotations

import argparse

import joblib
import numpy as np
import pandas as pd

from src.config import MODELS_DIR, N_TRIALS, SEED, SPLIT_KEY
from src.eval.metrics import compute_metrics, psi_table
from src.eval.report import (
    metrics_table,
    plot_calibration,
    plot_capture_curve,
    save_report,
)
from src.features.sba_features import CATEGORICAL_FEATURES, NUMERIC_FEATURES, engineer_sba_features
from src.framework.schema import assert_no_leakage
from src.ingestion.kaggle_download import download_sba
from src.ingestion.sba_adapter import build_canonical
from src.models.baseline import train_baseline
from src.models.blend import blend
from src.models.imbalance import smote_resample
from src.models.train import time_based_split, train_lgbm


def _sector_breakdown(sectors: pd.Series, y_true: np.ndarray, pd_scores: np.ndarray) -> pd.DataFrame:
    rows: dict[str, dict] = {}
    for sector, idx in sectors.groupby(sectors).groups.items():
        pos = sectors.index.get_indexer(idx)
        yt = y_true[pos]
        if yt.sum() < 5 or len(yt) < 200:  # skip thin sectors for stable metrics
            continue
        rows[str(sector)] = compute_metrics(yt, pd_scores[pos])
    return pd.DataFrame(rows).T.round(4)


def run(n_trials: int = N_TRIALS, run_smote: bool = True) -> None:
    out_dir = MODELS_DIR / "sba"

    # 1. Ingest -> canonical -----------------------------------------------
    csv_path = download_sba()
    canonical = build_canonical(csv_path)

    # 2. Features -----------------------------------------------------------
    X = engineer_sba_features(canonical)
    y = canonical["default_12m"].to_numpy()
    assert_no_leakage(list(X.columns))
    print(f"[run] features: {X.shape[1]} cols, {len(X):,} rows, "
          f"default rate={y.mean():.3%}")

    # 3. Time-based split ---------------------------------------------------
    tr, va, te = time_based_split(canonical, SPLIT_KEY)
    X_tr, X_va, X_te = X[tr], X[va], X[te]
    y_tr, y_va, y_te = y[tr], y[va], y[te]
    print(f"[run] split sizes -> train={tr.sum():,} val={va.sum():,} test={te.sum():,}")

    # 4. Baseline logistic regression --------------------------------------
    print("[run] training logistic-regression baseline ...")
    lr = train_baseline(X_tr, y_tr)
    lr_pd = lr.predict_proba(X_te)[:, 1]

    # 5. LightGBM (tuned + calibrated) + CatBoost blend ---------------------
    print(f"[run] training LightGBM ({n_trials} Optuna trials) ...")
    trained = train_lgbm(X_tr, y_tr, X_va, y_va, n_trials=n_trials)
    lgbm_raw = trained.predict_raw(X_te)
    lgbm_pd = trained.predict_pd(X_te)

    print("[run] training CatBoost + blending (ordered target-encoding side) ...")
    blended = blend(trained, X_tr, y_tr, X_va, y_va, CATEGORICAL_FEATURES)
    blend_raw = blended.predict_raw(X_te)
    blend_pd = blended.predict_pd(X_te)

    # 6. Imbalance comparison (class weights vs SMOTE) ---------------------
    smote_note = "skipped"
    if run_smote:
        try:
            print("[run] SMOTE comparison (subsampled) ...")
            from lightgbm import LGBMClassifier

            X_res, y_res = smote_resample(X_tr, y_tr, seed=SEED)
            X_te_num = pd.get_dummies(X_te, dummy_na=True).reindex(
                columns=X_res.columns, fill_value=0
            )
            smote_clf = LGBMClassifier(n_estimators=300, random_state=SEED, verbosity=-1)
            smote_clf.fit(X_res, y_res)
            smote_pd = smote_clf.predict_proba(X_te_num)[:, 1]
            smote_auc = compute_metrics(y_te, smote_pd)["roc_auc"]
            weights_auc = compute_metrics(y_te, lgbm_pd)["roc_auc"]
            smote_note = f"SMOTE AUC={smote_auc:.4f} vs class-weights AUC={weights_auc:.4f}"
            print(f"[run] {smote_note} -> class-weights chosen (calibratable, no synthetic rows)")
        except Exception as exc:  # keep the core run resilient
            smote_note = f"error: {exc}"
            print(f"[run] SMOTE comparison skipped: {exc}")

    # 7. Metrics + report ---------------------------------------------------
    # Raw scores measure discrimination (isotonic introduces ties that
    # understate ranking); calibrated scores measure PD quality (Brier).
    results = {
        "logistic_baseline": compute_metrics(y_te, lr_pd),
        "lightgbm_raw": compute_metrics(y_te, lgbm_raw),
        "lightgbm_calibrated": compute_metrics(y_te, lgbm_pd),
        "blend_raw": compute_metrics(y_te, blend_raw),
        "blend_calibrated": compute_metrics(y_te, blend_pd),
    }
    table = metrics_table(results)
    print("\n=== Test metrics (12-month stress, held-out latest cohort) ===")
    print(table.to_string())

    sector_table = _sector_breakdown(
        engineer_sba_features(canonical).loc[te, "sector"].reset_index(drop=True),
        y_te,
        blend_pd,
    )
    print("\n=== Blend metrics by NAICS sector ===")
    print(sector_table.to_string())

    probs = {
        "logistic_baseline": lr_pd,
        "lightgbm_calibrated": lgbm_pd,
        "blend_calibrated": blend_pd,
    }
    out_dir.mkdir(parents=True, exist_ok=True)
    plot_calibration(probs, y_te, out_dir / "calibration.png")
    plot_capture_curve(probs, y_te, out_dir / "capture_curve.png")
    save_report(
        out_dir,
        table,
        sector_table,
        extra={
            "seed": SEED,
            "n_trials": n_trials,
            "best_params": trained.best_params,
            "imbalance_comparison": smote_note,
            "label_note": "default_12m = SBA MIS_Status==CHGOFF (lifetime default, framed as stress label)",
            "psi_train_vs_test": psi_table(X_tr, X_te, NUMERIC_FEATURES),
        },
    )

    # 8. Persist model bundle (blend; SHAP reason codes use its LGBM component)
    joblib.dump(blended, out_dir / "model.pkl")
    print(f"[run] saved model bundle -> {out_dir / 'model.pkl'}")
    print("[run] done.")


def main() -> None:
    parser = argparse.ArgumentParser(description="Run the SBA MSME pipeline.")
    parser.add_argument("--trials", type=int, default=N_TRIALS, help="Optuna trials")
    parser.add_argument("--no-smote", action="store_true", help="skip SMOTE comparison")
    args = parser.parse_args()
    run(n_trials=args.trials, run_smote=not args.no_smote)


if __name__ == "__main__":
    main()
