# the lightgbm trainer everything else calls. tunes with optuna on a subsample to
# stay fast, refits the best params on the full training slice, then fits an
# isotonic calibrator on validation so the output is a real probability.
#
# predict_raw and predict_pd are both exposed on purpose. isotonic is piecewise
# constant, so it introduces score ties that understate ranking. raw scores are for
# AUC/KS, calibrated ones are for PD levels and brier.

from __future__ import annotations

from dataclasses import dataclass
from typing import Any

import numpy as np
import pandas as pd
from lightgbm import LGBMClassifier, early_stopping, log_evaluation
from sklearn.isotonic import IsotonicRegression

from src.config import MAX_TUNE_ROWS, N_TRIALS, SEED
from src.models.calibration import BetaCalibrator, fit_calibrator
from src.models.imbalance import scale_pos_weight

# Optuna is only needed for hyperparameter search — keep it out of the
# module import path so joblib-unpickling TrainedModel on lean Spaces
# does not require optuna installed.


@dataclass
class TrainedModel:

    model: LGBMClassifier
    calibrator: Any
    feature_cols: list[str]
    best_params: dict

    def predict_pd(self, X: pd.DataFrame) -> np.ndarray:
        raw = self.model.predict_proba(X[self.feature_cols])[:, 1]
        return self.calibrator.predict(raw)

    def predict_raw(self, X: pd.DataFrame) -> np.ndarray:
        return self.model.predict_proba(X[self.feature_cols])[:, 1]


def time_based_split(
    df: pd.DataFrame,
    fy_col: str,
    q_train: float = 0.70,
    q_val: float = 0.85,
) -> tuple[np.ndarray, np.ndarray, np.ndarray]:
    fy = df[fy_col]
    cut_train = fy.quantile(q_train)
    cut_val = fy.quantile(q_val)
    train = (fy <= cut_train).to_numpy()
    val = ((fy > cut_train) & (fy <= cut_val)).to_numpy()
    test = (fy > cut_val).to_numpy()
    return train, val, test


def _subsample(X: pd.DataFrame, y: np.ndarray, cap: int) -> tuple[pd.DataFrame, np.ndarray]:
    if len(X) <= cap:
        return X, y
    rng = np.random.default_rng(SEED)
    idx = rng.choice(len(X), size=cap, replace=False)
    return X.iloc[idx], np.asarray(y)[idx]


def build_monotone_constraints(
    feature_cols: list[str],
    directions: dict[str, int],
) -> list[int]:
    return [int(directions.get(c, 0)) for c in feature_cols]


def _tune(
    X_tr: pd.DataFrame,
    y_tr: np.ndarray,
    X_val: pd.DataFrame,
    y_val: np.ndarray,
    spw: float,
    n_trials: int,
    monotone_constraints: list[int] | None = None,
) -> dict:
    import optuna

    optuna.logging.set_verbosity(optuna.logging.WARNING)
    X_tr_s, y_tr_s = _subsample(X_tr, y_tr, MAX_TUNE_ROWS)
    extra = {"monotone_constraints": monotone_constraints} if monotone_constraints else {}

    def objective(trial: optuna.Trial) -> float:
        params = {
            "num_leaves": trial.suggest_int("num_leaves", 16, 128),
            "learning_rate": trial.suggest_float("learning_rate", 0.01, 0.2, log=True),
            "min_child_samples": trial.suggest_int("min_child_samples", 20, 300),
            "subsample": trial.suggest_float("subsample", 0.6, 1.0),
            "colsample_bytree": trial.suggest_float("colsample_bytree", 0.6, 1.0),
            "reg_alpha": trial.suggest_float("reg_alpha", 1e-8, 10.0, log=True),
            "reg_lambda": trial.suggest_float("reg_lambda", 1e-8, 10.0, log=True),
        }
        clf = LGBMClassifier(
            n_estimators=2000,
            scale_pos_weight=spw,
            random_state=SEED,
            n_jobs=-1,
            subsample_freq=1,
            verbosity=-1,
            **extra,
            **params,
        )
        clf.fit(
            X_tr_s,
            y_tr_s,
            eval_set=[(X_val, y_val)],
            eval_metric="auc",
            callbacks=[early_stopping(50, verbose=False), log_evaluation(0)],
        )
        return clf.best_score_["valid_0"]["auc"]

    study = optuna.create_study(
        direction="maximize",
        sampler=optuna.samplers.TPESampler(seed=SEED),
    )
    study.optimize(objective, n_trials=n_trials)
    print(f"[train] best tuning AUC={study.best_value:.4f}")
    return study.best_params


def train_lgbm(
    X_train: pd.DataFrame,
    y_train: np.ndarray,
    X_val: pd.DataFrame,
    y_val: np.ndarray,
    n_trials: int = N_TRIALS,
    monotone_constraints: list[int] | None = None,
    calibration_method: str = "isotonic",
) -> TrainedModel:
    feature_cols = list(X_train.columns)
    spw = scale_pos_weight(y_train)

    best_params = _tune(
        X_train, y_train, X_val, y_val, spw, n_trials, monotone_constraints
    )
    extra = {"monotone_constraints": monotone_constraints} if monotone_constraints else {}

    model = LGBMClassifier(
        n_estimators=3000,
        scale_pos_weight=spw,
        random_state=SEED,
        n_jobs=-1,
        subsample_freq=1,
        verbosity=-1,
        **extra,
        **best_params,
    )
    model.fit(
        X_train,
        y_train,
        eval_set=[(X_val, y_val)],
        eval_metric="auc",
        callbacks=[early_stopping(50, verbose=False), log_evaluation(0)],
    )

    raw_val = model.predict_proba(X_val)[:, 1]
    calibrator = fit_calibrator(raw_val, y_val, method=calibration_method)

    return TrainedModel(
        model=model,
        calibrator=calibrator,
        feature_cols=feature_cols,
        best_params=best_params,
    )
