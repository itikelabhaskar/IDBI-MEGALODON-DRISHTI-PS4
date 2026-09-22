# turns a macro shock (repo hike, GDP contraction, sector stress) into a per-account
# log-odds shift scaled by that sector's beta, so the scenario engine is sector
# granular instead of one flat multiplier.

from __future__ import annotations

import numpy as np
import pandas as pd

# Curated annual RBI macro series (approx. public values; source: RBI DBIE).
RBI_MACRO = pd.DataFrame(
    [
        (2015, 6.75, 4.9, 3.3, 8.0, 10.9),
        (2016, 6.25, 4.5, 4.6, 8.3, 8.2),
        (2017, 6.00, 3.6, 4.4, 6.8, 10.0),
        (2018, 6.50, 3.4, 3.8, 6.5, 13.3),
        (2019, 5.15, 4.8, -0.8, 3.9, 6.1),
        (2020, 4.00, 6.2, -8.4, -5.8, 5.9),  # COVID shock
        (2021, 4.00, 5.5, 11.4, 9.7, 9.6),
        (2022, 6.25, 6.7, 5.2, 7.0, 15.0),
        (2023, 6.50, 5.4, 5.2, 7.6, 16.6),
        (2024, 6.50, 4.8, 4.0, 6.8, 14.0),
    ],
    columns=["year", "repo_rate", "cpi_inflation", "iip_growth", "gdp_growth", "bank_credit_growth"],
)

# Sector sensitivity of default odds to macro stress (1.0 = average).
#
# Two naming families live here on purpose: the NAICS-style labels the SBA
# feature engineer emits, and the India MSME sector labels from
# ``src.ingestion.india_synth._SECTORS``. Before both were present, every India
# sector except construction / transport / retail_trade silently fell through to
# DEFAULT_BETA and the "sector-granular, not a flat multiplier" claim was not
# true for the hero segment. Mirrored in web/src/routes/scenario.tsx.
SECTOR_BETA: dict[str, float] = {
    # --- India MSME sectors ------------------------------------------------
    "hospitality": 1.4,
    "auto_components": 1.3,
    "textiles": 1.25,
    "agri_processing": 1.0,
    "food_processing": 0.85,
    "it_services": 0.7,
    "pharma": 0.6,
    # --- SBA / NAICS sectors (shared keys keep their existing values) -------
    "real_estate": 1.5,
    "construction": 1.4,
    "accommodation_food": 1.3,
    "manufacturing": 1.2,
    "transport": 1.2,
    "retail_trade": 1.1,
    "wholesale_trade": 1.1,
    "information": 1.0,
    "finance_insurance": 1.0,
    "professional_svc": 0.9,
    "education": 0.8,
    "agriculture": 0.9,
    "health_care": 0.6,
}
DEFAULT_BETA = 1.0

# Coefficients mapping macro deltas -> log-odds shift (calibrated so a 250bps
# hike + 3% GDP contraction ~doubles odds for an average-beta sector).
_C_REPO = 0.002    # per bps
_C_GDP = 0.08      # per pct of contraction
_C_SECTOR = 2.0    # per unit of sector-specific stress (0..1)


# NOTE: an origination-year US macro feature block once lived here and fed the
# SBA model; it was reverted (near-constant in the chronological test cohort,
# proxied vintage default waves, cost ~3 AUC points). See commit 51d8b22.


def latest_snapshot() -> dict:
    row = RBI_MACRO.iloc[-1]
    return row.to_dict()


def _beta(sector: str) -> float:
    return SECTOR_BETA.get(str(sector), DEFAULT_BETA)


def apply_scenario(
    pd_values: np.ndarray,
    sectors: pd.Series | np.ndarray | None = None,
    repo_hike_bps: float = 0.0,
    gdp_shock_pct: float = 0.0,
    sector_stress: float = 0.0,
    target_sector: str | None = None,
) -> np.ndarray:
    pd_values = np.clip(np.asarray(pd_values, dtype=float), 1e-6, 1 - 1e-6)
    if sectors is None:
        betas = np.ones_like(pd_values)
        sector_names = np.array(["other"] * len(pd_values), dtype=object)
    else:
        sector_names = np.asarray(sectors, dtype=object)
        betas = np.array([_beta(s) for s in sector_names])

    contraction = max(0.0, -float(gdp_shock_pct))
    systemic_shift = betas * (
        _C_REPO * float(repo_hike_bps)
        + _C_GDP * contraction
    )

    sector_stress_val = float(sector_stress)
    if sector_stress_val > 0.0:
        target_norm = str(target_sector or "all_cyclical").strip().lower()
        if target_norm in ("all", "all_cyclical", "cyclical"):
            # Target all high-beta cyclical sectors (beta >= 1.2)
            cyclical_mask = (betas >= 1.2).astype(float)
            sector_shift = cyclical_mask * betas * (_C_SECTOR * sector_stress_val)
        else:
            # Target specifically chosen industry
            target_mask = np.array([str(s).strip().lower() == target_norm for s in sector_names], dtype=float)
            sector_shift = target_mask * betas * (_C_SECTOR * sector_stress_val)
    else:
        sector_shift = np.zeros_like(pd_values)

    shift = systemic_shift + sector_shift
    odds = pd_values / (1 - pd_values)
    odds *= np.exp(shift)
    return odds / (1 + odds)

