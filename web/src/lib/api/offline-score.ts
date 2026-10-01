/**
 * Offline reference scorer for the Loan Appraisal module.
 *
 * The console is deployed three ways: the sandbox EC2 instance (FastAPI behind
 * `/api`), a static export on Hugging Face Spaces (no backend at all), and a
 * local dev server. Every other call in the data facade already degrades to the
 * snapshot when `/api` is unreachable; `scoreRawBorrower` was the one exception,
 * and on the static export it returned null — so the appraisal screen sat on its
 * "Appraisal Engine Ready" placeholder with no verdict and no error. This module
 * closes that gap so the module always answers.
 *
 * What is and is not approximated:
 *
 * - The PD is an approximation. It is a monotone log-odds model over the fields
 *   the appraisal form collects, not the trained LightGBM/CatBoost blend, and it
 *   is anchored on the snapshot's own PD distribution so it lands in a plausible
 *   range rather than an invented one. Callers must label it — `status` comes
 *   back as `"fallback"` precisely so the UI can say so.
 * - Everything downstream of the PD is exact. Grade edges, RAG buckets, the SMA
 *   playbook, the Ind AS 109 staging and the ECL formula are transcribed from
 *   `src/framework/interpretation.py`, and the early-warning rules from
 *   `src/explain/ews_rules.py`, thresholds included. The interpretation a credit
 *   officer sees is therefore the production one; only the probability feeding it
 *   is approximate.
 *
 * Keep the constants below in step with those two Python modules.
 */

export interface OfflineScoreInput {
  loan_id?: string;
  ticket_size?: number;
  sanction_limit?: number;
  drawing_power?: number;
  drawing_power_gap_pct?: number;
  demanded_vs_collected_ratio?: number;
  cibil_score?: number;
  dpd?: number;
  emi_bounce_6m?: number;
  lien_flag?: number;
  restructuring_flag?: number;
  sector?: string;
  sub_segment?: string;
  state?: string;
  gst_filing_delay_days?: number;
  itc_mismatch_flag?: number;
  cashflow_volatility?: number;
  balance_trend_pct?: number;
  [k: string]: unknown;
}

// Upper edge, exclusive. Mirrors _GRADE_EDGES in src/framework/interpretation.py.
const GRADE_EDGES: Array<[string, number]> = [
  ["RG1", 0.02], ["RG2", 0.04], ["RG3", 0.07], ["RG4", 0.11], ["RG5", 0.16],
  ["RG6", 0.23], ["RG7", 0.32], ["RG8", 0.45], ["RG9", 0.65], ["RG10", 1.01],
];

const RAG_BY_GRADE: Record<string, "Green" | "Amber" | "Red"> = {
  RG1: "Green", RG2: "Green", RG3: "Green", RG4: "Green",
  RG5: "Amber", RG6: "Amber", RG7: "Amber",
  RG8: "Red", RG9: "Red", RG10: "Red",
};

interface Action {
  sma_watch: string;
  action: string;
  cadence: string;
  owner: string;
}

const PLAYBOOK: Record<string, Action> = {
  RG1: { sma_watch: "Standard", action: "Business as usual; eligible for cross-sell / limit increase", cadence: "Annual review", owner: "Relationship manager" },
  RG2: { sma_watch: "Standard", action: "Business as usual; monitor at portfolio level", cadence: "Annual review", owner: "Relationship manager" },
  RG3: { sma_watch: "Standard", action: "Standard monitoring; no action", cadence: "Semi-annual review", owner: "Relationship manager" },
  RG4: { sma_watch: "Standard", action: "Watch trend; verify latest financials", cadence: "Quarterly review", owner: "Credit analyst" },
  RG5: { sma_watch: "SMA-0 watch", action: "Proactive engagement; confirm cash-flow health", cadence: "Monthly review", owner: "Credit analyst" },
  RG6: { sma_watch: "SMA-0 watch", action: "Enhanced monitoring; request updated stock/GST statements", cadence: "Monthly review", owner: "Credit analyst" },
  RG7: { sma_watch: "SMA-1 watch", action: "Restructuring assessment; covenant / collateral review", cadence: "Fortnightly review", owner: "Watchlist committee" },
  RG8: { sma_watch: "SMA-2 watch", action: "Site visit + restructuring offer; tighten limits", cadence: "Fortnightly review", owner: "Watchlist committee" },
  RG9: { sma_watch: "High-slippage risk", action: "Escalate to recovery; provision proactively; RFA review", cadence: "Weekly review", owner: "Recovery / stressed-assets" },
  RG10: { sma_watch: "High-slippage risk", action: "Initiate collections / recovery; maximise provisioning", cadence: "Weekly review", owner: "Recovery / stressed-assets" },
};

const DEFAULT_LGD = 0.45;

export function assignGrade(pd: number): string {
  for (const [grade, edge] of GRADE_EDGES) {
    if (pd < edge) return grade;
  }
  return "RG10";
}

export function assignEclStage(grade: string): number {
  if (["RG1", "RG2", "RG3", "RG4"].includes(grade)) return 1;
  if (["RG5", "RG6", "RG7", "RG8"].includes(grade)) return 2;
  return 3;
}

/** Ind AS 109 three-stage ECL, including the RBI floors on stage 3. */
export function indAs109Ecl(pd: number, ead: number, grade: string, lgd = DEFAULT_LGD) {
  const stage = assignEclStage(grade);
  const ecl12m = pd * lgd * ead;
  const lifetimeEcl = Math.min(1.0, 2.5 * pd) * lgd * ead;
  let ecl: number;
  if (stage === 1) {
    ecl = ecl12m;
  } else if (stage === 2) {
    ecl = lifetimeEcl;
  } else {
    const rbiFloor = grade === "RG10" ? 0.5 : 0.25;
    ecl = Math.max(lifetimeEcl, rbiFloor * ead);
  }
  return { ecl, ecl_stage: stage, lifetime_ecl: lifetimeEcl, ecl_12m: ecl12m };
}

// Sector risk multipliers, shared with the scenario-stress fallback.
const SECTOR_BETAS: Record<string, number> = {
  construction: 1.4, hospitality: 1.4, auto_components: 1.3, auto_ancillary: 1.3,
  textiles: 1.25, transport: 1.2, retail_trade: 1.1, agri_processing: 1.0,
  food_processing: 0.85, it_services: 0.7, pharma: 0.6, other: 1.0,
};

const num = (v: unknown, dflt = 0): number =>
  typeof v === "number" && Number.isFinite(v) ? v : dflt;

/**
 * Additive log-odds terms. Every weight is signed so the direction matches the
 * monotone constraints the trained model is fitted under — more bounces, more
 * DPD, a bigger drawing-power gap or a worse bureau score can only raise PD.
 * Each term doubles as a reason code, so the explanation shown to the officer is
 * the actual arithmetic rather than a separate narrative.
 */
interface Term {
  feature: string;
  code: string;
  label: string;
  contribution: number;
}

function logOddsTerms(p: OfflineScoreInput): Term[] {
  const terms: Term[] = [];
  const add = (feature: string, code: string, label: string, contribution: number) => {
    if (Math.abs(contribution) > 1e-6) terms.push({ feature, code, label, contribution });
  };

  // Bureau score: 300-900. Centred at 720, ~0.9 log-odds per 100 points below.
  const cibil = num(p.cibil_score, 720);
  add("cibil_score", "FINANCIAL_HEALTH", "Credit bureau score & financial health",
    ((720 - Math.max(300, Math.min(900, cibil))) / 100) * 0.9);

  // Days past due: the single strongest behavioural signal.
  const dpd = Math.max(0, num(p.dpd));
  add("dpd", "REPAYMENT_BEHAVIOUR", "Repayment behaviour (EMI / utilisation)",
    Math.min(2.4, Math.sqrt(dpd) * 0.42));

  const bounces = Math.max(0, num(p.emi_bounce_6m));
  add("emi_bounce_6m", "REPAYMENT_BEHAVIOUR", "Repayment behaviour (EMI / utilisation)",
    Math.min(1.8, bounces * 0.45));

  // Drawing-power erosion against sanction limit.
  const sanction = Math.max(1, num(p.sanction_limit, num(p.ticket_size, 1)));
  const gap = p.drawing_power_gap_pct != null
    ? Math.max(0, num(p.drawing_power_gap_pct))
    : Math.max(0, ((sanction - num(p.drawing_power, sanction)) / sanction) * 100);
  add("drawing_power_gap_pct", "LIQUIDITY_WORKING_CAPITAL", "Working capital & drawing-power limits",
    Math.min(1.5, (gap / 25) * 0.55));

  // Collection shortfall against demand.
  const ratio = num(p.demanded_vs_collected_ratio, 1.0);
  add("demanded_vs_collected_ratio", "DEBT_SERVICE_COVERAGE", "Debt service & collection coverage",
    Math.min(1.6, Math.max(0, 1.0 - ratio) * 4.0));

  add("gst_filing_delay_days", "GST_COMPLIANCE", "GST filing / compliance",
    Math.min(0.9, (Math.max(0, num(p.gst_filing_delay_days)) / 30) * 0.5));

  add("itc_mismatch_flag", "GST_COMPLIANCE", "GST filing / compliance",
    num(p.itc_mismatch_flag) >= 1 ? 0.35 : 0);

  add("cashflow_volatility", "CASHFLOW_LIQUIDITY", "Cash-flow & liquidity stress",
    Math.min(1.0, Math.max(0, num(p.cashflow_volatility, 0.15) - 0.15) * 1.8));

  const balTrend = num(p.balance_trend_pct, 0);
  add("balance_trend_pct", "CASHFLOW_LIQUIDITY", "Cash-flow & liquidity stress",
    Math.min(0.8, Math.max(0, -balTrend) / 10 * 0.3));

  add("lien_flag", "MANAGEMENT_LEGAL", "Legal encumbrance & account liens",
    num(p.lien_flag) >= 1 ? 0.7 : 0);

  add("restructuring_flag", "FACILITY_STRUCTURE", "Facility structure & terms",
    num(p.restructuring_flag) >= 1 ? 0.8 : 0);

  const beta = SECTOR_BETAS[String(p.sector ?? "other").toLowerCase()] ?? 1.0;
  add("sector", "SECTOR_GEO", "Sector / geography risk", Math.log(beta));

  return terms;
}

/** RBI early-warning rules evaluable from the appraisal form's own fields. */
function ewsSignals(p: OfflineScoreInput) {
  const signals: Array<{ code: string; label: string; severity: string }> = [];
  const push = (code: string, label: string, severity: string, hit: boolean) => {
    if (hit) signals.push({ code, label, severity });
  };
  const sanction = Math.max(1, num(p.sanction_limit, num(p.ticket_size, 1)));
  const gap = p.drawing_power_gap_pct != null
    ? num(p.drawing_power_gap_pct)
    : ((sanction - num(p.drawing_power, sanction)) / sanction) * 100;

  push("EWS01", "Frequent cheque/EMI bounces (>=2 in 6 months)", "high", num(p.emi_bounce_6m) >= 2);
  push("EWS03", "Delay in statutory / GST return filing (>30 days)", "medium", num(p.gst_filing_delay_days) >= 30);
  push("EWS04", "Input-tax-credit mismatch / tax irregularity", "medium", num(p.itc_mismatch_flag) >= 1);
  push("EWS06", "Declining bank balances (trend < -10%)", "medium", num(p.balance_trend_pct, 0) <= -10);
  push("EWS07", "Erratic cash flows (high volatility)", "medium", num(p.cashflow_volatility) >= 0.5);
  push("EWS16", "Active lien, encumbrance or statutory attachment on account", "high", num(p.lien_flag) >= 1);
  push("EWS17", "Prior loan restructuring / rescheduling history flagged", "high", num(p.restructuring_flag) >= 1);
  push("EWS18", "Significant drawing-power erosion vs sanction limit (>=25%)", "high", gap >= 25);
  push("EWS19", "Severe debt-service collection shortfall (<80% collected)", "high", num(p.demanded_vs_collected_ratio, 1) < 0.8);

  const order = { high: 0, medium: 1, low: 2 } as Record<string, number>;
  signals.sort((a, b) => (order[a.severity] ?? 3) - (order[b.severity] ?? 3));
  const maxSeverity = signals.length ? signals[0].severity : "none";
  return { n_triggers: signals.length, max_severity: maxSeverity, signals };
}

// Intercept placing a clean book-standard borrower near the snapshot's own
// central PD, so offline verdicts sit in the same range as live ones.
const BASE_LOG_ODDS = -4.0;

/**
 * Score a borrower without the API. Returns the same shape the FastAPI
 * `/score/{segment}` endpoint returns, with `status: "fallback"` so the caller
 * can label the verdict as an offline approximation.
 */
export function offlineScore(segment: string, p: OfflineScoreInput) {
  const terms = logOddsTerms(p);
  const z = BASE_LOG_ODDS + terms.reduce((s, t) => s + t.contribution, 0);
  const pd = Math.min(0.97, Math.max(0.002, 1 / (1 + Math.exp(-z))));

  const grade = assignGrade(pd);
  const play = PLAYBOOK[grade];
  const ead = Math.max(0, num(p.sanction_limit, num(p.ticket_size, 0)));
  const ecl = indAs109Ecl(pd, ead, grade);

  // Largest absolute movers first — the same ordering the SHAP panel uses.
  const reason_codes = terms
    .slice()
    .sort((a, b) => Math.abs(b.contribution) - Math.abs(a.contribution))
    .slice(0, 6)
    .map((t) => ({
      feature: t.feature,
      code: t.code,
      label: t.label,
      shap: Math.round(t.contribution * 1e4) / 1e4,
      effect: t.contribution >= 0 ? "increases risk" : "decreases risk",
    }));

  return {
    segment,
    status: "fallback",
    provisional: true,
    pd_12m: Math.round(pd * 1e4) / 1e4,
    risk_grade: grade,
    rag: RAG_BY_GRADE[grade],
    risk_band: RAG_BY_GRADE[grade] === "Green" ? "low" : RAG_BY_GRADE[grade] === "Amber" ? "elevated" : "high",
    sma_watch: play.sma_watch,
    recommended_action: play.action,
    review_cadence: play.cadence,
    action_owner: play.owner,
    ecl: Math.round(ecl.ecl * 100) / 100,
    ecl_stage: ecl.ecl_stage,
    lifetime_ecl: Math.round(ecl.lifetime_ecl * 100) / 100,
    lgd_assumed: DEFAULT_LGD,
    ead,
    currency: "INR",
    coverage: {
      status: "offline",
      detail: "Scored by the offline reference model; live scoring API unreachable.",
    },
    reason_codes,
    ews: ewsSignals(p),
  };
}
