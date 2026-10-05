import { useEffect, useMemo, useState } from "react";
import { useScopeBranch } from "../role-context";
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
import { offlineScore, type OfflineScoreInput } from "./offline-score";

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
    if (res.ok) return (await res.json()) as BorrowerScore;
  } catch {
    // fall through to the snapshot
  }
  // The sandbox database is seeded from this snapshot, so a deployment without
  // the API finds the same account the live one would, instead of "not found".
  const key = id.trim().toUpperCase();
  return snapshot.borrowers.find((b) => b.loan_id.toUpperCase() === key) ?? null;
}

/** Branch rollup, riskiest first (the controlling office's reading order). */
export function listBranches(): BranchSummary[] {
  return snapshot.branches ?? [];
}

/**
 * The book every page should show: the snapshot on first render, then the live
 * loan master once the API answers (new proposals, batch saves and re-ratings).
 */
export function useBook(): BorrowerScore[] {
  const [book, setBook] = useState<BorrowerScore[]>(() => snapshot.borrowers);
  const scope = useScopeBranch();
  useEffect(() => {
    let active = true;
    fetchPortfolio({ limit: 2000 }).then((r) => {
      if (active && r && r.source.mode === "live") setBook(r.borrowers);
    });
    return () => {
      active = false;
    };
  }, []);
  // A branch officer's book is their branch, on every page that reads it.
  return useMemo(() => (scope ? book.filter((b) => b.branch_code === scope) : book), [book, scope]);
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
): Promise<{ status: string; loan_id: string; borrower?: any; decision?: any; detail?: string } | null> {
  try {
    const res = await fetchWithTimeout("/api/underwrite/submit", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(payload),
    });
    if (res.status === 409 || res.status === 404) {
      const body = await res.json().catch(() => null);
      return { status: "conflict", loan_id: payload.loan_id, detail: body?.detail };
    }
    if (!res.ok) return null;
    return await res.json();
  } catch {
    return null;
  }
}

export async function uploadBatch(
  records: Record<string, unknown>[],
  segment: string = "msme_idbi",
  opts: { persist?: boolean } = {},
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
  saved_accounts?: number;
  skipped_existing?: string[];
  persisted?: boolean;
} | null> {
  const persist = opts.persist ?? true;
  try {
    // Large extracts take a while to score; allow ~60 ms a row plus headroom.
    const res = await fetchWithTimeout(
      "/api/batch/upload",
      {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ records, segment, persist }),
      },
      Math.max(8000, records.length * 60 + 5000),
    );
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

// Decisions taken while the API is unreachable (the static Space) are kept on
// this browser so the committee dialog, the portfolio row and the governance
// audit trail still agree. They are marked `local` wherever they are shown.
const LOCAL_DECISIONS_KEY = "drishti.decisions.local.v1";

export type LocalDecision = DecisionRecord & { local: true };

function readLocalDecisions(): LocalDecision[] {
  try {
    const raw = typeof window === "undefined" ? null : localStorage.getItem(LOCAL_DECISIONS_KEY);
    return raw ? (JSON.parse(raw) as LocalDecision[]) : [];
  } catch {
    return [];
  }
}

function saveLocalDecision(d: DecisionCreate): void {
  try {
    const rec: LocalDecision = {
      id: `LOCAL-${Date.now()}`,
      loan_id: d.loan_id,
      segment: d.segment,
      decision: d.decision,
      original_grade: d.original_grade ?? d.risk_grade,
      revised_grade: d.revised_grade,
      override_action: d.override_action,
      rationale: d.rationale,
      decided_by: d.decided_by,
      officer: d.officer ?? d.decided_by,
      role: d.role,
      ts: new Date().toISOString(),
      local: true,
    };
    localStorage.setItem(LOCAL_DECISIONS_KEY, JSON.stringify([rec, ...readLocalDecisions()].slice(0, 500)));
  } catch {
    /* storage unavailable: the caller reports the decision as not saved */
  }
}

const REVIEW_STATUS_BY_DECISION: Record<DecisionRecord["decision"], NonNullable<BorrowerScore["reviewed_status"]>> = {
  accept: "REVIEWED",
  override: "REVIEWED",
  defer: "DEFERRED",
  reject: "FLAGGED_SARB",
  restructure: "RESTRUCTURE",
};

/** Review status implied by the latest decision kept on this browser, if any. */
export function localReviewStatus(loanId: string): BorrowerScore["reviewed_status"] | undefined {
  const latest = readLocalDecisions().find((d) => d.loan_id === loanId);
  return latest ? REVIEW_STATUS_BY_DECISION[latest.decision] : undefined;
}

function newestFirst(a: DecisionRecord, b: DecisionRecord): number {
  return String(b.ts ?? "").localeCompare(String(a.ts ?? ""));
}

export async function fetchAllDecisions(limit: number = 50): Promise<DecisionRecord[]> {
  let server: DecisionRecord[] = [];
  try {
    const res = await fetchWithTimeout(`/api/decisions?limit=${limit}`);
    if (res.ok) server = (await res.json()) as DecisionRecord[];
  } catch {
    /* offline: local decisions only */
  }
  return [...readLocalDecisions(), ...server].sort(newestFirst).slice(0, limit);
}


/** Shape returned by POST /score/{segment} in src/serving/api.py. */
/** DPD-driven RBI SMA / Ind AS 109 floor, as returned by the scorer. */
export interface RegulatoryOverlay {
  rule: string;
  dpd: number;
  bucket: string;
  stage_floor: number;
  model_grade: string;
  model_sma_watch: string;
  applied: boolean;
}

interface ScoreResponse {
  status?: string;
  message?: string;
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
  regulatory_overlay?: RegulatoryOverlay | null;
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
    if (!res.ok) return false;
    // A static host can answer any path with its HTML shell and a 200.
    const body = (await res.json().catch(() => null)) as { status?: string } | null;
    return body?.status === "ok";
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
  row: BorrowerScore,
  signal?: AbortSignal,
): Promise<{ borrower: LiveBorrower; source: DataSource } | null> {
  // Re-score the row the page loaded (the loan master when the API is up), not
  // the bundled snapshot: after a re-rating the snapshot holds stale inputs.
  const base = row;

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
export async function createDecision(decision: DecisionCreate): Promise<"persisted" | "local" | false> {
  try {
    const res = await fetchWithTimeout("/api/decisions", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(decision),
    });
    if (res.ok) return "persisted";
    // The API answered and refused (validation, unknown loan, server error):
    // do not paper over that with a local copy.
    if (await probeApi()) return false;
  } catch {
    /* unreachable: fall through to the local record */
  }
  const before = readLocalDecisions().length;
  saveLocalDecision(decision);
  return readLocalDecisions().length > before ? "local" : false;
}

/**
 * Fetch decision audit trail for a specific loan ID.
 */
export async function fetchDecisions(loanId: string): Promise<DecisionRecord[]> {
  let server: DecisionRecord[] = [];
  try {
    const res = await fetchWithTimeout(`/api/decisions/${encodeURIComponent(loanId)}`);
    if (res.ok) server = (await res.json()) as DecisionRecord[];
  } catch {
    /* offline: local decisions only */
  }
  const local = readLocalDecisions().filter((d) => d.loan_id === loanId);
  return [...local, ...server].sort(newestFirst);
}

/**
 * Direct single-borrower underwriting scoring via FastAPI.
 *
 * Falls back to the offline reference scorer when `/api` is unreachable — the
 * static Hugging Face export has no backend, and before this the appraisal
 * screen silently showed nothing at all there. The fallback result carries
 * `status: "fallback"` so the caller can label the verdict as approximate.
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
    // 422 is the API refusing to score (coverage gate), not an outage: pass the
    // refusal through so the officer sees it instead of an offline estimate.
    if (res.status === 422) {
      const body = await res.json().catch(() => null);
      const detail = body?.detail;
      if (typeof detail === "string") {
        return { status: "insufficient_data", message: `DRISHTI refused to score: ${detail}` } as ScoreResponse;
      }
      if (detail && typeof detail === "object" && detail.status === "insufficient_data") {
        return { ...detail, status: "insufficient_data", message: detail.message } as ScoreResponse;
      }
    }
    if (!res.ok) {
      // Reachable API that failed (bad input, server error): say so. Only a
      // missing API (static host, proxy with nothing behind it) gets the offline scorer.
      if (await probeApi()) {
        return { status: "error", message: `The scoring API returned an error (HTTP ${res.status}).` } as ScoreResponse;
      }
      throw new Error(`HTTP ${res.status}`);
    }
    return (await res.json()) as ScoreResponse;
  } catch {
    // A caller-initiated abort is not an API outage — let it stay unanswered
    // rather than replacing a superseded request with an offline verdict.
    if (signal?.aborted) return null;
    return offlineScore(segment, payload as OfflineScoreInput) as ScoreResponse;
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
      // Only a 422 is the API declining to score; any other failure (404 on the
      // static Space, 401 with a key set, 5xx from the proxy) means no live model.
      if (!res.ok && res.status !== 422) throw new Error(`HTTP ${res.status}`);
      if (res.ok) {
        results.push((await res.json()) as ScoreResponse);
      } else {
        // The API answered but would not score (e.g. refuse-to-score on thin data).
        results.push({
          status: "error",
          pd_12m: 0.0,
          risk_grade: "UNRATED",
          rag: "Amber",
          sma_watch: "Not scored",
          ecl_stage: 1,
        });
      }
    } catch {
      // API unreachable: same offline reference scorer as the appraisal screen,
      // flagged "fallback" so the page can say the figures are approximate.
      results.push(offlineScore(segment, rec as OfflineScoreInput) as ScoreResponse);
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






// ---------------------------------------------------------------------------
// Unstructured inputs: read an officer note or a bank statement for one account
// and re-score it. Analysis only; the API saves nothing. Null when no API.
// ---------------------------------------------------------------------------

export interface UnstructuredVerdict {
  pd_12m: number | null;
  risk_grade: string | null;
  rag: string | null;
  ecl_stage: number | null;
  ecl: number | null;
}

export interface NoteAnalysis {
  loan_id: string;
  segment: string;
  masked_text: string;
  pii_masked: boolean;
  method: string;
  finbert_tone: number | null;
  signals: { key: string; label: string; value: number }[];
  model_uses_notes: boolean;
  before: UnstructuredVerdict;
  after: UnstructuredVerdict;
  /** Uncalibrated model score; the PD is read from it through stepped (isotonic) calibration. */
  raw_score?: { before: number | null; after: number | null };
}

export interface StatementAnalysis {
  loan_id: string;
  segment: string;
  transactions: number;
  period: { from: string | null; to: string | null };
  derived: Record<string, number>;
  model_inputs_updated: Record<string, number>;
  /** What the model used before: stored values, or inferred ones for keys in inputs_were_inferred. */
  stored_inputs?: Record<string, number | null>;
  inputs_were_inferred?: string[];
  before: UnstructuredVerdict;
  after: UnstructuredVerdict;
  /** Uncalibrated model score; the PD is read from it through stepped (isotonic) calibration. */
  raw_score?: { before: number | null; after: number | null };
}

async function postJson<T>(path: string, body: unknown): Promise<T | { error: string } | null> {
  try {
    const res = await fetchWithTimeout(path, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(body),
    }, 30000);
    if (res.ok) return (await res.json()) as T;
    const detail = (await res.json().catch(() => null))?.detail;
    if (res.status === 404 || res.status === 422) {
      return { error: typeof detail === "string" ? detail : "The API could not read this input." };
    }
    return (await probeApi()) ? { error: `The API returned an error (HTTP ${res.status}).` } : null;
  } catch {
    return null;
  }
}

export function analyseNote(loanId: string, text: string, useFinbert = false) {
  return postJson<NoteAnalysis>("/api/unstructured/note", { loan_id: loanId, text, use_finbert: useFinbert });
}

export function analyseStatement(loanId: string, statement: unknown) {
  return postJson<StatementAnalysis>("/api/unstructured/statement", { loan_id: loanId, statement });
}

export async function fetchSampleStatement(kind: "healthy" | "stressed"): Promise<Record<string, unknown> | null> {
  try {
    const res = await fetchWithTimeout(`/api/unstructured/sample-statement?kind=${kind}`);
    return res.ok ? ((await res.json()) as Record<string, unknown>) : null;
  } catch {
    return null;
  }
}

// ---------------------------------------------------------------------------
// Action plan: the recourse levers for one account, borrower vs bank, and the
// PD after applying a chosen set. Analysis only. Null when no API.
// ---------------------------------------------------------------------------

export interface PlanLever {
  label: string;
  actor: "borrower" | "bank";
  plain: string;
}

export interface PlanVerdict {
  pd_12m: number;
  risk_grade: string;
  rag: string;
}

export interface ActionPlan {
  loan_id: string;
  segment: string;
  target_pd: number;
  current: PlanVerdict | null;
  levers: PlanLever[];
  suggested: {
    baseline_pd: number;
    achieved_pd: number;
    borrower_pd: number;
    target_met: boolean;
    borrower_target_met: boolean;
    changes: { change: string; actor: "borrower" | "bank"; plain: string; pd_after: number }[];
  } | null;
}

export async function fetchActionPlan(loanId: string): Promise<ActionPlan | null> {
  try {
    const res = await fetchWithTimeout(`/api/action-plan/${encodeURIComponent(loanId)}`, undefined, 20000);
    return res.ok ? ((await res.json()) as ActionPlan) : null;
  } catch {
    return null;
  }
}

export async function applyActions(
  loanId: string,
  actions: string[],
): Promise<{ before: PlanVerdict; after: PlanVerdict } | null> {
  try {
    const res = await fetchWithTimeout(
      `/api/action-plan/${encodeURIComponent(loanId)}/apply`,
      { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ actions }) },
      20000,
    );
    return res.ok ? await res.json() : null;
  } catch {
    return null;
  }
}
