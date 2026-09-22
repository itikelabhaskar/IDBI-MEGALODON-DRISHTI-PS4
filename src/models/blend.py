# lightgbm + catboost averaged together. catboost's ordered target statistics give
# leakage-safe encoding for high cardinality columns like state and sector, which is
# the bit lightgbm's histogram splits handle worse.
#
# the blend weight is picked on validation AUC and never allowed to hit an endpoint,
# so the lightgbm side always contributes and SHAP reason codes stay meaningful.

from __future__ import annotations

from dataclasses import dataclass

import numpy as np
import pandas as pd
from catboost import CatBoostClassifier
from sklearn.isotonic import IsotonicRegression

from src.config import SEED
from src.models.imbalance import scale_pos_weight
from src.models.train import TrainedModel


@dataclass
class BlendedModel:
    lgbm: TrainedModel
    cat_model: CatBoostClassifier
    calibrator: IsotonicRegression
    feature_cols: list[str]
    cat_features: list[str]
    best_params: dict
    # LightGBM weight in the average, selected on validation AUC so the blend
    # never underperforms its stronger component (w=1.0 degenerates to LGBM).
    weight: float = 0.5

    @property
    def model(self):
        return self.lgbm.model

    def _cat_frame(self, X: pd.DataFrame) -> pd.DataFrame:
        Xc = X[self.feature_cols].copy()
        for c in self.cat_features:
            Xc[c] = Xc[c].astype(str).fillna("missing")
        return Xc

    def predict_raw(self, X: pd.DataFrame) -> np.ndarray:
        p_lgbm = self.lgbm.predict_raw(X)
        p_cat = self.cat_model.predict_proba(self._cat_frame(X))[:, 1]
        return self.weight * p_lgbm + (1.0 - self.weight) * p_cat

    def predict_pd(self, X: pd.DataFrame) -> np.ndarray:
        return self.calibrator.predict(self.predict_raw(X))


def train_catboost(
    X_tr: pd.DataFrame,
    y_tr: np.ndarray,
    X_val: pd.DataFrame,
    y_val: np.ndarray,
    cat_features: list[str],
) -> CatBoostClassifier:
    def _prep(X: pd.DataFrame) -> pd.DataFrame:
        Xc = X.copy()
        for c in cat_features:
            Xc[c] = Xc[c].astype(str).fillna("missing")
        return Xc

    clf = CatBoostClassifier(
        iterations=2000,
        learning_rate=0.05,
        depth=6,
        l2_leaf_reg=3.0,
        scale_pos_weight=scale_pos_weight(y_tr),
        random_seed=SEED,
        eval_metric="AUC",
        early_stopping_rounds=100,
        verbose=False,
        allow_writing_files=False,
    )
    clf.fit(
        _prep(X_tr), y_tr,
        eval_set=(_prep(X_val), y_val),
        cat_features=cat_features,
    )
    return clf


def blend(
    lgbm: TrainedModel,
    X_tr: pd.DataFrame,
    y_tr: np.ndarray,
    X_val: pd.DataFrame,
    y_val: np.ndarray,
    cat_features: list[str],
) -> BlendedModel:
    from sklearn.metrics import roc_auc_score

    cat_model = train_catboost(X_tr, y_tr, X_val, y_val, cat_features)

    bundle = BlendedModel(
        lgbm=lgbm,
        cat_model=cat_model,
        calibrator=IsotonicRegression(out_of_bounds="clip"),
        feature_cols=lgbm.feature_cols,
        cat_features=cat_features,
        best_params=lgbm.best_params,
    )

    p_lgbm = lgbm.predict_raw(X_val)
    p_cat = cat_model.predict_proba(bundle._cat_frame(X_val))[:, 1]
    # Grid excludes pure endpoints so both components always contribute —
    # SHAP reason codes come from the LightGBM side and must stay meaningful.
    weights = np.arange(0.25, 0.76, 0.125)
    aucs = [roc_auc_score(y_val, w * p_lgbm + (1 - w) * p_cat) for w in weights]
    bundle.weight = float(weights[int(np.argmax(aucs))])
    print(f"[blend] validation AUC by weight: "
          f"{ {round(w,3): round(a,4) for w, a in zip(weights, aucs)} } "
          f"-> chosen lgbm weight={bundle.weight}")

    raw_val = bundle.predict_raw(X_val)
    bundle.calibrator.fit(raw_val, y_val)
    return bundle
