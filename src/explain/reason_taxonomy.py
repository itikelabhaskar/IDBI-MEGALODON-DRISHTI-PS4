# maps raw feature names onto a fixed set of officer-facing reason codes, so every
# loan in every book explains itself in the same vocabulary. the feature underneath
# can differ per segment, the code the officer reads does not.

from __future__ import annotations

REASON_CODES: dict[str, str] = {
    "REPAYMENT_BEHAVIOUR": "Repayment behaviour (EMI / utilisation)",
    "CASHFLOW_LIQUIDITY": "Cash-flow & liquidity stress",
    "GST_COMPLIANCE": "GST filing / compliance",
    "ALTDATA_UTILITIES": "Utility / electricity alt-data",
    "ALTDATA_UPI": "UPI inflow stability",
    "BUREAU_PROFILE": "Bureau / credit profile",
    "FACILITY_STRUCTURE": "Facility structure & terms",
    "TEXT_OFFICER_NOTE": "Officer note signals",
    "SUPPLIER_CONTAGION": "Supplier-network contagion",
    "SECTOR_GEO": "Sector / geography risk",
    "LIQUIDITY_WORKING_CAPITAL": "Working capital & drawing-power limits",
    "DEBT_SERVICE_COVERAGE": "Debt service & collection coverage",
    "MANAGEMENT_LEGAL": "Legal encumbrance & account liens",
    "FINANCIAL_HEALTH": "Credit bureau score & financial health",
    "OTHER": "Other risk driver",
}

FEATURE_TO_CODE: dict[str, str] = {
    # --- India MSME: repayment / cash-flow / GST / alt-data ---------------
    "emi_bounce_6m": "REPAYMENT_BEHAVIOUR",
    "gst_filing_delay_days": "GST_COMPLIANCE",
    "gst_turnover_trend_pct": "GST_COMPLIANCE",
    "itc_mismatch_flag": "GST_COMPLIANCE",
    "cashflow_volatility": "CASHFLOW_LIQUIDITY",
    "balance_trend_pct": "CASHFLOW_LIQUIDITY",
    "credit_turnover_ratio": "CASHFLOW_LIQUIDITY",
    "current_ratio": "CASHFLOW_LIQUIDITY",
    "electricity_consumption_trend_pct": "ALTDATA_UTILITIES",
    "upi_inflow_stability": "ALTDATA_UPI",
    # --- Officer notes ----------------------------------------------------
    "note_payment_promise_broken": "TEXT_OFFICER_NOTE",
    "note_business_disruption": "TEXT_OFFICER_NOTE",
    "note_stock_statement_delay": "TEXT_OFFICER_NOTE",
    "note_dispute_litigation": "TEXT_OFFICER_NOTE",
    "note_positive_outlook": "TEXT_OFFICER_NOTE",
    "note_sentiment": "TEXT_OFFICER_NOTE",
    # --- Supplier graph ---------------------------------------------------
    "nbr_stress_score": "SUPPLIER_CONTAGION",
    "nbr_bounce_share": "SUPPLIER_CONTAGION",
    # --- Bureau / facility (India base) -----------------------------------
    "cmr": "BUREAU_PROFILE",
    "enquiries_6m": "BUREAU_PROFILE",
    "ticket_size": "FACILITY_STRUCTURE",
    "tenure_months": "FACILITY_STRUCTURE",
    "vintage_months": "FACILITY_STRUCTURE",
    "interest_spread_bps": "FACILITY_STRUCTURE",
    "sub_segment": "FACILITY_STRUCTURE",
    # --- Sector / geography -----------------------------------------------
    "sector": "SECTOR_GEO",
    "state": "SECTOR_GEO",
    "naics": "SECTOR_GEO",
    # --- SBA-ish facility structure ---------------------------------------
    "term": "FACILITY_STRUCTURE",
    "gr_appv": "FACILITY_STRUCTURE",
    "sba_appv": "FACILITY_STRUCTURE",
    "guarantee_ratio": "FACILITY_STRUCTURE",
    "no_emp": "FACILITY_STRUCTURE",
    "new_exist": "FACILITY_STRUCTURE",
    "new_business": "FACILITY_STRUCTURE",
    "real_estate_backed": "FACILITY_STRUCTURE",
    "disbursement_gross": "FACILITY_STRUCTURE",
    "create_job": "FACILITY_STRUCTURE",
    "retained_job": "FACILITY_STRUCTURE",
    "urban_rural": "FACILITY_STRUCTURE",
    "low_doc": "FACILITY_STRUCTURE",
    "rev_line_cr": "FACILITY_STRUCTURE",
    "franchise_code": "FACILITY_STRUCTURE",
    "has_franchise": "FACILITY_STRUCTURE",
    "same_state": "SECTOR_GEO",
    # --- Retail affordability / utilisation -------------------------------
    "amt_credit": "FACILITY_STRUCTURE",
    "amt_annuity": "FACILITY_STRUCTURE",
    "debt_ratio": "CASHFLOW_LIQUIDITY",
    "revolving_utilization": "REPAYMENT_BEHAVIOUR",
    # credit-score-ish external / bureau proxies
    "ext_source_1": "BUREAU_PROFILE",
    "ext_source_2": "BUREAU_PROFILE",
    "ext_source_3": "BUREAU_PROFILE",
    "ext_source_mean": "BUREAU_PROFILE",
    # --- IDBI Sandbox / Finacle signals -----------------------------------
    "drawing_power_gap_pct": "LIQUIDITY_WORKING_CAPITAL",
    "demanded_vs_collected_ratio": "DEBT_SERVICE_COVERAGE",
    "lien_flag": "MANAGEMENT_LEGAL",
    "restructuring_flag": "FACILITY_STRUCTURE",
    "cibil_score": "FINANCIAL_HEALTH",
    "drawing_power": "LIQUIDITY_WORKING_CAPITAL",
    "sanction_limit": "FACILITY_STRUCTURE",
    "overdue_amt": "REPAYMENT_BEHAVIOUR",
}


def code_for_feature(feature: str) -> str:
    return FEATURE_TO_CODE.get(feature, "OTHER")


def annotate_reason(feature: str, shap: float, effect: str) -> dict:
    code = code_for_feature(feature)
    return {
        "feature": feature,
        "code": code,
        "label": REASON_CODES[code],
        "shap": shap,
        "effect": effect,
    }
