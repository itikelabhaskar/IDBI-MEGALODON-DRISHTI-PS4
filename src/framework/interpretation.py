# turns one calibrated probability into everything a credit officer needs:
#
#   PD -> RG1..RG10 grade -> red/amber/green -> early-watch bucket
#      -> action + owner + cadence -> expected credit loss in rupees
#
# the rbi sma class is not derived from the pd: it comes from days past due.
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
# Amber = watch/engage, Red = act now.
_RAG_BY_GRADE: dict[str, str] = {
    "RG1": "Green", "RG2": "Green", "RG3": "Green", "RG4": "Green",
    "RG5": "Amber", "RG6": "Amber", "RG7": "Amber",
    "RG8": "Red", "RG9": "Red", "RG10": "Red",
}


def rag_bucket(grade: str) -> str:
    return _RAG_BY_GRADE[grade]


# Grade -> model watch bucket + action playbook. These buckets come from the PD,
# so they are named "Early watch 1/2/3" and never "SMA": RBI's Special Mention
# Account status is defined on days past due alone and is reported separately
# (dpd_regulatory_floor). Two labels for two different facts.
_PLAYBOOK: dict[str, Action] = {
    "RG1": Action("low", "No watch", "Business as usual; eligible for cross-sell / limit increase", "Annual review", "Relationship manager"),
    "RG2": Action("low", "No watch", "Business as usual; monitor at portfolio level", "Annual review", "Relationship manager"),
    "RG3": Action("moderate", "No watch", "Standard monitoring; no action", "Semi-annual review", "Relationship manager"),
    "RG4": Action("moderate", "No watch", "Watch trend; verify latest financials", "Quarterly review", "Credit analyst"),
    "RG5": Action("elevated", "Early watch 1", "Proactive engagement; confirm cash-flow health", "Monthly review", "Credit analyst"),
    "RG6": Action("elevated", "Early watch 1", "Enhanced monitoring; request updated stock/GST statements", "Monthly review", "Credit analyst"),
    "RG7": Action("high", "Early watch 2", "Restructuring assessment; covenant / collateral review", "Fortnightly review", "Watchlist committee"),
    "RG8": Action("high", "Early watch 3", "Site visit + restructuring offer; tighten limits", "Fortnightly review", "Watchlist committee"),
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


@dataclass(frozen=True)
class DpdFloor:
    """Regulatory classification implied by days past due."""

    bucket: str
    sma_watch: str
    floor_grade: str
    stage_floor: int


def dpd_regulatory_floor(dpd: float | None) -> DpdFloor | None:
    """RBI SMA bucket and Ind AS 109 stage floor for an account's days past due.

    The PD model deliberately does not see DPD (`idbi_adapter` decouples it to
    avoid circular leakage), but the regulatory status of an overdue account is
    not a prediction — RBI defines the SMA buckets on DPD itself (SMA-0 1-30,
    SMA-1 31-60, SMA-2 61-90, NPA beyond 90), and Ind AS 109 presumes a
    significant increase in credit risk past 30 days overdue (Stage 2) and treats
    90 days as credit-impaired (Stage 3). This returns that floor, so a scored
    account is never classed more leniently than its overdue status already is.

    `floor_grade` is the least severe grade whose playbook carries that bucket,
    and is used only to pick the action; the model's own grade is left as is.
    Returns None for a current account or a missing/invalid DPD.
    """
    try:
        d = float(dpd)
    except (TypeError, ValueError):
        return None
    if not np.isfinite(d) or d <= 0:
        return None
    if d > 90:
        return DpdFloor("NPA", "NPA (>90 DPD)", "RG9", 3)
    if d > 60:
        return DpdFloor("SMA-2", "Early watch 3", "RG8", 2)
    if d > 30:
        return DpdFloor("SMA-1", "Early watch 2", "RG7", 2)
    return DpdFloor("SMA-0", "Early watch 1", "RG5", 1)


def grade_rank(grade: str) -> int:
    """1 for RG1 through 10 for RG10, for comparing severity."""
    return int(str(grade).upper().removeprefix("RG"))


def calculate_ind_as_109_ecl(
    pd_value: float,
    ead: float,
    grade: str | None = None,
    lgd: float = DEFAULT_LGD,
    stage_floor: int | None = None,
) -> dict[str, float | int]:
    # ind as 109 staged ecl. stage 1 (RG1-RG4): 12-month pd x lgd x ead. stage 2
    # (RG5-RG8): lifetime, min(1, 2.5 x pd). stage 3 (RG9-RG10): lifetime with a
    # judgemental floor of 25% / 50% of ead. the floors key off the grade, not npa
    # age, so they are not the rbi irac provisioning rates. stage_floor raises the
    # stage without touching the grade (the days-past-due backstops).
    pd_val = float(pd_value)
    ead_val = float(ead)
    lgd_val = float(lgd)
    gr = grade if grade is not None else assign_grade(pd_val)
    stage = assign_ecl_stage(gr)
    if stage_floor is not None:
        stage = max(stage, int(stage_floor))

    ecl_12m = pd_val * lgd_val * ead_val
    # Lifetime PD proxy: flat 2.5x the 12m PD, capped at 1. A 3-year constant hazard would
    # give 1 - (1 - p)^3 (about 3p for small p); 2.5x is a judgemental haircut for
    # amortisation, not a fitted term structure. Replace with the survival model's curve.
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
