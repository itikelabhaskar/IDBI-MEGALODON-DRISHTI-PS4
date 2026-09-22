# rebuilds each segment's held-out slice, scores it with the served bundle and writes
# the threshold table, including the >=90% accuracy line the bank asked about.

from __future__ import annotations

import json

import joblib
import numpy as np
from sklearn.model_selection import train_test_split

from src.config import MODELS_DIR, SEED, SPLIT_KEY
from src.eval.operating_point import operating_points


def _stratified_test_idx(n: int, y: np.ndarray) -> np.ndarray:
    idx = np.arange(n)
    _, tmp = train_test_split(idx, test_size=0.30, stratify=y, random_state=SEED)
    _, te = train_test_split(tmp, test_size=0.50, stratify=y[tmp], random_state=SEED)
    return te


def _segment_test(segment: str):
    if segment == "msme_sba":
        from src.ingestion.kaggle_download import download_sba
        from src.ingestion.sba_adapter import build_canonical
        from src.models.train import time_based_split

        canonical = build_canonical(download_sba())
        _, _, te = time_based_split(canonical, SPLIT_KEY)
        return canonical[te], canonical["default_12m"].to_numpy()[te]
    if segment == "msme_india":
        from src.ingestion.india_synth import build_canonical, india_split

        canonical = build_canonical()
        _, _, te = india_split(canonical)
        return canonical[te], canonical["default_12m"].to_numpy()[te]
    if segment == "retail_homecredit":
        from src.ingestion.homecredit_adapter import build_canonical, download_homecredit

        canonical = build_canonical(download_homecredit())
    elif segment == "retail_gmsc":
        from src.ingestion.gmsc_adapter import build_canonical, download_gmsc

        canonical = build_canonical(download_gmsc())
    else:
        raise ValueError(segment)
    y = canonical["default_12m"].to_numpy()
    te = _stratified_test_idx(len(canonical), y)
    return canonical.iloc[te], y[te]


def run() -> None:
    from src.serving.segments import SEGMENT_SPECS

    for segment, spec in SEGMENT_SPECS.items():
        model_path = spec.model_dir / "model.pkl"
        if not model_path.exists():
            print(f"[opp] {segment}: not trained, skipped")
            continue
        bundle = joblib.load(model_path)
        canonical_te, y_te = _segment_test(segment)
        pd_hat = bundle.predict_pd(spec.engineer(canonical_te))
        payload = operating_points(y_te, pd_hat)
        out = spec.model_dir / "operating_points.json"
        out.write_text(json.dumps(payload, indent=2))
        flag = "MEETS >=90% acc" if payload["meets_90pct_accuracy"] else "below 90% acc"
        print(f"[opp] {segment}: max accuracy {payload['max_accuracy']:.3f} ({flag}) -> {out}")

        # Dual-view confusion (collections priority + review capacity) and PR
        # curve (research.md checklist: confusion matrices and PR curves).
        from src.eval.report import plot_confusion, plot_pr_curve

        f1_point = next(r for r in payload["points"] if r["operating_point"] == "F1-optimal")
        cap_point = next(r for r in payload["points"] if "top-10%" in r["operating_point"])
        plot_confusion(y_te, pd_hat, f1_point["threshold_exact"],
                       cap_point["threshold_exact"], spec.model_dir / "confusion.png")
        plot_pr_curve({"served model": pd_hat}, y_te, spec.model_dir / "pr_curve.png")


if __name__ == "__main__":
    run()
