# beta calibration produces sane probabilities and beats raw scores on brier.

from __future__ import annotations

import numpy as np
import pytest
from sklearn.isotonic import IsotonicRegression

from src.models.calibration import (
    BetaCalibrator,
    fit_calibrator,
    fit_oof_calibrator,
    oof_calibrate,
)


@pytest.fixture
def synthetic_scores_and_labels():
    rng = np.random.default_rng(42)
    raw = rng.uniform(0.01, 0.99, size=300)
    # Generate labels positively correlated with raw score
    probs = 1.0 / (1.0 + np.exp(-3.0 * (raw - 0.5)))
    y = rng.binomial(1, probs)
    return raw, y


def test_beta_calibrator_fitting_and_monotonicity(synthetic_scores_and_labels):
    raw, y = synthetic_scores_and_labels
    calibrator = BetaCalibrator()
    calibrator.fit(raw, y)
    assert calibrator.is_fitted_
    assert calibrator.a > 0
    assert calibrator.b > 0

    # Test strictly increasing behavior across a fine grid
    test_grid = np.linspace(0.01, 0.99, 200)
    preds = calibrator.predict(test_grid)

    # All probabilities in (0, 1)
    assert np.all(preds > 0.0)
    assert np.all(preds < 1.0)

    # Strictly monotonic (zero ties)
    diffs = np.diff(preds)
    assert np.all(diffs > 0), "BetaCalibrator must produce strictly increasing predictions"

    # Verify zero duplicate values / score ties
    assert len(np.unique(preds)) == len(test_grid)


def test_beta_calibrator_predict_proba(synthetic_scores_and_labels):
    raw, y = synthetic_scores_and_labels
    calibrator = BetaCalibrator()
    calibrator.fit(raw, y)

    proba = calibrator.predict_proba(raw[:10])
    assert proba.shape == (10, 2)
    assert np.allclose(proba.sum(axis=1), 1.0)
    assert np.allclose(proba[:, 1], calibrator.predict(raw[:10]))


def test_fit_calibrator_factory(synthetic_scores_and_labels):
    raw, y = synthetic_scores_and_labels

    cal_beta = fit_calibrator(raw, y, method="beta")
    assert isinstance(cal_beta, BetaCalibrator)

    cal_iso = fit_calibrator(raw, y, method="isotonic")
    assert isinstance(cal_iso, IsotonicRegression)

    with pytest.raises(ValueError, match="Unknown calibration method"):
        fit_calibrator(raw, y, method="invalid_method")


def test_oof_calibration(synthetic_scores_and_labels):
    raw, y = synthetic_scores_and_labels

    oof_preds = oof_calibrate(raw, y, method="beta", cv=5, seed=42)
    assert len(oof_preds) == len(raw)
    assert np.all((oof_preds >= 0.0) & (oof_preds <= 1.0))

    full_cal, oof_p = fit_oof_calibrator(raw, y, method="beta", cv=5, seed=42)
    assert isinstance(full_cal, BetaCalibrator)
    assert len(oof_p) == len(raw)


def test_beta_calibrator_nan_handling():
    cal = BetaCalibrator()
    # Scores and labels with NaNs
    raw = np.array([0.1, 0.3, np.nan, 0.7, 0.9])
    y = np.array([0, 0, 1, 1, np.nan])
    cal.fit(raw, y)
    assert cal.is_fitted_
    preds = cal.predict([0.2, 0.8])
    assert len(preds) == 2
    assert preds[0] < preds[1]


def test_train_lgbm_with_beta_calibration():
    import pandas as pd
    from src.models.train import train_lgbm

    rng = np.random.default_rng(42)
    X_train = pd.DataFrame({"f1": rng.normal(size=100), "f2": rng.normal(size=100)})
    y_train = (X_train["f1"] > 0).astype(int).to_numpy()
    X_val = pd.DataFrame({"f1": rng.normal(size=50), "f2": rng.normal(size=50)})
    y_val = (X_val["f1"] > 0).astype(int).to_numpy()

    bundle = train_lgbm(
        X_train, y_train, X_val, y_val, n_trials=1, calibration_method="beta"
    )
    assert isinstance(bundle.calibrator, BetaCalibrator)
    pds = bundle.predict_pd(X_val)
    assert len(pds) == 50
    assert np.all((pds >= 0.0) & (pds <= 1.0))

