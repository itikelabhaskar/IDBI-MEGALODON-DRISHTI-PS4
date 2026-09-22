# trains the hazard model and checks its 12 month point against a true 12 month
# label, so the timing story is measured rather than asserted.

from __future__ import annotations

import argparse
import json

import joblib
import matplotlib

matplotlib.use("Agg")
import matplotlib.pyplot as plt  # noqa: E402
import numpy as np  # noqa: E402
import pandas as pd  # noqa: E402

from src.config import MODELS_DIR, SEED, SPLIT_KEY  # noqa: E402
from src.eval.metrics import compute_metrics  # noqa: E402
from src.features.sba_features import engineer_sba_features  # noqa: E402
from src.ingestion.kaggle_download import download_sba  # noqa: E402
from src.ingestion.sba_adapter import load_raw_sba, to_canonical  # noqa: E402
from src.models.survival import (  # noqa: E402
    H_QUARTERS,
    person_period_expand,
    train_hazard,
)
from src.models.train import time_based_split  # noqa: E402


def _build_event_frame(n_loans: int) -> tuple[pd.DataFrame, np.ndarray, np.ndarray, np.ndarray]:
    raw = load_raw_sba(download_sba())
    canonical = to_canonical(raw)

    # Align raw rows to canonical rows by loan id (canonical dropped some rows).
    raw = raw.copy()
    raw["loan_id"] = raw["LoanNr_ChkDgt"].astype(str)
    raw = raw.drop_duplicates("loan_id").set_index("loan_id")
    raw = raw.loc[canonical["loan_id"]]

    chgoff_date = pd.to_datetime(raw["ChgOffDate"], format="%d-%b-%y", errors="coerce")
    months_to_event = (
        (chgoff_date.to_numpy() - canonical["origination_date"].to_numpy())
        / np.timedelta64(1, "D") / 30.44
    )

    is_default = canonical["default_12m"].to_numpy() == 1
    has_date = ~np.isnan(months_to_event) & (months_to_event > 0)
    event_months = np.where(is_default & has_date, months_to_event, np.nan)

    # Defaults without a usable charge-off date can't be timed -> drop them;
    # censored (paid) loans are observed to term.
    keep = (~is_default) | ~np.isnan(event_months)
    canonical = canonical.loc[keep].reset_index(drop=True)
    event_months = event_months[keep]
    term = canonical["term"].to_numpy(dtype=float)

    event_quarter = np.ceil(event_months / 3.0)
    observed = np.where(
        np.isnan(event_quarter), np.ceil(np.maximum(term, 3) / 3.0), event_quarter
    )
    label_12m = ((~np.isnan(event_months)) & (event_months <= 12)).astype(int)

    # Subsample loans for tractable person-period expansion.
    if len(canonical) > n_loans:
        rng = np.random.default_rng(SEED)
        idx = np.sort(rng.choice(len(canonical), n_loans, replace=False))
        canonical = canonical.iloc[idx].reset_index(drop=True)
        event_quarter = event_quarter[idx]
        observed = observed[idx]
        label_12m = label_12m[idx]

    return canonical, event_quarter, observed, label_12m


def run(n_loans: int = 120_000) -> None:
    out_dir = MODELS_DIR / "survival"
    canonical, event_q, observed_q, label_12m = _build_event_frame(n_loans)
    X = engineer_sba_features(canonical)
    feature_cols = list(X.columns)
    print(f"[run] loans={len(X):,}, timed defaults={np.isfinite(event_q).sum():,}, "
          f"true 12m default rate={label_12m.mean():.3%}")

    tr, va, te = time_based_split(canonical, SPLIT_KEY)

    pp_tr, y_tr = person_period_expand(X[tr], event_q[tr], observed_q[tr])
    pp_va, y_va = person_period_expand(X[va], event_q[va], observed_q[va])
    print(f"[run] person-period rows: train={len(pp_tr):,} val={len(pp_va):,} "
          f"(quarterly, horizon={H_QUARTERS})")

    hazard = train_hazard(pp_tr, y_tr, pp_va, y_va, feature_cols)

    # --- Evaluate PD@12m against the TRUE 12-month label -------------------
    X_te = X[te]
    pd12 = hazard.pd_at_months(X_te, months=12)
    surv_metrics = compute_metrics(label_12m[te], pd12)
    print(f"[run] survival PD@12m vs true 12m label: AUC={surv_metrics['roc_auc']:.4f}")

    binary_metrics = None
    binary_path = MODELS_DIR / "sba" / "model.pkl"
    if binary_path.exists():
        bundle = joblib.load(binary_path)
        binary_pd = bundle.predict_raw(X_te)
        binary_metrics = compute_metrics(label_12m[te], binary_pd)
        print(f"[run] binary (lifetime-label) model on same task: "
              f"AUC={binary_metrics['roc_auc']:.4f}")

    # --- Term-structure plot -------------------------------------------------
    cum = hazard.cumulative_pd(X_te.head(2000))
    order = np.argsort(cum[:, -1])
    months_axis = np.arange(1, H_QUARTERS + 1) * 3
    fig, ax = plt.subplots(figsize=(8, 5))
    ax.plot(months_axis, cum.mean(axis=0), lw=2.5, label="portfolio mean")
    ax.plot(months_axis, cum[order[-10:]].mean(axis=0), lw=2, ls="--",
            label="10 most stressed")
    ax.plot(months_axis, cum[order[:10]].mean(axis=0), lw=2, ls=":",
            label="10 cleanest")
    ax.axvline(12, color="grey", lw=1, alpha=0.7)
    ax.text(12.4, ax.get_ylim()[1] * 0.9, "12-month horizon", fontsize=9, color="grey")
    ax.set_xlabel("Months since disbursement")
    ax.set_ylabel("Cumulative PD")
    ax.set_title("PD term structure — WHEN stress arrives, not just IF")
    ax.legend()
    fig.tight_layout()
    out_dir.mkdir(parents=True, exist_ok=True)
    fig.savefig(out_dir / "term_structure.png", dpi=120)
    plt.close(fig)

    payload = {
        "survival_pd12_vs_true12m": {k: round(v, 4) for k, v in surv_metrics.items()},
        "binary_model_vs_true12m": (
            {k: round(v, 4) for k, v in binary_metrics.items()} if binary_metrics else None
        ),
        "meta": {
            "loans": int(len(X)), "horizon_quarters": H_QUARTERS, "seed": SEED,
            "note": (
                "Charge-off dates used for label construction only. Censored "
                "(paid) loans observed to term. PD@12m evaluated against the "
                "true 12-month default label — the problem statement's task."
            ),
        },
    }
    (out_dir / "metrics.json").write_text(json.dumps(payload, indent=2))
    joblib.dump(hazard, out_dir / "model.pkl")
    print(f"[run] artifacts -> {out_dir}")
    print("[run] done.")


def main() -> None:
    parser = argparse.ArgumentParser(description="Run the SBA survival pipeline.")
    parser.add_argument("--loans", type=int, default=120_000)
    args = parser.parse_args()
    run(n_loans=args.loans)


if __name__ == "__main__":
    main()
