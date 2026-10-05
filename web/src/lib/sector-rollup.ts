/**
 * Sector rollup: is a sector stressed across the board, or in a few branches?
 *
 * For each sector it compares the share of flagged accounts (PD ≥ the flag
 * threshold, 16%, the same cut the portfolio and branch pages use) with the
 * book's share, as a binomial z-score, and counts how many of the branches that
 * hold the sector carry flagged accounts in it. A high z spread over many
 * branches and zones points to a sector-wide cause (act on sector policy); a high
 * z in one or two branches points to a local cause (act on those branches).
 */
import type { BorrowerScore } from "./types";
import { dpdOf } from "./plain-language";

export const FLAG_PD = 0.16;

export type SectorStatus = "sector-wide" | "local cluster" | "watch" | "in line";

export interface SectorRow {
  sector: string;
  accounts: number;
  flagged: number;
  flagRate: number;
  bookFlagRate: number;
  z: number;
  ead: number;
  eadShare: number;
  weightedPd: number;
  ecl: number;
  branchesHolding: number;
  branchesFlagged: number;
  zonesFlagged: number;
  breadth: number;
  status: SectorStatus;
  topBranches: { code: string; name: string; flagged: number }[];
  drivers: { label: string; share: number }[];
}

type Raw = Record<string, unknown>;
const n = (v: unknown) => (typeof v === "number" ? v : typeof v === "string" && v !== "" ? Number(v) : NaN);

// Shared stress patterns among a sector's flagged accounts, from stored inputs.
const DRIVERS: { label: string; test: (r: Raw, b: BorrowerScore) => boolean }[] = [
  { label: "EMI / cheque returns (2+ in 6 months)", test: (r) => n(r.emi_bounce_6m) >= 2 },
  { label: "Drawing power 25%+ below limit", test: (r) => n(r.drawing_power_gap_pct) >= 25 },
  { label: "Under 85% of dues collected", test: (r) => n(r.demanded_vs_collected_ratio) < 0.85 },
  { label: "Days overdue", test: (_r, b) => (dpdOf(b) ?? 0) > 0 },
  { label: "GST returns 30+ days late", test: (r) => n(r.gst_filing_delay_days) > 30 },
  { label: "GST turnover down 15%+", test: (r) => n(r.gst_turnover_trend_pct) <= -15 },
  { label: "Bank balance down 10%+", test: (r) => n(r.balance_trend_pct) <= -10 },
  { label: "Bureau score under 650", test: (r) => n(r.cibil_score) > 0 && n(r.cibil_score) < 650 },
  { label: "Weak CIBIL MSME rank (CMR 7+)", test: (r) => n(r.cmr) >= 7 },
  { label: "Lien or attachment", test: (r) => n(r.lien_flag) === 1 },
  { label: "Restructured before", test: (r) => n(r.restructuring_flag) === 1 },
];

function classify(z: number, branchesFlagged: number, breadth: number, zonesFlagged: number): SectorStatus {
  if (z >= 2) {
    return branchesFlagged >= 3 && breadth >= 0.4 && zonesFlagged >= 2 ? "sector-wide" : "local cluster";
  }
  if (z >= 1) return "watch";
  return "in line";
}

export function sectorRollup(book: BorrowerScore[]): SectorRow[] {
  const total = book.length || 1;
  const bookFlagged = book.filter((b) => b.pd >= FLAG_PD).length;
  const p0 = bookFlagged / total;
  const bookEad = book.reduce((s, b) => s + (b.ead || 0), 0) || 1;

  const bySector = new Map<string, BorrowerScore[]>();
  for (const b of book) {
    const key = b.sector || "unknown";
    bySector.set(key, [...(bySector.get(key) ?? []), b]);
  }

  const rows: SectorRow[] = [];
  for (const [sector, accts] of bySector) {
    const flaggedAccts = accts.filter((b) => b.pd >= FLAG_PD);
    const k = flaggedAccts.length;
    const m = accts.length;
    const sd = Math.sqrt(m * p0 * (1 - p0)) || 1;
    const z = (k - m * p0) / sd;
    const ead = accts.reduce((s, b) => s + (b.ead || 0), 0);
    const holding = new Set(accts.map((b) => b.branch_code ?? "?"));
    const flaggedBranches = new Map<string, { name: string; flagged: number }>();
    for (const b of flaggedAccts) {
      const code = b.branch_code ?? "?";
      const cur = flaggedBranches.get(code) ?? { name: b.branch_name ?? code, flagged: 0 };
      cur.flagged += 1;
      flaggedBranches.set(code, cur);
    }
    const zones = new Set(flaggedAccts.map((b) => b.zone ?? "?"));
    const breadth = holding.size ? flaggedBranches.size / holding.size : 0;
    const drivers = DRIVERS.map((d) => ({
      label: d.label,
      share: k ? flaggedAccts.filter((b) => d.test((b.raw ?? {}) as Raw, b)).length / k : 0,
    }))
      .filter((d) => d.share >= 0.25)
      .sort((a, b) => b.share - a.share)
      .slice(0, 3);
    rows.push({
      sector,
      accounts: m,
      flagged: k,
      flagRate: m ? k / m : 0,
      bookFlagRate: p0,
      z,
      ead,
      eadShare: ead / bookEad,
      weightedPd: ead ? accts.reduce((s, b) => s + b.pd * (b.ead || 0), 0) / ead : 0,
      ecl: accts.reduce((s, b) => s + (b.ecl || 0), 0),
      branchesHolding: holding.size,
      branchesFlagged: flaggedBranches.size,
      zonesFlagged: zones.size,
      breadth,
      status: classify(z, flaggedBranches.size, breadth, zones.size),
      topBranches: [...flaggedBranches.entries()]
        .map(([code, v]) => ({ code, ...v }))
        .sort((a, b) => b.flagged - a.flagged)
        .slice(0, 3),
      drivers,
    });
  }
  const order: Record<SectorStatus, number> = { "sector-wide": 0, "local cluster": 1, watch: 2, "in line": 3 };
  return rows.sort((a, b) => order[a.status] - order[b.status] || b.z - a.z);
}
