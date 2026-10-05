import { useEffect, useState, useMemo } from "react";
import { useDecisionRights, useRole, useScopeBranch } from "@/lib/role-context";
import { dpdOf, driverDetail, rbiSma, watchLabel, whyFlaggedLine } from "@/lib/plain-language";
import { createFileRoute, Link, notFound, useCanGoBack, useRouter } from "@tanstack/react-router";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Separator } from "@/components/ui/separator";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import {
  ResponsiveContainer,
} from "recharts";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import {
  createDecision,
  fetchBorrower,
  fetchDecisions,
  getBorrower,
  getSnapshot,
  scoreBorrowerLive,
  scoreRawBorrower,
  type LiveBorrower,
} from "@/lib/api";
import { PageApiDrawer } from "@/components/drishti/page-api-drawer";
import { UnstructuredPanel } from "@/components/drishti/unstructured-panel";
import { ActionPlanCard } from "@/components/drishti/action-plan-card";
import { cn } from "@/lib/utils";
import { formatInr, formatInrCompact, formatPercent, ragTone, pdTone, GRADE_EDGES, gradeRange, gradeIndexToRag } from "@/lib/format";
import type { BorrowerScore, DecisionRecord, ReasonCode } from "@/lib/types";
import {
  ArrowLeft,
  AlertTriangle,
  TrendingDown,
  TrendingUp,
  CalendarClock,
  Printer,
  Wifi,
  WifiOff,
  Route as RouteIcon,
  UserCheck,
  History,
  Sliders,
  CheckCircle2,
  Sparkles,
  RotateCcw,
  ShieldCheck,
  Info,
  Share2,
  Copy,
  Check,
  FileText,
} from "lucide-react";
import { toast } from "sonner";
import { GuidedTooltip, HintIcon } from "@/components/drishti/guided-tooltip";

// Grades are "RG1".."RG10"; a string compare puts RG10 below RG6.
function gradeNumber(grade: string | undefined): number {
  return parseInt(String(grade ?? "").replace(/\D/g, ""), 10) || 0;
}

// Sandbox API that would carry each EWS rule's input. Null where none of the
// bank's 25 sandbox APIs supplies it (GST returns, financials, stock statements,
// officer inputs); those rules run on synthetic fields in this prototype.
const EWS_API_SOURCE: Record<string, { api: string; name: string }> = {
  EWS01: { api: "ESB-01", name: "Account statement" },
  EWS06: { api: "AA-01", name: "Account Aggregator statement" },
  EWS07: { api: "AA-01", name: "Account Aggregator statement" },
  EWS08: { api: "CBS-06", name: "Customer aggregate limits" },
  EWS15: { api: "CBS-03", name: "Loan limits and drawing power" },
  EWS16: { api: "CBS-05", name: "Account liens" },
  EWS17: { api: "CBS-04", name: "Loan account profile" },
  EWS18: { api: "CBS-03", name: "Loan limits and drawing power" },
  EWS19: { api: "CBS-02", name: "Overdue position" },
};

function getEwsApiSource(code: string): { api: string; name: string } | null {
  return EWS_API_SOURCE[code] ?? null;
}

export const Route = createFileRoute("/borrowers/$id")({
  loader: async ({ params }) => {
    const liveBorrower = await fetchBorrower(params.id);
    const borrower = liveBorrower ?? getBorrower(params.id);
    if (!borrower) {
      // During server rendering /api is unreachable, so an account that exists
      // only in the loan master (a new proposal, a batch upload) is not found
      // yet. Let the browser look it up instead of answering 404.
      if (typeof window === "undefined") return { borrower: null };
      // An unknown ID used to render an invented RG4 / Green borrower with no warning.
      throw notFound();
    }
    return { borrower };
  },
  component: BorrowerDetail,
});

function BorrowerDetail() {
  const { borrower } = Route.useLoaderData();
  const router = useRouter();
  useEffect(() => {
    // Re-run the loader in the browser, where the API is reachable.
    if (!borrower) router.invalidate();
  }, [borrower, router]);
  if (!borrower) {
    return <div className="p-6 text-xs text-muted-foreground">Loading account…</div>;
  }
  return <BorrowerDetailView snapshotRow={borrower} />;
}

function BorrowerDetailView({ snapshotRow }: { snapshotRow: BorrowerScore }) {
  const model = getSnapshot().model_card;

  // Live re-score against the FastAPI service when it is reachable. Adds the
  // cure path and a hazard-model stress horizon that the offline snapshot
  // cannot carry. Falls back silently to the snapshot row.
  const [b, setB] = useState<LiveBorrower>(snapshotRow);
  const [live, setLive] = useState(false);

  // Credit Committee HITL Decision modal states
  const [modalOpen, setModalOpen] = useState(false);
  const [decisionType, setDecisionType] = useState<"accept" | "override" | "defer" | "reject" | "restructure">("accept");
  const [revisedGrade, setRevisedGrade] = useState("RG2");
  const [restructuringMoratorium, setRestructuringMoratorium] = useState("6m");
  const [restructuringFitl, setRestructuringFitl] = useState(true);
  const [restructuringMarginInfusion, setRestructuringMarginInfusion] = useState("15");
  const [restructuringTevAgency, setRestructuringTevAgency] = useState("IDBI In-House Technical Appraisal Cell");
  const [rationale, setRationale] = useState("");
  const { user, role } = useRole();
  // Per account: a branch officer decides only on accounts of their branch.
  const caps = useDecisionRights(b.branch_code);
  const scopeBranch = useScopeBranch();
  const router = useRouter();
  const canGoBack = useCanGoBack();
  // Decisions are attributed to the signed-in officer, not to a free-text field.
  const officerId = user?.employeeId ? `${user.employeeId} (${user.name})` : user?.name || "UNIDENTIFIED_OFFICER";
  const [officerRole, setOfficerRole] = useState(
    role === "Branch Officer" ? "Branch Credit Officer" : "Controlling Office Credit Committee",
  );
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [pastDecisions, setPastDecisions] = useState<DecisionRecord[]>([]);
  const [latestDecision, setLatestDecision] = useState<DecisionRecord | null>(null);
  const [feedbackMsg, setFeedbackMsg] = useState<string | null>(null);

  useEffect(() => {
    fetchDecisions(snapshotRow.loan_id).then((decs) => {
      setPastDecisions(decs);
      if (decs && decs.length > 0) {
        setLatestDecision(decs[0]);
      }
    });
  }, [snapshotRow.loan_id]);

  useEffect(() => {
    const ac = new AbortController();
    setB(snapshotRow);
    setLive(false);
    // The route loader also runs during server rendering, where the relative
    // /api path is unreachable and it falls back to the bundled snapshot. Re-read
    // the loan master from the browser so a re-rated, overridden or newly added
    // account shows its current record, then re-score that record.
    fetchBorrower(snapshotRow.loan_id)
      .then((row) => {
        if (ac.signal.aborted) return null;
        if (row) setB(row);
        return scoreBorrowerLive(row ?? snapshotRow, ac.signal);
      })
      .then((r) => {
        if (!r || ac.signal.aborted) return;
        setB(r.borrower);
        setLive(r.source.mode === "live");
      });
    return () => ac.abort();
  }, [snapshotRow]);

  // Interactive Recourse What-If Simulator state
  const rawData = (snapshotRow as any).raw ?? {};
  const initialDpGap = Number(rawData.drawing_power_gap_pct ?? (gradeNumber(snapshotRow.risk_grade) >= 6 ? 22 : 0));
  const initialCollection = Number(rawData.demanded_vs_collected_ratio ?? (gradeNumber(snapshotRow.risk_grade) >= 6 ? 0.82 : 0.98));
  const initialLien = Number(rawData.lien_flag ?? 0);

  const [simulatedDpGap, setSimulatedDpGap] = useState<number>(initialDpGap);
  const [simulatedCollection, setSimulatedCollection] = useState<number>(initialCollection);
  const [simulatedLien, setSimulatedLien] = useState<number>(initialLien);

  const isRecourseModified =
    simulatedDpGap !== initialDpGap ||
    Math.abs(simulatedCollection - initialCollection) > 0.005 ||
    simulatedLien !== initialLien;

  const handleResetRecourse = () => {
    setSimulatedDpGap(initialDpGap);
    setSimulatedCollection(initialCollection);
    setSimulatedLien(initialLien);
  };

  const whatIfRecourse = useMemo(() => {
    const initDp = initialDpGap;
    const initColl = initialCollection;
    const initLien = initialLien;

    let lift = 0;
    if (simulatedDpGap < initDp) {
      lift += (initDp - simulatedDpGap) * 0.015;
    }
    if (simulatedCollection > initColl) {
      lift += (simulatedCollection - initColl) * 0.55;
    }
    if (initLien === 1 && simulatedLien === 0) {
      lift += 0.18;
    }

    const newPd = Math.max(0.005, b.pd * (1.0 - Math.min(0.85, lift)));
    const newGrade =
      newPd < 0.02 ? "RG1" : newPd < 0.04 ? "RG2" : newPd < 0.07 ? "RG3" :
      newPd < 0.11 ? "RG4" : newPd < 0.16 ? "RG5" : newPd < 0.23 ? "RG6" :
      newPd < 0.32 ? "RG7" : newPd < 0.45 ? "RG8" : newPd < 0.65 ? "RG9" : "RG10";
    const newEcl = Math.round(b.ead * newPd * 0.45);
    const capitalSaved = Math.max(0, b.ecl - newEcl);

    return {
      newPd,
      newGrade,
      newEcl,
      capitalSaved,
      liftPct: Math.round(lift * 100),
    };
  }, [b, initialDpGap, initialCollection, initialLien, simulatedDpGap, simulatedCollection, simulatedLien]);

  const [liveRecourse, setLiveRecourse] = useState<{
    newPd: number;
    newGrade: string;
    newEcl: number;
    capitalSaved: number;
    liftPct: number;
  } | null>(null);

  useEffect(() => {
    const ac = new AbortController();
    const timer = setTimeout(async () => {
      try {
        // Start from the account's own stored inputs and change only what the
        // sliders move. Filling other fields (bounces = 0, sanction = EAD) shifted
        // the baseline before any slider was touched.
        const base = { ...((b.raw ?? rawData) as Record<string, unknown>) };
        const sanction = Number(base.sanction_limit ?? base.ticket_size ?? b.ead);
        const liveInputs: Record<string, unknown> = {
          ...base,
          loan_id: b.loan_id,
          drawing_power_gap_pct: simulatedDpGap,
          demanded_vs_collected_ratio: simulatedCollection,
          lien_flag: simulatedLien,
          ...(base.drawing_power != null && { drawing_power: sanction * (1 - simulatedDpGap / 100) }),
        };
        const res = await scoreRawBorrower(b.segment, liveInputs, ac.signal);
        if (res && res.pd_12m != null && res.risk_grade) {
          const pdVal = res.pd_12m;
          const gradeVal = res.risk_grade;
          const eclVal = res.ecl ?? Math.round(b.ead * pdVal * 0.45);
          const saved = Math.max(0, b.ecl - eclVal);
          const lift = b.pd > 0 ? Math.max(0, Math.round(((b.pd - pdVal) / b.pd) * 100)) : 0;
          setLiveRecourse({
            newPd: pdVal,
            newGrade: gradeVal,
            newEcl: eclVal,
            capitalSaved: saved,
            liftPct: lift,
          });
        }
      } catch {
        // Keep fallback
      }
    }, 200);

    return () => {
      clearTimeout(timer);
      ac.abort();
    };
  }, [b, rawData, simulatedDpGap, simulatedCollection, simulatedLien]);

  const effectiveRecourse = isRecourseModified
    ? (liveRecourse ?? whatIfRecourse)
    : {
        newPd: b.pd,
        newGrade: b.risk_grade,
        newEcl: b.ecl,
        capitalSaved: 0,
        liftPct: 0,
      };
  const capitalSaved = Math.max(0, b.ecl - effectiveRecourse.newEcl);
  const eclReductionPct = b.ecl > 0 ? Math.round(((b.ecl - effectiveRecourse.newEcl) / b.ecl) * 100) : 0;

  const handleSubmitDecision = async () => {
    setIsSubmitting(true);
    setFeedbackMsg(null);
    const payload: DecisionRecord = {
      loan_id: b.loan_id,
      decision: decisionType,
      segment: b.segment,
      original_grade: b.risk_grade,
      revised_grade: decisionType === "override" ? revisedGrade : undefined,
      override_action: decisionType === "override"
        ? `Override to ${revisedGrade}`
        : decisionType === "restructure"
        ? `MSME Restructuring: Moratorium ${restructuringMoratorium}, FITL ${restructuringFitl ? "Yes" : "No"}, Margin +${restructuringMarginInfusion}%`
        : undefined,
      rationale: decisionType === "restructure"
        ? `[RBI MSME RESTRUCTURING & TEV STUDY] Moratorium: ${restructuringMoratorium} | FITL: ${restructuringFitl ? "Approved" : "None"} | Promoter Margin: +${restructuringMarginInfusion}% | Agency: ${restructuringTevAgency}. ${rationale.trim()}`
        : (rationale.trim() || `Decision ${decisionType} confirmed by ${officerId}`),
      decided_by: officerId,
      officer: officerId,
      role: officerRole,
    };
    const ok = await createDecision({
      ...payload,
      proposed_action: b.action,
      proposed_sma: b.sma_status,
      pd: b.pd,
      risk_grade: b.risk_grade,
    });
    // POST /decisions also sets the loan's review status server-side, so the
    // portfolio row and the audit trail come from one write.
    setIsSubmitting(false);
    if (ok) {
      setLatestDecision(payload);
      setPastDecisions((prev) => [payload, ...prev]);
      setFeedbackMsg(
        ok === "persisted"
          ? "Decision logged to the audit trail and the loan record."
          : "API not reachable: decision saved on this browser only and shown in the audit trail as local.",
      );
      setTimeout(() => {
        setModalOpen(false);
        setFeedbackMsg(null);
      }, 1200);
    } else {
      setFeedbackMsg("Decision not saved: the API rejected it.");
    }
  };

  const [copiedId, setCopiedId] = useState(false);

  const handleCopyId = (e: React.MouseEvent) => {
    e.stopPropagation();
    e.preventDefault();
    try {
      navigator.clipboard.writeText(b.loan_id);
      setCopiedId(true);
      toast.success(`Copied ${b.loan_id} to clipboard`, { duration: 1500 });
      setTimeout(() => setCopiedId(false), 1800);
    } catch {
      toast.error("Failed to copy loan ID");
    }
  };

  const handleCopyBriefing = () => {
    const briefing = `IDBI BANK CREDIT BRIEFING · MSME
Facility ID: ${b.loan_id} | Segment: ${b.segment} | Sector: ${(b.sector ?? "MSME").replace(/_/g, " ")} | State: ${b.state ?? "—"}
Risk Grade: ${b.risk_grade} | 12m Calibrated PD: ${(b.pd * 100).toFixed(1)}% | Ind AS 109: Stage ${b.ecl_stage ?? 1} | RAG: ${b.rag}
Exposure at Default (EAD): ₹${(b.ead || 0).toLocaleString("en-IN")} | ECL Provision: ₹${(b.ecl || 0).toLocaleString("en-IN")}
RBI SMA: ${rbiSma(dpdOf(b)) ?? "n/a"} | Model watch: ${watchLabel(b.sma_status)} | Why: ${whyFlaggedLine(b, 5)}
Recommended Action: ${b.action} (Cadence: ${b.cadence}, Owner: ${b.owner})
Top Risk Drivers: ${b.reason_codes?.slice(0, 2).map((r) => r.feature).join(", ") || "None"}
RBI EWS Triggers: ${b.ews_triggers?.length ?? 0} active`;

    navigator.clipboard.writeText(briefing);
    toast.success(`Copied Credit Briefing for ${b.loan_id} to clipboard`, { duration: 2500 });
  };

  // Keyboard shortcuts for Borrower 360:
  // P: print memo, C: copy briefing, D: credit decision modal
  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      if (["INPUT", "TEXTAREA", "SELECT"].includes((e.target as HTMLElement)?.tagName)) {
        return;
      }
      if (e.key === "p" || e.key === "P") {
        e.preventDefault();
        window.print();
      } else if (e.key === "c" || e.key === "C") {
        e.preventDefault();
        handleCopyBriefing();
      } else if (e.key === "d" || e.key === "D") {
        e.preventDefault();
        setModalOpen((prev) => !prev);
      }
    };
    window.addEventListener("keydown", handleKeyDown);
    return () => window.removeEventListener("keydown", handleKeyDown);
  }, [b]);


  return (
    <div className="p-4 md:p-6 space-y-6">
      {/* Header */}
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          {/* Back returns to wherever the officer came from with its filters intact
              (portfolio view, branch drill-down, batch, governance); a direct
              visit falls back to the portfolio. */}
          <Button
            variant="ghost"
            size="sm"
            className="-ml-2 mb-1 text-xs no-print"
            onClick={() => (canGoBack ? router.history.back() : router.navigate({ to: "/" }))}
          >
            <ArrowLeft className="mr-1 h-3.5 w-3.5" /> {canGoBack ? "Back" : "Portfolio console"}
          </Button>
          <div className="text-[11px] uppercase tracking-widest text-muted-foreground">
            {b.segment} · {(b.sector ?? "—").replace(/_/g, " ")} · {b.state ?? "—"} ·{" "}
            {b.sub_segment ?? "—"}
          </div>
          <div className="mt-1 flex flex-wrap items-center gap-x-3 gap-y-1 text-[11px] no-print">
            {b.branch_code &&
              (scopeBranch && b.branch_code !== scopeBranch ? (
                // A branch officer's watchlist is always their own branch, so a link
                // to another branch's watchlist would land on the wrong one.
                <span className="text-muted-foreground">{b.branch_name ?? `Branch ${b.branch_code}`}</span>
              ) : (
                <Link to="/" search={{ branch: b.branch_code }} className="text-primary hover:underline">
                  {b.branch_name ?? `Branch ${b.branch_code}`} · branch watchlist
                </Link>
              ))}
            <Link to="/governance" search={{ q: b.loan_id }} className="text-primary hover:underline">
              Decision history
            </Link>
            {caps.canDecide && b.segment === "msme_idbi" && (
              <Link to="/underwrite" search={{ id: b.loan_id }} className="text-primary hover:underline">
                Re-rate in Loan Appraisal
              </Link>
            )}
          </div>
          <div className="flex items-center gap-2 mt-1">
            <h1 className="text-xl font-semibold text-foreground font-mono">{b.loan_id}</h1>
            <button
              type="button"
              onClick={handleCopyId}
              title={copiedId ? "Copied!" : `Copy ${b.loan_id}`}
              aria-label={`Copy loan ID ${b.loan_id}`}
              className="inline-flex h-6 w-6 items-center justify-center rounded p-1 text-muted-foreground hover:bg-muted hover:text-foreground transition-colors cursor-pointer"
            >
              {copiedId ? (
                <Check className="h-3.5 w-3.5 text-emerald-600 animate-in zoom-in-50" />
              ) : (
                <Copy className="h-3.5 w-3.5 opacity-60 hover:opacity-100 transition-opacity" />
              )}
            </button>
          </div>
        </div>
        <div className="flex flex-wrap items-center gap-2">
          <PageApiDrawer routePath="/borrowers/$id" triggerLabel="Originating APIs" />
          <Badge
            variant="outline"
            className={`no-print font-normal ${
              live
                ? "border-band-a/30 bg-band-a/10 text-band-a"
                : "border-border bg-muted text-muted-foreground"
            }`}
            title={
              live
                ? "Scored live by the DRISHTI API"
                : "Offline snapshot — start the API for cure path and hazard horizon"
            }
          >
            {live ? <Wifi className="mr-1 h-3 w-3" /> : <WifiOff className="mr-1 h-3 w-3" />}
            {live ? "Live scoring" : "Snapshot"}
          </Badge>
          <Button
            variant="outline"
            size="sm"
            className="no-print gap-1.5"
            onClick={handleCopyBriefing}
            title="Copy standardized 4-line Credit Committee Briefing (Hotkey: C)"
          >
            <Share2 className="h-3.5 w-3.5" />
            <span className="hidden sm:inline">Copy Briefing</span>
          </Button>
          <Button
            variant="outline"
            size="sm"
            className="no-print"
            onClick={() => window.print()}
            title="Print formal CAM Dossier (Hotkey: P)"
          >
            <Printer className="mr-1.5 h-3.5 w-3.5" /> Print memo
          </Button>

          {caps.canDecide && (b.rag === "Amber" || b.rag === "Red" || gradeNumber(b.risk_grade) >= 6) && (
            <Button
              variant="outline"
              size="sm"
              className="no-print gap-1.5 border-purple-500/40 text-purple-700 dark:text-purple-300 hover:bg-purple-500/10"
              onClick={() => {
                setDecisionType("restructure");
                setModalOpen(true);
              }}
              title="Refer for MSME restructuring with a viability study (TEV)"
            >
              <FileText className="h-3.5 w-3.5 text-purple-600 dark:text-purple-400" />
              <span className="hidden sm:inline">Evaluate Restructuring</span>
            </Button>
          )}

          {!caps.canDecide && (
            <Badge variant="outline" className="no-print h-8 gap-1.5 px-2.5 text-xs font-normal" title={caps.reason ?? undefined}>
              <UserCheck className="h-3.5 w-3.5" /> {role === "Risk Admin" ? "Review only (Risk Admin)" : "View only: outside your branch"}
            </Badge>
          )}
          <Dialog open={modalOpen && caps.canDecide} onOpenChange={setModalOpen}>
            {caps.canDecide && (
            <DialogTrigger asChild>
              <Button size="sm" className="no-print gap-1.5 bg-primary text-primary-foreground hover:bg-primary/90">
                <UserCheck className="h-3.5 w-3.5" /> Credit Committee Decision
              </Button>
            </DialogTrigger>
            )}
            <DialogContent className="max-w-md">
              <DialogHeader>
                <DialogTitle>Credit Committee HITL Decision</DialogTitle>
                <DialogDescription className="text-xs">
                  Review borrower {b.loan_id} ({b.risk_grade}, PD {formatPercent(b.pd, 1)}) and log a credit committee decision to the audit trail.
                </DialogDescription>
              </DialogHeader>

              <div className="space-y-3.5 py-2 text-xs">
                <div>
                  <label className="text-[11px] font-medium text-muted-foreground uppercase">
                    Decision Action
                  </label>
                  <div className="mt-1.5 grid grid-cols-5 gap-1.5">
                    {(["accept", "override", "defer", "reject", "restructure"] as const).map((type) => (
                      <Button
                        key={type}
                        type="button"
                        variant={decisionType === type ? "default" : "outline"}
                        size="sm"
                        className="text-[11px] capitalize h-8 px-1"
                        onClick={() => setDecisionType(type)}
                      >
                        {type === "restructure" ? "Restructure" : type}
                      </Button>
                    ))}
                  </div>
                </div>

                {decisionType === "override" && (
                  <div>
                    <label className="text-[11px] font-medium text-muted-foreground uppercase">
                      Revised Risk Grade
                    </label>
                    <div className="mt-1 flex flex-wrap gap-1">
                      {["RG1", "RG2", "RG3", "RG4", "RG5", "RG6", "RG7", "RG8", "RG9", "RG10"].map((g) => (
                        <Button
                          key={g}
                          type="button"
                          variant={revisedGrade === g ? "secondary" : "ghost"}
                          size="sm"
                          className={`h-7 px-2 text-xs ${revisedGrade === g ? "border border-primary font-semibold" : ""}`}
                          onClick={() => setRevisedGrade(g)}
                        >
                          {g}
                        </Button>
                      ))}
                    </div>
                  </div>
                )}

                {decisionType === "restructure" && (
                  <div className="space-y-3 rounded-md border border-purple-500/30 bg-purple-50/40 dark:bg-purple-950/20 p-2.5">
                    <div className="text-[11px] font-semibold text-purple-700 dark:text-purple-300 flex items-center gap-1.5">
                      <FileText className="h-3.5 w-3.5" /> Restructuring with a viability study (TEV)
                    </div>
                    <div className="text-[11px] text-muted-foreground leading-normal">
                      Corrective action under the RBI Framework for Revitalising and Rehabilitating MSMEs: a unit found viable in a TEV study can get a moratorium and interest funding (FITL). Asset classification follows the RBI rules in force.
                    </div>
                    <div className="grid grid-cols-2 gap-2 text-xs">
                      <div>
                        <label className="text-[11px] font-medium text-muted-foreground">Moratorium</label>
                        <select
                          value={restructuringMoratorium}
                          onChange={(e) => setRestructuringMoratorium(e.target.value)}
                          className="mt-1 w-full h-7 text-xs rounded border border-input bg-background px-2"
                        >
                          <option value="3m">3 Months</option>
                          <option value="6m">6 Months</option>
                          <option value="9m">9 Months</option>
                          <option value="12m">12 Months</option>
                        </select>
                      </div>
                      <div>
                        <label className="text-[11px] font-medium text-muted-foreground">Promoter Margin</label>
                        <select
                          value={restructuringMarginInfusion}
                          onChange={(e) => setRestructuringMarginInfusion(e.target.value)}
                          className="mt-1 w-full h-7 text-xs rounded border border-input bg-background px-2"
                        >
                          <option value="10">+10% Infusion</option>
                          <option value="15">+15% Infusion</option>
                          <option value="20">+20% Infusion</option>
                          <option value="25">+25% Infusion</option>
                        </select>
                      </div>
                    </div>
                    <div>
                      <label className="text-[11px] font-medium text-muted-foreground">Who does the viability study (TEV agency)</label>
                      <Input
                        value={restructuringTevAgency}
                        onChange={(e) => setRestructuringTevAgency(e.target.value)}
                        className="mt-1 h-7 text-xs font-mono"
                      />
                    </div>
                    <div className="flex items-center justify-between text-xs pt-1 border-t border-purple-500/20">
                      <span className="text-[11px] font-medium">Convert overdue interest to a term loan (FITL)</span>
                      <label className="flex items-center gap-1.5 cursor-pointer text-[11px]">
                        <input
                          type="checkbox"
                          checked={restructuringFitl}
                          onChange={(e) => setRestructuringFitl(e.target.checked)}
                          className="rounded border-input text-primary"
                        />
                        <span>Capitalize Overdue Interest</span>
                      </label>
                    </div>
                  </div>
                )}

                <div className="grid grid-cols-2 gap-2">
                  <div>
                    <label className="text-[11px] font-medium text-muted-foreground uppercase">
                      Officer ID
                    </label>
                    <Input
                      className="mt-1 h-8 text-xs"
                      value={officerId}
                      readOnly
                    />
                  </div>
                  <div>
                    <label className="text-[11px] font-medium text-muted-foreground uppercase">
                      Committee Role
                    </label>
                    <Input
                      className="mt-1 h-8 text-xs"
                      value={officerRole}
                      onChange={(e) => setOfficerRole(e.target.value)}
                      placeholder="e.g. Committee Member"
                    />
                  </div>
                </div>

                <div>
                  <label className="text-[11px] font-medium text-muted-foreground uppercase">
                    Decision Rationale &amp; Audit Notes
                  </label>
                  <Textarea
                    className="mt-1 min-h-[70px] text-xs"
                    value={rationale}
                    onChange={(e) => setRationale(e.target.value)}
                    placeholder="Document qualitative justifications, additional collateral pledged, or management assessments..."
                  />
                </div>

                {pastDecisions.length > 0 && (
                  <div>
                    <label className="text-[11px] font-medium text-muted-foreground uppercase flex items-center gap-1">
                      <History className="h-3 w-3" /> Audit History ({pastDecisions.length})
                    </label>
                    <div className="mt-1 max-h-24 overflow-y-auto space-y-1 rounded border bg-muted/30 p-2">
                      {pastDecisions.map((d, idx) => (
                        <div key={idx} className="text-[11px] text-muted-foreground flex justify-between">
                          <span className="font-medium text-foreground">
                            {d.decision.toUpperCase()} {d.revised_grade ? `-> ${d.revised_grade}` : ""}
                          </span>
                          <span>by {d.decided_by || d.officer}</span>
                        </div>
                      ))}
                    </div>
                  </div>
                )}

                {feedbackMsg && (
                  <div className="rounded bg-primary/10 p-2 text-center text-xs text-primary font-medium">
                    {feedbackMsg}
                  </div>
                )}
              </div>

              <DialogFooter className="gap-2 sm:gap-0">
                <Button
                  type="button"
                  variant="outline"
                  size="sm"
                  onClick={() => setModalOpen(false)}
                  disabled={isSubmitting}
                >
                  Cancel
                </Button>
                <Button
                  type="button"
                  size="sm"
                  onClick={handleSubmitDecision}
                  disabled={isSubmitting}
                >
                  {isSubmitting ? "Logging..." : "Submit Committee Decision"}
                </Button>
              </DialogFooter>
            </DialogContent>
          </Dialog>
        </div>
      </div>

      {/* The account in one plain sentence, before any chart or model term. */}
      <div
        className={`rounded-lg border px-4 py-3 text-sm ${
          b.rag === "Red"
            ? "border-band-d/30 bg-band-d/5"
            : b.rag === "Amber"
              ? "border-band-c/30 bg-band-c/5"
              : "border-band-a/30 bg-band-a/5"
        }`}
      >
        <span className="font-semibold">{b.rag === "Green" ? "Why it is Green: " : "Why flagged: "}</span>
        {whyFlaggedLine(b, 4)}.
        <span className="ml-1 text-muted-foreground">
          {formatPercent(b.pd, 1)} chance of default in 12 months · {b.risk_grade} · {b.action}.
        </span>
      </div>

      {/* Credit Committee Decision Alert Banner */}
      {latestDecision && (
        <div className="flex items-center gap-2.5 rounded-lg border border-primary/30 bg-primary/5 px-4 py-2.5 text-xs text-foreground">
          <UserCheck className="h-4 w-4 text-primary shrink-0" />
          <div className="flex-1">
            <span className="font-semibold uppercase tracking-wider text-primary">
              Credit Committee Decision: {latestDecision.decision.toUpperCase()}
            </span>
            {latestDecision.revised_grade && (
              <span className="ml-1 font-medium">
                (Revised Grade: {latestDecision.revised_grade})
              </span>
            )}
            {" · "}
            <span className="text-muted-foreground">
              by {latestDecision.decided_by || latestDecision.officer || "Committee"} ({latestDecision.role || "Officer"})
            </span>
            {latestDecision.rationale && (
              <span className="text-muted-foreground"> — “{latestDecision.rationale}”</span>
            )}
          </div>
        </div>
      )}

      <div className="grid gap-4 lg:grid-cols-3 [&>*]:min-w-0">
        {/* PD gauge + grade */}
        <Card className="bg-surface">
          <CardHeader className="pb-0">
            <CardTitle className="text-sm">12-month default probability</CardTitle>
          </CardHeader>
          <CardContent className="space-y-4 pt-3">
            <div className="flex flex-wrap items-end gap-3">
              <div className="text-4xl font-semibold tabular-nums text-foreground">{formatPercent(b.pd, 1)}</div>
              <div className="flex items-center gap-1.5 pb-1">
                <Badge variant="outline" className={`${pdTone(b.pd)} font-mono font-normal`}>
                  {b.risk_grade}
                </Badge>
                <Badge variant="outline" className={`${ragTone[b.rag]} font-normal`}>
                  {b.rag}
                </Badge>
              </div>
            </div>
            {b.committee_grade && (
              <div className="-mt-2 text-[11px] text-amber-600 dark:text-amber-400" title="Set by a committee override; the model grade is above">
                Committee grade {b.committee_grade}
              </div>
            )}
            {/* Where this account sits on the RG1–RG10 scale. */}
            <div>
              <div className="flex gap-0.5" role="img" aria-label={`Grade ${b.risk_grade} on the RG1 to RG10 scale`}>
                {GRADE_EDGES.map(([g]) => g)
                  .concat("RG10")
                  .map((g, i) => {
                    const here = g === b.risk_grade;
                    const band = gradeIndexToRag(i);
                    return (
                      <div
                        key={g}
                        className={cn(
                          "flex h-7 flex-1 items-center justify-center rounded-sm text-[10px] font-mono",
                          band === "Green" ? "bg-band-a/15 text-band-a" : band === "Amber" ? "bg-band-c/15 text-band-c" : "bg-band-d/15 text-band-d",
                          here && "ring-2 ring-foreground font-semibold",
                        )}
                        title={`${g}: PD ${formatPercent(gradeRange(g)[0], 0)}–${formatPercent(gradeRange(g)[1], 0)}`}
                      >
                        {g.replace("RG", "")}
                      </div>
                    );
                  })}
              </div>
              <div className="mt-1 flex justify-between text-[11px] text-muted-foreground">
                <span>Green RG1–4</span>
                <span>Amber RG5–7</span>
                <span>Red RG8–10</span>
              </div>
            </div>
            <div className="space-y-1 text-[11px] text-muted-foreground">
              <div>
                {b.risk_grade} covers PD {formatPercent(gradeRange(b.risk_grade)[0], 0)} to{" "}
                {gradeRange(b.risk_grade)[1] >= 1 ? "100%" : formatPercent(gradeRange(b.risk_grade)[1], 0)}.
                {" "}Flagged for stress at PD ≥ 16% (RG6 and above).
              </div>
              {gradeIndexToRag(Math.max(0, gradeNumber(b.risk_grade) - 1)) !== b.rag && (
                <div className="text-foreground/80">
                  RAG is {b.rag} rather than {gradeIndexToRag(Math.max(0, gradeNumber(b.risk_grade) - 1))} because of days
                  overdue: the colour is never kinder than the account&apos;s actual repayment status.
                </div>
              )}
              <Link to="/reference" className="text-primary hover:underline">
                All thresholds
              </Link>
            </div>
          </CardContent>
        </Card>

        {/* Framework card */}
        <Card className="bg-surface">
          <CardHeader className="pb-2">
            <CardTitle className="text-sm">Interpretation framework</CardTitle>
          </CardHeader>
          <CardContent className="space-y-2.5 text-xs">
            <Row label="RAG bucket">
              <Badge variant="outline" className={`${ragTone[b.rag]} font-normal`}>
                {b.rag}
              </Badge>
            </Row>
            <Separator />
            <Row label="RBI SMA (days past due)">
              {rbiSma(dpdOf(b)) ?? "—"}
              {(dpdOf(b) ?? 0) > 0 && <span className="text-muted-foreground"> · {dpdOf(b)} days</span>}
            </Row>
            <Row label="Model early watch (from PD)">{watchLabel(b.sma_status)}</Row>
            <Separator />
            <Row label="Action">{b.action}</Row>
            <Separator />
            <Row label="Cadence">{b.cadence}</Row>
            <Separator />
            <Row label="Owner">{b.owner}</Row>
            <Separator />
            <Row label="API contracts">
              <span className="font-mono text-[11px] text-muted-foreground">
                Finacle 402/404/391/441/362
              </span>
            </Row>
          </CardContent>
        </Card>

        {/* Exposure card */}
        <Card className="bg-surface">
          <CardHeader className="pb-2">
            <CardTitle className="text-sm">Exposure &amp; expected loss</CardTitle>
            <CardDescription className="text-xs">LGD 45% · currency {b.currency}</CardDescription>
          </CardHeader>
          <CardContent className="space-y-2.5 text-xs">
            <Row label="EAD (ticket)">
              <span className="tabular-nums">{formatInr(b.ead)}</span>
            </Row>
            <Separator />
            <Row label="Expected credit loss">
              <span className="font-medium tabular-nums">{formatInr(b.ecl)}</span>
            </Row>
            <Separator />
            <Row label="Ind AS 109 ECL Stage">
              <Badge
                variant="outline"
                className={`font-normal ${
                  (b.ecl_stage ?? 1) === 1
                    ? "bg-band-a/15 text-band-a border-band-a/30"
                    : (b.ecl_stage ?? 1) === 2
                    ? "bg-band-c/15 text-band-c border-band-c/30"
                    : "bg-band-d/15 text-band-d border-band-d/30"
                }`}
              >
                {(b.ecl_stage ?? 1) === 1
                  ? "Stage 1 (12m ECL)"
                  : (b.ecl_stage ?? 1) === 2
                  ? "Stage 2 (risk has risen; lifetime provision)"
                  : "Stage 3 (Credit-Impaired)"}
              </Badge>
            </Row>
            {b.lifetime_ecl != null && (b.ecl_stage ?? 1) >= 2 && (
              <>
                <Separator />
                <Row label="Lifetime ECL">
                  <span className="tabular-nums font-medium text-foreground">
                    {formatInr(b.lifetime_ecl)}
                  </span>
                </Row>
              </>
            )}
            <Separator />
            <Row label="Coverage">
              <Badge variant="outline" className="bg-band-a/15 text-band-a border-band-a/30 font-normal">
                {b.coverage.replace("_", " ")}
              </Badge>
            </Row>
            <Separator />
            <Row label="Actual outcome (synthetic truth)">
              {b.actual_default == null ? (
                "—"
              ) : b.actual_default ? (
                <Badge variant="outline" className="bg-band-d/15 text-band-d border-band-d/30 font-normal">
                  defaulted
                </Badge>
              ) : (
                <Badge variant="outline" className="bg-band-a/15 text-band-a border-band-a/30 font-normal">
                  performing
                </Badge>
              )}
            </Row>
          </CardContent>
        </Card>
      </div>

      {/* Reason codes + EWS */}
      <div className="grid gap-4 lg:grid-cols-2 [&>*]:min-w-0">
        <Card className="bg-surface">
          <CardHeader className="pb-2">
            <CardTitle className="text-sm">Why this score — reason codes</CardTitle>
          </CardHeader>
          <CardContent>
            <ReasonList reasons={b.reason_codes} raw={b.raw as Record<string, unknown> | undefined} />
          </CardContent>
        </Card>

        <Card className="bg-surface">
          <CardHeader className="pb-2">
            <CardTitle className="text-sm">Early-warning signals (RBI EWS)</CardTitle>
          </CardHeader>
          <CardContent>
            {b.ews_triggers.length === 0 ? (
              <p className="text-xs text-muted-foreground">
                No active early-warning signals for this account.
              </p>
            ) : (
              <ul className="space-y-2">
                {b.ews_triggers.map((t) => (
                  <li key={t.code} className="flex items-start gap-2 text-xs">
                    <AlertTriangle
                      className={`mt-0.5 h-3.5 w-3.5 shrink-0 ${
                        t.severity === "high"
                          ? "text-band-d"
                          : t.severity === "medium"
                            ? "text-band-c"
                            : "text-muted-foreground"
                      }`}
                    />
                    <div>
                      <div className="flex items-center gap-1.5 flex-wrap">
                        <span className="font-medium">{t.name}</span>{" "}
                        <span className="text-muted-foreground font-mono text-[11px]">({t.code})</span>
                        {getEwsApiSource(t.code) ? (
                          <Badge variant="outline" className="text-[11px] font-mono border-blue-500/30 text-blue-600 bg-blue-50/40 dark:bg-blue-950/40" title={getEwsApiSource(t.code)!.name}>
                            {getEwsApiSource(t.code)!.api}
                          </Badge>
                        ) : (
                          <Badge variant="outline" className="text-[11px] font-normal text-muted-foreground" title="No sandbox API supplies this input; synthetic in the prototype">
                            no sandbox API
                          </Badge>
                        )}
                      </div>
                      <div className="text-muted-foreground mt-0.5">{t.detail}</div>
                    </div>
                  </li>
                ))}
              </ul>
            )}
          </CardContent>
        </Card>
      </div>

      {/* Officer notes and bank statements, read and re-scored live (nothing saved). */}
      <UnstructuredPanel loanId={b.loan_id} segment={b.segment} />

      {/* Interactive Recourse What-If Simulator. Its sliders (drawing-power gap,
          collection ratio, lien) are inputs of the IDBI-book model only; the
          India-book model ignores them, so there the action plan below is used. */}
      {b.segment === "msme_idbi" && (
      <Card className="border-primary/20 bg-surface">
        <CardHeader className="pb-2">
          <div className="flex items-center justify-between">
            <CardTitle className="flex items-center gap-1.5 text-sm">
              <Sliders className="h-4 w-4 text-primary" />
              Interactive "What-If" Recourse Simulator
            </CardTitle>
            <div className="flex items-center gap-2">
              <Button
                variant="ghost"
                size="sm"
                onClick={handleResetRecourse}
                disabled={!isRecourseModified}
                className="h-6 px-2 text-[11px] text-muted-foreground hover:text-foreground gap-1 cursor-pointer"
                title="Reset sliders back to baseline borrower parameters"
              >
                <RotateCcw className="h-3 w-3" />
                Reset Baseline
              </Button>
              <Badge variant="outline" className="border-primary/30 bg-primary/10 text-primary text-[11px]">
                Dynamic Sensitivity
              </Badge>
            </div>
          </div>
        </CardHeader>
        <CardContent className="space-y-4 text-xs">
          <div className="grid gap-4 sm:grid-cols-3">
            <div>
              <div className="flex items-center justify-between">
                <span className="text-[11px] font-medium text-muted-foreground flex items-center">
                  Drawing Power Gap (%)
                  <Badge variant="outline" className="text-[11px] font-mono border-blue-500/30 text-blue-600 bg-blue-50/40 ml-1.5 py-0 h-4">
                    CBS-03
                  </Badge>
                  <HintIcon text="Reducing DP Erosion: Under RBI working capital norms, Drawing Power (DP) is calculated from eligible hypothecated stock and debtors less margin. A DP gap ≥25% triggers mandatory Early Warning Signal EWS18. Reducing this gap (by auditing stock or infusing promoter margin) directly reduces probability of default and releases provision reserves." />
                </span>
                <div className="flex items-center gap-1 font-mono text-xs">
                  <span className="font-semibold text-foreground">{simulatedDpGap}%</span>
                  {simulatedDpGap !== initialDpGap && (
                    <span className={`text-[11px] ${simulatedDpGap < initialDpGap ? "text-emerald-500 font-semibold" : "text-rose-500"}`}>
                      ({simulatedDpGap < initialDpGap ? `-${initialDpGap - simulatedDpGap}%` : `+${simulatedDpGap - initialDpGap}%`})
                    </span>
                  )}
                </div>
              </div>
              <input
                type="range"
                min="0"
                max="50"
                step="1"
                value={simulatedDpGap}
                onChange={(e) => setSimulatedDpGap(Number(e.target.value))}
                className="mt-2 w-full accent-primary cursor-pointer"
              />
              <div className="flex items-center justify-between text-[11px] text-muted-foreground mt-0.5">
                <span>Baseline: {initialDpGap}%</span>
                <span className="text-primary/80">Covenant: regularize stock statements</span>
              </div>
            </div>

            <div>
              <div className="flex items-center justify-between">
                <span className="text-[11px] font-medium text-muted-foreground flex items-center">
                  Demanded vs Collected
                  <Badge variant="outline" className="text-[11px] font-mono border-blue-500/30 text-blue-600 bg-blue-50/40 ml-1.5 py-0 h-4">
                    CBS-02
                  </Badge>
                  <HintIcon text="Margin Enhancement & Collections: Ratio of cash collected against scheduled debt service obligations over trailing 12 months. Ratios <0.80 trigger RBI EWS19 collection shortfall. Recovering overdue interest and mandating higher cash retention covenants boosts debt service reliability." />
                </span>
                <div className="flex items-center gap-1 font-mono text-xs">
                  <span className="font-semibold text-foreground">{(simulatedCollection * 100).toFixed(0)}%</span>
                  {Math.abs(simulatedCollection - initialCollection) > 0.005 && (
                    <span className={`text-[11px] ${simulatedCollection > initialCollection ? "text-emerald-500 font-semibold" : "text-rose-500"}`}>
                      ({simulatedCollection > initialCollection ? `+${Math.round((simulatedCollection - initialCollection) * 100)}%` : `${Math.round((simulatedCollection - initialCollection) * 100)}%`})
                    </span>
                  )}
                </div>
              </div>
              <input
                type="range"
                min="0.5"
                max="1.0"
                step="0.02"
                value={simulatedCollection}
                onChange={(e) => setSimulatedCollection(Number(e.target.value))}
                className="mt-2 w-full accent-primary cursor-pointer"
              />
              <div className="flex items-center justify-between text-[11px] text-muted-foreground mt-0.5">
                <span>Baseline: {(initialCollection * 100).toFixed(0)}%</span>
                <span className="text-primary/80">Covenant: recover overdue interest</span>
              </div>
            </div>

            <div>
              <div className="flex items-center justify-between">
                <span className="text-[11px] font-medium text-muted-foreground flex items-center">
                  Account Lien / Encumbrance
                  <Badge variant="outline" className="text-[11px] font-mono border-rose-500/30 text-rose-600 bg-rose-50/40 ml-1.5 py-0 h-4">
                    CBS-05
                  </Badge>
                  <HintIcon text="Statutory Lien Clearance: The lien enquiry (CBS-05) tracks statutory tax notices, GST attachments, or court orders on borrower accounts. Clearing statutory liens removes legal encumbrance on primary collateral, lifting default multipliers." />
                </span>
                <Badge
                  variant="outline"
                  className={`font-mono text-[11px] h-5 px-1.5 ${
                    simulatedLien === 0
                      ? "border-emerald-500/30 text-emerald-600 bg-emerald-500/10"
                      : "border-rose-500/30 text-rose-600 bg-rose-500/10"
                  }`}
                >
                  {simulatedLien === 0 ? "Clean" : "Lien Marked"}
                </Badge>
              </div>
              <Button
                variant={simulatedLien === 0 ? "outline" : "secondary"}
                size="sm"
                onClick={() => setSimulatedLien(simulatedLien === 0 ? 1 : 0)}
                className="mt-2 w-full h-8 text-xs cursor-pointer"
              >
                {simulatedLien === 0 ? "Statutory Notice Cleared (Clean)" : "Clear Lien Notice"}
              </Button>
              <div className="flex items-center justify-between text-[11px] text-muted-foreground mt-0.5">
                <span>Baseline: {initialLien === 0 ? "Clean" : "Lien Marked"}</span>
                <span className="text-primary/80">Covenant: statutory dues regularized</span>
              </div>
            </div>
          </div>

          {/* Live Visual Diff: Baseline vs Post-Recourse ECL & Capital Relief */}
          <div className="rounded-lg border border-border bg-card p-3.5 space-y-3">
            <div className="flex flex-wrap items-center justify-between gap-2 border-b border-border/60 pb-2">
              <div className="flex items-center gap-1.5">
                <Sparkles className="h-3.5 w-3.5 text-primary" />
                <span className="text-xs font-semibold text-foreground">
                  Live Visual Diff: Baseline vs Post-Recourse
                </span>
              </div>
              <div className="flex items-center gap-1.5">
                {liveRecourse ? (
                  <Badge variant="outline" className="text-[11px] h-4 px-1.5 border-emerald-500/30 text-emerald-600 bg-emerald-500/10">
                    Live ML Evaluated
                  </Badge>
                ) : (
                  <Badge variant="outline" className="text-[11px] h-4 px-1.5 border-blue-500/30 text-blue-600 bg-blue-500/10">
                    Sensitivity Rescored
                  </Badge>
                )}
                {isRecourseModified ? (
                  <Badge className="bg-emerald-500/15 text-emerald-600 dark:text-emerald-400 border border-emerald-500/30 text-[11px] h-4 px-1.5">
                    Covenants Applied
                  </Badge>
                ) : (
                  <span className="text-[11px] text-muted-foreground">Adjust sliders to apply covenants</span>
                )}
              </div>
            </div>

            <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
              {/* Diff 1: Ind AS 109 ECL */}
              <div className="rounded-md border border-border/70 bg-background/60 p-2.5 space-y-1.5">
                <div className="flex items-center justify-between text-[11px] uppercase tracking-wider text-muted-foreground">
                  <span className="flex items-center">
                    Ind AS 109 ECL
                    <HintIcon text="Expected Credit Loss impairment provision required under Ind AS 109. Visual diff displays direct capital relief achieved by mitigating borrower risk factors." />
                  </span>
                  {capitalSaved > 0 && (
                    <span className="font-semibold text-emerald-600 dark:text-emerald-400 font-mono text-[11px]">
                      -{eclReductionPct}%
                    </span>
                  )}
                </div>
                <div className="flex items-baseline gap-2 flex-wrap min-w-0">
                  <span className="text-xs line-through text-muted-foreground font-mono">
                    {formatInr(b.ecl)}
                  </span>
                  <span className="text-xs text-muted-foreground">→</span>
                  <span className={`text-sm font-bold font-mono ${capitalSaved > 0 ? "text-emerald-600 dark:text-emerald-400" : "text-foreground"}`}>
                    {formatInr(effectiveRecourse.newEcl)}
                  </span>
                </div>
                {/* Visual diff comparison bar */}
                <div className="space-y-1 pt-1">
                  <div className="h-2 w-full rounded-full bg-muted overflow-hidden flex">
                    <div
                      className="h-full bg-primary/70 transition-all duration-300"
                      style={{ width: `${Math.max(5, Math.min(100, (effectiveRecourse.newEcl / Math.max(1, b.ecl)) * 100))}%` }}
                      title={`Post-recourse ECL: ${formatInr(effectiveRecourse.newEcl)}`}
                    />
                    {capitalSaved > 0 && (
                      <div
                        className="h-full bg-emerald-500/40 border-l border-emerald-500/60 transition-all duration-300 animate-pulse"
                        style={{ width: `${Math.min(95, (capitalSaved / Math.max(1, b.ecl)) * 100)}%` }}
                        title={`Capital provision unlocked: ${formatInr(capitalSaved)}`}
                      />
                    )}
                  </div>
                  <div className="flex justify-between text-[11px] text-muted-foreground font-mono">
                    <span>Post-Recourse Reserve</span>
                    {capitalSaved > 0 ? (
                      <span className="text-emerald-600 dark:text-emerald-400 font-medium">
                        Saved {formatInrCompact(capitalSaved)}
                      </span>
                    ) : (
                      <span>Baseline Level</span>
                    )}
                  </div>
                </div>
              </div>

              {/* Diff 2: 12M PD & Risk Grade */}
              <div className="rounded-md border border-border/70 bg-background/60 p-2.5 space-y-1.5 min-w-0">
                <div className="flex items-center justify-between text-[11px] uppercase tracking-wider text-muted-foreground">
                  <span className="flex items-center">
                    Calibrated 12M PD
                    <HintIcon text="Isotonically calibrated 12-month Probability of Default and corresponding Risk Grade (RG1–RG10) under the counterfactual scenario." />
                  </span>
                  {effectiveRecourse.liftPct > 0 && (
                    <span className="font-semibold text-emerald-600 dark:text-emerald-400 font-mono text-[11px]">
                      -{effectiveRecourse.liftPct}% Risk
                    </span>
                  )}
                </div>
                <div className="flex items-baseline gap-2 flex-wrap min-w-0">
                  <span className="text-xs line-through text-muted-foreground font-mono">
                    {formatPercent(b.pd, 1)}
                  </span>
                  <span className="text-xs text-muted-foreground">→</span>
                  <span className={`text-sm font-bold font-mono ${effectiveRecourse.newPd < b.pd ? "text-emerald-600 dark:text-emerald-400" : "text-foreground"}`}>
                    {formatPercent(effectiveRecourse.newPd, 1)}
                  </span>
                </div>
                <div className="flex items-center gap-1.5 pt-1 flex-wrap min-w-0">
                  <Badge variant="outline" className={`text-[11px] py-0 h-4 ${pdTone(b.pd)} font-mono`}>
                    {b.risk_grade}
                  </Badge>
                  <span className="text-xs text-muted-foreground">→</span>
                  <Badge variant="outline" className={`text-[11px] py-0 h-4 ${pdTone(effectiveRecourse.newPd)} font-mono font-semibold`}>
                    {effectiveRecourse.newGrade}
                  </Badge>
                  {gradeNumber(effectiveRecourse.newGrade) < gradeNumber(b.risk_grade) && (
                    <span className="text-[11px] text-emerald-600 dark:text-emerald-400 font-medium flex items-center">
                      <TrendingUp className="h-3 w-3 mr-0.5" /> Upgrade
                    </span>
                  )}
                </div>
              </div>

              {/* Diff 3: Capital Relieved */}
              <div className="rounded-md border border-emerald-500/30 bg-emerald-500/5 p-2.5 flex flex-col justify-between">
                <div className="text-[11px] uppercase tracking-wider text-emerald-700 dark:text-emerald-300 font-semibold flex items-center justify-between">
                  <span>Provision released</span>
                  <CheckCircle2 className="h-3.5 w-3.5 text-emerald-500" />
                </div>
                <div className="my-1">
                  <div className="text-lg font-bold font-mono text-emerald-600 dark:text-emerald-400">
                    {formatInr(capitalSaved)}
                  </div>
                  <p className="text-[11px] text-muted-foreground leading-tight">
                    {capitalSaved > 0
                      ? "Estimated provision reserve reduction upon covenant execution."
                      : "Adjust levers above to estimate reserve reduction."}
                  </p>
                </div>
                <div className="text-[11px] text-emerald-800/80 dark:text-emerald-300/80 font-medium flex items-center gap-1">
                  <ShieldCheck className="h-3 w-3 shrink-0" />
                  <span>Provision Relief</span>
                </div>
              </div>
            </div>
          </div>
        </CardContent>
      </Card>
      )}

      {/* Action plan: the engine's recourse levers, borrower vs bank */}
      <ActionPlanCard b={b} />

      {/* Stress horizon + committee actions */}
      {/* Formal Credit Appraisal Memo (CAM) & Committee Sign-Off */}
      <Card className="bg-surface print-page">
        <CardHeader className="pb-2">
          <div className="flex flex-wrap items-center justify-between gap-2">
            <CardTitle className="text-sm font-semibold">
              Credit Appraisal Memo (CAM) — Zonal Review Dossier
            </CardTitle>
            <span className="text-[11px] uppercase font-mono text-muted-foreground">
              REF: IDBI/CAM/{b.loan_id}/2026
            </span>
          </div>
        </CardHeader>
        <CardContent className="text-xs space-y-4 leading-relaxed text-foreground/90">
          <div className="grid grid-cols-2 sm:grid-cols-4 gap-2 border-y border-border py-2 text-[11px]">
            <div>
              <span className="text-muted-foreground block">Borrower ID</span>
              <span className="font-mono font-semibold">{b.loan_id}</span>
            </div>
            <div>
              <span className="text-muted-foreground block">Facility Sanctioned</span>
              <span className="font-mono font-semibold">{formatInr(b.ead)}</span>
            </div>
            <div>
              <span className="text-muted-foreground block">Predicted PD (12M)</span>
              <span className="font-mono font-semibold text-primary">{formatPercent(b.pd, 2)}</span>
            </div>
            <div>
              <span className="text-muted-foreground block">Credit Grade / Stage</span>
              <span className="font-mono font-semibold">{b.risk_grade} · Stage {b.ecl_stage ?? 1}</span>
            </div>
          </div>

          <p>
            Account <strong>{b.loan_id}</strong> ({(b.sector ?? "—").replace(/_/g, " ")},{" "}
            {b.sub_segment ?? "—"}, {b.state ?? "—"}) carries a calibrated 12-month default
            probability of <strong>{formatPercent(b.pd, 1)}</strong>, graded{" "}
            <strong>{b.risk_grade}</strong> with a <strong>{b.rag}</strong> RAG bucket and{" "}
            <strong>{watchLabel(b.sma_status)}</strong> (RBI SMA status from days past due:{" "}
            <strong>{rbiSma(dpdOf(b)) ?? "not recorded"}</strong>). Prescribed action: {b.action.toLowerCase()} at{" "}
            {b.cadence.toLowerCase()} owned by the {b.owner.toLowerCase()}. Expected credit loss is{" "}
            <strong>{formatInr(b.ecl)}</strong> on an exposure of {formatInr(b.ead)} (LGD 45%).
          </p>

          {/* Committee Sign-Off Block for Print */}
          <div className="pt-4 border-t border-border mt-4 grid grid-cols-3 gap-4 text-center text-[11px] text-muted-foreground">
            <div className="border-t border-dashed border-border pt-2">
              <span className="font-semibold text-foreground block">Appraisal Officer</span>
              Branch Credit Operations
            </div>
            <div className="border-t border-dashed border-border pt-2">
              <span className="font-semibold text-foreground block">Risk Manager</span>
              Controlling Office Risk Dept
            </div>
            <div className="border-t border-dashed border-border pt-2">
              <span className="font-semibold text-foreground block">Chairperson</span>
              Zonal Credit Committee
            </div>
          </div>
        </CardContent>
      </Card>
    </div>
  );
}

function Row({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div className="flex items-center justify-between gap-4">
      <span className="shrink-0 text-muted-foreground">{label}</span>
      <span className="min-w-0 truncate text-right text-foreground">{children}</span>
    </div>
  );
}

// Reason codes grouped into one row per driver family, in plain words. The
// share is each family's part of the total SHAP attribution for this account
// (log-odds), not PD points; the raw taxonomy code stays in the tooltip.
function ReasonList({ reasons, raw }: { reasons: ReasonCode[]; raw?: Record<string, unknown> }) {
  if (reasons.length === 0) {
    return (
      <p className="text-xs text-muted-foreground">
        No active risk driver reason codes for this facility.
      </p>
    );
  }
  const groups = new Map<string, { label: string; code: string; net: number; features: string[] }>();
  for (const r of reasons) {
    const key = r.label || r.taxonomy_code || r.feature;
    const g = groups.get(key) ?? { label: key, code: r.taxonomy_code, net: 0, features: [] };
    g.net += r.direction === "raises_risk" ? Math.abs(r.impact) : -Math.abs(r.impact);
    if (!g.features.includes(r.feature)) g.features.push(r.feature);
    groups.set(key, g);
  }
  const rows = [...groups.values()].sort((x, y) => Math.abs(y.net) - Math.abs(x.net));
  const total = rows.reduce((s, g) => s + Math.abs(g.net), 0) || 1;
  return (
    <div className="space-y-2.5">
      <ul className="space-y-2.5">
        {rows.map((g) => {
          const raises = g.net >= 0;
          const share = Math.round((Math.abs(g.net) / total) * 100);
          return (
            <li key={g.label} title={g.code}>
              <div className="flex items-center justify-between gap-2 text-xs">
                <span className="flex items-center gap-1.5 font-medium">
                  {raises ? (
                    <TrendingDown className="h-3.5 w-3.5 text-negative" />
                  ) : (
                    <CalendarClock className="h-3.5 w-3.5 text-positive" />
                  )}
                  {g.label}
                </span>
                <span className={`shrink-0 tabular-nums ${raises ? "text-negative" : "text-positive"}`}>
                  {raises ? "raises risk" : "lowers risk"} · {share}%
                </span>
              </div>
              <div className="mt-1 h-1.5 overflow-hidden rounded-full bg-muted">
                <div
                  className={`h-full rounded-full ${raises ? "bg-negative" : "bg-positive"}`}
                  style={{ width: `${Math.max(share, 4)}%` }}
                />
              </div>
              <div className="mt-0.5 text-[11px] text-muted-foreground">
                {g.features.map((f) => driverDetail(f, raw)).join(" · ")}
              </div>
            </li>
          );
        })}
      </ul>
      <p className="text-[11px] text-muted-foreground">
        % = share of what moves this account&apos;s score, from the model&apos;s own attribution (SHAP).
      </p>
    </div>
  );
}

