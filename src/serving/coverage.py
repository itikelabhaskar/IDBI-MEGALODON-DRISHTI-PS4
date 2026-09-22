# decides whether we know enough about a borrower to score them at all. counts how
# many feature families the caller actually sent and refuses below a threshold,
# rather than quietly filling defaults and returning a confident looking number.

from __future__ import annotations

from dataclasses import dataclass

from src.features.india_features import (
    BASE_FEATURES,
    CASHFLOW_FEATURES,
    GRAPH_FEATURES,
    NOTE_FEATURES,
)

# Default thresholds: (insufficient_data upper, provisional upper).
_DEFAULT_THRESHOLDS = (0.35, 0.55)


@dataclass(frozen=True)
class CoverageResult:
    score: float  # 0..1
    status: str  # "full" | "provisional" | "insufficient_data"
    provisional: bool
    families: dict[str, bool]  # family_name -> present
    detail: str


def family_defs(segment: str) -> dict[str, list[str]]:
    if segment == "msme_idbi":
        return {
            "bureau_profile": [
                "cibil_score", "cmr", "state", "sector", "sub_segment", "vintage_months",
            ],
            "facility_limits": [
                "ticket_size", "sanction_limit", "drawing_power",
                "drawing_power_gap_pct", "tenure_months",
            ],
            "repayment_behaviour": [
                "dpd", "overdue_amt", "demanded_vs_collected_ratio",
                "total_int_ovdu", "total_p_ovdu", "emi_bounce_6m",
            ],
            "risk_flags": ["lien_flag", "restructuring_flag", "officer_note"],
        }
    if segment == "msme_india":
        return {
            "base": list(BASE_FEATURES),
            "cashflow": list(CASHFLOW_FEATURES),
            # officer_note is the raw field clients send; NOTE_FEATURES are derived.
            "notes": ["officer_note", *NOTE_FEATURES],
            "graph": list(GRAPH_FEATURES),
        }
    if segment == "msme_sba":
        # guarantee_ratio is derived in engineer_sba_features, not a raw field —
        # treat sba_appv as the raw proxy for the facility family.
        return {
            "profile": ["naics", "state", "no_emp", "new_exist", "urban_rural"],
            "facility": ["term", "gr_appv", "sba_appv", "disbursement_gross"],
            "behaviour": [
                "rev_line_cr", "low_doc", "franchise_code", "create_job", "retained_job",
            ],
        }
    if segment == "retail_homecredit":
        return {
            "profile": [
                "days_birth", "days_employed", "code_gender", "cnt_children",
                "cnt_fam_members", "name_income_type", "name_education_type",
                "name_family_status", "name_housing_type", "occupation_type",
                "organization_type", "flag_own_car", "flag_own_realty",
            ],
            "facility": [
                "amt_income_total", "amt_credit", "amt_annuity", "amt_goods_price",
                "name_contract_type",
            ],
            "bureau": ["ext_source_1", "ext_source_2", "ext_source_3"],
        }
    if segment == "retail_gmsc":
        return {
            "profile": ["age", "dependents", "monthly_income"],
            "credit": [
                "revolving_utilization", "debt_ratio",
                "open_credit_lines", "real_estate_loans",
            ],
            "delinquency": ["dpd_30_59", "dpd_60_89", "times_90_late"],
        }
    # Unknown / default: three coarse families from typical MSME/retail raw fields.
    return {
        "profile": ["state", "age", "no_emp", "monthly_income", "code_gender"],
        "facility": ["term", "amt_credit", "gr_appv", "ticket_size", "disbursement_gross"],
        "behaviour": [
            "rev_line_cr", "debt_ratio", "emi_bounce_6m", "revolving_utilization",
        ],
    }


def assess_coverage(
    segment: str,
    provided_keys: set[str] | list[str],
    *,
    thresholds: tuple[float, float] = _DEFAULT_THRESHOLDS,
) -> CoverageResult:
    provided = set(provided_keys)
    families = family_defs(segment)
    n = len(families)
    if n == 0:
        return CoverageResult(
            score=0.0,
            status="insufficient_data",
            provisional=False,
            families={},
            detail="no feature families defined for segment",
        )

    present_map = {
        name: any(field in provided for field in fields)
        for name, fields in families.items()
    }
    n_present = sum(present_map.values())
    score = n_present / n

    lo, hi = thresholds
    if score < lo:
        status = "insufficient_data"
        provisional = False
    elif score < hi:
        status = "provisional"
        provisional = True
    else:
        status = "full"
        provisional = False

    missing = [name for name, ok in present_map.items() if not ok]
    if status == "full":
        detail = f"{n_present}/{n} families present"
    elif status == "provisional":
        detail = (
            f"{n_present}/{n} families present; missing={missing}; "
            "score is provisional"
        )
    else:
        detail = (
            f"{n_present}/{n} families present; missing={missing}; "
            "refuse to score — insufficient data"
        )

    return CoverageResult(
        score=score,
        status=status,
        provisional=provisional,
        families=present_map,
        detail=detail,
    )
