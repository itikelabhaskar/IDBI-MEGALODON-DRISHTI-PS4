import type {
  BorrowerScore,
  BranchSummary,
  PortfolioSnapshot,
  DecisionCreate,
  DecisionRecord,
  GovernanceDriftRecord,
  GovernanceMetrics,
  UnderwriteSubmitPayload,
  PortfolioApiResponse,
  ScenarioSimulateParams,
  ScenarioSimulateResponse,
  ContagionSimulateParams,
  ContagionSimulateResponse,
} from "../types";
import snapshotJson from "../data/portfolio-snapshot.json";

/**
 * Data facade for the console.
 *
 * Snapshot (default): `web/src/lib/data/portfolio-snapshot.json`, produced by
 *   `src.pipelines.make_ui_snapshot` scoring the India MSME book through
 *   RiskScorer. It carries the *explained* payload — reason codes, EWS
 *   triggers, coverage — so the whole console works with nothing running.
 *
 * Live: Connected to the operational SQLite / RDS master database and FastAPI scoring
 *   service proxied at `/api` (or directly available).
 *   Adds live CRUD underwriting, batch scoring persistence, branch network rollups,
 *   drift tracking, and HITL audit history.
 *
 * Live is strictly additive. Every call falls back to the snapshot row on any
 * error, so a dead API degrades to the offline demo rather than a broken page.
 */

const snapshot = snapshotJson as unknown as PortfolioSnapshot;

async function fetchWithTimeout(
  input: RequestInfo | URL,
  init?: RequestInit,
  timeoutMs = 8000
): Promise<Response> {
  const controller = new AbortController();
  const id = setTimeout(() => controller.abort(), timeoutMs);
  if (init?.signal) {
    if (init.signal.aborted) {
      controller.abort();
    } else {
      init.signal.addEventListener("abort", () => controller.abort());
    }
  }
  try {
    return await fetch(input, {
      ...init,
      signal: controller.signal,
    });
  } finally {
    clearTimeout(id);
  }
}

export interface DataSource {
  mode: "snapshot" | "live";
}

export function getSnapshot(): PortfolioSnapshot {
  return snapshot;
}

export async function fetchPortfolio(params?: {
  limit?: number;
  offset?: number;
  query?: string;
  rag?: string;
  segment?: string;
  branch_code?: string;
  sort_by?: string;
}): Promise<{
  borrowers: BorrowerScore[];
  total: number;
  limit: number;
  offset: number;
  source: DataSource;
}> {
  try {
    const q = new URLSearchParams();
    if (params?.limit != null) q.set("limit", String(params.limit));
    if (params?.offset != null) q.set("offset", String(params.offset));
    if (params?.query) q.set("query", params.query);
    if (params?.rag && params.rag !== "all") q.set("rag", params.rag);
    if (params?.segment && params.segment !== "all") q.set("segment", params.segment);
    if (params?.branch_code && params.branch_code !== "all") q.set("branch_code", params.branch_code);
    if (params?.sort_by) q.set("sort_by", params.sort_by);

    const qs = q.toString();
    const url = qs ? `/api/portfolio?${qs}` : "/api/portfolio";
    const res = await fetchWithTimeout(url);
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    const data = (await res.json()) as PortfolioApiResponse;
    const borrowers = data.borrowers || data.items || [];
    return {
      borrowers,
      total: data.total ?? borrowers.length,
      limit: data.limit ?? 500,
      offset: data.offset ?? 0,
      source: { mode: "live" },
    };
  } catch {
    let bList = snapshot.borrowers;
    if (params?.branch_code && params.branch_code !== "all") {
      bList = bList.filter((b) => b.branch_code === params.branch_code);
    }
    if (params?.rag && params.rag !== "all") {
      bList = bList.filter((b) => b.rag === params.rag);
    }
    if (params?.segment && params.segment !== "all") {
      bList = bList.filter((b) => b.segment === params.segment);
    }
    return {
      borrowers: bList,
      total: bList.length,
      limit: params?.limit ?? 500,
      offset: params?.offset ?? 0,
      source: { mode: "snapshot" },
    };
  }
}

export async function listBorrowers(params?: {
  branch_code?: string;
  limit?: number;
}): Promise<{
  borrowers: BorrowerScore[];
  source: DataSource;
}> {
  try {
    const q = new URLSearchParams();
    q.set("limit", String(params?.limit ?? 500));
    if (params?.branch_code && params.branch_code !== "all") {
      q.set("branch_code", params.branch_code);
    }
    const res = await fetchWithTimeout(`/api/portfolio?${q.toString()}`);
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    const data = (await res.json()) as PortfolioApiResponse;
    const borrowers = data.borrowers || data.items || [];
    if (borrowers.length > 0) {
      return { borrowers, source: { mode: "live" } };
    }
  } catch {
    // Fallback to snapshot
  }
  let fallback = snapshot.borrowers;
  if (params?.branch_code && params.branch_code !== "all") {
    fallback = fallback.filter((b) => b.branch_code === params.branch_code);
  }
  return { borrowers: fallback, source: { mode: "snapshot" } };
}

export async function fetchPortfolioSummary(branchCode?: string): Promise<any> {
  try {
    const url = branchCode && branchCode !== "all"
      ? `/api/portfolio/summary?branch_code=${encodeURIComponent(branchCode)}`
      : "/api/portfolio/summary";
    const res = await fetchWithTimeout(url);
    if (!res.ok) return null;
    return await res.json();
  } catch {
    return null;
  }
}

export function getBorrower(id: string): BorrowerScore | undefined {
  return snapshot.borrowers.find((b) => b.loan_id === id);
}

export async function fetchBorrower(id: string): Promise<BorrowerScore | null> {
  try {
    const res = await fetchWithTimeout(`/api/borrowers/${encodeURIComponent(id)}`);
    if (!res.ok) return null;
    return (await res.json()) as BorrowerScore;
  } catch {
    return null;
  }
}

/** Branch rollup, riskiest first (the controlling office's reading order). */
export function listBranches(): BranchSummary[] {
  return snapshot.branches ?? [];
}

export async function fetchBranches(): Promise<BranchSummary[]> {
  try {
    const res = await fetchWithTimeout("/api/branches");
    if (!res.ok) return snapshot.branches ?? [];
    const data = (await res.json()) as BranchSummary[];
    if (Array.isArray(data) && data.length > 0) return data;
    return snapshot.branches ?? [];
  } catch {
    return snapshot.branches ?? [];
  }
}

export async function submitUnderwriting(
  payload: UnderwriteSubmitPayload,
): Promise<{ status: string; loan_id: string; borrower?: any; decision?: any } | null> {
  try {
    const res = await fetchWithTimeout("/api/underwrite/submit", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(payload),
    });
    if (!res.ok) return null;
    return await res.json();
  } catch {
    return null;
  }
}

export async function uploadBatch(
  records: Record<string, unknown>[],
  segment: string = "msme_idbi",
): Promise<{
  status: string;
  run_id: string;
  total_accounts: number;
  high_severe_count: number;
  total_ecl: number;
  mean_pd: number;
  max_pd: number;
  grade_distribution?: Record<string, number>;
  scored_records: any[];
} | null> {
  try {
    const res = await fetchWithTimeout("/api/batch/upload", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ records, segment }),
    });
    if (!res.ok) return null;
    return await res.json();
  } catch {
    return null;
  }
}

export async function fetchGovernanceDrift(limit: number = 50): Promise<GovernanceDriftRecord[]> {
  try {
    const res = await fetchWithTimeout(`/api/governance/drift?limit=${limit}`);
    if (!res.ok) return [];
    return (await res.json()) as GovernanceDriftRecord[];
  } catch {
    return [];
  }
}

export async function fetchGovernanceMetrics(): Promise<GovernanceMetrics | null> {
  try {
    const res = await fetchWithTimeout("/api/governance/metrics");
    if (!res.ok) return null;
    return (await res.json()) as GovernanceMetrics;
  } catch {
    return null;
  }
}

export async function fetchAllDecisions(limit: number = 50): Promise<DecisionRecord[]> {
  try {
    const res = await fetchWithTimeout(`/api/decisions?limit=${limit}`);
    if (!res.ok) return [];
    return (await res.json()) as DecisionRecord[];
  } catch {
    return [];
  }
}


/** Shape returned by POST /score/{segment} in src/serving/api.py. */
interface ScoreResponse {
  status?: string;
  pd_12m?: number;
  risk_grade?: string;
  rag?: string;
  sma_watch?: string;
  recommended_action?: string;
  review_cadence?: string;
  action_owner?: string;
  ecl?: number;
  ecl_stage?: number;
  lifetime_ecl?: number;
  currency?: string;
  coverage?: { status?: string };
  reason_codes?: Array<{
    feature: string;
    code?: string;
    label?: string;
    shap?: number;
    effect?: string;
  }>;
  ews?: {
    signals?: Array<{ code: string; label: string; severity: string }>;
  };
  stress_horizon?: {
    stress_horizon_m?: number | null;
    onset_month?: number;
    estimated?: boolean;
  };
  cure_path?: {
    baseline_pd: number;
    achieved_pd: number;
    target_met: boolean;
    baseline_ecl?: number;
    achieved_ecl?: number;
    changes: Array<{ change: string; pd_after: number; ecl_after?: number }>;
  };
}

export interface LiveBorrower extends BorrowerScore {
  curePath?: ScoreResponse["cure_path"];
}

const SEVERITY_DETAIL: Record<string, string> = {
  high: "High-severity RBI early-warning signal — act now.",
  medium: "Medium-severity signal — verify at the next review.",
  low: "Low-severity signal — monitor.",
};

function mergeLive(base: BorrowerScore, res: ScoreResponse): LiveBorrower {
  return {
    ...base,
    pd: res.pd_12m ?? base.pd,
    risk_grade: (res.risk_grade as BorrowerScore["risk_grade"]) ?? base.risk_grade,
    rag: (res.rag as BorrowerScore["rag"]) ?? base.rag,
    sma_status: (res.sma_watch as BorrowerScore["sma_status"]) ?? base.sma_status,
    action: res.recommended_action ?? base.action,
    cadence: res.review_cadence ?? base.cadence,
    owner: res.action_owner ?? base.owner,
    ecl: res.ecl ?? base.ecl,
    ecl_stage: res.ecl_stage ?? base.ecl_stage,
    lifetime_ecl: res.lifetime_ecl ?? base.lifetime_ecl,
    currency: res.currency ?? base.currency,
    coverage: (res.coverage?.status as BorrowerScore["coverage"]) ?? base.coverage,
    reason_codes: (res.reason_codes ?? []).map((r) => ({
      feature: r.feature,
      label: r.label || r.feature,
      direction: String(r.effect ?? "").includes("increases") ? "raises_risk" : "lowers_risk",
      impact: r.shap ?? 0,
      taxonomy_code: r.code ?? "OTHER",
    })),
    ews_triggers: (res.ews?.signals ?? []).map((s) => ({
      code: s.code,
      name: s.label,
      severity: s.severity as "low" | "medium" | "high",
      detail: SEVERITY_DETAIL[s.severity] ?? "",
    })),
    stress_horizon: res.stress_horizon
      ? {
          expected_stress_month: res.stress_horizon.stress_horizon_m ?? 0,
          quarter: "",
          estimated: res.stress_horizon.estimated ?? true,
        }
      : base.stress_horizon,
    curePath: res.cure_path,
  };
}

/** True when the scoring API answers /health. Used to show the live/offline pill. */
export async function probeApi(signal?: AbortSignal): Promise<boolean> {
  try {
    const res = await fetchWithTimeout("/api/health", { signal });
    return res.ok;
  } catch {
    return false;
  }
}

/**
 * Re-score one borrower through the live API, returning the snapshot row
 * unchanged if anything goes wrong (API down, model not trained, 422 coverage
 * refusal). Never throws.
 */
export async function scoreBorrowerLive(
  id: string,
  signal?: AbortSignal,
): Promise<{ borrower: LiveBorrower; source: DataSource } | null> {
  const base = getBorrower(id);
  if (!base) return null;

  const raw = (base as BorrowerScore & { raw?: Record<string, unknown> }).raw;
  if (!raw || Object.keys(raw).length === 0) {
    return { borrower: base, source: { mode: "snapshot" } };
  }

  try {
    const res = await fetchWithTimeout(`/api/score/${base.segment}?explain=true`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ loan_id: base.loan_id, ...raw }),
      signal,
    });
    if (!res.ok) return { borrower: base, source: { mode: "snapshot" } };
    const json = (await res.json()) as ScoreResponse;
    if (json.status !== "ok") return { borrower: base, source: { mode: "snapshot" } };
    return { borrower: mergeLive(base, json), source: { mode: "live" } };
  } catch {
    return { borrower: base, source: { mode: "snapshot" } };
  }
}

/**
 * Submit a human-in-the-loop credit committee decision.
 */
export async function createDecision(decision: DecisionCreate): Promise<boolean> {
  try {
    const res = await fetchWithTimeout("/api/decisions", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(decision),
    });
    return res.ok;
  } catch {
    return false;
  }
}

/**
 * Fetch decision audit trail for a specific loan ID.
 */
export async function fetchDecisions(loanId: string): Promise<DecisionRecord[]> {
  try {
    const res = await fetchWithTimeout(`/api/decisions/${encodeURIComponent(loanId)}`);
    if (!res.ok) return [];
    return (await res.json()) as DecisionRecord[];
  } catch {
    return [];
  }
}

/**
 * Direct single-borrower underwriting scoring via FastAPI.
 */
export async function scoreRawBorrower(
  segment: string,
  payload: Record<string, unknown>,
  signal?: AbortSignal,
): Promise<ScoreResponse | null> {
  try {
    const res = await fetchWithTimeout(`/api/score/${segment}?explain=true&memo=true`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(payload),
      signal,
    });
    if (!res.ok) return null;
    return (await res.json()) as ScoreResponse;
  } catch {
    return null;
  }
}

/**
 * Direct batch scoring helper for arbitrary records.
 */
export async function scoreBatchRecords(
  segment: string,
  records: Record<string, unknown>[],
): Promise<ScoreResponse[]> {
  const results: ScoreResponse[] = [];
  for (const rec of records) {
    try {
      const res = await fetchWithTimeout(`/api/score/${segment}?explain=true`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(rec),
      });
      if (res.ok) {
        results.push((await res.json()) as ScoreResponse);
      } else {
        results.push({
          status: "error",
          pd_12m: 0.0,
          risk_grade: "UNRATED",
          rag: "Amber",
          sma_watch: "Scoring Offline",
          ecl_stage: 1,
        });
      }
    } catch {
      results.push({
        status: "error",
        pd_12m: 0.0,
        risk_grade: "UNRATED",
        rag: "Amber",
        sma_watch: "Scoring Offline",
        ecl_stage: 1,
      });
    }
  }
  return results;
}

const FALLBACK_SECTOR_BETAS: Record<string, number> = {
  construction: 1.4,
  hospitality: 1.4,
  auto_components: 1.3,
  textiles: 1.25,
  transport: 1.2,
  retail_trade: 1.1,
  agri_processing: 1.0,
  food_processing: 0.85,
  it_services: 0.7,
  pharma: 0.6,
  other: 1.0,
};

/**
 * Execute scenario stress test against live database or snapshot fallback.
 */
export async function simulateScenario(
  params: ScenarioSimulateParams,
  signal?: AbortSignal,
): Promise<ScenarioSimulateResponse> {
  try {
    const res = await fetchWithTimeout("/api/scenario/simulate", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(params),
      signal,
    });
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    return (await res.json()) as ScenarioSimulateResponse;
  } catch {
    // Client-side fallback computation
    const borrowers = snapshot.borrowers;
    const repoBps = params.repo_bps;
    const gdpDrop = params.gdp_shock_pct;

    let baseSum = 0;
    let stressSum = 0;
    const gradeMap = new Map<string, { base: number; stress: number; count: number; sumPdBase: number; sumPdStress: number }>();
    const sectorMap = new Map<string, { base: number; stress: number; count: number; beta: number }>();

    for (let i = 1; i <= 10; i++) {
      gradeMap.set(`RG${i}`, { base: 0, stress: 0, count: 0, sumPdBase: 0, sumPdStress: 0 });
    }

    for (const b of borrowers) {
      const sectorKey = b.sector ?? "other";
      const beta = FALLBACK_SECTOR_BETAS[sectorKey] ?? 1.0;
      const baseEcl = b.ecl || (b.ead * b.pd * 0.45);
      
      let stressedPd = b.pd;
      let stressedEcl = baseEcl;

      if (repoBps > 0 || gdpDrop > 0 || (params.sector_stress ?? 0) > 0) {
        const z = Math.log(Math.max(b.pd, 1e-4) / (1 - Math.max(b.pd, 1e-4)));
        const targetNorm = (params.target_sector || "all_cyclical").toLowerCase();
        let sectorShockMult = 0;
        if ((params.sector_stress ?? 0) > 0) {
          if (targetNorm === "all_cyclical" || targetNorm === "all") {
            sectorShockMult = beta >= 1.2 ? beta * (params.sector_stress ?? 0) : 0;
          } else if (sectorKey.toLowerCase() === targetNorm) {
            sectorShockMult = beta * (params.sector_stress ?? 0);
          }
        }
        const shift = (0.002 * repoBps + 0.08 * gdpDrop) * beta + 2.0 * sectorShockMult;
        stressedPd = 1 / (1 + Math.exp(-(z + shift)));
        const scale = b.pd > 1e-6 ? stressedPd / b.pd : 1.0;
        stressedEcl = baseEcl * scale;
      }

      baseSum += baseEcl;
      stressSum += stressedEcl;

      const gItem = gradeMap.get(b.risk_grade) ?? { base: 0, stress: 0, count: 0, sumPdBase: 0, sumPdStress: 0 };
      gItem.base += baseEcl;
      gItem.stress += stressedEcl;
      gItem.count += 1;
      gItem.sumPdBase += b.pd;
      gItem.sumPdStress += stressedPd;
      gradeMap.set(b.risk_grade, gItem);

      const sItem = sectorMap.get(sectorKey) ?? { base: 0, stress: 0, count: 0, beta };
      sItem.base += baseEcl;
      sItem.stress += stressedEcl;
      sItem.count += 1;
      sectorMap.set(sectorKey, sItem);
    }

    const byGrade = [...gradeMap.entries()]
      .sort((a, b) => {
        const numA = parseInt(a[0].replace(/\D/g, ""), 10) || 0;
        const numB = parseInt(b[0].replace(/\D/g, ""), 10) || 0;
        return numA - numB;
      })
      .map(([grade, v]) => ({
        grade,
        base: Math.round(v.base),
        stress: Math.round(v.stress),
        count: v.count,
        avg_pd_base: v.count ? Number((v.sumPdBase / v.count).toFixed(4)) : 0,
        avg_pd_stress: v.count ? Number((v.sumPdStress / v.count).toFixed(4)) : 0,
      }));

    const bySector = [...sectorMap.entries()].map(([sec, v]) => {
      const upliftPct = v.base > 0 ? ((v.stress / v.base) - 1.0) * 100.0 : 0.0;
      return {
        sector: sec,
        beta: v.beta,
        base_ecl: Math.round(v.base),
        stressed_ecl: Math.round(v.stress),
        uplift_pct: Number(upliftPct.toFixed(2)),
        accounts: v.count,
      };
    }).sort((a, b) => b.uplift_pct - a.uplift_pct);

    const upliftPct = baseSum > 0 ? ((stressSum / baseSum) - 1.0) * 100.0 : 0.0;

    return {
      status: "fallback",
      repo_bps: repoBps,
      gdp_shock_pct: gdpDrop,
      sector_stress: params.sector_stress ?? 0,
      target_sector: params.target_sector || "all_cyclical",
      total_accounts: borrowers.length,
      baseline_ecl: Math.round(baseSum),
      stressed_ecl: Math.round(stressSum),
      ecl_uplift_pct: Number(upliftPct.toFixed(2)),
      weighted_avg_pd_base: 0.0482,
      weighted_avg_pd_stressed: 0.0571,
      by_grade: byGrade,
      by_sector: bySector,
    };
  }
}

/**
 * Execute contagion simulation against live database or fallback.
 */
export async function simulateContagion(
  params?: ContagionSimulateParams,
  signal?: AbortSignal,
): Promise<ContagionSimulateResponse> {
  try {
    const res = await fetchWithTimeout("/api/contagion/simulate", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(params || {}),
      signal,
    });
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    return (await res.json()) as ContagionSimulateResponse;
  } catch {
    let borrowers = snapshot.borrowers;
    if (params?.branch_code && params.branch_code !== "all") {
      borrowers = borrowers.filter((b) => b.branch_code === params.branch_code);
    }
    if (params?.sector && params.sector !== "all") {
      borrowers = borrowers.filter((b) => b.sector === params.sector);
    }
    const transmission = params?.transmission_rate ?? 0.35;
    const threshold = params?.stress_threshold ?? 0.16;

    const byCommunity = new Map<string, typeof borrowers>();
    for (const b of borrowers) {
      const key = `${b.state ?? "?"}·${b.sector ?? "?"}`;
      const arr = byCommunity.get(key) ?? [];
      arr.push(b);
      byCommunity.set(key, arr);
    }

    const communities = [...byCommunity.entries()]
      .map(([name, members]) => ({
        name,
        members_count: members.length,
        avgPd: members.reduce((s, m) => s + m.pd, 0) / members.length,
        redCount: members.filter((m) => m.rag === "Red").length,
        ecl: Math.round(members.reduce((s, m) => s + m.ecl, 0)),
        infected_count: 0,
      }))
      .sort((a, b) => b.avgPd - a.avgPd);

    const scatter = borrowers.map((b) => ({
      id: b.loan_id,
      x: Math.round(b.ead / 1000),
      y: Math.round(b.pd * 1000) / 10,
      base_pd: Math.round(b.pd * 1000) / 10,
      z: b.ecl,
      base_ecl: b.ecl,
      rag: b.rag,
      base_rag: b.rag,
      status: (b.pd >= threshold ? "initial_stressed" : "stable") as "initial_stressed" | "stable",
      sector: b.sector,
      state: b.state,
    }));

    const initStressed = borrowers.filter((b) => b.pd >= threshold).length;
    const totalEcl = Math.round(borrowers.reduce((s, b) => s + b.ecl, 0));

    return {
      status: "fallback",
      transmission_rate: transmission,
      stress_threshold: threshold,
      total_nodes: borrowers.length,
      total_edges: Math.round(borrowers.length * 2.9),
      initial_stressed_nodes: initStressed,
      final_stressed_nodes: initStressed,
      contagion_spread_count: 0,
      baseline_ecl: totalEcl,
      stressed_ecl: totalEcl,
      cascade_ecl_delta: 0,
      rounds_executed: 1,
      rounds_history: [{ round: 0, stressed_count: initStressed, newly_infected: 0, total_ecl: totalEcl }],
      top_contagion_hubs: [],
      communities: communities.slice(0, 10),
      scatter,
    };
  }
}


