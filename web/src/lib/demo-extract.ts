/**
 * Synthetic Finacle-style extract for showing the Batch Screener at book scale.
 *
 * Every row is generated (seeded, so the same size and seed always give the same
 * book) and marked synthetic on screen. A hidden stress factor per account drives
 * all of its fields together, as stress does in a real book: a stressed unit shows
 * a weaker bureau score, a drawing-power gap, a collection shortfall, bounces and
 * days overdue at the same time. Roughly 1 in 9 accounts is stressed, so the
 * portfolio looks like an MSME book, not a watchlist.
 */

export interface DemoExtractRow {
  loan_id: string;
  sector: string;
  sub_segment: "micro" | "small" | "medium";
  state: string;
  ticket_size: number;
  sanction_limit: number;
  drawing_power: number;
  drawing_power_gap_pct: number;
  demanded_vs_collected_ratio: number;
  cibil_score: number;
  dpd: number;
  emi_bounce_6m: number;
  lien_flag: 0 | 1;
  restructuring_flag: 0 | 1;
  gst_filing_delay_days: number;
  itc_mismatch_flag: 0 | 1;
}

// Sectors and states the msme_idbi model and the branch registry know.
const SECTORS = [
  "auto_components", "construction", "food_processing", "it_services",
  "pharma", "retail_trade", "textiles",
];
const STATES = ["MH", "GJ", "MP", "TN", "KA", "TG", "KL", "DL", "UP", "RJ", "PB", "WB"];

/** mulberry32: small, fast, seedable PRNG. */
function rng(seed: number): () => number {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

const clamp = (v: number, lo: number, hi: number) => Math.min(hi, Math.max(lo, v));
const round = (v: number, step: number) => Math.round(v / step) * step;

export function generateDemoExtract(n: number, seed = 2026): DemoExtractRow[] {
  const r = rng(seed);
  const normal = () => {
    // Box-Muller
    const u = Math.max(r(), 1e-12);
    return Math.sqrt(-2 * Math.log(u)) * Math.cos(2 * Math.PI * r());
  };
  const pick = <T,>(xs: T[]) => xs[Math.floor(r() * xs.length)];

  const rows: DemoExtractRow[] = [];
  for (let i = 0; i < n; i++) {
    const sizeDraw = r();
    const sub_segment = sizeDraw < 0.55 ? "micro" : sizeDraw < 0.9 ? "small" : "medium";
    // Ticket sizes (INR): micro 5–50 lakh, small 50 lakh–5 crore, medium 5–25 crore, log-uniform.
    const [lo, hi] = sub_segment === "micro" ? [5e5, 5e6] : sub_segment === "small" ? [5e6, 5e7] : [5e7, 2.5e8];
    const limit = round(Math.exp(Math.log(lo) + r() * (Math.log(hi) - Math.log(lo))), 10000);

    // Hidden stress: most accounts near 0; about 1 in 9 carries some stress, spread
    // from mild (watch) to severe (default-like), so Amber outnumbers Red.
    const stress = normal() * 0.4 + (r() < 0.11 ? 0.5 + Math.pow(r(), 1.6) * 2.4 : 0);
    const s = Math.max(0, stress);

    const cibil = Math.round(clamp(752 - 75 * stress + normal() * 32, 300, 900));
    const gap = round(clamp(Math.abs(normal()) * 3 + 10 * s + (s > 0 ? normal() * 3 : 0), 0, 65), 0.1);
    const ratio = round(clamp(1 - Math.max(0, 0.11 * stress + normal() * 0.025), 0.35, 1), 0.001);
    let dpd = 0;
    if (s > 2.1) dpd = 31 + Math.floor(r() * 59);
    else if (s > 1.4) dpd = Math.floor(r() * 46);
    else if (s > 0.8 && r() < 0.4) dpd = 1 + Math.floor(r() * 20);
    else if (r() < 0.04) dpd = 1 + Math.floor(r() * 10);
    const bounces = Math.max(0, Math.round(s * 1.6 + normal() * 0.6));

    rows.push({
      loan_id: `DEMO-${String(seed).slice(-2)}-${String(i + 1).padStart(4, "0")}`,
      sector: pick(SECTORS),
      sub_segment,
      state: pick(STATES),
      ticket_size: limit,
      sanction_limit: limit,
      drawing_power: round(limit * (1 - gap / 100), 1000),
      drawing_power_gap_pct: gap,
      demanded_vs_collected_ratio: ratio,
      cibil_score: cibil,
      dpd,
      emi_bounce_6m: bounces,
      lien_flag: r() < 0.01 + 0.05 * s ? 1 : 0,
      restructuring_flag: r() < 0.02 + 0.05 * s ? 1 : 0,
      gst_filing_delay_days: Math.max(0, Math.round(Math.abs(normal()) * 4 + 18 * Math.max(0, s - 0.6))),
      itc_mismatch_flag: r() < 0.03 + 0.08 * s ? 1 : 0,
    });
  }
  return rows;
}

export const DEMO_EXTRACT_COLUMNS: (keyof DemoExtractRow)[] = [
  "loan_id", "sector", "sub_segment", "state", "ticket_size", "sanction_limit", "drawing_power",
  "drawing_power_gap_pct", "demanded_vs_collected_ratio", "cibil_score", "dpd", "emi_bounce_6m",
  "lien_flag", "restructuring_flag", "gst_filing_delay_days", "itc_mismatch_flag",
];

/** CSV text in the column order the Batch Screener's upload accepts. */
export function demoExtractCsv(rows: DemoExtractRow[]): string {
  const head = DEMO_EXTRACT_COLUMNS.join(",");
  return [head, ...rows.map((row) => DEMO_EXTRACT_COLUMNS.map((c) => row[c]).join(","))].join("\n");
}

/**
 * The same rows under Finacle-style column names (ACCT_NUM, SANCT_LIM, DRW_PWR,
 * COLL_RATIO, CIBIL, OVERDUE_DPD, CHQ_RTN, LIEN, RESCHED). Uploading it shows the
 * Batch Screener mapping a core-banking extract onto the model's fields.
 */
export function demoExtractFinacleCsv(rows: DemoExtractRow[]): string {
  const cols: [string, keyof DemoExtractRow][] = [
    ["ACCT_NUM", "loan_id"],
    ["SANCT_LIM", "sanction_limit"],
    ["DRW_PWR", "drawing_power"],
    ["COLL_RATIO", "demanded_vs_collected_ratio"],
    ["CIBIL", "cibil_score"],
    ["OVERDUE_DPD", "dpd"],
    ["CHQ_RTN", "emi_bounce_6m"],
    ["LIEN", "lien_flag"],
    ["RESCHED", "restructuring_flag"],
    ["sector", "sector"],
    ["sub_segment", "sub_segment"],
    ["state", "state"],
    ["gst_filing_delay_days", "gst_filing_delay_days"],
    ["itc_mismatch_flag", "itc_mismatch_flag"],
  ];
  return [cols.map((c) => c[0]).join(","), ...rows.map((r) => cols.map(([, k]) => r[k]).join(","))].join("\n");
}
