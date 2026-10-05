import type { RagBucket, RiskGrade } from "./types";

const inrFormatter = new Intl.NumberFormat("en-IN", {
  style: "currency",
  currency: "INR",
  maximumFractionDigits: 0,
});

export function formatInr(value: number): string {
  return inrFormatter.format(value);
}

// Deterministic Indian compact currency (₹..K / ₹..L / ₹..Cr). Hand-rolled
// rather than Intl `notation: "compact"` because ICU formats round values
// inconsistently between Node (SSR) and the browser (e.g. "₹90.0L" vs "₹90L"),
// which causes React hydration mismatches.
export function formatInrCompact(value: number): string {
  const sign = value < 0 ? "-" : "";
  const v = Math.abs(value);
  const fmt = (n: number, suffix: string) => `${sign}₹${n.toFixed(1).replace(/\.0$/, "")}${suffix}`;
  if (v >= 1e7) return fmt(v / 1e7, "Cr");
  if (v >= 1e5) return fmt(v / 1e5, "L");
  if (v >= 1e3) return fmt(v / 1e3, "K");
  return `${sign}₹${Math.round(v)}`;
}

export function formatPercent(value: number, digits = 0): string {
  return `${(value * 100).toFixed(digits)}%`;
}

export function formatDate(iso: string): string {
  const d = new Date(iso);
  return d.toLocaleDateString("en-IN", {
    year: "numeric",
    month: "short",
    day: "2-digit",
  });
}

/** RAG bucket → token classes (chips, pills, chart fills). */
export const ragTone: Record<RagBucket, string> = {
  Green: "bg-band-a/15 text-band-a border-band-a/30",
  Amber: "bg-band-c/15 text-band-c border-band-c/30",
  Red: "bg-band-d/15 text-band-d border-band-d/30",
};

export const ragSolid: Record<RagBucket, string> = {
  Green: "bg-band-a text-white",
  Amber: "bg-band-c text-black/85",
  Red: "bg-band-d text-white",
};

export const ragHex: Record<RagBucket, string> = {
  Green: "#10b981",
  Amber: "#f59e0b",
  Red: "#ef4444",
};

/**
 * RG1–RG10 → RAG band. Mirrors `_RAG_BY_GRADE` in
 * src/framework/interpretation.py EXACTLY: RG1–4 Green, RG5–7 Amber,
 * RG8–10 Red. Keep the two in lockstep — the backend stamps a `rag` field on
 * every scored row, so a divergence here makes one page render two different
 * band schemes at once.
 */
export function gradeToRag(grade: RiskGrade): RagBucket {
  const n = Number(grade.replace("RG", ""));
  if (n <= 4) return "Green";
  if (n <= 7) return "Amber";
  return "Red";
}

/** Zero-based grade index → RAG band, for charts that iterate RG1…RG10. */
export function gradeIndexToRag(i: number): RagBucket {
  return i < 4 ? "Green" : i < 7 ? "Amber" : "Red";
}

/**
 * Upper PD bound of each grade, RG1..RG9 (RG10 is everything above 65%).
 * Mirrors _GRADE_EDGES in src/framework/interpretation.py; a test fails if they drift.
 */
export const GRADE_EDGES: ReadonlyArray<readonly [string, number]> = [
  ["RG1", 0.02],
  ["RG2", 0.04],
  ["RG3", 0.07],
  ["RG4", 0.11],
  ["RG5", 0.16],
  ["RG6", 0.23],
  ["RG7", 0.32],
  ["RG8", 0.45],
  ["RG9", 0.65],
];

/** PD range [low, high) of a grade, from GRADE_EDGES. */
export function gradeRange(grade: string): [number, number] {
  const i = GRADE_EDGES.findIndex(([g]) => g === grade);
  if (i < 0) return [GRADE_EDGES[GRADE_EDGES.length - 1][1], 1];
  return [i === 0 ? 0 : GRADE_EDGES[i - 1][1], GRADE_EDGES[i][1]];
}

/** Human-readable band legend, derived so it can never drift from the mapping. */
export const RAG_LEGEND = "Green RG1–RG4 · Amber RG5–RG7 · Red RG8–RG10";

/**
 * PD → chip tone. Uses the interpretation framework's own grade edges
 * (_GRADE_EDGES holds upper bounds: RG5 starts at 0.11 = first Amber, RG8 at
 * 0.32 = first Red) so a PD chip and a RAG chip on the same row agree.
 */
export function pdTone(pd: number): string {
  if (pd < 0.11) return ragTone.Green;
  if (pd < 0.32) return ragTone.Amber;
  return ragTone.Red;
}
