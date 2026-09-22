/**
 * DRISHTI domain types — mirror of the FastAPI scoring contract
 * (src/serving/api.py + src/serving/scorer.py). Kept in one place so the UI
 * and the backend can evolve against a single shape.
 */

/** Risk grade RG1 (best) … RG10 (worst). */
export type RiskGrade = "RG1" | "RG2" | "RG3" | "RG4" | "RG5" | "RG6" | "RG7" | "RG8" | "RG9" | "RG10";

export type RagBucket = "Green" | "Amber" | "Red";

export type SmaStatus = "Standard" | "SMA-0" | "SMA-1" | "SMA-2" | "NPA";

export type CoverageLevel = "full" | "provisional" | "insufficient_data";

export interface EwsTrigger {
  code: string;
  name: string;
  severity: "low" | "medium" | "high";
  detail: string;
}

export interface ReasonCode {
  feature: string;
  label: string;
  direction: "raises_risk" | "lowers_risk";
  impact: number;
  taxonomy_code: string;
}

export interface StressHorizon {
  expected_stress_month: number;
  quarter: string;
  estimated: boolean;
}

export interface RecourseLever {
  lever: string;
  description: string;
  pd_after: number;
  ecl_delta: number;
}

export interface BorrowerScore {
  loan_id: string;
  segment: string;
  pd: number;
  pd_raw?: number;
  risk_grade: RiskGrade;
  rag: RagBucket;
  sma_status: SmaStatus;
  action: string;
  cadence: string;
  owner: string;
  ead: number;
  ecl: number;
  ecl_stage?: number;
  lifetime_ecl?: number;
  currency: string;
  coverage: CoverageLevel;
  fields_defaulted: string[];
  reason_codes: ReasonCode[];
  ews_triggers: EwsTrigger[];
  stress_horizon?: StressHorizon;
  recourse?: RecourseLever[];
  /** True when the borrower actually defaulted within 12m (synthetic ground truth). */
  actual_default?: boolean;
  /** Display-only extras for the drill-down. */
  sector?: string;
  state?: string;
  ticket_size?: number;
  sub_segment?: string;
  /** Organisational placement — display/routing only, never a model input. */
  zone?: string;
  region?: string;
  branch_code?: string;
  branch_name?: string;
  /**
   * Raw canonical fields as sent to the model, echoed by
   * src.pipelines.make_ui_snapshot so the console can POST them back to
   * /score/{segment} for a live re-score. Absent → live mode is skipped.
   */
  raw?: Record<string, unknown>;
}

/**
 * Per-branch rollup for the controlling-office view. Computed over the FULL
 * held-out cohort (~12.5K accounts, ~280 per branch), not the 400 sampled
 * detail rows — branch statistics off a 400-row sample would be noise.
 */
export interface BranchSummary {
  zone: string;
  region: string;
  branch_code: string;
  branch_name: string;
  accounts: number;
  avg_pd: number;
  max_pd: number;
  flagged: number;
  flag_rate: number;
  ecl: number;
  ead: number;
  green: number;
  amber: number;
  red: number;
  /** Synthetic ground truth — lets the officer see predicted vs realised. */
  actual_default_rate: number;
}

export interface PortfolioSnapshot {
  generated_at: string;
  segment: string;
  model_card: {
    auc: number;
    capture_top10: number;
    lift_top10: number;
    brier_calibrated: number;
    base_default_rate: number;
    /** Precision among flagged loans at the operating threshold. */
    propensity_at_threshold: number;
    flag_rate: number;
    threshold: number;
    /** Measured group-fairness verdict, written by src/pipelines/run_fairness.py. */
    fairness?: {
      status: string;
      disparate_impact_ratio: number | null;
      headline_attribute?: string;
      worst_attribute?: string;
      worst_disparate_impact_ratio?: number | null;
      failing_attributes?: string[];
      all_attributes_pass?: boolean;
    };
  };
  borrowers: BorrowerScore[];
  /** Branch rollup over the full held-out cohort. */
  branches: BranchSummary[];
}

export interface DecisionRecord {
  id?: number | string;
  loan_id: string;
  segment?: string;
  decision: "accept" | "override" | "defer" | "reject";
  original_grade?: string;
  revised_grade?: string;
  override_action?: string;
  rationale?: string;
  reason?: string;
  decided_by?: string;
  officer?: string;
  role?: string;
  ts?: string;
}

export interface DecisionCreate {
  loan_id: string;
  decision: "accept" | "override" | "defer" | "reject";
  segment?: string;
  proposed_action?: string;
  proposed_sma?: string;
  pd?: number;
  risk_grade?: string;
  original_grade?: string;
  revised_grade?: string;
  override_action?: string;
  rationale?: string;
  decided_by?: string;
  officer?: string;
  role?: string;
}

export interface GovernanceDriftRecord {
  id: number;
  run_id?: string;
  timestamp?: string;
  segment: string;
  overall_psi: number;
  max_feature_psi?: number;
  alert_triggered: boolean;
  features_drifted?: string | string[] | Record<string, number>;
  fairness_disparate_impact?: string | Record<string, number>;
}

export interface GovernanceMetrics {
  segment: string;
  auc: number;
  brier: number;
  capture_top10: number;
  lift_top10: number;
  base_default_rate: number;
  psi_overall: number;
  psi_status: string;
  psi_threshold: number;
  fairness_status: string;
  disparate_impact_ratio: number;
  refuse_to_score_coverage_rate: number;
  ecl_staging_summary?: {
    stage_1_pct: number;
    stage_2_pct: number;
    stage_3_pct: number;
  };
}

export interface UnderwriteSubmitPayload {
  loan_id: string;
  segment?: string;
  sanction_limit: number;
  drawing_power: number;
  cibil_score?: number;
  demanded_vs_collected_ratio?: number;
  dpd?: number;
  emi_bounce_6m?: number;
  lien_flag?: number;
  restructuring_flag?: number;
  gst_filing_delay_days?: number;
  itc_mismatch_flag?: number;
  sector?: string;
  sub_segment?: string;
  state?: string;
  branch_code?: string;
  branch_name?: string;
  zone?: string;
  region?: string;
  decision?: "accept" | "override" | "defer" | "reject";
  revised_grade?: string;
  override_action?: string;
  rationale?: string;
  officer?: string;
  role?: string;
}

export interface PortfolioApiResponse {
  borrowers: BorrowerScore[];
  items?: BorrowerScore[];
  total: number;
  limit: number;
  offset: number;
}

export interface ScenarioSimulateParams {
  repo_bps: number;
  gdp_shock_pct: number;
  sector_stress?: number;
  target_sector?: string;
  branch_code?: string;
}

export interface ScenarioGradeResult {
  grade: string;
  base: number;
  stress: number;
  count: number;
  avg_pd_base: number;
  avg_pd_stress: number;
}

export interface ScenarioSectorResult {
  sector: string;
  beta: number;
  base_ecl: number;
  stressed_ecl: number;
  uplift_pct: number;
  accounts: number;
}

export interface ScenarioSimulateResponse {
  status: string;
  repo_bps: number;
  gdp_shock_pct: number;
  sector_stress: number;
  target_sector?: string;
  total_accounts: number;
  baseline_ecl: number;
  stressed_ecl: number;
  ecl_uplift_pct: number;
  weighted_avg_pd_base: number;
  weighted_avg_pd_stressed: number;
  by_grade: ScenarioGradeResult[];
  by_sector: ScenarioSectorResult[];
}

export interface ContagionSimulateParams {
  transmission_rate?: number;
  stress_threshold?: number;
  shock_seeds?: string[];
  max_rounds?: number;
  branch_code?: string;
  sector?: string;
}

export interface ContagionScatterPoint {
  id: string;
  x: number;
  y: number;
  base_pd?: number;
  z: number;
  base_ecl?: number;
  rag: RagBucket;
  base_rag?: RagBucket;
  status: "initial_stressed" | "contagion_infected" | "stable";
  stressed_neighbors?: number;
  pagerank?: number;
  sector?: string;
  state?: string;
}

export interface ContagionCommunity {
  name: string;
  members_count: number;
  avgPd: number;
  baseAvgPd?: number;
  redCount: number;
  ecl: number;
  infected_count?: number;
}

export interface ContagionHub {
  loan_id: string;
  stressed_neighbors: number;
  pagerank: number;
  n_links: number;
  downstream_ead: number;
  pd_12m: number;
  sector: string;
}

export interface ContagionRoundRecord {
  round: number;
  stressed_count: number;
  newly_infected: number;
  total_ecl: number;
}

export interface ContagionSimulateResponse {
  status: string;
  transmission_rate: number;
  stress_threshold: number;
  total_nodes: number;
  total_edges: number;
  initial_stressed_nodes: number;
  final_stressed_nodes: number;
  contagion_spread_count: number;
  baseline_ecl: number;
  stressed_ecl: number;
  cascade_ecl_delta: number;
  rounds_executed: number;
  rounds_history: ContagionRoundRecord[];
  top_contagion_hubs: ContagionHub[];
  communities: ContagionCommunity[];
  scatter: ContagionScatterPoint[];
}



