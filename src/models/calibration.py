# beta calibration as an alternative to isotonic. isotonic can overfit small
# validation slices and its step function creates ties; beta fits a smooth curve.

from __future__ import annotations

from typing import Any
import numpy as np
import pandas as pd
from scipy.optimize import minimize
from scipy.special import expit
from sklearn.isotonic import IsotonicRegression
from sklearn.model_selection import StratifiedKFold


class BetaCalibrator:

    def __init__(
        self,
        a: float = 1.0,
        b: float = 1.0,
        c: float = 0.0,
        eps: float = 1e-6,
    ) -> None:
        self.a = float(a)
        self.b = float(b)
        self.c = float(c)
        self.eps = float(eps)
        self.is_fitted_ = False

    def fit(
        self,
        raw_scores: np.ndarray | pd.Series | list[float],
        y_true: np.ndarray | pd.Series | list[int | float],
    ) -> "BetaCalibrator":
        s = np.asarray(raw_scores, dtype=float).ravel()
        y = np.asarray(y_true, dtype=float).ravel()

        if len(s) != len(y):
            raise ValueError(f"Length mismatch: s has {len(s)}, y has {len(y)}")

        valid = np.isfinite(s) & np.isfinite(y)
        if not np.any(valid):
            raise ValueError("No valid finite samples provided to fit BetaCalibrator")
        s = s[valid]
        y = y[valid]

        s_clean = np.clip(s, self.eps, 1.0 - self.eps)
        x1 = np.log(s_clean)
        x2 = -np.log(1.0 - s_clean)

        def _nll(params: list[float] | np.ndarray) -> float:
            p_a, p_b, p_c = params
            z = p_a * x1 + p_b * x2 + p_c
            z = np.clip(z, -35.0, 35.0)
            p = expit(z)
            # Binary log loss / cross-entropy
            loss = -np.sum(y * np.log(p + 1e-15) + (1.0 - y) * np.log(1.0 - p + 1e-15))
            return float(loss)

        # Monotonicity requires a > 0, b > 0
        bounds = [(1e-4, 50.0), (1e-4, 50.0), (-50.0, 50.0)]
        init_guess = [1.0, 1.0, 0.0]

        res = minimize(
            _nll,
            init_guess,
            bounds=bounds,
            method="L-BFGS-B",
            options={"maxiter": 500, "ftol": 1e-9},
        )

        self.a = float(res.x[0])
        self.b = float(res.x[1])
        self.c = float(res.x[2])
        self.is_fitted_ = True
        return self

    def predict(
        self,
        raw_scores: np.ndarray | pd.Series | list[float],
    ) -> np.ndarray:
        s = np.asarray(raw_scores, dtype=float)
        shape = s.shape
        s_flat = np.clip(s.ravel(), self.eps, 1.0 - self.eps)
        x1 = np.log(s_flat)
        x2 = -np.log(1.0 - s_flat)
        z = self.a * x1 + self.b * x2 + self.c
        z = np.clip(z, -35.0, 35.0)
        p = expit(z)
        return p.reshape(shape)

    def predict_proba(
        self,
        raw_scores: np.ndarray | pd.Series | list[float],
    ) -> np.ndarray:
        p1 = self.predict(raw_scores).ravel()
        p0 = 1.0 - p1
        return np.column_stack([p0, p1])


def fit_calibrator(
    raw_scores: np.ndarray | pd.Series,
    y_true: np.ndarray | pd.Series,
    method: str = "beta",
) -> BetaCalibrator | IsotonicRegression:
    raw = np.asarray(raw_scores, dtype=float).ravel()
    y = np.asarray(y_true, dtype=float).ravel()

    if method == "beta":
        cal = BetaCalibrator()
        cal.fit(raw, y)
        return cal
    elif method == "isotonic":
        cal = IsotonicRegression(out_of_bounds="clip")
        cal.fit(raw, y)
        return cal
    else:
        raise ValueError(f"Unknown calibration method '{method}', expected 'beta' or 'isotonic'")


def oof_calibrate(
    raw_scores: np.ndarray | pd.Series,
    y_true: np.ndarray | pd.Series,
    method: str = "beta",
    cv: int = 5,
    seed: int = 42,
) -> np.ndarray:
    raw = np.asarray(raw_scores, dtype=float).ravel()
    y = np.asarray(y_true, dtype=int).ravel()
    oof_preds = np.zeros_like(raw, dtype=float)

    skf = StratifiedKFold(n_splits=cv, shuffle=True, random_state=seed)
    for train_idx, val_idx in skf.split(raw, y):
        cal = fit_calibrator(raw[train_idx], y[train_idx], method=method)
        oof_preds[val_idx] = cal.predict(raw[val_idx])

    return oof_preds


def fit_oof_calibrator(
    raw_scores: np.ndarray | pd.Series,
    y_true: np.ndarray | pd.Series,
    method: str = "beta",
    cv: int = 5,
    seed: int = 42,
) -> tuple[BetaCalibrator | IsotonicRegression, np.ndarray]:
    oof_p = oof_calibrate(raw_scores, y_true, method=method, cv=cv, seed=seed)
    full_cal = fit_calibrator(raw_scores, y_true, method=method)
    return full_cal, oof_p
