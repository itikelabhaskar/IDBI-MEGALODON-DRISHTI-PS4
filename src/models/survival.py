# answers WHEN rather than just IF. a person-period lightgbm predicts a quarterly
# hazard, those compose into a cumulative PD curve, and the 12 month point of that
# curve is directly comparable to the binary model.
#
# charge-off dates build the time-to-event label and are never used as features.

from __future__ import annotations

from dataclasses import dataclass

import numpy as np
import pandas as pd
from lightgbm import LGBMClassifier, early_stopping, log_evaluation

from src.config import SEED
from src.models.imbalance import scale_pos_weight

H_QUARTERS = 20  # observation horizon: 20 quarters = 5 years


@dataclass
class HazardModel:
    model: LGBMClassifier
    feature_cols: list[str]  # borrower features; "quarter" is appended
    horizon: int = H_QUARTERS

    def hazard_curve(self, X: pd.DataFrame) -> np.ndarray:
        n = len(X)
        rep = X[self.feature_cols].loc[X.index.repeat(self.horizon)].reset_index(drop=True)
        rep["quarter"] = np.tile(np.arange(1, self.horizon + 1), n)
        h = self.model.predict_proba(rep)[:, 1]
        return h.reshape(n, self.horizon)

    def cumulative_pd(self, X: pd.DataFrame) -> np.ndarray:
        h = self.hazard_curve(X)
        return 1.0 - np.cumprod(1.0 - h, axis=1)

    def pd_at_months(self, X: pd.DataFrame, months: int = 12) -> np.ndarray:
        q = max(1, min(self.horizon, months // 3))
        return self.cumulative_pd(X)[:, q - 1]

    def expected_stress_quarter(self, X: pd.DataFrame) -> np.ndarray:
        cum = self.cumulative_pd(X)
        total = cum[:, -1:]
        with np.errstate(invalid="ignore", divide="ignore"):
            frac = cum / np.where(total > 0, total, np.nan)
        return np.nanargmax(frac >= 0.5, axis=1) + 1

    def stress_onset_month(self, X: pd.DataFrame, onset_pd: float = 0.11) -> np.ndarray:
        cum = self.cumulative_pd(X)
        n, h = cum.shape
        out = np.full(n, h * 3, dtype=int)
        hits = cum >= onset_pd
        any_hit = hits.any(axis=1)
        first_q = hits.argmax(axis=1)  # 0-based; only valid where any_hit
        out[any_hit] = (first_q[any_hit] + 1) * 3
        return out

    def stress_horizon_payload(
        self,
        X_row: pd.DataFrame | pd.Series,
        onset_pd: float = 0.11,
    ) -> dict:
        frame = X_row.to_frame().T if isinstance(X_row, pd.Series) else X_row
        row = frame.iloc[[0]]
        stress_q = int(self.expected_stress_quarter(row)[0])
        onset_m = int(self.stress_onset_month(row, onset_pd=onset_pd)[0])
        pd12 = float(self.pd_at_months(row, 12)[0])
        return {
            "stress_horizon_m": stress_q * 3,
            "onset_month": onset_m,
            "estimated": False,
            "pd_at_12m": round(pd12, 4),
        }


def estimated_stress_horizon(
    pd_12m: float,
    onset_pd: float = 0.11,
    months: int = 12,
) -> dict:
    pd_12m = float(pd_12m)
    onset_month = months
    for m in range(1, months + 1):
        if pd_12m * (m / months) >= onset_pd:
            onset_month = m
            break
    return {
        "stress_horizon_m": months if pd_12m >= onset_pd else None,
        "onset_month": onset_month,
        "estimated": True,
        "pd_at_12m": round(pd_12m, 4),
    }


def person_period_expand(
    X: pd.DataFrame,
    event_quarter: np.ndarray,
    observed_quarters: np.ndarray,
    horizon: int = H_QUARTERS,
) -> tuple[pd.DataFrame, np.ndarray]:
    obs = np.minimum(observed_quarters.astype(int), horizon).clip(min=1)
    idx = np.repeat(np.arange(len(X)), obs)
    quarters = np.concatenate([np.arange(1, o + 1) for o in obs])

    rep = X.iloc[idx].reset_index(drop=True)
    rep["quarter"] = quarters

    ev = event_quarter[idx]
    y = ((~np.isnan(ev)) & (quarters == ev)).astype(int)
    return rep, y


def train_hazard(
    X_tr: pd.DataFrame,
    y_tr: np.ndarray,
    X_va: pd.DataFrame,
    y_va: np.ndarray,
    feature_cols: list[str],
    horizon: int = H_QUARTERS,
) -> HazardModel:
    clf = LGBMClassifier(
        n_estimators=1500,
        learning_rate=0.05,
        num_leaves=63,
        min_child_samples=200,
        subsample=0.9,
        subsample_freq=1,
        colsample_bytree=0.9,
        scale_pos_weight=scale_pos_weight(y_tr),
        random_state=SEED,
        n_jobs=-1,
        verbosity=-1,
    )
    clf.fit(
        X_tr, y_tr,
        eval_set=[(X_va, y_va)],
        eval_metric="auc",
        callbacks=[early_stopping(50, verbose=False), log_evaluation(0)],
    )
    return HazardModel(model=clf, feature_cols=feature_cols, horizon=horizon)
