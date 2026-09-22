import { useState, useEffect, useRef } from "react";
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
import { createDecision, scoreRawBorrower, submitUnderwriting, fetchBorrower } from "@/lib/api";
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
}

export function UnderwritePage() {
  const [segment, setSegment] = useState<"msme_idbi" | "msme_india">("msme_idbi");
  const [loanId, setLoanId] = useState("IDBI-APP-2026-0042");
  const [sanctionLimit, setSanctionLimit] = useState(2500000);
  const [drawingPower, setDrawingPower] = useState(2500000);
  const [cibilScore, setCibilScore] = useState(740);
  const [demandedRatio, setDemandedRatio] = useState(0.98);
  const [dpd, setDpd] = useState(0);
  const [emiBounces, setEmiBounces] = useState(0);
  const [lienFlag, setLienFlag] = useState(0);
  const [restructuringFlag, setRestructuringFlag] = useState(0);
  const [sector, setSector] = useState("auto_ancillary");
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

  // Results & submission state
  const [isScoring, setIsScoring] = useState(false);
  const [result, setResult] = useState<AppraisalResult | null>(null);
  const [modalOpen, setModalOpen] = useState(false);
  const [decisionType, setDecisionType] = useState<"accept" | "override" | "defer" | "reject">("accept");
  const [revisedGrade, setRevisedGrade] = useState("RG3");
  const [rationale, setRationale] = useState("");
  const [officerId, setOfficerId] = useState("APPRAISAL_OFFICER_07");
  const [decisionFeedback, setDecisionFeedback] = useState<string | null>(null);

  const handleCopyVerdict = async () => {
    if (!result) return;
    const summaryText = `[DRISHTI APPRAISAL VERDICT]
Facility Ref: ${loanId}
Risk Grade: ${result.risk_grade} | 12M Calibrated PD: ${formatPercent(result.pd_12m, 2)}
RAG Status: ${result.rag} | Watch Category: ${result.sma_watch}
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
      cashflow_volatility: Math.min(0.8, 0.15 + (gap / 100) * 0.5),
      balance_trend_pct: (dRatio - 1.0) * 100,
    };

    const res = await scoreRawBorrower(seg, payload);
    setIsScoring(false);
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
      if (b) {
        setLoanId(b.loan_id);
        const limit = b.ead || 2500000;
        setSanctionLimit(limit);
        const raw = (b.raw || {}) as Record<string, any>;
        const dp = Number(raw.drawing_power ?? b.ead ?? 2500000);
        setDrawingPower(dp);
        const cibil = Number(raw.cibil_score ?? 740);
        setCibilScore(cibil);
        const dem = Number(raw.demanded_vs_collected_ratio ?? 0.98);
        setDemandedRatio(dem);
        const d = Number(raw.dpd ?? 0);
        setDpd(d);
        const emi = Number(raw.emi_bounce_6m ?? 0);
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
        const gst = Number(raw.gst_filing_delay_days ?? 4);
        setGstDelay(gst);
        const itc = Number(raw.itc_mismatch_flag ?? 0);
        setItcMismatch(itc);
        const seg = b.segment === "msme_india" ? "msme_india" : "msme_idbi";
        setSegment(seg);
        setFetchFeedback({
          msg: `Fetched Finacle CBS account ${b.loan_id} (${b.branch_name || "Branch 1019"}) — 14 parameters auto-populated.`,
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
          msg: `Account ID "${idToFetch}" not found in Finacle CBS database.`,
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
      setTimeout(() => setFetchFeedback(null), 4000);
    }
  };

  const applyPreset = async (preset: "prime" | "early_stress" | "distressed", autoScroll = false) => {
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
      dp = 1800000;
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
      branch_code: "1019",
      decision: decisionType,
      revised_grade: decisionType === "override" ? revisedGrade : undefined,
      override_action: decisionType === "override" ? `Override to ${revisedGrade}` : undefined,
      rationale: rationale.trim() || `Underwriting appraisal decision logged by ${officerId}`,
      officer: officerId,
      role: "Branch Credit Appraisal Officer",
    });

    if (res && res.status === "success") {
      setDecisionFeedback("Proposal appraisal & decision successfully persisted to master portfolio and HITL audit log.");
      setTimeout(() => {
        setModalOpen(false);
        setDecisionFeedback(null);
      }, 1200);
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
      override_action: decisionType === "override" ? `Override to ${revisedGrade}` : undefined,
      rationale: rationale.trim() || `Underwriting appraisal decision logged by ${officerId}`,
      decided_by: officerId,
      officer: officerId,
      role: "Branch Credit Appraisal Officer",
    });

    if (ok) {
      setDecisionFeedback("Decision successfully persisted to HITL audit log.");
      setTimeout(() => {
        setModalOpen(false);
        setDecisionFeedback(null);
      }, 1200);
    } else {
      setDecisionFeedback("Error persisting decision to API database.");
    }
  };

  return (
    <TooltipProvider delayDuration={150}>
      <div className="p-4 md:p-6 space-y-6">
        {/* Header */}
        <div className="flex flex-wrap items-start justify-between gap-3">
          <div>
            <div className="text-[10px] uppercase tracking-widest text-muted-foreground">
              Core Underwriting & Appraisal Simulator · Real-Time Decisioning
            </div>
            <h1 className="mt-1 text-xl font-semibold text-foreground">
              Single Borrower Credit Appraisal
            </h1>
            <p className="mt-0.5 text-sm text-muted-foreground">
              Test incoming MSME loan proposals or limit renewals against calibrated 12-month PD,
              RBI Early Warning Signals, and Ind AS 109 provisions.
            </p>
          </div>
          <div className="flex items-center gap-2 no-print">
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
                      {formatPercent(result.pd_12m, 1)}) into the immutable audit database.
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
                        onChange={(e) => setOfficerId(e.target.value)}
                        className="mt-1 h-8 text-xs font-mono"
                      />
                    </div>
                    {decisionFeedback && (
                      <div className="rounded bg-muted p-2 text-xs text-primary">{decisionFeedback}</div>
                    )}
                    <Button onClick={handleLogDecision} className="w-full text-xs">
                      Confirm & Persist to Audit Trail
                    </Button>
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
              <div className="flex items-center gap-2">
                <Database className="h-4 w-4 text-blue-600 shrink-0" />
                <div>
                  <span className="text-xs font-semibold text-foreground flex items-center">
                    1-Click Finacle Core Banking Auto-Fill:
                    <HelpTip
                      enabled={guidedTips}
                      content="Direct Core Banking System query: Ingests sanctioned facility limits, drawing power from stock registers, past 6-month cheque bounces, and overdue DPD without manual data re-entry."
                    />
                  </span>
                  <span className="ml-1 text-[11px] text-muted-foreground hidden sm:inline">
                    Pulls limits, DPD, DP, and bounces directly from Core Banking System
                  </span>
                </div>
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
                    content="Pre-loaded representative MSME borrowing accounts representing prime conduct, early warning stress, and recent loan renewals."
                  />
                </span>
                <ActionTooltip
                  enabled={guidedTips}
                  content="Prime Auto Ancillary Account: CIBIL 770, 0% DP erosion, 100% debt-service recovery, 0 DPD. Click to auto-fill and jump to appraisal verdict."
                >
                  <Button
                    variant="secondary"
                    size="sm"
                    className="h-6 text-[11px] px-2 font-mono"
                    onClick={() => {
                      setFinacleLookupId("IDBI_LN_100361");
                      handleFinacleFetch("IDBI_LN_100361", true);
                    }}
                  >
                    IDBI_LN_100361 (Auto Ancillary · Prime)
                  </Button>
                </ActionTooltip>
                <ActionTooltip
                  enabled={guidedTips}
                  content="Stressed Textile Account: CIBIL 645, 28% DP erosion gap, 25 DPD overdue, 2 EMI bounces. Click to auto-fill and jump to verdict."
                >
                  <Button
                    variant="secondary"
                    size="sm"
                    className="h-6 text-[11px] px-2 font-mono"
                    onClick={() => {
                      setFinacleLookupId("IDBI_LN_100155");
                      handleFinacleFetch("IDBI_LN_100155", true);
                    }}
                  >
                    IDBI_LN_100155 (Textiles · Stressed)
                  </Button>
                </ActionTooltip>
                <ActionTooltip
                  enabled={guidedTips}
                  content="Recent Facility Renewal: Working capital CC proposal undergoing annual review under FY26 RBI guidelines."
                >
                  <Button
                    variant="secondary"
                    size="sm"
                    className="h-6 text-[11px] px-2 font-mono"
                    onClick={() => {
                      setFinacleLookupId("IDBI-TEST-FACILITY-999");
                      handleFinacleFetch("IDBI-TEST-FACILITY-999", true);
                    }}
                  >
                    IDBI-TEST-FACILITY-999 (Recent Renewal)
                  </Button>
                </ActionTooltip>
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
                  content="SMA-0 Incipient Stress: Simulates 25 DPD, 2 EMI bounces, and 28% DP erosion gap."
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
        <div className="grid gap-6 lg:grid-cols-12">
          {/* Input Form Column (7 cols) */}
          <div className="space-y-4 lg:col-span-7">
            <Card className="bg-surface">
              <CardHeader className="pb-3">
                <CardTitle className="text-sm font-semibold">1. Proposal & Facility Particulars</CardTitle>
                <CardDescription className="text-xs">
                  Finacle core banking facility limits, customer details, and sector.
                </CardDescription>
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
                        className="inline-flex items-center gap-1 text-[10px] text-primary hover:underline font-mono"
                        title="Copy Loan ID"
                      >
                        {copiedLoanId ? <Check className="h-2.5 w-2.5 text-emerald-500" /> : <Copy className="h-2.5 w-2.5" />}
                        {copiedLoanId ? "Copied" : "Copy"}
                      </button>
                    </div>
                    <Input
                      value={loanId}
                      onChange={(e) => setLoanId(e.target.value)}
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
                        <span className="ml-auto text-[10px] text-rose-500 font-semibold">EWS18 Alert</span>
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
                        <SelectItem value="auto_ancillary">Auto Ancillaries</SelectItem>
                        <SelectItem value="textiles">Textiles & Garments</SelectItem>
                        <SelectItem value="pharmaceuticals">Pharma & Chemicals</SelectItem>
                        <SelectItem value="engineering">Light Engineering</SelectItem>
                        <SelectItem value="retail_trade">Retail & Wholesale</SelectItem>
                        <SelectItem value="food_processing">Agro & Food Processing</SelectItem>
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
                <CardTitle className="text-sm font-semibold">2. Repayment Health & Early Warning Metrics</CardTitle>
                <CardDescription className="text-xs">
                  Finacle APIs 402, 404, 362, 391 debt servicing and collection ratios.
                </CardDescription>
              </CardHeader>
              <CardContent className="space-y-4 text-xs">
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
                      <span className="text-[10px] text-rose-500 font-medium">EWS19 Shortfall</span>
                    )}
                  </div>
                  <div>
                    <Label className="text-[11px] text-muted-foreground flex items-center">
                      Current DPD (Days)
                      <HelpTip
                        enabled={guidedTips}
                        content="Days Past Due on credit obligations: 1–30 days = SMA-0; 31–60 days = SMA-1; 61–90 days = SMA-2; >90 days = NPA Default."
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

                <div className="grid gap-3 sm:grid-cols-2">
                  <div>
                    <Label className="text-[11px] text-muted-foreground flex items-center">
                      Lien / Encumbrance Flag (API 362)
                      <HelpTip
                        enabled={guidedTips}
                        content="Finacle API 362 Lien Inquiry: 1 indicates statutory tax notice, income tax attachment, GST demand, or court attachment on collateral."
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
                      Restructuring History (API 391)
                      <HelpTip
                        enabled={guidedTips}
                        content="Finacle API 391 Restructuring Flag: 1 indicates past tenure extension, moratorium, or interest capitalization."
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
                        content="Facility Approved: 12-month PD is within bank risk appetite (<3.0%), Ind AS 109 Stage 1. Qualifies for fast-track credit sanction."
                      >
                        <span className="flex items-center gap-2 text-xs font-bold text-emerald-700 dark:text-emerald-400 cursor-help">
                          <CheckCircle2 className="h-4 w-4 shrink-0" />
                          RECOMMENDATION: APPROVE FACILITY SANCTION
                        </span>
                      </ActionTooltip>
                      <div className="flex items-center gap-1.5">
                        <ActionTooltip
                          enabled={guidedTips}
                          content="Green Criteria: Calibrated 12-month PD < 3.0%, Ind AS 109 Stage 1, 0 cheque bounces, healthy debt-service collection (>95%), and drawing power fully backed. Qualifies for fast-track processing."
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
                          <Badge className="bg-emerald-500/20 text-emerald-700 dark:text-emerald-300 border-emerald-500/40 text-[10px] cursor-help">
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
                        content="Conditional Sanction: Incipient stress or moderate default risk (3.0%–12.0%). Sanction permitted only with mandatory covenants."
                      >
                        <span className="flex items-center gap-2 text-xs font-bold text-amber-700 dark:text-amber-400 cursor-help">
                          <AlertTriangle className="h-4 w-4 shrink-0" />
                          RECOMMENDATION: CONDITIONAL SANCTION WITH COVENANTS
                        </span>
                      </ActionTooltip>
                      <div className="flex items-center gap-1.5">
                        <ActionTooltip
                          enabled={guidedTips}
                          content="Amber Criteria: Calibrated 12-month PD between 3.0% and 12.0%, or incipient stress detected (DP gap > 0%, EMI bounces, or GST filing delays). Requires credit committee approval with mandatory covenants."
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
                          <Badge className="bg-amber-500/20 text-amber-700 dark:text-amber-300 border-amber-500/40 text-[10px] cursor-help">
                            Incipient Stress
                          </Badge>
                        </ActionTooltip>
                      </div>
                    </div>
                    <p className="text-xs text-foreground leading-relaxed">
                      Moderate risk detected: 12-month PD of <strong>{formatPercent(result.pd_12m, 2)}</strong> (Grade <strong>{result.risk_grade}</strong>).
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
                        content="Proposal Rejected / Commencing Recovery: 12-month PD exceeds risk threshold (>12.0%) or critical RBI triggers breached."
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
                          <Badge className="bg-red-500/20 text-red-700 dark:text-red-300 border-red-500/40 text-[10px] cursor-help">
                            High Risk / Impaired
                          </Badge>
                        </ActionTooltip>
                      </div>
                    </div>
                    <p className="text-xs text-foreground leading-relaxed">
                      Default probability of <strong>{formatPercent(result.pd_12m, 2)}</strong> (Grade <strong>{result.risk_grade}</strong>) exceeds bank risk tolerance.
                      {dpGapPct >= 25 && " Severe Drawing Power erosion (EWS18)."}
                      {demandedRatio < 0.8 && " Critical debt-service collection shortfall (EWS19)."}
                      {dpd > 0 && ` Past due ${dpd} days.`}
                      {lienFlag === 1 && " Statutory tax lien encumbrance active."}
                    </p>
                    <div className="rounded border border-red-500/20 bg-background/60 p-2 text-[11px] text-muted-foreground">
                      <strong className="text-foreground">Credit Directive:</strong> Do not enhance limit. Issue 15-day cure notice; if unresolved, recall facility and refer to Stressed Asset Resolution Branch.
                    </div>
                    <div className="flex flex-wrap items-center gap-2 pt-1 border-t border-red-500/20">
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
                    <span className="text-[10px] uppercase tracking-widest text-muted-foreground">
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
                    Watch Action: <span className="font-semibold text-foreground">{result.sma_watch}</span> ·{" "}
                    {result.recommended_action}
                  </CardDescription>
                </CardHeader>
                <CardContent className="space-y-4 text-xs">
                  {/* Ind AS 109 & ECL Row */}
                  <div className="grid grid-cols-2 gap-2 rounded-lg border border-border bg-card p-3">
                    <div>
                      <div className="text-[10px] uppercase tracking-widest text-muted-foreground flex items-center">
                        Ind AS 109 Stage
                        <HelpTip
                          enabled={guidedTips}
                          content="Ind AS 109 Staging: Stage 1 = Performing (12-month ECL); Stage 2 = Significant Increase in Credit Risk (Lifetime ECL); Stage 3 = Credit-Impaired / Default."
                        />
                      </div>
                      <div className="mt-0.5 text-sm font-semibold">
                        Stage {result.ecl_stage ?? 1}
                      </div>
                      <div className="text-[10px] text-muted-foreground">
                        {result.ecl_stage === 1
                          ? "12-Month ECL"
                          : result.ecl_stage === 2
                          ? "Lifetime ECL"
                          : "Credit Impaired"}
                      </div>
                    </div>
                    <div>
                      <div className="text-[10px] uppercase tracking-widest text-muted-foreground flex items-center">
                        Expected Loss (ECL)
                        <HelpTip
                          enabled={guidedTips}
                          content="ECL = EAD (Exposure at Default) × Calibrated 12M PD × LGD (Loss Given Default, 45%). Capital provision required under RBI master directions."
                        />
                      </div>
                      <div className="mt-0.5 text-sm font-semibold font-mono text-rose-500">
                        {formatInr(result.ecl ?? 0)}
                      </div>
                      <div className="text-[10px] text-muted-foreground">
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
                        No RBI Early Warning Signals triggered. Account compliant.
                      </div>
                    )}
                  </div>

                  {/* Progressive Disclosure: AI Math & SHAP Taxonomy Accordion */}
                  <Accordion type="single" collapsible className="w-full">
                    <AccordionItem value="shap-details" className="border border-border/70 rounded-md px-3 bg-muted/20">
                      <AccordionTrigger className="text-xs font-semibold py-2 hover:no-underline">
                        <div className="flex items-center gap-1.5 text-foreground">
                          <Sparkles className="h-3.5 w-3.5 text-primary" />
                          <span>Inspect AI Scoring Details & SHAP Taxonomy</span>
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
                                  className={`font-mono text-[10px] font-semibold ${
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

