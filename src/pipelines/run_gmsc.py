# trains the unsecured retail book, with monotone constraints on the delinquency and
# utilisation features so the model cannot learn that more arrears means less risk.

from __future__ import annotations

import argparse

import joblib
import numpy as np
import pandas as pd
from sklearn.linear_model import LogisticRegression
from sklearn.model_selection import train_test_split
from sklearn.pipeline import Pipeline

from src.config import MODELS_DIR, SEED
from src.eval.metrics import compute_metrics, psi_table
from src.eval.report import metrics_table, plot_calibration, plot_capture_curve, save_report
from src.features.gmsc_features import (
    CATEGORICAL_FEATURES,
    NUMERIC_FEATURES,
    engineer_gmsc_features,
)
from src.features.preprocessing import build_preprocessor
from src.framework.interpretation import enrich, grade_order
from src.ingestion.gmsc_adapter import build_canonical, download_gmsc
from src.models.blend import blend
from src.models.train import build_monotone_constraints, train_lgbm

# Credit-officer intuition, enforced: more utilisation / delinquency / debt can
# never LOWER predicted risk; more income can never raise it. Age direction is
# left free (non-monotone empirically); exposure_proxy is a derived quantity.
MONOTONE_DIRECTIONS: dict[str, int] = {
    "revolving_utilization": 1,
    "debt_ratio": 1,
    "dpd_30_59": 1,
    "dpd_60_89": 1,
    "times_90_late": 1,
    "total_past_due": 1,
    "worst_dpd": 1,
    "monthly_income": -1,
    "income_per_dependent": -1,
}


def _baseline(X_tr, y_tr) -> Pipeline:
    pre = build_preprocessor(NUMERIC_FEATURES, CATEGORICAL_FEATURES, scale=True)
    lr = LogisticRegression(max_iter=1000, class_weight="balanced", random_state=SEED)
    pipe = Pipeline([("pre", pre), ("clf", lr)])
    pipe.fit(X_tr, y_tr)
    return pipe


def _band_breakdown(band: pd.Series, y_true: np.ndarray, pd_scores: np.ndarray) -> pd.DataFrame:
    rows: dict[str, dict] = {}
    for level, idx in band.groupby(band).groups.items():
        pos = band.index.get_indexer(idx)
        yt = y_true[pos]
        if yt.sum() < 20 or len(yt) < 200:
            continue
        rows[str(level)] = compute_metrics(yt, pd_scores[pos])
    return pd.DataFrame(rows).T.round(4)


def run(n_trials: int = 30) -> None:
    out_dir = MODELS_DIR / "gmsc"
    canonical = build_canonical(download_gmsc())
    X = engineer_gmsc_features(canonical)
    y = canonical["default_12m"].to_numpy()
    print(f"[run] features: {X.shape[1]} cols, {len(X):,} rows, default rate={y.mean():.3%}")

    idx = np.arange(len(X))
    tr_idx, tmp_idx = train_test_split(idx, test_size=0.30, stratify=y, random_state=SEED)
    va_idx, te_idx = train_test_split(tmp_idx, test_size=0.50, stratify=y[tmp_idx], random_state=SEED)
    X_tr, X_va, X_te = X.iloc[tr_idx], X.iloc[va_idx], X.iloc[te_idx]
    y_tr, y_va, y_te = y[tr_idx], y[va_idx], y[te_idx]
    print(f"[run] split -> train={len(tr_idx):,} val={len(va_idx):,} test={len(te_idx):,}")

    print("[run] training logistic-regression baseline ...")
    lr = _baseline(X_tr, y_tr)
    lr_pd = lr.predict_proba(X_te)[:, 1]

    print(f"[run] training LightGBM ({n_trials} Optuna trials, monotone-constrained) ...")
    constraints = build_monotone_constraints(list(X.columns), MONOTONE_DIRECTIONS)
    trained = train_lgbm(
        X_tr, y_tr, X_va, y_va, n_trials=n_trials, monotone_constraints=constraints
    )
    lgbm_raw = trained.predict_raw(X_te)
    lgbm_pd = trained.predict_pd(X_te)

    print("[run] training CatBoost + blending ...")
    blended = blend(trained, X_tr, y_tr, X_va, y_va, CATEGORICAL_FEATURES)
    blend_raw = blended.predict_raw(X_te)
    blend_pd = blended.predict_pd(X_te)

    results = {
        "logistic_baseline": compute_metrics(y_te, lr_pd),
        "lightgbm_raw": compute_metrics(y_te, lgbm_raw),
        "lightgbm_calibrated": compute_metrics(y_te, lgbm_pd),
        "blend_raw": compute_metrics(y_te, blend_raw),
        "blend_calibrated": compute_metrics(y_te, blend_pd),
    }
    table = metrics_table(results)
    print("\n=== GMSC test metrics ===")
    print(table.to_string())

    band = X_te["age_band"].astype(str).reset_index(drop=True)
    seg_table = _band_breakdown(band, y_te, blend_pd)
    print("\n=== By age band ===")
    print(seg_table.to_string())

    scored = X_te.copy()
    scored["pd"] = blend_pd
    scored = enrich(scored, pd_col="pd", ead_col="exposure_proxy")
    grade_dist = scored["risk_grade"].value_counts().reindex(grade_order()).fillna(0).astype(int)
    print("\n=== Unified risk-grade distribution (same RG1–RG10) ===")
    print(grade_dist.to_string())

    out_dir.mkdir(parents=True, exist_ok=True)
    probs = {
        "logistic_baseline": lr_pd,
        "lightgbm_calibrated": lgbm_pd,
        "blend_calibrated": blend_pd,
    }
    plot_calibration(probs, y_te, out_dir / "calibration.png")
    plot_capture_curve(probs, y_te, out_dir / "capture_curve.png")
    save_report(
        out_dir, table, seg_table,
        extra={"seed": SEED, "n_trials": n_trials, "best_params": trained.best_params,
               "segment": "retail_gmsc", "split": "stratified random 70/15/15",
               "monotone_constraints": MONOTONE_DIRECTIONS,
               "psi_train_vs_test": psi_table(X_tr, X_te, NUMERIC_FEATURES)},
    )
    joblib.dump(blended, out_dir / "model.pkl")
    print(f"[run] saved model bundle -> {out_dir / 'model.pkl'}")
    print("[run] done.")


def main() -> None:
    parser = argparse.ArgumentParser(description="Run the GMSC unsecured-retail pipeline.")
    parser.add_argument("--trials", type=int, default=30)
    args = parser.parse_args()
    run(n_trials=args.trials)


if __name__ == "__main__":
    main()
