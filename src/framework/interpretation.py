# turns one calibrated probability into everything a credit officer needs:
#
#   PD -> RG1..RG10 grade -> red/amber/green -> SMA watch bucket
#      -> action + owner + cadence -> expected credit loss in rupees
#
# this is the part that makes four different loan books comparable, which is what
# the problem statement means by a common interpretation framework.
# grade bands are illustrative and should be recalibrated to observed frequencies.

from __future__ import annotations

from dataclasses import dataclass

import numpy as np
import pandas as pd

# Risk-grade PD boundaries (upper edge, exclusive). 10 grades, RG1 = safest.
# Illustrative bands; recalibrate to IDBI observed default frequencies later.
_GRADE_EDGES: list[tuple[str, float]] = [
    ("RG1", 0.02),
    ("RG2", 0.04),
    ("RG3", 0.07),
    ("RG4", 0.11),
    ("RG5", 0.16),
    ("RG6", 0.23),
    ("RG7", 0.32),
    ("RG8", 0.45),
    ("RG9", 0.65),
    ("RG10", 1.01),
]


@dataclass(frozen=True)
class Action:

    band: str
    sma_watch: str
    action: str
    cadence: str
    owner: str


# Colour-coded bucket the bank asked for verbatim in the AMA ("high risk,
# medium, low ... colour coded red, amber, green"). Green = business as usual,
# Amber = watch/engage (SMA-0/1 territory), Red = act now (SMA-2/slippage).
_RAG_BY_GRADE: dict[str, str] = {
    "RG1": "Green", "RG2": "Green", "RG3": "Green", "RG4": "Green",
    "RG5": "Amber", "RG6": "Amber", "RG7": "Amber",
    "RG8": "Red", "RG9": "Red", "RG10": "Red",
}


def rag_bucket(grade: str) -> str:
    return _RAG_BY_GRADE[grade]


# Grade -> watch bucket + action playbook. SMA labels follow RBI's Special
# Mention Account framework (early stress before NPA slippage).
_PLAYBOOK: dict[str, Action] = {
    "RG1": Action("low", "Standard", "Business as usual; eligible for cross-sell / limit increase", "Annual review", "Relationship manager"),
    "RG2": Action("low", "Standard", "Business as usual; monitor at portfolio level", "Annual review", "Relationship manager"),
    "RG3": Action("moderate", "Standard", "Standard monitoring; no action", "Semi-annual review", "Relationship manager"),
    "RG4": Action("moderate", "Standard", "Watch trend; verify latest financials", "Quarterly review", "Credit analyst"),
    "RG5": Action("elevated", "SMA-0 watch", "Proactive engagement; confirm cash-flow health", "Monthly review", "Credit analyst"),
    "RG6": Action("elevated", "SMA-0 watch", "Enhanced monitoring; request updated stock/GST statements", "Monthly review", "Credit analyst"),
    "RG7": Action("high", "SMA-1 watch", "Restructuring assessment; covenant / collateral review", "Fortnightly review", "Watchlist committee"),
    "RG8": Action("high", "SMA-2 watch", "Site visit + restructuring offer; tighten limits", "Fortnightly review", "Watchlist committee"),
    "RG9": Action("severe", "High-slippage risk", "Escalate to recovery; provision proactively; RFA review", "Weekly review", "Recovery / stressed-assets"),
    "RG10": Action("severe", "High-slippage risk", "Initiate collections / recovery; maximise provisioning", "Weekly review", "Recovery / stressed-assets"),
}

# Default loss-given-default when segment-specific LGD is unavailable.
DEFAULT_LGD = 0.45


def assign_grade(pd_value: float) -> str:
    for grade, edge in _GRADE_EDGES:
        if pd_value < edge:
            return grade
    return "RG10"


def playbook(grade: str) -> Action:
    return _PLAYBOOK[grade]


def assign_ecl_stage(grade_or_pd: str | float) -> int:
    if isinstance(grade_or_pd, (int, float)):
        gr = assign_grade(float(grade_or_pd))
    else:
        gr = str(grade_or_pd).strip().upper()

    if gr in ("RG1", "RG2", "RG3", "RG4"):
        return 1
    elif gr in ("RG5", "RG6", "RG7", "RG8"):
        return 2
    else:
        return 3


def calculate_ind_as_109_ecl(
    pd_value: float,
    ead: float,
    grade: str | None = None,
    lgd: float = DEFAULT_LGD,
) -> dict[str, float | int]:
    pd_val = float(pd_value)
    ead_val = float(ead)
    lgd_val = float(lgd)
    gr = grade if grade is not None else assign_grade(pd_val)
    stage = assign_ecl_stage(gr)

    ecl_12m = pd_val * lgd_val * ead_val
    lifetime_pd = min(1.0, 2.5 * pd_val)
    lifetime_ecl = lifetime_pd * lgd_val * ead_val

    if stage == 1:
        ecl = ecl_12m
    elif stage == 2:
        ecl = lifetime_ecl
    else:
        rbi_floor = 0.50 if gr == "RG10" else 0.25
        ecl = max(lifetime_ecl, rbi_floor * ead_val)

    return {
        "ecl": float(ecl),
        "ecl_stage": stage,
        "lifetime_ecl": float(lifetime_ecl),
        "ecl_12m": float(ecl_12m),
    }


def expected_credit_loss(
    pd_value: float,
    ead: float,
    lgd: float = DEFAULT_LGD,
    grade: str | None = None,
    multi_stage: bool = False,
) -> float:
    if multi_stage:
        return float(calculate_ind_as_109_ecl(pd_value, ead, grade=grade, lgd=lgd)["ecl"])
    return float(pd_value) * float(lgd) * float(ead)


def enrich(
    df: pd.DataFrame,
    pd_col: str = "pd",
    ead_col: str | None = "gr_appv",
    lgd: float = DEFAULT_LGD,
) -> pd.DataFrame:
    out = df.copy()
    pds = out[pd_col].astype(float)
    grades = pds.map(assign_grade)
    out["risk_grade"] = grades
    out["rag"] = grades.map(_RAG_BY_GRADE)
    out["risk_band"] = grades.map(lambda g: _PLAYBOOK[g].band)
    out["sma_watch"] = grades.map(lambda g: _PLAYBOOK[g].sma_watch)
    out["recommended_action"] = grades.map(lambda g: _PLAYBOOK[g].action)
    out["review_cadence"] = grades.map(lambda g: _PLAYBOOK[g].cadence)
    out["action_owner"] = grades.map(lambda g: _PLAYBOOK[g].owner)
    out["ecl_stage"] = grades.map(assign_ecl_stage)

    actual_ead = ead_col if (ead_col is not None and ead_col in out.columns) else None
    if actual_ead is None:
        for cand in ("ticket_size", "amt_credit", "gr_appv"):
            if cand in out.columns:
                actual_ead = cand
                break

    if actual_ead is not None:
        ead_vals = out[actual_ead].astype(float)
        ecl_list = []
        lifetime_ecl_list = []
        for p, gr, e in zip(pds, grades, ead_vals):
            res = calculate_ind_as_109_ecl(p, e, grade=gr, lgd=lgd)
            ecl_list.append(res["ecl"])
            lifetime_ecl_list.append(res["lifetime_ecl"])
        out["ecl"] = ecl_list
        out["lifetime_ecl"] = lifetime_ecl_list
    else:
        out["ecl"] = np.nan
        out["lifetime_ecl"] = np.nan
    return out


def grade_order() -> list[str]:
    return [g for g, _ in _GRADE_EDGES]
