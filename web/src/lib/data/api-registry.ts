export type ApiCategory =
  | "Repayment & Overdue"
  | "Limits & Drawing Power"
  | "Facility & Loan Profile"
  | "Encumbrances & Liens"
  | "Cashflow & Statement"
  | "Account Aggregator (AA)"
  | "Customer KYC & Limits"
  | "Collateral & Security";

export type ApiFieldMapping = {
  sourceField: string;
  drishtiFeature: string;
  description: string;
};

export type ApiEntry = {
  apiId: string;
  name: string;
  category: ApiCategory;
  system: "Finacle CBS" | "Account Aggregator" | "Finacle KYC" | "ESB Enterprise Bus";
  endpoint: string;
  description: string;
  extractedFields: ApiFieldMapping[];
  downstreamUse: string[];
  rulesOrModels: string[];
  uiLocations: {
    label: string;
    route: string;
    description: string;
  }[];
  sampleRequest: Record<string, any>;
  sampleResponse: Record<string, any>;
};

// The data sources the console reads, described generically. Names, IDs, fields and
// sample payloads here are DRISHTI's own illustrations; the bank's interface
// specifications are confidential and are not part of this repository.
export const IDBI_API_REGISTRY: ApiEntry[] = [
  {
    "apiId": "CBS-01",
    "name": "Loan overdue details",
    "category": "Repayment & Overdue",
    "system": "Finacle CBS",
    "endpoint": "/loans/overdue-details",
    "description": "Returns loan overdue metrics: Days Past Due (DPD), current outstanding balance, overdue principal, and NPA asset status code using Customer ID and Loan Account Number.",
    "extractedFields": [
      {
        "sourceField": "Days past due",
        "drishtiFeature": "dpd",
        "description": "Days past due count for pre-default stress classification"
      },
      {
        "sourceField": "Overdue amount",
        "drishtiFeature": "overdue_amt",
        "description": "Current unpaid overdue balance"
      },
      {
        "sourceField": "Default 12m",
        "drishtiFeature": "default_12m",
        "description": "Asset classification (STD, SMA0, SMA1, SMA2, NPA)"
      }
    ],
    "downstreamUse": [
      "Pruning T0 performing cohort (DPD < 90)",
      "12-month forward default target label construction",
      "DPD > 60 days supervisory watch trigger"
    ],
    "rulesOrModels": [
      "LightGBM Monotone Default Target",
      "RBI SMA Classification",
      "T0 Leakage Guard"
    ],
    "uiLocations": [
      {
        "label": "Loan Appraisal",
        "route": "/underwrite",
        "description": "Overdue DPD input & overdue balance auto-fill"
      },
      {
        "label": "Portfolio Console",
        "route": "/",
        "description": "DPD column & SMA status filter in Watchlist Queue"
      },
      {
        "label": "Borrower 360",
        "route": "/borrowers/$id",
        "description": "Repayment health badge & DPD trend"
      }
    ],
    "sampleRequest": {
      "note": "Illustrative request; not the bank's contract",
      "input": {
        "customer_id": "CUST_000123",
        "account_id": "LN_000456"
      }
    },
    "sampleResponse": {
      "note": "Illustrative response; field names are DRISHTI's, not the bank's",
      "result": {
        "dpd": "18",
        "overdue_amt": "1425000",
        "default_12m": "illustrative"
      }
    }
  },
  {
    "apiId": "CBS-02",
    "name": "Overdue position (demanded vs collected)",
    "category": "Repayment & Overdue",
    "system": "Finacle CBS",
    "endpoint": "/loans/overdue-position",
    "description": "checks cumulative interest demanded vs. collected, principal overdue, and trailing debt service velocity.",
    "extractedFields": [
      {
        "sourceField": "Demanded vs collected ratio",
        "drishtiFeature": "demanded_vs_collected_ratio",
        "description": "Trailing 12-month cash debt-service collection efficiency"
      },
      {
        "sourceField": "Interest overdue amount",
        "drishtiFeature": "interest_overdue_amt",
        "description": "Total unpaid interest beyond scheduled due date"
      },
      {
        "sourceField": "Principal overdue amount",
        "drishtiFeature": "principal_overdue_amt",
        "description": "Total unpaid principal beyond scheduled instalment"
      }
    ],
    "downstreamUse": [
      "EWS19 Early Warning Signal: Demanded vs Collected Ratio < 0.80",
      "Monotone constraint: lower collection ratio strictly increases default probability",
      "Ind AS 109 Stage 2 SICR (Significant Increase in Credit Risk) trigger"
    ],
    "rulesOrModels": [
      "RBI EWS19 Rule",
      "LightGBM Monotone Feature",
      "Ind AS 109 Stage 2 SICR"
    ],
    "uiLocations": [
      {
        "label": "Loan Appraisal",
        "route": "/underwrite",
        "description": "Demanded vs Collected Ratio slider & EWS19 Shortfall badge"
      },
      {
        "label": "Portfolio Console",
        "route": "/",
        "description": "Action Queue 24h triage & EWS trigger count"
      },
      {
        "label": "Borrower 360",
        "route": "/borrowers/$id",
        "description": "Debt service reliability metric & Recourse lever"
      }
    ],
    "sampleRequest": {
      "note": "Illustrative request; not the bank's contract",
      "input": {
        "customer_id": "CUST_000123",
        "account_id": "LN_000456"
      }
    },
    "sampleResponse": {
      "note": "Illustrative response; field names are DRISHTI's, not the bank's",
      "result": {
        "demanded_vs_collected_ratio": "0.75",
        "interest_overdue_amt": "1425000",
        "principal_overdue_amt": "1425000"
      }
    }
  },
  {
    "apiId": "CBS-03",
    "name": "Loan limits and drawing power history",
    "category": "Limits & Drawing Power",
    "system": "Finacle CBS",
    "endpoint": "/loans/limits-history",
    "description": "Fetches credit limit and drawing power history: approved sanction limit vs. assessed DP derived from hypothecated stock registers and debtor statements less margins.",
    "extractedFields": [
      {
        "sourceField": "Sanction limit",
        "drishtiFeature": "sanction_limit",
        "description": "Approved credit line exposure (EAD baseline)"
      },
      {
        "sourceField": "Drawing power",
        "drishtiFeature": "drawing_power",
        "description": "Current usable drawing power against verified stock"
      },
      {
        "sourceField": "Drawing power gap %",
        "drishtiFeature": "drawing_power_gap_pct",
        "description": "Percentage shortfall between sanction limit and eligible DP"
      }
    ],
    "downstreamUse": [
      "EWS18 Early Warning Signal: Drawing Power erosion gap >= 25%",
      "Working capital distress detection 6–12 months prior to formal NPA",
      "Actionable recourse lever: re-assessing stock & infusing promoter margin saves provisions"
    ],
    "rulesOrModels": [
      "RBI EWS18 Rule",
      "Monotone Credit Constraint",
      "Borrower Cure Path Recourse"
    ],
    "uiLocations": [
      {
        "label": "Loan Appraisal",
        "route": "/underwrite",
        "description": "Sanction Limit, Assessed DP & Drawing Power Erosion Gap (%)"
      },
      {
        "label": "Borrower 360",
        "route": "/borrowers/$id",
        "description": "What-If Recourse simulator ('Reduce DP Erosion' slider)"
      },
      {
        "label": "Scenario Lab",
        "route": "/scenario",
        "description": "Working capital drawdown stress response"
      }
    ],
    "sampleRequest": {
      "note": "Illustrative request; not the bank's contract",
      "input": {
        "customer_id": "CUST_000123",
        "account_id": "LN_000456"
      }
    },
    "sampleResponse": {
      "note": "Illustrative response; field names are DRISHTI's, not the bank's",
      "result": {
        "sanction_limit": "1425000",
        "drawing_power": "1425000",
        "drawing_power_gap_pct": "12.5"
      }
    }
  },
  {
    "apiId": "CBS-04",
    "name": "Loan account profile",
    "category": "Facility & Loan Profile",
    "system": "Finacle CBS",
    "endpoint": "/loans/profile",
    "description": "Complete loan profile dossier: facility type, interest rate, sanctioned tenor, branch code, sector, post-dated cheques, and restructuring history.",
    "extractedFields": [
      {
        "sourceField": "Loan id",
        "drishtiFeature": "loan_id",
        "description": "Unique facility identifier"
      },
      {
        "sourceField": "Branch code",
        "drishtiFeature": "branch_code",
        "description": "Originating branch code for controlling-office rollup"
      },
      {
        "sourceField": "Restructuring flag",
        "drishtiFeature": "restructuring_flag",
        "description": "Prior loan restructuring or moratorium concession"
      },
      {
        "sourceField": "Tenor months",
        "drishtiFeature": "tenor_months",
        "description": "Sanctioned facility tenor in months"
      },
      {
        "sourceField": "Sector",
        "drishtiFeature": "sector",
        "description": "MSME industry sector for macro vulnerability beta"
      }
    ],
    "downstreamUse": [
      "Prior restructuring EWS trigger (indicates historical credit distress)",
      "Branch network hierarchical aggregation (45 IDBI branches across 4 zones)",
      "Sector beta sensitivity in RBI macroeconomic stress scenarios"
    ],
    "rulesOrModels": [
      "Branch Org Hierarchy Model",
      "Macro Sector Beta Overlays",
      "Restructure EWS"
    ],
    "uiLocations": [
      {
        "label": "Loan Appraisal",
        "route": "/underwrite",
        "description": "CBS Quick-Fetch autofill & facility demographics"
      },
      {
        "label": "Branch Network",
        "route": "/branches",
        "description": "Zonal & regional rollups by branch code"
      },
      {
        "label": "Borrower 360",
        "route": "/borrowers/$id",
        "description": "Facility profile header & sector benchmarks"
      }
    ],
    "sampleRequest": {
      "note": "Illustrative request; not the bank's contract",
      "input": {
        "customer_id": "CUST_000123",
        "account_id": "LN_000456"
      }
    },
    "sampleResponse": {
      "note": "Illustrative response; field names are DRISHTI's, not the bank's",
      "result": {
        "loan_id": "1425000",
        "branch_code": "illustrative",
        "restructuring_flag": "illustrative",
        "tenor_months": "18",
        "sector": "1425000"
      }
    }
  },
  {
    "apiId": "CBS-05",
    "name": "Account liens and encumbrances",
    "category": "Encumbrances & Liens",
    "system": "Finacle CBS",
    "endpoint": "/accounts/liens",
    "description": "Queries encumbrances and holds: active statutory tax liens, court orders, loan margins, or frozen balances that restrict borrower liquidity.",
    "extractedFields": [
      {
        "sourceField": "Lien flag",
        "drishtiFeature": "lien_flag",
        "description": "Binary indicator for active legal or statutory lien"
      },
      {
        "sourceField": "Lien reason",
        "drishtiFeature": "lien_reason",
        "description": "Reason for hold: GST/IT statutory demand or court attachment"
      },
      {
        "sourceField": "Lien amount",
        "drishtiFeature": "lien_amount",
        "description": "Total encumbered capital"
      }
    ],
    "downstreamUse": [
      "Immediate Red RAG grade override (lien presence triggers mandatory committee review)",
      "Statutory lien Early Warning Signal",
      "Borrower cure path lever: clearing tax liens restores operational liquidity"
    ],
    "rulesOrModels": [
      "Statutory Lien Rule",
      "Credit Committee Red Gate",
      "Cure Path Action"
    ],
    "uiLocations": [
      {
        "label": "Loan Appraisal",
        "route": "/underwrite",
        "description": "Active Statutory Lien Flag toggle with Red criteria badge"
      },
      {
        "label": "Borrower 360",
        "route": "/borrowers/$id",
        "description": "Lien status chip & Cure Path checklist"
      },
      {
        "label": "Portfolio Console",
        "route": "/",
        "description": "Legal hold filter in Watchlist queue"
      }
    ],
    "sampleRequest": {
      "note": "Illustrative request; not the bank's contract",
      "input": {
        "customer_id": "CUST_000123",
        "account_id": "LN_000456"
      }
    },
    "sampleResponse": {
      "note": "Illustrative response; field names are DRISHTI's, not the bank's",
      "result": {
        "lien_flag": "illustrative",
        "lien_reason": "1425000",
        "lien_amount": "1425000"
      }
    }
  },
  {
    "apiId": "ESB-01",
    "name": "Account statement (paginated)",
    "category": "Cashflow & Statement",
    "system": "ESB Enterprise Bus",
    "endpoint": "/accounts/statements/paginated",
    "description": "Full IDBI internal CASA statement with up to 999 transactions, Dr/Cr turnover, inward cheque returns, NACH mandate bounces, and narration text.",
    "extractedFields": [
      {
        "sourceField": "EMI bounce 6m",
        "drishtiFeature": "emi_bounce_6m",
        "description": "Count of unpaid inward cheque / NACH debit returns"
      },
      {
        "sourceField": "Banking turnover",
        "drishtiFeature": "banking_turnover",
        "description": "Total monthly operational cash inflows"
      },
      {
        "sourceField": "Cashflow volatility score",
        "drishtiFeature": "cashflow_volatility_score",
        "description": "Cash flow coefficient of variation"
      }
    ],
    "downstreamUse": [
      "Monotone constraint: higher bounce count strictly increases probability of default",
      "Banking cash-flow volatility feature engineering",
      "RBI EWS NACH Return rule trigger"
    ],
    "rulesOrModels": [
      "LightGBM Monotone Bounce Constraint",
      "Cash Flow Volatility Engine",
      "RBI Cheque Return EWS"
    ],
    "uiLocations": [
      {
        "label": "Loan Appraisal",
        "route": "/underwrite",
        "description": "Cheque / NACH Bounces (Last 6M) input"
      },
      {
        "label": "Borrower 360",
        "route": "/borrowers/$id",
        "description": "Banking behavioral metrics & repayment risk"
      },
      {
        "label": "Operations Guide",
        "route": "/guide",
        "description": "Cheque bounce operational response guidelines"
      }
    ],
    "sampleRequest": {
      "note": "Illustrative request; not the bank's contract",
      "input": {
        "customer_id": "CUST_000123",
        "account_id": "LN_000456"
      }
    },
    "sampleResponse": {
      "note": "Illustrative response; field names are DRISHTI's, not the bank's",
      "result": {
        "emi_bounce_6m": "18",
        "banking_turnover": "1425000",
        "cashflow_volatility_score": "1425000"
      }
    }
  },
  {
    "apiId": "AA-01",
    "name": "Account Aggregator statement fetch",
    "category": "Account Aggregator (AA)",
    "system": "Account Aggregator",
    "endpoint": "/fiu/fetch-statement",
    "description": "Account Aggregator financial data fetch: retrieves multi-bank current account statements, GST return filings (GSTR-3B/1), and cross-institution turnover.",
    "extractedFields": [
      {
        "sourceField": "GST filing delay days",
        "drishtiFeature": "gst_filing_delay_days",
        "description": "Days delayed in filing monthly GSTR-3B"
      },
      {
        "sourceField": "Itc mismatch flag",
        "drishtiFeature": "itc_mismatch_flag",
        "description": "Input Tax Credit reconciliation mismatch between GSTR-2B and 3B"
      },
      {
        "sourceField": "Bank turnover ratio",
        "drishtiFeature": "bank_turnover_ratio",
        "description": "External bank turnover divergence vs IDBI primary account"
      }
    ],
    "downstreamUse": [
      "Alternative data & GST cash-flow lift (+0.242 AUC jump over structured bureau alone)",
      "EWS GST Mismatch trigger: flags sales diversion to non-IDBI bank accounts",
      "Ind AS 109 Forward-Looking Macro adjustment"
    ],
    "rulesOrModels": [
      "GST Reconciliation Engine",
      "Alt-Data XGBoost/LightGBM Pipeline",
      "EWS GST Divergence"
    ],
    "uiLocations": [
      {
        "label": "Loan Appraisal",
        "route": "/underwrite",
        "description": "GST Filing Delay & ITC Mismatch toggle"
      },
      {
        "label": "Borrower 360",
        "route": "/borrowers/$id",
        "description": "GST vs Banking reconciliation summary"
      },
      {
        "label": "Supplier Contagion",
        "route": "/contagion",
        "description": "Inter-firm counterparty trade network construction & payment ripple"
      },
      {
        "label": "Architecture",
        "route": "/architecture",
        "description": "Moat Staircase Phase 2 lift (+GST/AA)"
      }
    ],
    "sampleRequest": {
      "note": "Illustrative request; not the bank's contract",
      "input": {
        "customer_id": "CUST_000123",
        "account_id": "LN_000456"
      }
    },
    "sampleResponse": {
      "note": "Illustrative response; field names are DRISHTI's, not the bank's",
      "result": {
        "gst_filing_delay_days": "18",
        "itc_mismatch_flag": "illustrative",
        "bank_turnover_ratio": "0.75"
      }
    }
  },
  {
    "apiId": "CBS-06",
    "name": "Customer aggregate limits",
    "category": "Customer KYC & Limits",
    "system": "Finacle CBS",
    "endpoint": "/customers/aggregate-limits",
    "description": "Customer-level aggregate of all facilities across funded (CC/OD/TL) and non-funded (LC/BG) exposure, including customer internal rating and rating drift.",
    "extractedFields": [
      {
        "sourceField": "Exposure",
        "drishtiFeature": "ead",
        "description": "Total funded Exposure at Default"
      },
      {
        "sourceField": "Non funded exposure",
        "drishtiFeature": "non_funded_ead",
        "description": "Contingent exposure (Letters of Credit / Bank Guarantees)"
      },
      {
        "sourceField": "Prior internal rating",
        "drishtiFeature": "prior_internal_rating",
        "description": "Historical bank rating for rating drift calculation"
      }
    ],
    "downstreamUse": [
      "Total Exposure at Default (EAD) calculation for Ind AS 109 ECL = EAD × PD × LGD",
      "Funded vs non-funded exposure mix risk weighting",
      "Customer rating transition matrix monitoring"
    ],
    "rulesOrModels": [
      "Ind AS 109 ECL Model",
      "EAD Exposure Aggregator"
    ],
    "uiLocations": [
      {
        "label": "Portfolio Console",
        "route": "/",
        "description": "EAD and Total Sanctioned Book KPI tiles"
      },
      {
        "label": "Borrower 360",
        "route": "/borrowers/$id",
        "description": "Exposure & Expected Loss card"
      },
      {
        "label": "Scenario Lab",
        "route": "/scenario",
        "description": "Macro shock EAD impact calculations"
      }
    ],
    "sampleRequest": {
      "note": "Illustrative request; not the bank's contract",
      "input": {
        "customer_id": "CUST_000123",
        "account_id": "LN_000456"
      }
    },
    "sampleResponse": {
      "note": "Illustrative response; field names are DRISHTI's, not the bank's",
      "result": {
        "ead": "1425000",
        "non_funded_ead": "1425000",
        "prior_internal_rating": "1425000"
      }
    }
  },
  {
    "apiId": "CBS-07",
    "name": "Loan repayment schedule",
    "category": "Facility & Loan Profile",
    "system": "Finacle CBS",
    "endpoint": "/loans/repayment-schedule",
    "description": "Generates complete monthly amortization schedules (principal vs interest breakdown) across loan lifecycle.",
    "extractedFields": [
      {
        "sourceField": "Monthly installment",
        "drishtiFeature": "monthly_installment",
        "description": "Scheduled monthly debt service obligation"
      },
      {
        "sourceField": "Balloon risk flag",
        "drishtiFeature": "balloon_risk_flag",
        "description": "Lump-sum principal maturity risk indicator"
      }
    ],
    "downstreamUse": [
      "Discrete-time hazard model quarterly PD term structure (WHEN stress occurs)",
      "Debt Service Coverage Ratio (DSCR) validation"
    ],
    "rulesOrModels": [
      "Discrete-Time Hazard Model",
      "Cash Flow DSCR Analyzer"
    ],
    "uiLocations": [
      {
        "label": "Architecture",
        "route": "/architecture",
        "description": "Hazard model quarterly term structure panel"
      },
      {
        "label": "Borrower 360",
        "route": "/borrowers/$id",
        "description": "Amortization profile & projected risk window"
      }
    ],
    "sampleRequest": {
      "note": "Illustrative request; not the bank's contract",
      "input": {
        "customer_id": "CUST_000123",
        "account_id": "LN_000456"
      }
    },
    "sampleResponse": {
      "note": "Illustrative response; field names are DRISHTI's, not the bank's",
      "result": {
        "monthly_installment": "1425000",
        "balloon_risk_flag": "illustrative"
      }
    }
  },
  {
    "apiId": "AA-02",
    "name": "Account Aggregator consent request",
    "category": "Account Aggregator (AA)",
    "system": "Account Aggregator",
    "endpoint": "/aa/consent-init",
    "description": "Step 1 of the RBI Account Aggregator protocol: initiates customer consent request via mobile/PAN with specific data types, frequency, and expiry.",
    "extractedFields": [
      {
        "sourceField": "AA consent handle",
        "drishtiFeature": "aa_consent_handle",
        "description": "Unique tracking handle for customer consent request"
      }
    ],
    "downstreamUse": [
      "Verifiable consent audit trail under RBI Account Aggregator framework",
      "Automated triggering of AA data pipeline upon user approval"
    ],
    "rulesOrModels": [
      "RBI Consent Compliance Engine",
      "AA Data Ingestion Lifecycle"
    ],
    "uiLocations": [
      {
        "label": "Operations Guide",
        "route": "/guide",
        "description": "AA Consent protocol step-by-step SOP"
      },
      {
        "label": "Governance",
        "route": "/governance",
        "description": "Consent compliance audit logging"
      }
    ],
    "sampleRequest": {
      "note": "Illustrative request; not the bank's contract",
      "input": {
        "customer_id": "CUST_000123",
        "account_id": "LN_000456"
      }
    },
    "sampleResponse": {
      "note": "Illustrative response; field names are DRISHTI's, not the bank's",
      "result": {
        "aa_consent_handle": "1425000"
      }
    }
  },
  {
    "apiId": "ESB-02",
    "name": "Credit bureau score",
    "category": "Customer KYC & Limits",
    "system": "ESB Enterprise Bus",
    "endpoint": "Bureau enquiry via the bank's ESB",
    "description": "Sends applicant identity, contact and address details through the bank's ESB to the credit bureau and returns the bureau decision and score block. The bank's contract does not fix the score field names; the mapping below is indicative.",
    "extractedFields": [
      {
        "sourceField": "CIBIL score",
        "drishtiFeature": "cibil_score",
        "description": "Bureau score (300–900 for consumer / promoter scores)"
      }
    ],
    "downstreamUse": [
      "Bureau score input to the PD model (monotone: a higher score never raises PD)",
      "Bureau flag in the appraisal memo"
    ],
    "rulesOrModels": [
      "LightGBM Monotone Default Target"
    ],
    "uiLocations": [
      {
        "label": "Loan Appraisal",
        "route": "/underwrite",
        "description": "CIBIL score input"
      },
      {
        "label": "Borrower 360",
        "route": "/borrowers/$id",
        "description": "Bureau score in the borrower profile"
      }
    ],
    "sampleRequest": {
      "note": "Illustrative request; not the bank's contract",
      "input": {
        "customer_id": "CUST_000123",
        "account_id": "LN_000456"
      }
    },
    "sampleResponse": {
      "note": "Illustrative response; field names are DRISHTI's, not the bank's",
      "result": {
        "cibil_score": "1425000"
      }
    }
  }
];
