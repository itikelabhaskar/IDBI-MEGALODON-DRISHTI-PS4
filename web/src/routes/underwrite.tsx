import { useState, useEffect, useRef, useMemo } from "react";
import { useCapabilities, useRole, useScopeBranch } from "@/lib/role-context";
import { rbiSma, watchLabel, whyFlaggedLine } from "@/lib/plain-language";
import type { BorrowerScore } from "@/lib/types";
import { createFileRoute, Link } from "@tanstack/react-router";
import { cn } from "@/lib/utils";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from "@/components/ui/dialog";
import { Textarea } from "@/components/ui/textarea";
import {
  Accordion,
  AccordionContent,
  AccordionItem,
  AccordionTrigger,
} from "@/components/ui/accordion";
import {
  Tooltip,
  TooltipContent,
  TooltipProvider,
  TooltipTrigger,
} from "@/components/ui/tooltip";
import { useGuidedTips } from "@/components/drishti/guided-tips";
import { PageApiDrawer } from "@/components/drishti/page-api-drawer";
import { createDecision, scoreRawBorrower, submitUnderwriting, fetchBorrower, getSnapshot, type RegulatoryOverlay } from "@/lib/api";
import { formatInr, formatInrCompact, formatPercent, ragTone, pdTone } from "@/lib/format";
import {
  Calculator,
  CheckCircle2,
  AlertTriangle,
  FileText,
  Printer,
  Sparkles,
  ArrowRight,
  RotateCcw,
  ShieldAlert,
  Send,
  Building2,
  TrendingDown,
  Search,
  Database,
  AlertOctagon,
  Loader2,
  Check,
  BookOpen,
  HelpCircle,
  Info,
  Copy,
  ArrowDown,
  Workflow,
  ExternalLink,
} from "lucide-react";

function HelpTip({ content, enabled = true }: { content: React.ReactNode; enabled?: boolean }) {
  if (!enabled) return null;
  return (
    <Tooltip>
      <TooltipTrigger asChild>
        <button
          type="button"
          className="inline-flex items-center text-muted-foreground/80 hover:text-foreground cursor-help ml-1 align-middle transition-colors p-0.5 rounded hover:bg-muted/50"
          aria-label="Guidance note"
        >
          <Info className="h-3 w-3 text-primary/70 hover:text-primary" />
        </button>
      </TooltipTrigger>
      <TooltipContent
        side="top"
        className="max-w-xs text-xs font-normal bg-slate-900 text-slate-100 dark:bg-slate-800 dark:text-slate-100 border border-slate-700 shadow-xl p-2.5 leading-relaxed z-50"
      >
        {content}
      </TooltipContent>
    </Tooltip>
  );
}

function ActionTooltip({
  content,
  children,
  enabled = true,
}: {
  content: React.ReactNode;
  children: React.ReactNode;
  enabled?: boolean;
}) {
  if (!enabled) return <>{children}</>;
  return (
    <Tooltip>
      <TooltipTrigger asChild>{children}</TooltipTrigger>
      <TooltipContent
        side="top"
        className="max-w-xs text-xs font-normal bg-slate-900 text-slate-100 dark:bg-slate-800 dark:text-slate-100 border border-slate-700 shadow-xl p-2 leading-relaxed z-50"
      >
        {content}
      </TooltipContent>
    </Tooltip>
  );
}

export const Route = createFileRoute("/underwrite")({
  // ?id=<loan id> arrives from a borrower page's "Re-rate" link.
  validateSearch: (search: Record<string, unknown>): { id?: string } => ({
    id: search.id != null && search.id !== "" ? String(search.id) : undefined,
  }),
  component: UnderwritePage,
});

interface AppraisalResult {
  pd_12m: number;
  risk_grade: string;
  rag: "Green" | "Amber" | "Red";
  sma_watch: string;
  recommended_action: string;
  review_cadence: string;
  action_owner: string;
  ecl?: number;
  ecl_stage?: number;
  reason_codes?: Array<{
    feature: string;
    label?: string;
    shap?: number;
    effect?: string;
    code?: string;
  }>;
  ews?: {
    signals?: Array<{ code: string; label: string; severity: string }>;
  };
  regulatory_overlay?: RegulatoryOverlay | null;
}

// Real accounts from the book, one per verdict colour, picked from the bundled
// snapshot at load time. Hand-written labels went stale whenever the book was
// re-scored ("Early stress" ended up opening an RG9 / Red account), so the label
// and tooltip are built from the account's own stored grade and fields.
const RAG_GRADES: Record<"Green" | "Amber" | "Red", number[]> = {
  Green: [1, 2, 3, 4],
  Amber: [5, 6, 7],
  Red: [8, 9, 10],
};

function pickSampleAccounts(branchCode?: string): Array<{ id: string; label: string; tip: string }> {
  const book = getSnapshot().borrowers.filter(
    (b) => b.segment === "msme_idbi" && (!branchCode || b.branch_code === branchCode),
  );
  const out: Array<{ id: string; label: string; tip: string }> = [];
  for (const rag of ["Green", "Amber", "Red"] as const) {
    const pool = book.filter((b) => b.rag === rag);
    // Prefer accounts whose colour comes from the model grade rather than a DPD escalation.
    const byGrade = pool.filter((b) => RAG_GRADES[rag].includes(parseInt(b.risk_grade.replace(/\D/g, ""), 10)));
    const candidates = (byGrade.length ? byGrade : pool).slice().sort((x, y) => x.pd - y.pd);
    const acct = candidates[Math.floor(candidates.length / 2)];
    if (!acct) continue;
    const raw = (acct.raw ?? {}) as Record<string, number | string | undefined>;
    const sector = String(acct.sector ?? "msme").replace(/_/g, " ");
    const facts = [
      `${formatInrCompact(Number(raw.sanction_limit ?? acct.ead ?? 0))} limit`,
      raw.cibil_score != null ? `CIBIL ${raw.cibil_score}` : null,
      raw.drawing_power_gap_pct != null ? `drawing power ${raw.drawing_power_gap_pct}% below limit` : null,
      raw.demanded_vs_collected_ratio != null
        ? `${Math.round(Number(raw.demanded_vs_collected_ratio) * 100)}% of dues collected`
        : null,
      `${Number(raw.dpd ?? 0)} days overdue`,
    ].filter(Boolean);
    out.push({
      id: acct.loan_id,
      label: `${sector.replace(/\b\w/g, (c) => c.toUpperCase())} · ${acct.risk_grade} ${rag}`,
      tip: `${facts.join(", ")}. Stored verdict: ${acct.risk_grade} / ${rag}, PD ${formatPercent(acct.pd, 1)}. Click to load it and re-run the appraisal.`,
    });
  }
  return out;
}

const SAMPLE_ACCOUNTS = pickSampleAccounts();

// The sectors the model was trained on. A value outside this list is an unseen
// category to the model, and a fetched account's sector would show blank here.
const SECTORS: Array<[string, string]> = [
  ["agri_processing", "Agri Processing"],
  ["auto_components", "Auto Components"],
  ["construction", "Construction"],
  ["food_processing", "Agro & Food Processing"],
  ["hospitality", "Hospitality"],
  ["it_services", "IT Services"],
  ["pharma", "Pharma & Chemicals"],
  ["retail_trade", "Retail & Wholesale"],
  ["textiles", "Textiles & Garments"],
  ["transport", "Transport & Logistics"],
];

function newProposalId(): string {
  const d = new Date();
  const ymd = `${d.getFullYear()}${String(d.getMonth() + 1).padStart(2, "0")}${String(d.getDate()).padStart(2, "0")}`;
  return `IDBI-APP-${ymd}-${Math.random().toString(36).slice(2, 6).toUpperCase()}`;
}

export function UnderwritePage() {
  const caps = useCapabilities();
  if (!caps.canDecide) {
    return (
      <div className="p-4 md:p-6">
        <Card className="mx-auto max-w-xl bg-surface">
          <CardHeader>
            <CardTitle className="text-base">Loan appraisal is a controlling-office desk</CardTitle>
            <CardDescription className="text-xs">{caps.readOnlyReason}</CardDescription>
          </CardHeader>
          <CardContent className="flex flex-wrap gap-2 text-xs">
            <Button asChild size="sm" variant="outline">
              <Link to="/governance">Review the decision audit trail</Link>
            </Button>
            <Button asChild size="sm" variant="outline">
              <Link to="/">Open the portfolio (read-only)</Link>
            </Button>
          </CardContent>
        </Card>
      </div>
    );
  }
  return <UnderwriteDesk />;
}

function UnderwriteDesk() {
  const [segment, setSegment] = useState<"msme_idbi" | "msme_india">("msme_idbi");
  // A new proposal gets its own ID; fetching an account switches to re-rating
  // that account. A fixed default ID used to make every proposal overwrite the last.
  const [loanId, setLoanId] = useState(newProposalId);
  const [appraisalMode, setAppraisalMode] = useState<"new" | "rerate">("new");
  const [sanctionLimit, setSanctionLimit] = useState(2500000);
  const [drawingPower, setDrawingPower] = useState(2500000);
  const [cibilScore, setCibilScore] = useState(740);
  const [demandedRatio, setDemandedRatio] = useState(0.98);
  const [amountMode, setAmountMode] = useState<"amounts" | "ratio">("amounts");
  const [demandedAmt, setDemandedAmt] = useState<number>(300000);
  const [collectedAmt, setCollectedAmt] = useState<number>(294000);
  const [restructuringMoratorium, setRestructuringMoratorium] = useState("6m");
  const [restructuringFitl, setRestructuringFitl] = useState(true);
  const [restructuringMarginInfusion, setRestructuringMarginInfusion] = useState("15");
  const [restructuringTevAgency, setRestructuringTevAgency] = useState("IDBI In-House Technical Appraisal Cell");
  const [dpd, setDpd] = useState(0);
  const [emiBounces, setEmiBounces] = useState(0);
  const [lienFlag, setLienFlag] = useState(0);
  const [restructuringFlag, setRestructuringFlag] = useState(0);
  const [sector, setSector] = useState("auto_components");
  const [subSegment, setSubSegment] = useState("small");
  const [state, setState] = useState("MH");
  const [gstDelay, setGstDelay] = useState(4);
  const [itcMismatch, setItcMismatch] = useState(0);

  // Guided tooltips mode synced with platform-wide context
  const { tipsEnabled, setTipsEnabled } = useGuidedTips();
  const guidedTips = tipsEnabled;
  const [bannerDismissed, setBannerDismissed] = useState<boolean>(() => {
    if (typeof window !== "undefined") {
      return localStorage.getItem("drishti_underwrite_guide_banner_dismissed") === "true";
    }
    return false;
  });
  const [copiedLoanId, setCopiedLoanId] = useState(false);
  const [copiedVerdict, setCopiedVerdict] = useState(false);

  // Smooth scroll refs to the recommendation column and verdict banner
  const recommendationRef = useRef<HTMLDivElement>(null);
  const recommendationBannerRef = useRef<HTMLDivElement>(null);
  const [highlightVerdict, setHighlightVerdict] = useState(false);

  const scrollToVerdict = () => {
    setTimeout(() => {
      const target = recommendationBannerRef.current || recommendationRef.current;
      if (target) {
        target.scrollIntoView({ behavior: "smooth", block: "start" });
      }
    }, 120);
    setHighlightVerdict(true);
    setTimeout(() => setHighlightVerdict(false), 2500);
  };

  const handleCopyLoanId = async () => {
    try {
      await navigator.clipboard.writeText(loanId);
      setCopiedLoanId(true);
      setTimeout(() => setCopiedLoanId(false), 2000);
    } catch (err) {
      console.error("Clipboard copy failed", err);
    }
  };

  const handleDemandedAmtChange = (val: number) => {
    const dVal = Math.max(1, val);
    setDemandedAmt(dVal);
    const r = Math.min(1.0, Math.max(0, collectedAmt / dVal));
    setDemandedRatio(Math.round(r * 1000) / 1000);
  };

  const handleCollectedAmtChange = (val: number) => {
    const cVal = Math.max(0, val);
    setCollectedAmt(cVal);
    const r = demandedAmt > 0 ? Math.min(1.0, Math.max(0, cVal / demandedAmt)) : 1.0;
    setDemandedRatio(Math.round(r * 1000) / 1000);
  };

  // Results & submission state
  const [isScoring, setIsScoring] = useState(false);
  const [result, setResult] = useState<AppraisalResult | null>(null);
  // A verdict produced without the scoring API has to say so on the face of the
  // screen — an unlabelled approximation in a credit decision is worse than none.
  const [scoredOffline, setScoredOffline] = useState(false);
  const [scoreError, setScoreError] = useState<string | null>(null);
  const [modalOpen, setModalOpen] = useState(false);
  const [decisionType, setDecisionType] = useState<"accept" | "override" | "defer" | "reject" | "restructure">("accept");
  const [revisedGrade, setRevisedGrade] = useState("RG3");
  const [rationale, setRationale] = useState("");
  const { user } = useRole();
  const scopeBranch = useScopeBranch();
  // A branch officer's quick accounts come from their own branch.
  const sampleAccounts = useMemo(
    () => (scopeBranch ? pickSampleAccounts(scopeBranch) : SAMPLE_ACCOUNTS),
    [scopeBranch],
  );
  // Decisions are attributed to the signed-in officer, not to a free-text field.
  const officerId = user?.employeeId ? `${user.employeeId} (${user.name})` : user?.name || "UNIDENTIFIED_OFFICER";
  const [decisionFeedback, setDecisionFeedback] = useState<string | null>(null);
  const [submittedId, setSubmittedId] = useState<string | null>(null);
  const [isSubmitting, setIsSubmitting] = useState(false);
  const scoreSeq = useRef(0);

  const handleCopyVerdict = async () => {
    if (!result) return;
    const summaryText = `[DRISHTI APPRAISAL VERDICT]
Facility Ref: ${loanId}
Risk Grade: ${result.risk_grade} | 12M Calibrated PD: ${formatPercent(result.pd_12m, 2)}
RAG Status: ${result.rag} | RBI SMA: ${rbiSma(dpd) ?? "n/a"} | Model watch: ${watchLabel(result.sma_watch)}
Ind AS 109: Stage ${result.ecl_stage ?? 1} | Expected Credit Loss (ECL): ${formatInr(result.ecl ?? 0)}
Prescribed Action: ${result.recommended_action} (Cadence: ${result.review_cadence}, Owner: ${result.action_owner})
Underwriting Timestamp: ${new Date().toLocaleString()}`;
    try {
      await navigator.clipboard.writeText(summaryText);
      setCopiedVerdict(true);
      setTimeout(() => setCopiedVerdict(false), 2500);
    } catch (err) {
      console.error("Clipboard copy failed", err);
    }
  };

  // Finacle Quick-Fetch State
  const [finacleLookupId, setFinacleLookupId] = useState("");
  const [isFetchingFinacle, setIsFetchingFinacle] = useState(false);
  const [fetchFeedback, setFetchFeedback] = useState<{ msg: string; type: "success" | "error" } | null>(null);

  const executeScore = async (
    customParams?: {
      loan_id?: string;
      sanctionLimit?: number;
      drawingPower?: number;
      cibilScore?: number;
      demandedRatio?: number;
      dpd?: number;
      emiBounces?: number;
      lienFlag?: number;
      restructuringFlag?: number;
      sector?: string;
      subSegment?: string;
      state?: string;
      gstDelay?: number;
      itcMismatch?: number;
      segment?: "msme_idbi" | "msme_india";
    },
    autoScroll = false,
  ) => {
    setIsScoring(true);
    const lId = customParams?.loan_id ?? loanId;
    const sLimit = customParams?.sanctionLimit ?? sanctionLimit;
    const dPower = customParams?.drawingPower ?? drawingPower;
    const cScore = customParams?.cibilScore ?? cibilScore;
    const dRatio = customParams?.demandedRatio ?? demandedRatio;
    const dDpd = customParams?.dpd ?? dpd;
    const eBounces = customParams?.emiBounces ?? emiBounces;
    const lFlag = customParams?.lienFlag ?? lienFlag;
    const rFlag = customParams?.restructuringFlag ?? restructuringFlag;
    const sSector = customParams?.sector ?? sector;
    const sSub = customParams?.subSegment ?? subSegment;
    const sState = customParams?.state ?? state;
    const gDelay = customParams?.gstDelay ?? gstDelay;
    const iMismatch = customParams?.itcMismatch ?? itcMismatch;
    const seg = customParams?.segment ?? segment;

    const gap = Math.max(0, Math.round(((sLimit - dPower) / Math.max(1, sLimit)) * 100 * 10) / 10);
    const payload = {
      loan_id: lId,
      ticket_size: sLimit,
      sanction_limit: sLimit,
      drawing_power: dPower,
      drawing_power_gap_pct: gap,
      demanded_vs_collected_ratio: dRatio,
      cibil_score: cScore,
      dpd: dDpd,
      emi_bounce_6m: eBounces,
      lien_flag: lFlag,
      restructuring_flag: rFlag,
      sector: sSector,
      sub_segment: sSub,
      state: sState,
      gst_filing_delay_days: gDelay,
      itc_mismatch_flag: iMismatch,
    };
    // cashflow_volatility / balance_trend_pct are derived by the model's own
    // feature step (and by the offline scorer) exactly as in training.

    // Auto-score fires on every edit; only the latest request may set the verdict.
    const seq = ++scoreSeq.current;
    const res = await scoreRawBorrower(seg, payload);
    if (seq !== scoreSeq.current) return;
    setIsScoring(false);
    if (res?.status === "insufficient_data" || res?.status === "error") {
      // Clear the previous verdict so it cannot be submitted against new inputs.
      setResult(null);
      setScoreError(
        res.message ||
          "DRISHTI refused to score: too few of the model's input families were supplied for a reliable PD.",
      );
      return;
    }
    if (!res || res.pd_12m == null) {
      setResult(null);
      setScoreError(
        "Could not produce a verdict for these inputs. Check the facility parameters and run the appraisal again.",
      );
      return;
    }
    setScoreError(null);
    setScoredOffline(res.status === "fallback");
    if (res && res.pd_12m != null) {
      setResult({
        pd_12m: res.pd_12m,
        risk_grade: res.risk_grade || "RG5",
        rag: (res.rag as "Green" | "Amber" | "Red") || "Amber",
        sma_watch: res.sma_watch || "Standard",
        recommended_action: res.recommended_action || "Quarterly Review",
        review_cadence: res.review_cadence || "Quarterly",
        action_owner: res.action_owner || "Relationship Manager",
        ecl: res.ecl || Math.round(sLimit * res.pd_12m * 0.45),
        ecl_stage: res.ecl_stage || 1,
        reason_codes: res.reason_codes,
        ews: res.ews,
        regulatory_overlay: res.regulatory_overlay,
      });
      if (autoScroll) {
        scrollToVerdict();
      }
    }
  };

  const handleFinacleFetch = async (targetId?: string, autoScroll = false) => {
    const idToFetch = (targetId || finacleLookupId).trim();
    if (!idToFetch) return;
    setIsFetchingFinacle(true);
    setFetchFeedback(null);
    try {
      const b = await fetchBorrower(idToFetch);
      if (b && b.segment !== "msme_idbi") {
        // The form carries the IDBI Finacle fields only; re-rating an India-book
        // account here would score it without its GST / vintage inputs and then
        // overwrite them.
        setFetchFeedback({
          msg: `${b.loan_id} is in the ${b.segment} book, which this form cannot re-rate without losing its inputs. Open its borrower page instead.`,
          type: "error",
        });
        return;
      }
      if (b && scopeBranch && b.branch_code !== scopeBranch) {
        setFetchFeedback({
          msg: `${b.loan_id} belongs to ${b.branch_name ?? `branch ${b.branch_code}`}, not your branch (${scopeBranch}). Its own branch or the controlling office re-rates it.`,
          type: "error",
        });
        return;
      }
      if (b) {
        setLoanId(b.loan_id);
        setAppraisalMode("rerate");
        const limit = b.ead || 2500000;
        setSanctionLimit(limit);
        const raw = (b.raw || {}) as Record<string, any>;
        const dp = Number(raw.drawing_power ?? b.ead ?? 2500000);
        setDrawingPower(dp);
        const cibil = Number(raw.cibil_score ?? 740);
        setCibilScore(cibil);
        const dem = Number(raw.demanded_vs_collected_ratio ?? 0.98);
        setDemandedRatio(dem);
        const dAmt = Math.round(limit * 0.12);
        const cAmt = Math.round(dAmt * dem);
        setDemandedAmt(dAmt);
        setCollectedAmt(cAmt);
        const d = Number(raw.dpd ?? 0);
        setDpd(d);
        // When the record has no bounce count, use the model's own fill-in
        // (engineer_idbi_features: from the collection ratio). Defaulting to 0
        // scored the same account lower here than on its borrower page.
        const emi = Number(
          raw.emi_bounce_6m ?? (dem < 0.7 ? 3 : dem < 0.85 ? 2 : dem < 0.95 ? 1 : 0),
        );
        setEmiBounces(emi);
        const lien = Number(raw.lien_flag ?? 0);
        setLienFlag(lien);
        const restr = Number(raw.restructuring_flag ?? 0);
        setRestructuringFlag(restr);
        const sec = b.sector || sector;
        if (b.sector) setSector(b.sector);
        const sub = b.sub_segment || subSegment;
        if (b.sub_segment) setSubSegment(b.sub_segment);
        const st = b.state || state;
        if (b.state) setState(b.state);
        const gst = Number(raw.gst_filing_delay_days ?? 0);
        setGstDelay(gst);
        const itc = Number(raw.itc_mismatch_flag ?? 0);
        setItcMismatch(itc);
        const seg = b.segment === "msme_india" ? "msme_india" : "msme_idbi";
        setSegment(seg);
        setFetchFeedback({
          msg: `Loaded ${b.loan_id} (${b.branch_name || "branch not recorded"}) from the demo book for re-rating. In the bank this fetch would call the CBS APIs (402, 404, 391, 441, 362).`,
          type: "success",
        });

        await executeScore(
          {
            loan_id: b.loan_id,
            sanctionLimit: limit,
            drawingPower: dp,
            cibilScore: cibil,
            demandedRatio: dem,
            dpd: d,
            emiBounces: emi,
            lienFlag: lien,
            restructuringFlag: restr,
            sector: sec,
            subSegment: sub,
            state: st,
            gstDelay: gst,
            itcMismatch: itc,
            segment: seg,
          },
          autoScroll,
        );
      } else {
        setFetchFeedback({
          msg: `Account "${idToFetch}" is not in the demo book.`,
          type: "error",
        });
      }
    } catch {
      setFetchFeedback({
        msg: "Error communicating with Finacle Core Banking API.",
        type: "error",
      });
    } finally {
      setIsFetchingFinacle(false);
      // Success notes fade; an error stays until the next fetch so it can be read.
      setTimeout(() => setFetchFeedback((f) => (f?.type === "success" ? null : f)), 4000);
    }
  };

  const applyPreset = async (preset: "prime" | "early_stress" | "distressed", autoScroll = false) => {
    // A preset is a hypothetical proposal, never an edit of a fetched account.
    setLoanId(newProposalId());
    setAppraisalMode("new");
    setFetchFeedback(null);
    let limit = 2500000;
    let dp = 2500000;
    let cibil = 770;
    let dem = 1.0;
    let d = 0;
    let emi = 0;
    let lien = 0;
    let restr = 0;
    let gst = 2;
    let itc = 0;

    if (preset === "prime") {
      limit = 3000000;
      dp = 3000000;
      cibil = 770;
      dem = 1.0;
      d = 0;
      emi = 0;
      lien = 0;
      restr = 0;
      gst = 2;
      itc = 0;
    } else if (preset === "early_stress") {
      limit = 2500000;
      // 12% drawing-power gap. At 28% the model already reads RG10 / Red: it is
      // very steep in this feature on the synthetic data, so a 28% gap is not
      // "early" stress for it.
      dp = 2200000;
      cibil = 645;
      dem = 0.85;
      d = 25;
      emi = 2;
      lien = 0;
      restr = 0;
      gst = 18;
      itc = 1;
    } else {
      limit = 4000000;
      dp = 2200000;
      cibil = 570;
      dem = 0.68;
      d = 65;
      emi = 4;
      lien = 1;
      restr = 1;
      gst = 45;
      itc = 1;
    }

    setSanctionLimit(limit);
    setDrawingPower(dp);
    setCibilScore(cibil);
    setDemandedRatio(dem);
    const dAmt = Math.round(limit * 0.12);
    const cAmt = Math.round(dAmt * dem);
    setDemandedAmt(dAmt);
    setCollectedAmt(cAmt);
    setDpd(d);
    setEmiBounces(emi);
    setLienFlag(lien);
    setRestructuringFlag(restr);
    setGstDelay(gst);
    setItcMismatch(itc);

    await executeScore(
      {
        sanctionLimit: limit,
        drawingPower: dp,
        cibilScore: cibil,
        demandedRatio: dem,
        dpd: d,
        emiBounces: emi,
        lienFlag: lien,
        restructuringFlag: restr,
        gstDelay: gst,
        itcMismatch: itc,
      },
      autoScroll,
    );
  };

  const dpGapPct = Math.max(
    0,
    Math.round(((sanctionLimit - drawingPower) / Math.max(1, sanctionLimit)) * 100 * 10) / 10,
  );

  const { id: deepLinkId } = Route.useSearch();
  useEffect(() => {
    if (!deepLinkId) return;
    setFinacleLookupId(deepLinkId);
    handleFinacleFetch(deepLinkId, true);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [deepLinkId]);

  const handleScore = async (autoScroll = false) => {
    await executeScore(undefined, autoScroll);
  };

  useEffect(() => {
    const timer = setTimeout(() => {
      handleScore();
    }, 250);
    return () => clearTimeout(timer);
  }, [
    sanctionLimit,
    drawingPower,
    cibilScore,
    demandedRatio,
    dpd,
    emiBounces,
    lienFlag,
    restructuringFlag,
    sector,
    subSegment,
    state,
    gstDelay,
    itcMismatch,
    segment,
  ]);

  const handleLogDecision = async () => {
    if (!result || isSubmitting) return;
    setIsSubmitting(true);
    try {
      await logDecision();
    } finally {
      setIsSubmitting(false);
    }
  };

  const logDecision = async () => {
    if (!result) return;
    const res = await submitUnderwriting({
      loan_id: loanId,
      segment: segment,
      sanction_limit: sanctionLimit,
      drawing_power: drawingPower,
      cibil_score: cibilScore,
      demanded_vs_collected_ratio: demandedRatio,
      dpd: dpd,
      emi_bounce_6m: emiBounces,
      lien_flag: lienFlag,
      restructuring_flag: restructuringFlag,
      gst_filing_delay_days: gstDelay,
      itc_mismatch_flag: itcMismatch,
      sector: sector,
      sub_segment: subSegment,
      state: state,
      mode: appraisalMode,
      // A branch officer's new proposal is booked to their branch.
      branch_code: scopeBranch,
      decision: decisionType,
      revised_grade: decisionType === "override" ? revisedGrade : undefined,
      override_action: decisionType === "override"
        ? `Override to ${revisedGrade}`
        : decisionType === "restructure"
        ? `MSME Restructuring: Moratorium ${restructuringMoratorium}, FITL ${restructuringFitl ? "Yes" : "No"}, Margin ${restructuringMarginInfusion}% (${restructuringTevAgency})`
        : undefined,
      rationale: decisionType === "restructure"
        ? `[RBI MSME RESTRUCTURING & TEV STUDY] Moratorium: ${restructuringMoratorium} | FITL: ${restructuringFitl ? "Approved" : "None"} | Promoter Margin: +${restructuringMarginInfusion}% | Agency: ${restructuringTevAgency}. ${rationale.trim()}`
        : (rationale.trim() || `Underwriting appraisal decision logged by ${officerId}`),
      officer: officerId,
      role: "Branch Credit Appraisal Officer",
    });

    if (res && res.status === "conflict") {
      setDecisionFeedback(res.detail || "This loan ID is already in the book. Fetch it to re-rate it.");
      return;
    }
    if (res && res.status === "success") {
      setDecisionFeedback(
        appraisalMode === "rerate"
          ? `Re-rating of ${loanId} saved to the loan record and the audit trail.`
          : `Proposal ${loanId} added to the portfolio and the audit trail.`,
      );
      setSubmittedId(loanId);
      return;
    }

    const ok = await createDecision({
      loan_id: loanId,
      segment: segment,
      decision: decisionType,
      proposed_action: result.recommended_action,
      proposed_sma: result.sma_watch,
      pd: result.pd_12m,
      risk_grade: result.risk_grade,
      original_grade: result.risk_grade,
      revised_grade: decisionType === "override" ? revisedGrade : undefined,
      override_action: decisionType === "override"
        ? `Override to ${revisedGrade}`
        : decisionType === "restructure"
        ? `MSME Restructuring: Moratorium ${restructuringMoratorium}, FITL ${restructuringFitl ? "Yes" : "No"}, Margin ${restructuringMarginInfusion}%`
        : undefined,
      rationale: decisionType === "restructure"
        ? `[RBI MSME RESTRUCTURING & TEV STUDY] Moratorium: ${restructuringMoratorium} | FITL: ${restructuringFitl ? "Approved" : "None"} | Promoter Margin: +${restructuringMarginInfusion}% | Agency: ${restructuringTevAgency}. ${rationale.trim()}`
        : (rationale.trim() || `Underwriting appraisal decision logged by ${officerId}`),
      decided_by: officerId,
      officer: officerId,
      role: "Branch Credit Appraisal Officer",
    });

    if (ok) {
      setDecisionFeedback(
        ok === "persisted"
          ? "Decision logged to the audit trail (proposal not added to the book)."
          : "API not reachable: decision saved on this browser only and shown in the audit trail as local.",
      );
    } else {
      setDecisionFeedback("Decision not saved: the API rejected it.");
    }
  };

  return (
    <TooltipProvider delayDuration={150}>
      <div className="p-4 md:p-6 space-y-6">
        {/* Header */}
        <div className="flex flex-wrap items-start justify-between gap-3">
          <div>
            <h1 className="text-xl font-semibold text-foreground">
              Single Borrower Credit Appraisal
            </h1>
          </div>
          <div className="flex flex-wrap items-center gap-2 no-print">
            <PageApiDrawer routePath="/underwrite" triggerLabel="Active Sandbox APIs" />
            <ActionTooltip
              enabled={guidedTips}
              content="Export or print formal Credit Appraisal Memo (CAM) formatted for Zonal Credit Committee review."
            >
              <Button
                variant="outline"
                size="sm"
                onClick={() => window.print()}
                disabled={!result}
                className="gap-1.5 h-8 text-xs"
              >
                <Printer className="h-3.5 w-3.5" /> Export CAM Dossier
              </Button>
            </ActionTooltip>
            {result && (
              <Dialog open={modalOpen} onOpenChange={setModalOpen}>
                <DialogTrigger asChild>
                  <Button size="sm" className="gap-1.5 h-8 text-xs bg-primary text-primary-foreground">
                    <Send className="h-3.5 w-3.5" /> Submit to Credit Committee
                  </Button>
                </DialogTrigger>
                <DialogContent className="max-w-md">
                  <DialogHeader>
                    <DialogTitle>Submit Appraisal to Credit Committee</DialogTitle>
                    <DialogDescription className="text-xs">
                      Record this appraisal proposal for {loanId} ({result.risk_grade}, PD{" "}
                      {formatPercent(result.pd_12m, 1)}) into the audit log.
                    </DialogDescription>
                  </DialogHeader>
                  <div className="space-y-3 py-2 text-xs">
                    <div>
                      <Label className="text-xs font-medium">Proposed Committee Action</Label>
                      <Select
                        value={decisionType}
                        onValueChange={(v: any) => setDecisionType(v)}
                      >
                        <SelectTrigger className="mt-1 h-8">
                          <SelectValue />
                        </SelectTrigger>
                        <SelectContent>
                          <SelectItem value="accept">Sanction as Appraised ({result.risk_grade})</SelectItem>
                          <SelectItem value="override">Sanction with Grade Override</SelectItem>
                          <SelectItem value="defer">Defer for Collateral / Field Inspection</SelectItem>
                          <SelectItem value="reject">Reject Loan Proposal</SelectItem>
                          <SelectItem value="restructure">Refer for restructuring (viability study)</SelectItem>
                        </SelectContent>
                      </Select>
                    </div>
                    {decisionType === "override" && (
                      <div>
                        <Label className="text-xs font-medium">Override Grade</Label>
                        <Select value={revisedGrade} onValueChange={setRevisedGrade}>
                          <SelectTrigger className="mt-1 h-8">
                            <SelectValue />
                          </SelectTrigger>
                          <SelectContent>
                            {["RG1", "RG2", "RG3", "RG4", "RG5", "RG6", "RG7", "RG8", "RG9", "RG10"].map((g) => (
                              <SelectItem key={g} value={g}>{g}</SelectItem>
                            ))}
                          </SelectContent>
                        </Select>
                      </div>
                    )}
                    {decisionType === "restructure" && (
                      <div className="space-y-3 rounded-md border border-purple-500/30 bg-purple-50/40 dark:bg-purple-950/20 p-2.5">
                        <div className="text-[11px] font-semibold text-purple-700 dark:text-purple-300 flex items-center gap-1.5">
                          <FileText className="h-3.5 w-3.5" /> Restructuring with a viability study (TEV)
                        </div>
                        <div className="text-[11px] text-muted-foreground leading-normal">
                          Corrective action under the RBI Framework for Revitalising and Rehabilitating MSMEs: a unit found viable in a Techno-Economic Viability (TEV) study can be restructured (moratorium, FITL) before recovery is considered. Asset classification follows the RBI rules in force; restructuring alone does not keep the account standard.
                        </div>
                        <div className="grid grid-cols-2 gap-2 text-xs">
                          <div>
                            <Label className="text-[11px] font-medium text-muted-foreground">Principal Moratorium</Label>
                            <Select value={restructuringMoratorium} onValueChange={setRestructuringMoratorium}>
                              <SelectTrigger className="mt-1 h-7 text-xs">
                                <SelectValue />
                              </SelectTrigger>
                              <SelectContent>
                                <SelectItem value="3m">3 Months</SelectItem>
                                <SelectItem value="6m">6 Months</SelectItem>
                                <SelectItem value="9m">9 Months</SelectItem>
                                <SelectItem value="12m">12 Months</SelectItem>
                              </SelectContent>
                            </Select>
                          </div>
                          <div>
                            <Label className="text-[11px] font-medium text-muted-foreground">Promoter Margin Infusion</Label>
                            <Select value={restructuringMarginInfusion} onValueChange={setRestructuringMarginInfusion}>
                              <SelectTrigger className="mt-1 h-7 text-xs">
                                <SelectValue />
                              </SelectTrigger>
                              <SelectContent>
                                <SelectItem value="10">+10% Fresh Capital</SelectItem>
                                <SelectItem value="15">+15% Fresh Capital</SelectItem>
                                <SelectItem value="20">+20% Fresh Capital</SelectItem>
                                <SelectItem value="25">+25% Fresh Capital</SelectItem>
                              </SelectContent>
                            </Select>
                          </div>
                        </div>
                        <div className="space-y-1">
                          <Label className="text-[11px] font-medium text-muted-foreground">Techno-Economic Viability (TEV) Agency</Label>
                          <Input
                            value={restructuringTevAgency}
                            onChange={(e) => setRestructuringTevAgency(e.target.value)}
                            className="h-7 text-xs font-mono"
                            placeholder="Empaneled TEV Consultant / IDBI Appraisal Cell"
                          />
                        </div>
                        <div className="flex items-center justify-between text-xs pt-1 border-t border-purple-500/20">
                          <span className="text-[11px] font-medium">Funded Interest Term Loan (FITL)</span>
                          <label className="flex items-center gap-1.5 cursor-pointer text-[11px]">
                            <input
                              type="checkbox"
                              checked={restructuringFitl}
                              onChange={(e) => setRestructuringFitl(e.target.checked)}
                              className="rounded border-input text-primary"
                            />
                            <span>Convert Overdue Interest</span>
                          </label>
                        </div>
                      </div>
                    )}
                    <div>
                      <Label className="text-xs font-medium">Appraisal Rationale / Mitigating Covenants</Label>
                      <Textarea
                        value={rationale}
                        onChange={(e) => setRationale(e.target.value)}
                        placeholder="e.g. Primary collateral personal guarantee verified; drawing power covenant capped at 85%."
                        className="mt-1 text-xs"
                        rows={3}
                      />
                    </div>
                    <div>
                      <Label className="text-xs font-medium">Appraisal Officer ID</Label>
                      <Input
                        value={officerId}
                        readOnly
                        className="mt-1 h-8 text-xs font-mono bg-muted"
                      />
                    </div>
                    {decisionFeedback && (
                      <div className="rounded bg-muted p-2 text-xs text-primary">{decisionFeedback}</div>
                    )}
                    {submittedId ? (
                      <div className="grid grid-cols-2 gap-2">
                        <Button asChild variant="outline" className="text-xs">
                          <Link to="/borrowers/$id" params={{ id: submittedId }}>
                            Open account
                          </Link>
                        </Button>
                        <Button
                          className="text-xs"
                          onClick={() => {
                            setModalOpen(false);
                            setDecisionFeedback(null);
                            setSubmittedId(null);
                            setLoanId(newProposalId());
                            setAppraisalMode("new");
                          }}
                        >
                          New proposal
                        </Button>
                      </div>
                    ) : (
                      <Button onClick={handleLogDecision} disabled={isSubmitting} className="w-full text-xs">
                        {appraisalMode === "rerate" ? `Confirm re-rating of ${loanId}` : "Confirm & add proposal to the book"}
                      </Button>
                    )}
                  </div>
                </DialogContent>
              </Dialog>
            )}
          </div>
        </div>

        {/* First-time Guided Appraisal Banner (Dismissible) */}
        {guidedTips && !bannerDismissed && (
          <div className="flex items-start justify-between gap-3 rounded-lg border border-primary/30 bg-primary/5 p-3 text-xs text-foreground no-print animate-in fade-in slide-in-from-top-2">
            <div className="flex items-start gap-2.5">
              <HelpCircle className="h-4 w-4 text-primary shrink-0 mt-0.5" />
              <div>
                <span className="font-semibold text-primary">Interactive Underwriting Guide Active</span>
                <p className="mt-0.5 text-muted-foreground text-[11px] leading-relaxed">
                  Hover over the <Info className="inline h-3 w-3 text-primary/80" /> icons or CBS account chips to view regulatory definitions for Drawing Power erosion, Demanded Ratio, DPD, Lien Flags, and GST delays. Clicking any chip or preset will auto-populate Finacle parameters and smoothly scroll down to the Plain-English verdict.
                </p>
              </div>
            </div>
            <div className="flex items-center gap-1.5 shrink-0">
              <Button
                variant="ghost"
                size="sm"
                className="h-6 px-2 text-[11px] text-muted-foreground hover:text-foreground"
                onClick={() => {
                  setBannerDismissed(true);
                  localStorage.setItem("drishti_underwrite_guide_banner_dismissed", "true");
                }}
              >
                Dismiss
              </Button>
              <Button
                variant="outline"
                size="sm"
                className="h-6 px-2 text-[11px] text-muted-foreground hover:text-foreground border-border/80"
                onClick={() => setTipsEnabled(false)}
              >
                Turn Off Hints
              </Button>
            </div>
          </div>
        )}

        {/* 1-Click Finacle Core Banking Quick-Fetch & Preset Bar */}
        <Card className="border-border/80 bg-surface shadow-sm no-print">
          <CardContent className="p-3.5 sm:p-4 space-y-3">
            <div className="flex flex-col md:flex-row md:items-center justify-between gap-3">
              <div className="flex flex-wrap items-center gap-2">
                <Database className="h-4 w-4 text-blue-600 shrink-0" />
                <span className="text-xs font-semibold text-foreground">
                  Finacle CBS Quick-Fetch
                </span>
                <Link
                  to="/architecture"
                  hash="api-matrix"
                  className="hidden sm:inline-flex items-center gap-1 text-[11px] font-mono text-muted-foreground hover:text-primary transition-colors bg-muted/60 hover:bg-muted px-2 py-0.5 rounded border border-border/80"
                  title="View IDBI Sandbox API Lineage Matrix"
                >
                  <Workflow className="h-3 w-3 text-primary" />
                  <span>5 APIs: 402, 404, 391, 441, 362</span>
                  <ExternalLink className="h-2.5 w-2.5 opacity-60" />
                </Link>
                <PageApiDrawer
                  routePath="/underwrite"
                  triggerLabel="CBS APIs"
                  variant="pill"
                />
              </div>

              {/* Quick Fetch Bar */}
              <div className="flex items-center gap-2">
                <ActionTooltip
                  enabled={guidedTips}
                  content="Enter any valid IDBI Core Banking loan facility number (e.g. IDBI_LN_100361) and press Enter or click Fetch CBS."
                >
                  <div className="relative w-48 sm:w-56">
                    <Search className="pointer-events-none absolute left-2 top-1/2 h-3.5 w-3.5 -translate-y-1/2 text-muted-foreground" />
                    <Input
                      value={finacleLookupId}
                      onChange={(e) => setFinacleLookupId(e.target.value)}
                      onKeyDown={(e) => {
                        if (e.key === "Enter") handleFinacleFetch(undefined, true);
                      }}
                      placeholder="e.g. IDBI_LN_100361"
                      className="h-7 pl-7 font-mono text-xs"
                    />
                  </div>
                </ActionTooltip>
                <ActionTooltip
                  enabled={guidedTips}
                  content="Direct Core Banking System query: Ingests sanctioned facility limits, drawing power from stock registers, past 6-month cheque bounces, and overdue DPD without manual data re-entry."
                >
                  <Button
                    variant="outline"
                    size="sm"
                    onClick={() => handleFinacleFetch(undefined, true)}
                    disabled={isFetchingFinacle || !finacleLookupId.trim()}
                    className="h-7 text-xs border-blue-500/40 text-blue-600 hover:bg-blue-500/10"
                  >
                    {isFetchingFinacle ? (
                      <Loader2 className="h-3 w-3 animate-spin mr-1" />
                    ) : (
                      <Database className="h-3 w-3 mr-1" />
                    )}
                    Fetch CBS
                  </Button>
                </ActionTooltip>
              </div>
            </div>

            {/* Quick Account Chips & Archetypes */}
            <div className="flex flex-wrap items-center justify-between gap-2 border-t border-border/60 pt-2.5">
              <div className="flex flex-wrap items-center gap-1.5">
                <span className="text-[11px] text-muted-foreground font-medium flex items-center">
                  Quick CBS Accounts:
                  <HelpTip
                    enabled={guidedTips}
                    content="One real account from the book per verdict colour (Green, Amber, Red), chosen from the current scores."
                  />
                </span>
                {sampleAccounts.map((acct) => (
                  <ActionTooltip key={acct.id} enabled={guidedTips} content={acct.tip}>
                    <Button
                      variant="secondary"
                      size="sm"
                      className="h-6 text-[11px] px-2 font-mono"
                      onClick={() => {
                        setFinacleLookupId(acct.id);
                        handleFinacleFetch(acct.id, true);
                      }}
                    >
                      {acct.id} ({acct.label})
                    </Button>
                  </ActionTooltip>
                ))}
              </div>

              <div className="flex flex-wrap items-center gap-1.5">
                <span className="text-[11px] text-muted-foreground font-medium flex items-center">
                  Stress Presets:
                  <HelpTip
                    enabled={guidedTips}
                    content="One-click stress archetypes to simulate instant transition between prime performing, incipient watch, and sub-standard asset tiers."
                  />
                </span>
                <ActionTooltip
                  enabled={guidedTips}
                  content="Prime Baseline: Sets benchmark Grade RG1/RG2 credit facility parameters with clean conduct."
                >
                  <Button
                    variant="outline"
                    size="sm"
                    className="h-6 text-[11px] px-2"
                    onClick={() => applyPreset("prime", true)}
                  >
                    Prime
                  </Button>
                </ActionTooltip>
                <ActionTooltip
                  enabled={guidedTips}
                  content="SMA-0 early stress: 25 days past due, 2 EMI bounces, drawing power 12% below the limit, CIBIL 645."
                >
                  <Button
                    variant="outline"
                    size="sm"
                    className="h-6 text-[11px] px-2 text-amber-600 border-amber-500/30 hover:bg-amber-500/10"
                    onClick={() => applyPreset("early_stress", true)}
                  >
                    SMA-0
                  </Button>
                </ActionTooltip>
                <ActionTooltip
                  enabled={guidedTips}
                  content="SMA-2 Severe Stress: Simulates 65 DPD, statutory tax lien, 45% DP erosion, and 4 bounces."
                >
                  <Button
                    variant="outline"
                    size="sm"
                    className="h-6 text-[11px] px-2 text-rose-600 border-rose-500/30 hover:bg-rose-500/10"
                    onClick={() => applyPreset("distressed", true)}
                  >
                    SMA-2
                  </Button>
                </ActionTooltip>
              </div>
            </div>

            {fetchFeedback && (
              <div
                className={`rounded-md p-2 text-xs flex items-center gap-1.5 ${
                  fetchFeedback.type === "success"
                    ? "bg-emerald-500/10 text-emerald-600 border border-emerald-500/20"
                    : "bg-rose-500/10 text-rose-600 border border-rose-500/20"
                }`}
              >
                {fetchFeedback.type === "success" ? (
                  <Check className="h-3.5 w-3.5" />
                ) : (
                  <AlertTriangle className="h-3.5 w-3.5" />
                )}
                <span>{fetchFeedback.msg}</span>
              </div>
            )}
          </CardContent>
        </Card>

        {/* Main Grid: Form Inputs vs Scoring Output */}
        <div className="grid gap-6 lg:grid-cols-12 [&>*]:min-w-0">
          {/* Input Form Column (7 cols) */}
          <div className="space-y-4 lg:col-span-7">
            <Card className="bg-surface">
              <CardHeader className="pb-3">
                <div className="flex flex-wrap items-center justify-between gap-2">
                  <CardTitle className="text-sm font-semibold">1. Proposal & Facility Particulars</CardTitle>
                  <div className="flex items-center gap-1.5">
                    <Badge variant="outline" className="text-[11px] font-mono border-blue-500/30 text-blue-600 bg-blue-50/40 dark:bg-blue-950/40">
                      CBS-04 · Facility
                    </Badge>
                    <Badge variant="outline" className="text-[11px] font-mono border-blue-500/30 text-blue-600 bg-blue-50/40 dark:bg-blue-950/40">
                      CBS-03 · Limits
                    </Badge>
                  </div>
                </div>
              </CardHeader>
              <CardContent className="space-y-4 text-xs">
                <div className="grid gap-3 sm:grid-cols-3">
                  <div>
                    <div className="flex items-center justify-between">
                      <Label className="text-[11px] text-muted-foreground flex items-center">
                        Borrower Ref / Loan ID
                        <HelpTip
                          enabled={guidedTips}
                          content="Unique Core Banking facility identifier. Click the copy icon to copy to clipboard for CAM or Finacle CBS lookup."
                        />
                      </Label>
                      <button
                        type="button"
                        onClick={handleCopyLoanId}
                        className="inline-flex items-center gap-1 text-[11px] text-primary hover:underline font-mono"
                        title="Copy Loan ID"
                      >
                        {copiedLoanId ? <Check className="h-2.5 w-2.5 text-emerald-500" /> : <Copy className="h-2.5 w-2.5" />}
                        {copiedLoanId ? "Copied" : "Copy"}
                      </button>
                    </div>
                    <Input
                      value={loanId}
                      onChange={(e) => {
                        setLoanId(e.target.value);
                        setAppraisalMode("new");
                      }}
                      className="mt-1 h-8 font-mono text-xs"
                    />
                  </div>
                  <div>
                    <Label className="text-[11px] text-muted-foreground flex items-center">
                      Segment Engine
                      <HelpTip
                        enabled={guidedTips}
                        content="Select the credit risk model: IDBI Finacle (trained on native core banking transaction indicators) or India MSME (trained on cashflow & GST parameters)."
                      />
                    </Label>
                    <Select
                      value={segment}
                      onValueChange={(v: any) => setSegment(v)}
                    >
                      <SelectTrigger className="mt-1 h-8 text-xs">
                        <SelectValue />
                      </SelectTrigger>
                      <SelectContent>
                        <SelectItem value="msme_idbi">IDBI Finacle (Native APIs)</SelectItem>
                        <SelectItem value="msme_india">India MSME (Cashflow / GST)</SelectItem>
                      </SelectContent>
                    </Select>
                  </div>
                  <div>
                    <Label className="text-[11px] text-muted-foreground flex items-center">
                      MSME Sub-Segment
                      <HelpTip
                        enabled={guidedTips}
                        content="Classification under MSMED Act 2020: Micro (< ₹1 Cr investment), Small (₹1–5 Cr investment), Medium (₹5–25 Cr investment)."
                      />
                    </Label>
                    <Select value={subSegment} onValueChange={setSubSegment}>
                      <SelectTrigger className="mt-1 h-8 text-xs">
                        <SelectValue />
                      </SelectTrigger>
                      <SelectContent>
                        <SelectItem value="micro">Micro (&lt; ₹1 Cr)</SelectItem>
                        <SelectItem value="small">Small (₹1–5 Cr)</SelectItem>
                        <SelectItem value="medium">Medium (₹5–25 Cr)</SelectItem>
                      </SelectContent>
                    </Select>
                  </div>
                </div>

                <div className="grid gap-3 sm:grid-cols-3">
                  <div>
                    <Label className="text-[11px] text-muted-foreground flex items-center">
                      Sanction Limit (INR)
                      <HelpTip
                        enabled={guidedTips}
                        content="Total credit facility limit sanctioned by the credit committee. Serves as Exposure at Default (EAD) ceiling."
                      />
                    </Label>
                    <Input
                      type="number"
                      min={50000}
                      step={50000}
                      required
                      value={sanctionLimit}
                      onChange={(e) => setSanctionLimit(Number(e.target.value))}
                      className="mt-1 h-8 text-xs font-mono"
                    />
                  </div>
                  <div>
                    <Label className="text-[11px] text-muted-foreground flex items-center">
                      Assessed Drawing Power (INR)
                      <HelpTip
                        enabled={guidedTips}
                        content="Drawing Power (DP) = (Eligible Paid Stock + Book Debts within 90 days) minus stipulated bank margin. Bank disbursements must remain capped within DP."
                      />
                    </Label>
                    <Input
                      type="number"
                      min={0}
                      step={50000}
                      required
                      value={drawingPower}
                      onChange={(e) => setDrawingPower(Number(e.target.value))}
                      className="mt-1 h-8 text-xs font-mono"
                    />
                  </div>
                  <div>
                    <Label className="text-[11px] text-muted-foreground flex items-center">
                      DP Erosion Gap (%)
                      <HelpTip
                        enabled={guidedTips}
                        content="Percentage shortfall between Sanction Limit and current Assessed DP. Shortfall >= 25% triggers mandatory RBI Early Warning Signal EWS18."
                      />
                    </Label>
                    <div className="mt-1 flex h-8 items-center rounded-md border border-input bg-muted px-2 font-mono text-xs font-semibold">
                      {dpGapPct}%
                      {dpGapPct >= 25 && (
                        <span className="ml-auto text-[11px] text-rose-500 font-semibold">EWS18 Alert</span>
                      )}
                    </div>
                  </div>
                </div>

                <div className="grid gap-3 sm:grid-cols-3">
                  <div>
                    <Label className="text-[11px] text-muted-foreground flex items-center">
                      Industry Sector
                      <HelpTip
                        enabled={guidedTips}
                        content="Primary borrower activity sector. Baseline default hazards and cyclical macroeconomic trends are weighted per sector."
                      />
                    </Label>
                    <Select value={sector} onValueChange={setSector}>
                      <SelectTrigger className="mt-1 h-8 text-xs">
                        <SelectValue />
                      </SelectTrigger>
                      <SelectContent>
                        {SECTORS.map(([value, name]) => (
                          <SelectItem key={value} value={value}>
                            {name}
                          </SelectItem>
                        ))}
                      </SelectContent>
                    </Select>
                  </div>
                  <div>
                    <Label className="text-[11px] text-muted-foreground flex items-center">
                      State Jurisdiction
                      <HelpTip
                        enabled={guidedTips}
                        content="Two-letter state postal code governing local stamp duty, DRT jurisdiction, and state industrial subsidies."
                      />
                    </Label>
                    <Input
                      value={state}
                      onChange={(e) => setState(e.target.value.toUpperCase())}
                      maxLength={2}
                      className="mt-1 h-8 font-mono text-xs uppercase"
                    />
                  </div>
                  <div>
                    <Label className="text-[11px] text-muted-foreground flex items-center">
                      CIBIL Bureau Score
                      <HelpTip
                        enabled={guidedTips}
                        content="Bureau credit score (300–900). Scores >= 750 reflect prime credit; scores < 650 incur substantial default risk surcharges."
                      />
                    </Label>
                    <Input
                      type="number"
                      min={300}
                      max={900}
                      step={1}
                      required
                      value={cibilScore}
                      onChange={(e) => setCibilScore(Number(e.target.value))}
                      className="mt-1 h-8 font-mono text-xs"
                    />
                  </div>
                </div>
              </CardContent>
            </Card>

            <Card className="bg-surface">
              <CardHeader className="pb-3">
                <div className="flex flex-wrap items-center justify-between gap-2">
                  <div className="flex items-center gap-2">
                    <CardTitle className="text-sm font-semibold">2. Repayment Health &amp; Early Warning Metrics</CardTitle>
                    <div className="flex items-center gap-1 bg-muted/60 p-0.5 rounded border border-border text-[11px]">
                      <button
                        type="button"
                        onClick={() => setAmountMode("amounts")}
                        className={cn(
                          "px-2 py-0.5 rounded transition-colors text-[11px] font-medium",
                          amountMode === "amounts" ? "bg-background text-foreground shadow-xs" : "text-muted-foreground hover:text-foreground"
                        )}
                      >
                        ₹ Amounts (Finacle 404)
                      </button>
                      <button
                        type="button"
                        onClick={() => setAmountMode("ratio")}
                        className={cn(
                          "px-2 py-0.5 rounded transition-colors text-[11px] font-medium",
                          amountMode === "ratio" ? "bg-background text-foreground shadow-xs" : "text-muted-foreground hover:text-foreground"
                        )}
                      >
                        Direct Ratio
                      </button>
                    </div>
                  </div>
                  <div className="flex flex-wrap items-center gap-1">
                    <Badge variant="outline" className="text-[11px] font-mono border-blue-500/30 text-blue-600 bg-blue-50/40 dark:bg-blue-950/40">
                      CBS-02 · Repayment
                    </Badge>
                    <Badge variant="outline" className="text-[11px] font-mono border-amber-500/30 text-amber-600 bg-amber-50/40 dark:bg-amber-950/40">
                      CBS-01 · DPD
                    </Badge>
                    <Badge variant="outline" className="text-[11px] font-mono border-purple-500/30 text-purple-600 bg-purple-50/40 dark:bg-purple-950/40">
                      ESB-01 · Bounces
                    </Badge>
                    <Badge variant="outline" className="text-[11px] font-mono border-rose-500/30 text-rose-600 bg-rose-50/40 dark:bg-rose-950/40">
                      CBS-05 · Liens
                    </Badge>
                  </div>
                </div>
              </CardHeader>
              <CardContent className="space-y-4 text-xs">
                {amountMode === "amounts" ? (
                  <>
                    <div className="grid gap-3 sm:grid-cols-3">
                      <div>
                        <Label className="text-[11px] text-muted-foreground flex items-center">
                          Demanded Dues (₹)
                          <HelpTip
                            enabled={guidedTips}
                            content="Overdue position (CBS-02): Cumulative debt-service dues demanded across trailing 12 months."
                          />
                        </Label>
                        <Input
                          type="number"
                          min={1000}
                          step={10000}
                          required
                          value={demandedAmt}
                          onChange={(e) => handleDemandedAmtChange(Number(e.target.value))}
                          className="mt-1 h-8 font-mono text-xs"
                        />
                      </div>
                      <div>
                        <Label className="text-[11px] text-muted-foreground flex items-center">
                          Collected Dues (₹)
                          <HelpTip
                            enabled={guidedTips}
                            content="Overdue position (CBS-02): Total actual cash recoveries credited against demand."
                          />
                        </Label>
                        <Input
                          type="number"
                          min={0}
                          step={10000}
                          required
                          value={collectedAmt}
                          onChange={(e) => handleCollectedAmtChange(Number(e.target.value))}
                          className="mt-1 h-8 font-mono text-xs"
                        />
                      </div>
                      <div>
                        <Label className="text-[11px] text-muted-foreground flex items-center">
                          Derived Collection Ratio
                          <HelpTip
                            enabled={guidedTips}
                            content="Collected ÷ Demanded ratio. Ratio < 0.80 triggers RBI EWS19 collection shortfall."
                          />
                        </Label>
                        <div className="mt-1 flex h-8 items-center rounded-md border border-input bg-muted px-2 font-mono text-xs font-semibold">
                          {Math.round(demandedRatio * 100)}% ({demandedRatio})
                          {demandedRatio < 0.8 && (
                            <span className="ml-auto text-[11px] text-rose-500 font-semibold">EWS19 Shortfall</span>
                          )}
                        </div>
                      </div>
                    </div>
                    <div className="grid gap-3 sm:grid-cols-2">
                      <div>
                        <Label className="text-[11px] text-muted-foreground flex items-center">
                          Current DPD (Days)
                          <HelpTip
                            enabled={guidedTips}
                            content="Days Past Due on credit obligations: 1–30 days = SMA-0; 31–60 days = SMA-1; 61–90 days = SMA-2; >90 days = NPA."
                          />
                        </Label>
                        <Input
                          type="number"
                          min={0}
                          max={90}
                          step={1}
                          required
                          value={dpd}
                          onChange={(e) => setDpd(Number(e.target.value))}
                          className="mt-1 h-8 font-mono text-xs"
                        />
                      </div>
                      <div>
                        <Label className="text-[11px] text-muted-foreground flex items-center">
                          EMI Bounces (Last 6m)
                          <HelpTip
                            enabled={guidedTips}
                            content="Count of inward check or NACH/ECS debit bounces due to insufficient funds in trailing 6 calendar months."
                          />
                        </Label>
                        <Input
                          type="number"
                          min={0}
                          max={24}
                          step={1}
                          required
                          value={emiBounces}
                          onChange={(e) => setEmiBounces(Number(e.target.value))}
                          className="mt-1 h-8 font-mono text-xs"
                        />
                      </div>
                    </div>
                  </>
                ) : (
                  <div className="grid gap-3 sm:grid-cols-3">
                    <div>
                      <Label className="text-[11px] text-muted-foreground flex items-center">
                        Demanded vs Collected
                        <HelpTip
                          enabled={guidedTips}
                          content="Ratio of debt service demanded vs cash collected over trailing 12 months. Value < 0.80 triggers RBI EWS19 collection shortfall."
                        />
                      </Label>
                      <Input
                        type="number"
                        step={0.01}
                        min={0}
                        max={1}
                        required
                        value={demandedRatio}
                        onChange={(e) => setDemandedRatio(Number(e.target.value))}
                        className="mt-1 h-8 font-mono text-xs"
                      />
                      {demandedRatio < 0.8 && (
                        <span className="text-[11px] text-rose-500 font-medium">EWS19 Shortfall</span>
                      )}
                    </div>
                    <div>
                      <Label className="text-[11px] text-muted-foreground flex items-center">
                        Current DPD (Days)
                        <HelpTip
                          enabled={guidedTips}
                          content="Days Past Due on credit obligations: 1–30 days = SMA-0; 31–60 days = SMA-1; 61–90 days = SMA-2; >90 days = NPA. Sets the RBI watch bucket and the Ind AS 109 stage floor (Stage 2 past 30 days, Stage 3 past 90). It does not move the PD: the model excludes DPD to avoid circular leakage."
                        />
                      </Label>
                      <Input
                        type="number"
                        min={0}
                        max={90}
                        step={1}
                        required
                        value={dpd}
                        onChange={(e) => setDpd(Number(e.target.value))}
                        className="mt-1 h-8 font-mono text-xs"
                      />
                    </div>
                    <div>
                      <Label className="text-[11px] text-muted-foreground flex items-center">
                        EMI Bounces (Last 6m)
                        <HelpTip
                          enabled={guidedTips}
                          content="Count of inward check or NACH/ECS debit bounces due to insufficient funds in trailing 6 calendar months."
                        />
                      </Label>
                      <Input
                        type="number"
                        min={0}
                        max={24}
                        step={1}
                        required
                        value={emiBounces}
                        onChange={(e) => setEmiBounces(Number(e.target.value))}
                        className="mt-1 h-8 font-mono text-xs"
                      />
                    </div>
                  </div>
                )}

                <div className="grid gap-3 sm:grid-cols-2">
                  <div>
                    <Label className="text-[11px] text-muted-foreground flex items-center">
                      Lien / Encumbrance Flag (CBS-05)
                      <HelpTip
                        enabled={guidedTips}
                        content="Lien enquiry (CBS-05): 1 indicates statutory tax notice, income tax attachment, GST demand, or court attachment on collateral."
                      />
                    </Label>
                    <Select value={String(lienFlag)} onValueChange={(v) => setLienFlag(Number(v))}>
                      <SelectTrigger className="mt-1 h-8 text-xs">
                        <SelectValue />
                      </SelectTrigger>
                      <SelectContent>
                        <SelectItem value="0">0 — No Encumbrance / Clean</SelectItem>
                        <SelectItem value="1">1 — Account Lien / Statutory Notice</SelectItem>
                      </SelectContent>
                    </Select>
                  </div>
                  <div>
                    <Label className="text-[11px] text-muted-foreground flex items-center">
                      Restructuring History (CBS-04)
                      <HelpTip
                        enabled={guidedTips}
                        content="Loan profile restructuring flag (CBS-04): 1 indicates past tenure extension, moratorium, or interest capitalization."
                      />
                    </Label>
                    <Select
                      value={String(restructuringFlag)}
                      onValueChange={(v) => setRestructuringFlag(Number(v))}
                    >
                      <SelectTrigger className="mt-1 h-8 text-xs">
                        <SelectValue />
                      </SelectTrigger>
                      <SelectContent>
                        <SelectItem value="0">0 — Standard / Never Restructured</SelectItem>
                        <SelectItem value="1">1 — Restructured / Extended Tenure</SelectItem>
                      </SelectContent>
                    </Select>
                  </div>
                </div>

                <div className="grid gap-3 sm:grid-cols-2">
                  <div>
                    <Label className="text-[11px] text-muted-foreground flex items-center">
                      GST Return Filing Delay (Days)
                      <HelpTip
                        enabled={guidedTips}
                        content="Average delay past the 20th monthly statutory filing deadline for GSTR-3B. Systematic delay > 30 days flags working capital distress."
                      />
                    </Label>
                    <Input
                      type="number"
                      min={0}
                      max={365}
                      step={1}
                      required
                      value={gstDelay}
                      onChange={(e) => setGstDelay(Number(e.target.value))}
                      className="mt-1 h-8 font-mono text-xs"
                    />
                  </div>
                  <div>
                    <Label className="text-[11px] text-muted-foreground flex items-center">
                      ITC Mismatch Flag (GSTR-2B vs 3B)
                      <HelpTip
                        enabled={guidedTips}
                        content="Discrepancy between Input Tax Credit claimed in GSTR-3B and suppliers' GSTR-2B filings. Material mismatch (>10%) signals potential supplier defaults or tax audit exposure."
                      />
                    </Label>
                    <Select
                      value={String(itcMismatch)}
                      onValueChange={(v) => setItcMismatch(Number(v))}
                    >
                      <SelectTrigger className="mt-1 h-8 text-xs">
                        <SelectValue />
                      </SelectTrigger>
                      <SelectContent>
                        <SelectItem value="0">0 — Mismatch &lt; 5% (Normal)</SelectItem>
                        <SelectItem value="1">1 — Material ITC Mismatch (&gt; 10%)</SelectItem>
                      </SelectContent>
                    </Select>
                  </div>
                </div>

                <ActionTooltip
                  enabled={guidedTips}
                  content="Re-scores borrower in real time using Optuna Monotone LGBM + Beta calibration and smoothly scrolls to the Plain-English recommendation verdict."
                >
                  <Button
                    onClick={() => handleScore(true)}
                    disabled={isScoring}
                    className="w-full gap-2 bg-primary text-primary-foreground hover:bg-primary/90"
                  >
                    <Calculator className="h-4 w-4" />
                    {isScoring ? "Evaluating DRISHTI AI Model..." : "Run DRISHTI AI Appraisal & View Verdict"}
                    <ArrowDown className="h-3.5 w-3.5 ml-1 opacity-80" />
                  </Button>
                </ActionTooltip>
              </CardContent>
            </Card>
          </div>

          {/* Output Column (5 cols) */}
          <div className="space-y-4 lg:col-span-5" ref={recommendationRef}>
            {scoreError && (
              <div className="rounded-lg border border-destructive/40 bg-destructive/10 p-3 text-xs text-destructive">
                {scoreError}
              </div>
            )}
            {scoredOffline && (
              <div className="rounded-lg border border-amber-500/40 bg-amber-500/10 p-3 text-xs">
                <span className="font-medium text-amber-700 dark:text-amber-400">
                  Offline reference model
                </span>
                <span className="text-muted-foreground">
                  {" "}— the live scoring service is not reachable from this deployment, so the
                  probability below is an approximation, not the trained model&apos;s output. The
                  risk grade, SMA watch bucket, early-warning rules and Ind AS 109 provision are
                  computed from it using the production thresholds. Run this appraisal against the
                  Bank&apos;s sandbox deployment for a model-grade verdict.
                </span>
              </div>
            )}
            {result ? (
              <>
                {/* Plain-English Recommendation Banner */}
                <div
                  ref={recommendationBannerRef}
                  className={cn(
                    "scroll-mt-20 transition-all duration-500 rounded-lg",
                    highlightVerdict && (
                      result.rag === "Green"
                        ? "ring-4 ring-emerald-500/80 ring-offset-2 animate-pulse shadow-2xl"
                        : result.rag === "Red"
                        ? "ring-4 ring-red-500/80 ring-offset-2 animate-pulse shadow-2xl"
                        : "ring-4 ring-amber-500/80 ring-offset-2 animate-pulse shadow-2xl"
                    )
                  )}
                >
                {result.rag === "Green" ? (
                  <div className="rounded-lg border border-emerald-500/40 bg-emerald-500/10 p-4 space-y-2.5">
                    <div className="flex items-center justify-between">
                      <ActionTooltip
                        enabled={guidedTips}
                        content="Green verdict: grade RG1–RG4 (12-month PD below 11%) and no regulatory escalation from days past due. The sanction itself stays with the delegated authority."
                      >
                        <span className="flex items-center gap-2 text-xs font-bold text-emerald-700 dark:text-emerald-400 cursor-help">
                          <CheckCircle2 className="h-4 w-4 shrink-0" />
                          RECOMMENDATION: APPROVE FACILITY SANCTION
                        </span>
                      </ActionTooltip>
                      <div className="flex items-center gap-1.5">
                        <ActionTooltip
                          enabled={guidedTips}
                          content="Green = grade RG1–RG4, i.e. calibrated 12-month PD below 11%, unless days past due escalate the account. Same bands as the portfolio and the guide."
                        >
                          <button
                            type="button"
                            className="inline-flex items-center gap-1 text-[11px] font-medium text-emerald-700 dark:text-emerald-300 underline underline-offset-2 hover:opacity-80 transition-opacity"
                          >
                            <Info className="h-3 w-3" /> Why Green?
                          </button>
                        </ActionTooltip>
                        <ActionTooltip
                          enabled={guidedTips}
                          content="Fast-Track Underwriting: Discretionary sanction delegated to Branch Credit Committee with standard annual review."
                        >
                          <Badge className="bg-emerald-500/20 text-emerald-700 dark:text-emerald-300 border-emerald-500/40 text-[11px] cursor-help">
                            Fast-Track
                          </Badge>
                        </ActionTooltip>
                      </div>
                    </div>
                    <p className="text-xs text-foreground leading-relaxed">
                      Calibrated default probability is exceptionally low at <strong>{formatPercent(result.pd_12m, 2)}</strong> (Grade <strong>{result.risk_grade}</strong>). Clean banking conduct: 0 bounces, drawing power fully backed, debt service collection ratio at <strong>{Math.round(demandedRatio * 100)}%</strong>.
                    </p>
                    <div className="rounded border border-emerald-500/20 bg-background/60 p-2 text-[11px] text-muted-foreground">
                      <strong className="text-foreground">Suggested Sanction Covenant:</strong> Standard annual review cadence. Quarterly physical stock inspection.
                    </div>
                    <div className="flex flex-wrap items-center gap-2 pt-1 border-t border-emerald-500/20">
                      <ActionTooltip
                        enabled={guidedTips}
                        content="Export or print formal Credit Appraisal Memo (CAM) formatted for Zonal Credit Committee review."
                      >
                        <Button
                          variant="outline"
                          size="sm"
                          onClick={() => window.print()}
                          className="h-7 text-[11px] gap-1 border-emerald-500/30 text-emerald-800 dark:text-emerald-200 hover:bg-emerald-500/10"
                        >
                          <Printer className="h-3 w-3" /> Quick CAM Export (PDF)
                        </Button>
                      </ActionTooltip>
                      <ActionTooltip
                        enabled={guidedTips}
                        content="Copy appraisal verdict, 12M PD, RAG category, and Ind AS 109 ECL staging summary to clipboard."
                      >
                        <Button
                          variant="ghost"
                          size="sm"
                          onClick={handleCopyVerdict}
                          className="h-7 text-[11px] gap-1 text-emerald-800 dark:text-emerald-200 hover:bg-emerald-500/10"
                        >
                          {copiedVerdict ? <Check className="h-3 w-3 text-emerald-500" /> : <Copy className="h-3 w-3" />}
                          {copiedVerdict ? "Copied Verdict Summary!" : "Copy Appraisal Verdict"}
                        </Button>
                      </ActionTooltip>
                    </div>
                  </div>
                ) : result.rag === "Amber" ? (
                  <div className="rounded-lg border border-amber-500/40 bg-amber-500/10 p-4 space-y-2.5">
                    <div className="flex items-center justify-between">
                      <ActionTooltip
                        enabled={guidedTips}
                        content="Amber verdict: grade RG5–RG7 (12-month PD 11%–32%) or a days-past-due escalation. Sanction only with covenants and committee review."
                      >
                        <span className="flex items-center gap-2 text-xs font-bold text-amber-700 dark:text-amber-400 cursor-help">
                          <AlertTriangle className="h-4 w-4 shrink-0" />
                          RECOMMENDATION: CONDITIONAL SANCTION WITH COVENANTS
                        </span>
                      </ActionTooltip>
                      <div className="flex items-center gap-1.5">
                        <ActionTooltip
                          enabled={guidedTips}
                          content="Amber = grade RG5–RG7 (12-month PD 11%–32%), or a Green grade escalated by 1–60 days past due. Sanction only with covenants and committee review."
                        >
                          <button
                            type="button"
                            className="inline-flex items-center gap-1 text-[11px] font-medium text-amber-700 dark:text-amber-300 underline underline-offset-2 hover:opacity-80 transition-opacity"
                          >
                            <Info className="h-3 w-3" /> Why Amber?
                          </button>
                        </ActionTooltip>
                        <ActionTooltip
                          enabled={guidedTips}
                          content="Incipient Stress: Breached one or more early-warning covenants (drawing power shortfall, overdue EMI, or delayed GST filing)."
                        >
                          <Badge className="bg-amber-500/20 text-amber-700 dark:text-amber-300 border-amber-500/40 text-[11px] cursor-help">
                            Incipient Stress
                          </Badge>
                        </ActionTooltip>
                      </div>
                    </div>
                    <p className="text-xs text-foreground leading-relaxed">
                      {result.regulatory_overlay?.applied ? (
                        <>
                          Account is <strong>{result.regulatory_overlay.dpd} days past due</strong> ({result.regulatory_overlay.bucket}), so RBI classification sets the watch status; model PD is{" "}
                          <strong>{formatPercent(result.pd_12m, 2)}</strong> (Grade <strong>{result.risk_grade}</strong>).
                        </>
                      ) : (
                        <>
                          Moderate risk detected: 12-month PD of <strong>{formatPercent(result.pd_12m, 2)}</strong> (Grade <strong>{result.risk_grade}</strong>).
                        </>
                      )}
                      {dpGapPct > 0 && ` Drawing power is eroded by ${dpGapPct}%.`}
                      {emiBounces > 0 && ` ${emiBounces} EMI bounce(s) in last 6 months.`}
                      {gstDelay > 10 && ` GST delay of ${gstDelay} days.`}
                    </p>
                    <div className="rounded border border-amber-500/20 bg-background/60 p-2 text-[11px] text-muted-foreground space-y-1">
                      <strong className="text-foreground">Mandatory Covenants:</strong>
                      <ol className="list-decimal pl-4 space-y-0.5">
                        <li>Demand 15% margin enhancement or collateral top-up within 30 days.</li>
                        <li>Mandate monthly drawing power audit by chartered surveyor.</li>
                        <li>Covenant: Cap facility drawdowns to assessed drawing power ({formatInr(drawingPower)}).</li>
                      </ol>
                    </div>
                    <div className="flex flex-wrap items-center gap-2 pt-1 border-t border-amber-500/20">
                      <ActionTooltip
                        enabled={guidedTips}
                        content="Refer for MSME restructuring with a Techno-Economic Viability (TEV) study before recovery action."
                      >
                        <Button
                          variant="outline"
                          size="sm"
                          onClick={() => {
                            setDecisionType("restructure");
                            setModalOpen(true);
                          }}
                          className="h-7 text-[11px] gap-1 border-purple-500/40 text-purple-800 dark:text-purple-300 hover:bg-purple-500/10"
                        >
                          <FileText className="h-3 w-3 text-purple-600 dark:text-purple-400" /> 📋 Refer for restructuring
                        </Button>
                      </ActionTooltip>
                      <ActionTooltip
                        enabled={guidedTips}
                        content="Export or print formal Credit Appraisal Memo (CAM) formatted for Zonal Credit Committee review."
                      >
                        <Button
                          variant="outline"
                          size="sm"
                          onClick={() => window.print()}
                          className="h-7 text-[11px] gap-1 border-amber-500/30 text-amber-800 dark:text-amber-200 hover:bg-amber-500/10"
                        >
                          <Printer className="h-3 w-3" /> Quick CAM Export (PDF)
                        </Button>
                      </ActionTooltip>
                      <ActionTooltip
                        enabled={guidedTips}
                        content="Copy appraisal verdict, 12M PD, RAG category, and Ind AS 109 ECL staging summary to clipboard."
                      >
                        <Button
                          variant="ghost"
                          size="sm"
                          onClick={handleCopyVerdict}
                          className="h-7 text-[11px] gap-1 text-amber-800 dark:text-amber-200 hover:bg-amber-500/10"
                        >
                          {copiedVerdict ? <Check className="h-3 w-3 text-emerald-500" /> : <Copy className="h-3 w-3" />}
                          {copiedVerdict ? "Copied Verdict Summary!" : "Copy Appraisal Verdict"}
                        </Button>
                      </ActionTooltip>
                    </div>
                  </div>
                ) : (
                  <div className="rounded-lg border border-red-500/40 bg-red-500/10 p-4 space-y-2.5">
                    <div className="flex items-center justify-between">
                      <ActionTooltip
                        enabled={guidedTips}
                        content="Red verdict: grade RG8–RG10 (12-month PD 32% or more) or 61+ days past due. Do not enhance; refer for restructuring assessment or recovery."
                      >
                        <span className="flex items-center gap-2 text-xs font-bold text-red-700 dark:text-red-400 cursor-help">
                          <AlertOctagon className="h-4 w-4 shrink-0" />
                          RECOMMENDATION: REJECT PROPOSAL / COMMENCE RECOVERY
                        </span>
                      </ActionTooltip>
                      <div className="flex items-center gap-1.5">
                        <ActionTooltip
                          enabled={guidedTips}
                          content="Red Criteria: High default probability (> 12.0%) or critical RBI triggers breached: severe DP erosion >= 25% (EWS18), debt service collection shortfall < 80% (EWS19), active statutory lien, or DPD > 60. Rejection or SARB recovery advised."
                        >
                          <button
                            type="button"
                            className="inline-flex items-center gap-1 text-[11px] font-medium text-red-700 dark:text-red-300 underline underline-offset-2 hover:opacity-80 transition-opacity"
                          >
                            <Info className="h-3 w-3" /> Why Red?
                          </button>
                        </ActionTooltip>
                        <ActionTooltip
                          enabled={guidedTips}
                          content="Impaired / High Risk: Ind AS 109 Stage 2/3 classification requiring lifetime ECL provisioning and SARB recovery."
                        >
                          <Badge className="bg-red-500/20 text-red-700 dark:text-red-300 border-red-500/40 text-[11px] cursor-help">
                            High Risk / Impaired
                          </Badge>
                        </ActionTooltip>
                      </div>
                    </div>
                    <p className="text-xs text-foreground leading-relaxed">
                      {result.regulatory_overlay?.applied ? (
                        <>
                          Account is <strong>{result.regulatory_overlay.dpd} days past due</strong> ({result.regulatory_overlay.bucket}): the overdue status alone puts it beyond bank risk tolerance, whatever the model PD of{" "}
                          <strong>{formatPercent(result.pd_12m, 2)}</strong> (Grade <strong>{result.risk_grade}</strong>).
                        </>
                      ) : (
                        <>
                          Default probability of <strong>{formatPercent(result.pd_12m, 2)}</strong> (Grade <strong>{result.risk_grade}</strong>) exceeds bank risk tolerance.
                        </>
                      )}
                      {dpGapPct >= 25 && " Severe Drawing Power erosion (EWS18)."}
                      {demandedRatio < 0.8 && " Critical debt-service collection shortfall (EWS19)."}
                      {dpd > 0 && !result.regulatory_overlay?.applied && ` Past due ${dpd} days.`}
                      {lienFlag === 1 && " Statutory tax lien encumbrance active."}
                    </p>
                    <div className="rounded border border-red-500/20 bg-background/60 p-2 text-[11px] text-muted-foreground">
                      <strong className="text-foreground">Credit Directive:</strong> Do not enhance limit. Issue 15-day cure notice; if unresolved, recall facility and refer to Stressed Asset Resolution Branch.
                    </div>
                    <div className="flex flex-wrap items-center gap-2 pt-1 border-t border-red-500/20">
                      <ActionTooltip
                        enabled={guidedTips}
                        content="Refer for MSME restructuring with a Techno-Economic Viability (TEV) study before SARB recovery action."
                      >
                        <Button
                          variant="outline"
                          size="sm"
                          onClick={() => {
                            setDecisionType("restructure");
                            setModalOpen(true);
                          }}
                          className="h-7 text-[11px] gap-1 border-purple-500/40 text-purple-800 dark:text-purple-300 hover:bg-purple-500/10"
                        >
                          <FileText className="h-3 w-3 text-purple-600 dark:text-purple-400" /> 📋 Refer for restructuring
                        </Button>
                      </ActionTooltip>
                      <ActionTooltip
                        enabled={guidedTips}
                        content="Export or print formal Credit Appraisal Memo (CAM) formatted for Zonal Credit Committee review."
                      >
                        <Button
                          variant="outline"
                          size="sm"
                          onClick={() => window.print()}
                          className="h-7 text-[11px] gap-1 border-red-500/30 text-red-800 dark:text-red-200 hover:bg-red-500/10"
                        >
                          <Printer className="h-3 w-3" /> Quick CAM Export (PDF)
                        </Button>
                      </ActionTooltip>
                      <ActionTooltip
                        enabled={guidedTips}
                        content="Copy appraisal verdict, 12M PD, RAG category, and Ind AS 109 ECL staging summary to clipboard."
                      >
                        <Button
                          variant="ghost"
                          size="sm"
                          onClick={handleCopyVerdict}
                          className="h-7 text-[11px] gap-1 text-red-800 dark:text-red-200 hover:bg-red-500/10"
                        >
                          {copiedVerdict ? <Check className="h-3 w-3 text-emerald-500" /> : <Copy className="h-3 w-3" />}
                          {copiedVerdict ? "Copied Verdict Summary!" : "Copy Appraisal Verdict"}
                        </Button>
                      </ActionTooltip>
                    </div>
                  </div>
                )}
                </div>

              {/* Summary Score Card */}
              <Card className="border-primary/30 bg-surface shadow-sm">
                <CardHeader className="pb-3">
                  <div className="flex items-center justify-between">
                    <span className="text-[11px] uppercase tracking-widest text-muted-foreground">
                      Appraisal Assessment
                    </span>
                    <Badge className={ragTone[result.rag]}>
                      {result.rag} Risk
                    </Badge>
                  </div>
                  <CardTitle className="text-xl font-bold flex items-center justify-between">
                    <span>{result.risk_grade}</span>
                    <span className="text-sm font-mono font-normal text-muted-foreground">
                      PD: {formatPercent(result.pd_12m, 2)}
                    </span>
                  </CardTitle>
                  <CardDescription className="text-xs">
                    <span className="block text-sm text-foreground">
                      <span className="font-semibold">{result.rag === "Green" ? "Why it is Green: " : "Why flagged: "}</span>
                      {whyFlaggedLine({
                        rag: result.rag,
                        reason_codes: [],
                        raw: {
                          emi_bounce_6m: emiBounces,
                          drawing_power_gap_pct: Math.max(0, ((sanctionLimit - drawingPower) / Math.max(1, sanctionLimit)) * 100),
                          demanded_vs_collected_ratio: demandedRatio,
                          cibil_score: cibilScore,
                          dpd,
                          lien_flag: lienFlag,
                          restructuring_flag: restructuringFlag,
                          gst_filing_delay_days: gstDelay,
                          itc_mismatch_flag: itcMismatch,
                        },
                      } as unknown as BorrowerScore, 4)}.
                    </span>
                    RBI SMA (days past due): <span className="font-semibold text-foreground">{rbiSma(dpd) ?? "—"}</span>
                    {" · "}Model watch: <span className="font-semibold text-foreground">{watchLabel(result.sma_watch)}</span> ·{" "}
                    {result.recommended_action}
                    {result.regulatory_overlay?.applied && (
                      <span className="mt-1.5 block rounded border border-amber-500/40 bg-amber-500/10 px-2 py-1 text-[11px] text-foreground">
                        <span className="font-medium">RBI classification:</span>{" "}
                        {result.regulatory_overlay.dpd} DPD places this facility in{" "}
                        {result.regulatory_overlay.bucket}
                        {result.regulatory_overlay.stage_floor > 1 &&
                          ` (Ind AS 109 Stage ${result.regulatory_overlay.stage_floor})`}
                        .
                      </span>
                    )}
                  </CardDescription>
                </CardHeader>
                <CardContent className="space-y-4 text-xs">
                  {/* Ind AS 109 & ECL Row */}
                  <div className="grid grid-cols-2 gap-2 rounded-lg border border-border bg-card p-3">
                    <div>
                      <div className="text-[11px] uppercase tracking-widest text-muted-foreground flex items-center">
                        Ind AS 109 Stage
                        <HelpTip
                          enabled={guidedTips}
                          content="Ind AS 109 Staging: Stage 1 = Performing (12-month ECL); Stage 2 = Significant Increase in Credit Risk (Lifetime ECL); Stage 3 = Credit-Impaired / Default."
                        />
                      </div>
                      <div className="mt-0.5 text-sm font-semibold">
                        Stage {result.ecl_stage ?? 1}
                      </div>
                      <div className="text-[11px] text-muted-foreground">
                        {result.ecl_stage === 1
                          ? "12-Month ECL"
                          : result.ecl_stage === 2
                          ? "Lifetime ECL"
                          : "Credit Impaired"}
                      </div>
                    </div>
                    <div>
                      <div className="text-[11px] uppercase tracking-widest text-muted-foreground flex items-center">
                        Expected Loss (ECL)
                        <HelpTip
                          enabled={guidedTips}
                          content="ECL = EAD (Exposure at Default) × Calibrated 12M PD × LGD (Loss Given Default, 45%). Capital provision required under RBI master directions."
                        />
                      </div>
                      <div className="mt-0.5 text-sm font-semibold font-mono text-rose-500">
                        {formatInr(result.ecl ?? 0)}
                      </div>
                      <div className="text-[11px] text-muted-foreground">
                        LGD 45% · Provisioning
                      </div>
                    </div>
                  </div>

                  {/* RBI Early Warning Signals (EWS) */}
                  <div>
                    <div className="mb-2 flex items-center justify-between">
                      <span className="text-[11px] font-semibold uppercase tracking-wider text-muted-foreground">
                        RBI EWS Trigger Alerts ({result.ews?.signals?.length ?? 0})
                      </span>
                    </div>
                    {result.ews?.signals && result.ews.signals.length > 0 ? (
                      <div className="space-y-1.5">
                        {result.ews.signals.map((sig) => (
                          <div
                            key={sig.code}
                            className="flex items-start gap-2 rounded-md border border-border bg-card p-2 text-[11px]"
                          >
                            <AlertTriangle
                              className={`mt-0.5 h-3.5 w-3.5 shrink-0 ${
                                sig.severity === "high"
                                  ? "text-rose-500"
                                  : sig.severity === "medium"
                                  ? "text-amber-500"
                                  : "text-blue-500"
                              }`}
                            />
                            <div>
                              <span className="font-semibold font-mono mr-1">[{sig.code}]</span>
                              <span>{sig.label}</span>
                            </div>
                          </div>
                        ))}
                      </div>
                    ) : (
                      <div className="flex items-center gap-2 rounded-md border border-emerald-500/20 bg-emerald-500/10 p-2 text-[11px] text-emerald-600 dark:text-emerald-400">
                        <CheckCircle2 className="h-4 w-4" />
                        {result.regulatory_overlay?.applied
                          ? `No further RBI early-warning signals triggered. Overdue status (${result.regulatory_overlay.bucket}) is classified above.`
                          : "No RBI Early Warning Signals triggered. Account compliant."}
                      </div>
                    )}
                  </div>

                  {/* Progressive Disclosure: AI Math & SHAP Taxonomy Accordion */}
                  <Accordion type="single" collapsible className="w-full">
                    <AccordionItem value="shap-details" className="border border-border/70 rounded-md px-3 bg-muted/20">
                      <AccordionTrigger className="text-xs font-semibold py-2 hover:no-underline">
                        <div className="flex items-center gap-1.5 text-foreground">
                          <Sparkles className="h-3.5 w-3.5 text-primary" />
                          <span>How the score was calculated (technical detail)</span>
                        </div>
                      </AccordionTrigger>
                      <AccordionContent className="pt-2 text-xs space-y-2">
                        <div className="text-[11px] text-muted-foreground">
                          Local feature attributions derived from TreeSHAP on LightGBM + Beta calibration:
                        </div>
                        {result.reason_codes && result.reason_codes.length > 0 ? (
                          <div className="space-y-1">
                            {result.reason_codes.map((rc, idx) => (
                              <div
                                key={idx}
                                className="flex items-center justify-between rounded bg-muted/60 px-2 py-1 text-[11px]"
                              >
                                <span className="truncate pr-2">{rc.label || rc.feature}</span>
                                <span
                                  className={`font-mono text-[11px] font-semibold ${
                                    (rc.shap ?? 0) > 0 ? "text-rose-500" : "text-emerald-500"
                                  }`}
                                >
                                  {(rc.shap ?? 0) > 0 ? `+${(rc.shap ?? 0).toFixed(2)}` : (rc.shap ?? 0).toFixed(2)}
                                </span>
                              </div>
                            ))}
                          </div>
                        ) : (
                          <div className="text-[11px] text-muted-foreground">No feature impact overrides.</div>
                        )}
                        <div className="pt-1 border-t border-border/40 flex items-center justify-between text-[11px]">
                          <span className="text-muted-foreground">Model: Optuna Monotone LGBM + Beta Calibrator</span>
                          <Link to="/guide" className="text-primary hover:underline flex items-center gap-1">
                            <BookOpen className="h-3 w-3" />
                            <span>Risk Scale Guide</span>
                          </Link>
                        </div>
                      </AccordionContent>
                    </AccordionItem>
                  </Accordion>
                </CardContent>
              </Card>
            </>
          ) : (
            <Card className="border-dashed bg-muted/30">
              <CardContent className="flex flex-col items-center justify-center p-12 text-center">
                <Building2 className="h-10 w-10 text-muted-foreground/40 mb-3" />
                <h3 className="text-sm font-medium text-foreground">Appraisal Engine Ready</h3>
                <p className="mt-1 text-xs text-muted-foreground max-w-xs">
                  Fill in the borrower and facility parameters on the left and click "Run DRISHTI AI
                  Appraisal" to generate risk grades, EWS triggers, and Ind AS 109 provisions.
                </p>
              </CardContent>
            </Card>
          )}
        </div>
      </div>
    </div>
    </TooltipProvider>
  );
}

