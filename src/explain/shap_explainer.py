# per borrower reason codes from the lightgbm booster. uses the tree path dependent
# explainer so no background dataset is needed and categorical splits are handled.

from __future__ import annotations

import numpy as np
import pandas as pd

from src.explain.reason_taxonomy import annotate_reason


class ReasonCodeExplainer:

    def __init__(self, model, feature_names: list[str]):
        import shap

        self.feature_names = list(feature_names)
        # tree_path_dependent: no background data needed; uses LightGBM's native
        # pred_contrib, which handles categorical splits correctly.
        self.explainer = shap.TreeExplainer(model)

    def _shap_matrix(self, X: pd.DataFrame) -> np.ndarray:
        vals = self.explainer.shap_values(X[self.feature_names])
        if isinstance(vals, list):  # older shap: [class0, class1]
            vals = vals[1]
        vals = np.asarray(vals)
        if vals.ndim == 3:  # (n, n_features, n_classes)
            vals = vals[:, :, -1]
        return vals

    def reason_codes(self, X_row: pd.DataFrame, top_k: int = 5) -> list[dict]:
        vals = self._shap_matrix(X_row.iloc[[0]])[0]
        order = np.argsort(np.abs(vals))[::-1][:top_k]
        codes = []
        for i in order:
            v = float(vals[i])
            codes.append(
                annotate_reason(
                    self.feature_names[i],
                    round(v, 4),
                    "increases risk" if v > 0 else "decreases risk",
                )
            )
        return codes

    def global_importance(self, X: pd.DataFrame, sample: int = 2000) -> pd.Series:
        if len(X) > sample:
            X = X.sample(sample, random_state=42)
        vals = self._shap_matrix(X)
        imp = np.abs(vals).mean(axis=0)
        return pd.Series(imp, index=self.feature_names).sort_values(ascending=False)
