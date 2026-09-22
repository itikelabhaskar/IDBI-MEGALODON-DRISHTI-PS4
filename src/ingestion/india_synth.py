# generates the synthetic india MSME book. attributes are drawn first, a latent
# risk score is a function of those attributes, and the label is a draw from it,
# so the model has to actually recover the signal.
#
# two factors are hidden from the structured columns on purpose: officer_insight
# only shows up in the note text, community_stress only in the supplier graph.
# that is what makes the notes and graph ablation steps honest instead of circular.

from __future__ import annotations

import numpy as np
import pandas as pd

from src.config import PROCESSED_DIR, SEED, SEGMENTS
from src.framework.schema import validate_canonical

# Sub-segment mix and 12m stress priors (MSME Pulse-style magnitudes).
_SUBSEGMENTS = {
    "micro": {"share": 0.60, "target_rate": 0.045, "ticket_mu": 13.6},   # ~8 L
    "small": {"share": 0.30, "target_rate": 0.030, "ticket_mu": 15.3},   # ~45 L
    "medium": {"share": 0.10, "target_rate": 0.020, "ticket_mu": 17.0},  # ~2.4 Cr
}

_SECTORS = {
    "textiles": 0.25, "food_processing": 0.05, "auto_components": 0.10,
    "pharma": -0.20, "retail_trade": 0.15, "construction": 0.40,
    "transport": 0.20, "it_services": -0.30, "hospitality": 0.35,
    "agri_processing": 0.10,
}

_STATES = {
    "MH": 0.0, "GJ": -0.05, "TN": -0.05, "KA": -0.10, "DL": 0.05, "UP": 0.15,
    "WB": 0.10, "RJ": 0.05, "TG": -0.05, "PB": 0.10, "MP": 0.10, "KL": 0.0,
}

# Standardised-driver weights in the latent risk score. Signs encode credit
# intuition (also enforced as monotone constraints at training time).
_W = {
    "gst_filing_delay_days": 0.45,
    "gst_turnover_trend_pct": -0.40,
    "itc_mismatch_flag": 0.25,
    "emi_bounce_6m": 0.85,
    "cashflow_volatility": 0.50,
    "balance_trend_pct": -0.40,
    "credit_turnover_ratio": 0.35,
    "current_ratio": -0.30,
    "cmr": 0.55,
    "enquiries_6m": 0.25,
    "interest_spread_bps": 0.30,
    "vintage_months": -0.20,
    # Alt-data signals named in the problem statement's scope (electricity
    # consumption of the unit; UPI transaction-footprint regularity).
    "electricity_consumption_trend_pct": -0.30,
    "upi_inflow_stability": -0.35,
}
_W_OFFICER = 0.95    # hidden: only notes carry it
_W_COMMUNITY = 0.85  # hidden: only the supplier graph carries it
_NOISE = 0.9

N_COMMUNITIES = 120  # supplier clusters for the contagion layer


def _standardize(s: pd.Series) -> pd.Series:
    return (s - s.mean()) / (s.std() + 1e-9)


def _calibrate_intercept(z: np.ndarray, target: float) -> float:
    lo, hi = -12.0, 4.0
    for _ in range(60):
        mid = (lo + hi) / 2
        if (1 / (1 + np.exp(-(mid + z)))).mean() > target:
            hi = mid
        else:
            lo = mid
    return (lo + hi) / 2


def generate_india_msme(n: int = 60_000, seed: int = SEED) -> pd.DataFrame:
    rng = np.random.default_rng(seed)

    subseg = rng.choice(
        list(_SUBSEGMENTS), p=[v["share"] for v in _SUBSEGMENTS.values()], size=n
    )
    sector = rng.choice(list(_SECTORS), size=n)
    state = rng.choice(list(_STATES), size=n)

    ticket_mu = np.array([_SUBSEGMENTS[s]["ticket_mu"] for s in subseg])
    ticket_size = np.exp(rng.normal(ticket_mu, 0.55))
    tenure_months = rng.choice([12, 24, 36, 48, 60, 84], size=n, p=[0.10, 0.20, 0.30, 0.20, 0.15, 0.05])
    vintage_months = np.clip(rng.gamma(3.0, 18.0, n), 3, 240)
    approval_fy = rng.choice([2019, 2020, 2021, 2022, 2023, 2024], size=n,
                             p=[0.10, 0.12, 0.16, 0.20, 0.21, 0.21])

    # --- Hidden factors ------------------------------------------------------
    officer_insight = rng.normal(0, 1, n)          # notes-only signal
    community = rng.integers(0, N_COMMUNITIES, n)  # supplier cluster id
    community_stress_level = rng.normal(0, 1, N_COMMUNITIES)[community]
    cs = community_stress_level

    # --- Observable cash-flow / bureau drivers (feature-first, label-free) ---
    # Community stress partially shifts members' observables (a stressed
    # supplier cluster shows more bounces/delays), so neighbours' observables
    # sharpen the estimate of the shared factor — that is what the graph
    # features recover, without ever touching labels.
    gst_filing_delay_days = np.clip(rng.gamma(1.4, 6.0, n) * (1 + 0.35 * np.tanh(cs)), 0, 120)
    gst_turnover_trend_pct = np.clip(rng.normal(4.0, 16.0, n) - 5.0 * cs, -70, 80)
    itc_mismatch_flag = (rng.random(n) < 0.12).astype(int)
    emi_bounce_6m = rng.poisson(0.55 * np.exp(0.5 * cs), n).clip(0, 12)
    cashflow_volatility = np.clip(rng.gamma(2.2, 0.12, n), 0.02, 1.5)
    balance_trend_pct = np.clip(rng.normal(2.0, 14.0, n) - 4.0 * cs, -60, 60)
    credit_turnover_ratio = np.clip(rng.gamma(2.0, 0.25, n), 0.05, 3.0)
    current_ratio = np.clip(rng.normal(1.5, 0.55, n), 0.1, 4.0)
    cmr = rng.integers(1, 11, n).astype(float)
    enquiries_6m = rng.poisson(1.2, n).clip(0, 15)
    interest_spread_bps = np.clip(rng.normal(280, 90, n), 50, 700)
    # Electricity consumption tracks real activity: correlated with turnover
    # trend + community stress, plus idiosyncratic noise. Public/utility data.
    electricity_consumption_trend_pct = np.clip(
        0.55 * gst_turnover_trend_pct - 2.0 * cs + rng.normal(0, 10.0, n), -70, 80
    )
    # UPI inflow regularity in [0,1]: gig-like volatile inflows score low.
    upi_inflow_stability = np.clip(
        rng.beta(5, 2, n) - 0.25 * np.tanh(cs) * rng.random(n), 0.02, 1.0
    )

    df = pd.DataFrame(
        {
            "sub_segment": subseg, "sector": sector, "state": state,
            "ticket_size": ticket_size, "tenure_months": tenure_months,
            "vintage_months": vintage_months, "approval_fy": approval_fy,
            "gst_filing_delay_days": gst_filing_delay_days,
            "gst_turnover_trend_pct": gst_turnover_trend_pct,
            "itc_mismatch_flag": itc_mismatch_flag,
            "emi_bounce_6m": emi_bounce_6m,
            "cashflow_volatility": cashflow_volatility,
            "balance_trend_pct": balance_trend_pct,
            "credit_turnover_ratio": credit_turnover_ratio,
            "current_ratio": current_ratio,
            "cmr": cmr, "enquiries_6m": enquiries_6m,
            "interest_spread_bps": interest_spread_bps,
            "electricity_consumption_trend_pct": electricity_consumption_trend_pct,
            "upi_inflow_stability": upi_inflow_stability,
            "community_id": community,
        }
    )

    # --- Latent risk -> label, calibrated per sub-segment -------------------
    z = sum(w * _standardize(df[c]) for c, w in _W.items())
    z += df["sector"].map(_SECTORS).astype(float)
    z += df["state"].map(_STATES).astype(float)
    z += _W_OFFICER * officer_insight
    z += _W_COMMUNITY * community_stress_level
    z += rng.normal(0, _NOISE, n)
    z = z.to_numpy()

    pd_true = np.empty(n)
    for name, cfg in _SUBSEGMENTS.items():
        mask = subseg == name
        a = _calibrate_intercept(z[mask], cfg["target_rate"])
        pd_true[mask] = 1 / (1 + np.exp(-(a + z[mask])))
    default = (rng.random(n) < pd_true).astype("int64")

    df["default_12m"] = default
    df["officer_insight"] = officer_insight            # hidden; notes only
    df["community_stress_level"] = community_stress_level  # hidden; graph only
    df["loan_id"] = [f"IN{100000 + i}" for i in range(n)]
    df["segment"] = "msme_india"
    df["origination_date"] = pd.to_datetime(
        (df["approval_fy"] - 1).astype(int).astype(str) + "-04-01"
    ) + pd.to_timedelta(rng.integers(0, 364, n), unit="D")
    return df


def india_split(canonical: pd.DataFrame) -> tuple[np.ndarray, np.ndarray, np.ndarray]:
    fy = canonical["approval_fy"].to_numpy()
    return fy <= 2022, fy == 2023, fy == 2024


def build_canonical(
    n: int = 60_000, seed: int = SEED, save: bool = True, use_finbert: bool = False
) -> pd.DataFrame:
    processed = PROCESSED_DIR / SEGMENTS["msme_india"]["processed_file"]
    if processed.exists():
        print(f"[adapter] loading cached canonical frame: {processed}")
        return pd.read_parquet(processed)

    from src.features.graph_signals import attach_graph_features
    from src.features.notes_signals import extract_note_signals, generate_notes

    df = generate_india_msme(n=n, seed=seed)
    df["officer_note"] = generate_notes(df, seed=seed)
    if use_finbert:
        print("[adapter] extracting note signals with FinBERT sentiment ...")
    df = pd.concat(
        [df, extract_note_signals(df["officer_note"], use_finbert=use_finbert)], axis=1
    )
    df = attach_graph_features(df, seed=seed)
    df = df.drop(columns=["officer_insight", "community_stress_level"])

    canonical = validate_canonical(df.reset_index(drop=True))
    if save:
        canonical.to_parquet(processed, index=False)
        print(f"[adapter] wrote canonical frame ({len(canonical):,} rows): {processed}")
    return canonical
