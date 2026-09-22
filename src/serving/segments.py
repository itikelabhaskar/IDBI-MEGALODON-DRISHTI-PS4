# one entry per loan book: which feature builder to call, which column is exposure,
# what to break the portfolio down by, and how to load a demo sample.
# this is what keeps the scorer, api and console segment-agnostic.

from __future__ import annotations

from collections.abc import Callable
from dataclasses import dataclass, field

import numpy as np
import pandas as pd

from src.config import MODELS_DIR, SPLIT_KEY
from src.features import gmsc_features as gm
from src.features import homecredit_features as hc
from src.features import india_features as ind
from src.features import sba_features as sba
from src.ingestion import idbi_adapter


@dataclass(frozen=True)
class SegmentSpec:
    name: str
    label: str
    model_dir_name: str
    engineer: Callable[[pd.DataFrame], pd.DataFrame]
    numeric_features: list[str]
    categorical_features: list[str]
    ead_col: str
    breakdown_col: str
    raw_defaults: dict
    load_canonical: Callable[[], pd.DataFrame]
    sample_portfolio: Callable[[pd.DataFrame, int, int], pd.DataFrame]
    whatif: dict = field(default_factory=dict)
    # ISO-ish currency tag of the segment's monetary columns (honest labelling:
    # public datasets are not INR; the India segment is).
    currency: str = "USD"

    @property
    def model_dir(self):
        return MODELS_DIR / self.model_dir_name


# --- Canonical loaders / samplers (imported lazily to keep this light) ------
def _sba_canonical() -> pd.DataFrame:
    from src.ingestion.kaggle_download import download_sba
    from src.ingestion.sba_adapter import build_canonical

    return build_canonical(download_sba())


def _sba_sample(canonical: pd.DataFrame, n: int, seed: int) -> pd.DataFrame:
    from src.models.train import time_based_split

    _, _, te = time_based_split(canonical, SPLIT_KEY)
    cohort = canonical[te].reset_index(drop=True)
    if len(cohort) > n:
        cohort = cohort.sample(n, random_state=seed).reset_index(drop=True)
    return cohort


def _hc_canonical() -> pd.DataFrame:
    from src.ingestion.homecredit_adapter import build_canonical, download_homecredit

    return build_canonical(download_homecredit())


def _hc_sample(canonical: pd.DataFrame, n: int, seed: int) -> pd.DataFrame:
    c = canonical
    if len(c) > n:
        c = c.sample(n, random_state=seed)
    return c.reset_index(drop=True)


def _india_canonical() -> pd.DataFrame:
    from src.ingestion.india_synth import build_canonical

    return build_canonical()


def _india_sample(canonical: pd.DataFrame, n: int, seed: int) -> pd.DataFrame:
    from src.ingestion.india_synth import india_split

    _, _, te = india_split(canonical)
    cohort = canonical[te].reset_index(drop=True)
    if len(cohort) > n:
        cohort = cohort.sample(n, random_state=seed).reset_index(drop=True)
    return cohort


def _gmsc_canonical() -> pd.DataFrame:
    from src.ingestion.gmsc_adapter import build_canonical, download_gmsc

    return build_canonical(download_gmsc())


def _gmsc_sample(canonical: pd.DataFrame, n: int, seed: int) -> pd.DataFrame:
    c = canonical
    if len(c) > n:
        c = c.sample(n, random_state=seed)
    return c.reset_index(drop=True)


def _idbi_canonical() -> pd.DataFrame:
    from src.ingestion.idbi_adapter import idbi_canonical

    return idbi_canonical()


def _idbi_sample(canonical: pd.DataFrame, n: int, seed: int) -> pd.DataFrame:
    from src.ingestion.idbi_adapter import idbi_sample

    return idbi_sample(canonical, n, seed)



# --- Raw-field defaults for single-record scoring --------------------------
_SBA_RAW_DEFAULTS: dict[str, object] = {
    "naics": "0", "state": "unknown", "bank_state": "unknown",
    "term": np.nan, "no_emp": np.nan, "new_exist": np.nan,
    "create_job": np.nan, "retained_job": np.nan, "franchise_code": 0,
    "urban_rural": np.nan, "rev_line_cr": "other", "low_doc": "other",
    "disbursement_gross": np.nan, "gr_appv": np.nan, "sba_appv": np.nan,
    "approval_fy": np.nan,
}

_HC_NUMERIC_RAW = [
    "amt_income_total", "amt_credit", "amt_annuity", "amt_goods_price",
    "days_birth", "days_employed", "days_id_publish", "days_last_phone_change",
    "cnt_children", "cnt_fam_members", "ext_source_1", "ext_source_2",
    "ext_source_3", "region_population_relative", "region_rating_client",
]
_HC_RAW_DEFAULTS: dict[str, object] = {
    **{c: np.nan for c in _HC_NUMERIC_RAW},
    "flag_own_car": "N", "flag_own_realty": "N",
    "name_contract_type": "Cash loans", "code_gender": "missing",
    "name_income_type": "missing", "name_education_type": "missing",
    "name_family_status": "missing", "name_housing_type": "missing",
    "occupation_type": "missing", "organization_type": "missing",
}

_INDIA_RAW_DEFAULTS: dict[str, object] = {
    **{c: np.nan for c in ind.BASE_NUMERIC + ind.CASHFLOW_FEATURES},
    **{c: np.nan for c in ind.GRAPH_FEATURES},
    "sub_segment": "unknown", "sector": "unknown", "state": "unknown",
    "officer_note": "",
}

_GMSC_RAW_DEFAULTS: dict[str, object] = {
    c: np.nan
    for c in [
        "revolving_utilization", "age", "debt_ratio", "monthly_income",
        "open_credit_lines", "real_estate_loans", "dependents",
        "dpd_30_59", "dpd_60_89", "times_90_late",
    ]
}


_IDBI_RAW_DEFAULTS: dict[str, object] = {
    **_INDIA_RAW_DEFAULTS,
    "cibil_score": 650.0,
    "dpd": 0.0,
    "overdue_amt": 0.0,
    "demanded_vs_collected_ratio": 1.0,
    "drawing_power_gap_pct": 0.0,
    "sanction_limit": 1_000_000.0,
    "drawing_power": 1_000_000.0,
    "lien_flag": 0,
    "restructuring_flag": 0,
    "ticket_size": 1_000_000.0,
}


SEGMENT_SPECS: dict[str, SegmentSpec] = {
    "msme_idbi": SegmentSpec(
        name="msme_idbi",
        label="MSME — IDBI Sandbox (Finacle APIs 402/404/391/441/362/408)",
        model_dir_name="idbi",
        engineer=idbi_adapter.engineer_idbi_features,
        numeric_features=ind.NUMERIC_FEATURES,
        categorical_features=ind.CATEGORICAL_FEATURES,
        ead_col="ticket_size",
        breakdown_col="sector",
        raw_defaults=_IDBI_RAW_DEFAULTS,
        load_canonical=_idbi_canonical,
        sample_portfolio=_idbi_sample,
        whatif={
            "drawing_power_gap_pct": "Drawing Power Gap (%)",
            "demanded_vs_collected_ratio": "Demanded vs Collected Ratio",
            "emi_bounce_6m": "EMI bounces (6m)",
        },
        currency="INR",
    ),
    "msme_india": SegmentSpec(
        name="msme_india",
        label="MSME — India (synthetic, GST/AA/notes/graph)",
        model_dir_name="india",
        engineer=ind.engineer_india_features,
        numeric_features=ind.NUMERIC_FEATURES,
        categorical_features=ind.CATEGORICAL_FEATURES,
        ead_col="ticket_size",
        breakdown_col="sector",
        raw_defaults=_INDIA_RAW_DEFAULTS,
        load_canonical=_india_canonical,
        sample_portfolio=_india_sample,
        whatif={
            "emi_bounce_6m": "EMI bounces (6m)",
            "gst_filing_delay_days": "GST filing delay (days)",
        },
        currency="INR",
    ),
    "msme_sba": SegmentSpec(
        name="msme_sba",
        label="MSME — SBA 7(a)",
        model_dir_name="sba",
        engineer=sba.engineer_sba_features,
        numeric_features=sba.NUMERIC_FEATURES,
        categorical_features=sba.CATEGORICAL_FEATURES,
        ead_col="gr_appv",
        breakdown_col="sector",
        raw_defaults=_SBA_RAW_DEFAULTS,
        load_canonical=_sba_canonical,
        sample_portfolio=_sba_sample,
        # (feature, label, is_currency) levers with derived-field propagation.
        whatif={"term": "Loan term (months)", "gr_appv": "Gross approved (USD)"},
        currency="USD",
    ),
    "retail_homecredit": SegmentSpec(
        name="retail_homecredit",
        label="Retail — Home Credit",
        model_dir_name="homecredit",
        engineer=hc.engineer_homecredit_features,
        numeric_features=hc.NUMERIC_FEATURES,
        categorical_features=hc.CATEGORICAL_FEATURES,
        ead_col="amt_credit",
        breakdown_col="contract_type",
        raw_defaults=_HC_RAW_DEFAULTS,
        load_canonical=_hc_canonical,
        sample_portfolio=_hc_sample,
        whatif={"amt_credit": "Credit amount (CU)", "amt_annuity": "Annuity (CU)"},
        currency="CU",  # Home Credit amounts are in unlabelled currency units
    ),
    "retail_gmsc": SegmentSpec(
        name="retail_gmsc",
        label="Retail — Give Me Some Credit",
        model_dir_name="gmsc",
        engineer=gm.engineer_gmsc_features,
        numeric_features=gm.NUMERIC_FEATURES,
        categorical_features=gm.CATEGORICAL_FEATURES,
        ead_col="exposure_proxy",
        breakdown_col="age_band",
        raw_defaults=_GMSC_RAW_DEFAULTS,
        load_canonical=_gmsc_canonical,
        sample_portfolio=_gmsc_sample,
        whatif={"debt_ratio": "Debt ratio", "revolving_utilization": "Revolving utilisation"},
        currency="USD",
    ),
}


def available_segments() -> list[str]:
    return [s for s, spec in SEGMENT_SPECS.items() if (spec.model_dir / "model.pkl").exists()]
