/**
 * Plain-language wording for a controlling-office officer.
 *
 * Two labels that used to share the word "SMA" are kept apart here:
 * - RBI SMA status is a regulatory fact, defined on days past due only.
 * - The model's early-watch bucket comes from the 12-month PD.
 * And the "why flagged" line turns an account's own stored inputs into one
 * sentence, ordered by what drives the model's score for that account.
 */
import type { BorrowerScore } from "./types";

export type RbiSma = "Standard" | "SMA-0" | "SMA-1" | "SMA-2" | "NPA";

type Raw = Record<string, unknown>;

function rawOf(b: Pick<BorrowerScore, "raw"> & Record<string, unknown>): Raw {
  return ((b.raw as Raw | undefined) ?? {}) as Raw;
}

function num(v: unknown): number | null {
  const n = typeof v === "number" ? v : typeof v === "string" && v.trim() !== "" ? Number(v) : NaN;
  return Number.isFinite(n) ? n : null;
}

/** Days past due from the row itself (loan master) or its stored inputs (snapshot). */
export function dpdOf(b: BorrowerScore): number | null {
  return num((b as unknown as Raw).dpd) ?? num(rawOf(b as never).dpd);
}

/** RBI Special Mention Account status from days past due (IRAC norms). */
export function rbiSma(dpd: number | null): RbiSma | null {
  if (dpd == null) return null;
  if (dpd <= 0) return "Standard";
  if (dpd <= 30) return "SMA-0";
  if (dpd <= 60) return "SMA-1";
  if (dpd <= 90) return "SMA-2";
  return "NPA";
}

/** The model's PD-based bucket. Older records carry the former "SMA-x watch" names. */
export function watchLabel(label: string | null | undefined): string {
  const legacy: Record<string, string> = {
    Standard: "No watch",
    "SMA-0 watch": "Early watch 1",
    "SMA-1 watch": "Early watch 2",
    "SMA-2 watch": "Early watch 3",
  };
  const l = String(label ?? "").trim();
  return legacy[l] ?? (l || "—");
}

/** Model features → which stored input explains them, so the line follows the score's drivers. */
const DRIVER_INPUT: Record<string, string> = {
  emi_bounce_6m: "emi_bounce_6m",
  drawing_power_gap_pct: "drawing_power_gap_pct",
  cashflow_volatility: "drawing_power_gap_pct",
  demanded_vs_collected_ratio: "demanded_vs_collected_ratio",
  balance_trend_pct: "balance_trend_pct",
  cibil_score: "cibil_score",
  cmr: "cmr",
  gst_filing_delay_days: "gst_filing_delay_days",
  gst_turnover_trend_pct: "gst_turnover_trend_pct",
  itc_mismatch_flag: "itc_mismatch_flag",
  current_ratio: "current_ratio",
  credit_turnover_ratio: "credit_turnover_ratio",
  enquiries_6m: "enquiries_6m",
  electricity_consumption_trend_pct: "electricity_consumption_trend_pct",
  nbr_stress_score: "nbr_stress_score",
};

/** One plain sentence fragment per stressed input, or null when the input looks healthy. */
function describe(key: string, r: Raw): string | null {
  const v = num(r[key]);
  switch (key) {
    case "emi_bounce_6m":
      // With no bounce count on record the model estimates one from the collection
      // ratio; the "dues collected" reason already states that, so it is not repeated.
      return v != null && v >= 1 ? `${v} cheque / EMI return${v === 1 ? "" : "s"} in 6 months` : null;
    case "drawing_power_gap_pct":
      return v != null && v >= 10 ? `drawing power ${Math.round(v)}% below the limit` : null;
    case "demanded_vs_collected_ratio":
      return v != null && v < 0.95 ? `only ${Math.round(v * 100)}% of dues collected` : null;
    case "balance_trend_pct":
      return v != null && v <= -10 ? `bank balance down ${Math.round(-v)}%` : null;
    case "cibil_score":
      return v != null && v > 0 && v < 650 ? `low bureau score (${Math.round(v)})` : null;
    case "cmr":
      return v != null && v >= 7 ? `weak CIBIL MSME rank (CMR-${Math.round(v)})` : null;
    case "gst_filing_delay_days":
      return v != null && v > 30 ? `GST returns ${Math.round(v)} days late` : null;
    case "gst_turnover_trend_pct":
      return v != null && v <= -15 ? `GST turnover down ${Math.round(-v)}%` : null;
    case "itc_mismatch_flag":
      return v != null && v >= 1 ? "GST input-credit mismatch" : null;
    case "current_ratio":
      return v != null && v < 1 ? `current ratio below 1 (${v.toFixed(2)})` : null;
    case "credit_turnover_ratio":
      return v != null && v < 0.6 ? "sales not routed through the account" : null;
    case "enquiries_6m":
      return v != null && v >= 4 ? `${v} credit enquiries in 6 months` : null;
    case "electricity_consumption_trend_pct":
      return v != null && v <= -15 ? `power use down ${Math.round(-v)}%` : null;
    case "nbr_stress_score":
      return v != null && v >= 0.5 ? "key suppliers / buyers under stress" : null;
    default:
      return null;
  }
}

/**
 * Up to `max` plain reasons why an account scores as it does, e.g.
 * ["3 cheque / EMI returns in 6 months", "drawing power 28% below the limit"].
 * Inputs the model leaned on for this account come first.
 */
export function whyFlagged(b: BorrowerScore, max = 3): string[] {
  const r = rawOf(b as never);
  const ordered: string[] = [];
  for (const rc of b.reason_codes ?? []) {
    if (rc.direction !== "raises_risk") continue;
    const k = DRIVER_INPUT[rc.feature];
    if (k && !ordered.includes(k)) ordered.push(k);
  }
  for (const k of Object.values(DRIVER_INPUT)) if (!ordered.includes(k)) ordered.push(k);

  const out: string[] = [];
  const dpd = dpdOf(b);
  if (dpd != null && dpd > 0) out.push(`${Math.round(dpd)} days overdue`);
  if (num(r.lien_flag) === 1) out.push("lien or attachment on the account");
  if (num(r.restructuring_flag) === 1) out.push("restructured before");
  for (const k of ordered) {
    const d = describe(k, r);
    if (d && !out.includes(d)) out.push(d);
  }
  return out.slice(0, max);
}

/** The whole line, with a healthy-account wording when nothing is stressed. */
export function whyFlaggedLine(b: BorrowerScore, max = 3): string {
  const reasons = whyFlagged(b, max);
  if (reasons.length === 0) return "No stress signals in the account's inputs";
  const s = reasons.join("; ");
  return s.charAt(0).toUpperCase() + s.slice(1);
}

/** Short plain meanings for terms the console cannot avoid showing. */
export const GLOSSARY: Record<string, string> = {
  SHAP: "how much each input pushed this account's score up or down",
  PSI: "how far today's data has drifted from the data the model learnt on (above 0.25 = retrain)",
  SICR: "significant increase in credit risk since sanction — moves the loan to Stage 2",
  FITL: "funded interest term loan: overdue interest converted into a separate term loan",
  TEV: "techno-economic viability study: an independent check that the unit can recover",
  "Stage 1": "performing loan; provision covers the next 12 months of expected loss",
  "Stage 2": "risk has risen materially (or 30+ days overdue); provision covers the loan's lifetime",
  "Stage 3": "credit-impaired (90+ days overdue); provision against the expected loss now",
  ECL: "expected credit loss: PD × loss if it defaults × amount outstanding",
  EAD: "exposure at default: what would be owed if the borrower defaulted",
};

/** Plain name and value for each model input the reason codes can cite. */
const FEATURE_PLAIN: Record<string, { name: string; fmt?: (v: number) => string }> = {
  emi_bounce_6m: { name: "EMI / cheque returns", fmt: (v) => `${v} in 6 months` },
  cashflow_volatility: { name: "Swing in monthly receipts", fmt: (v) => v.toFixed(2) },
  balance_trend_pct: { name: "Bank balance trend", fmt: (v) => `${v > 0 ? "+" : ""}${Math.round(v)}%` },
  upi_inflow_stability: { name: "Regularity of UPI receipts", fmt: (v) => v.toFixed(2) },
  gst_filing_delay_days: { name: "GST filing delay", fmt: (v) => `${Math.round(v)} days` },
  gst_turnover_trend_pct: { name: "GST turnover trend", fmt: (v) => `${v > 0 ? "+" : ""}${Math.round(v)}%` },
  itc_mismatch_flag: { name: "GST input-credit mismatch", fmt: (v) => (v ? "yes" : "no") },
  cmr: { name: "CIBIL MSME rank", fmt: (v) => `CMR-${Math.round(v)}` },
  enquiries_6m: { name: "Credit enquiries", fmt: (v) => `${v} in 6 months` },
  ticket_size: { name: "Loan size" },
  vintage_months: { name: "Years with the bank", fmt: (v) => `${(v / 12).toFixed(1)} years` },
  tenure_months: { name: "Loan tenure", fmt: (v) => `${Math.round(v)} months` },
  interest_spread_bps: { name: "Interest spread", fmt: (v) => `${Math.round(v)} bps` },
  credit_turnover_ratio: { name: "Sales routed through the account", fmt: (v) => `${Math.round(v * 100)}%` },
  current_ratio: { name: "Current ratio", fmt: (v) => v.toFixed(2) },
  electricity_consumption_trend_pct: { name: "Power use trend", fmt: (v) => `${v > 0 ? "+" : ""}${Math.round(v)}%` },
  nbr_stress_score: { name: "Stress among suppliers / buyers", fmt: (v) => v.toFixed(2) },
  nbr_bounce_share: { name: "Suppliers / buyers with returns", fmt: (v) => `${Math.round(v * 100)}%` },
  note_sentiment: { name: "Tone of the officer's note", fmt: (v) => (v > 0 ? "positive" : v < 0 ? "negative" : "neutral") },
  note_payment_promise_broken: { name: "Note: broken promise", fmt: (v) => (v ? "yes" : "no") },
  note_business_disruption: { name: "Note: business disruption", fmt: (v) => (v ? "yes" : "no") },
  note_stock_statement_delay: { name: "Note: stock statement delay", fmt: (v) => (v ? "yes" : "no") },
  note_dispute_litigation: { name: "Note: dispute / litigation", fmt: (v) => (v ? "yes" : "no") },
  note_positive_outlook: { name: "Note: positive outlook", fmt: (v) => (v ? "yes" : "no") },
  sector: { name: "Sector" },
  state: { name: "State" },
  sub_segment: { name: "Size band" },
};

/** "EMI / cheque returns: 3 in 6 months" for one reason-code input. */
export function driverDetail(feature: string, raw: Record<string, unknown> | undefined): string {
  const meta = FEATURE_PLAIN[feature] ?? { name: feature.replace(/_/g, " ") };
  const value = raw?.[feature];
  if (value == null || value === "") return meta.name;
  const n = num(value);
  if (n == null) return `${meta.name}: ${String(value).replace(/_/g, " ")}`;
  return `${meta.name}: ${meta.fmt ? meta.fmt(n) : n.toLocaleString("en-IN")}`;
}
