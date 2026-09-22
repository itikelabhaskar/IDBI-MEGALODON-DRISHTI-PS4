import { useEffect, useState, useMemo } from "react";
import { createFileRoute, Link } from "@tanstack/react-router";
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
  RadialBarChart,
  RadialBar,
  PolarAngleAxis,
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
import { formatInr, formatInrCompact, formatPercent, ragTone, pdTone } from "@/lib/format";
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
} from "lucide-react";
import { toast } from "sonner";
import { GuidedTooltip, HintIcon } from "@/components/drishti/guided-tooltip";

function buildFallbackBorrower(loanId: string): BorrowerScore {
  return {
    loan_id: loanId,
    segment: "msme_idbi",
    sector: "auto_ancillary",
    sub_segment: "small",
    state: "MH",
    ticket_size: 2500000,
    ead: 2500000,
    pd: 0.048,
    risk_grade: "RG4",
    rag: "Green",
    sma_status: "Standard",
    action: "Annual Review",
    cadence: "Annual",
    owner: "Branch Manager",
    ecl: 54000,
    ecl_stage: 1,
    currency: "INR",
    coverage: "full",
    fields_defaulted: [],
    reason_codes: [],
    ews_triggers: [],
    stress_horizon: { expected_stress_month: 12, quarter: "Q4", estimated: true },
    raw: {
      loan_id: loanId,
      sanction_limit: 2500000,
      drawing_power: 2500000,
      drawing_power_gap_pct: 0,
      demanded_vs_collected_ratio: 0.98,
      cibil_score: 720,
      dpd: 0,
      lien_flag: 0,
      restructuring_flag: 0,
    },
  };
}

export const Route = createFileRoute("/borrowers/$id")({
  loader: async ({ params }) => {
    const liveBorrower = await fetchBorrower(params.id);
    const borrower = liveBorrower ?? getBorrower(params.id) ?? buildFallbackBorrower(params.id);
    return { borrower };
  },
  component: BorrowerDetail,
});

function BorrowerDetail() {
  const { borrower: snapshotRow } = Route.useLoaderData();
  const model = getSnapshot().model_card;

  // Live re-score against the FastAPI service when it is reachable. Adds the
  // cure path and a hazard-model stress horizon that the offline snapshot
  // cannot carry. Falls back silently to the snapshot row.
  const [b, setB] = useState<LiveBorrower>(snapshotRow);
  const [live, setLive] = useState(false);

  // Credit Committee HITL Decision modal states
  const [modalOpen, setModalOpen] = useState(false);
  const [decisionType, setDecisionType] = useState<"accept" | "override" | "defer" | "reject">("accept");
  const [revisedGrade, setRevisedGrade] = useState("RG2");
  const [rationale, setRationale] = useState("");
  const [officerId, setOfficerId] = useState("CRO_COMM_01");
  const [officerRole, setOfficerRole] = useState("Controlling Office Credit Committee");
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
    scoreBorrowerLive(snapshotRow.loan_id, ac.signal).then((r) => {
      if (!r || ac.signal.aborted) return;
      setB(r.borrower);
      setLive(r.source.mode === "live");
    });
    return () => ac.abort();
  }, [snapshotRow]);

  // Interactive Recourse What-If Simulator state
  const rawData = (snapshotRow as any).raw ?? {};
  const initialDpGap = Number(rawData.drawing_power_gap_pct ?? (snapshotRow.risk_grade >= "RG6" ? 22 : 0));
  const initialCollection = Number(rawData.demanded_vs_collected_ratio ?? (snapshotRow.risk_grade >= "RG6" ? 0.82 : 0.98));
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
        const liveInputs: Record<string, unknown> = {
          ...(b.raw ?? rawData),
          loan_id: b.loan_id,
          drawing_power_gap_pct: simulatedDpGap,
          demanded_vs_collected_ratio: simulatedCollection,
          lien_flag: simulatedLien,
          cibil_score: Number((b.raw as any)?.cibil_score ?? (b as any).cibil_score ?? 700),
          sanction_limit: Number(b.ead || 1000000),
          drawing_power: Number(b.ead * (1 - simulatedDpGap / 100)),
          dpd: Number((b.raw as any)?.dpd ?? 0),
          emi_bounce_6m: Number((b.raw as any)?.emi_bounce_6m ?? 0),
          sector: b.sector ?? "auto_ancillary",
          sub_segment: b.sub_segment ?? "small",
          state: b.state ?? "MH",
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
      override_action: decisionType === "override" ? `Override to ${revisedGrade}` : undefined,
      rationale: rationale.trim() || `Decision ${decisionType} confirmed by ${officerId}`,
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
    setIsSubmitting(false);
    if (ok) {
      setLatestDecision(payload);
      setPastDecisions((prev) => [payload, ...prev]);
      setFeedbackMsg("Decision successfully logged to audit database.");
      setTimeout(() => {
        setModalOpen(false);
        setFeedbackMsg(null);
      }, 1200);
    } else {
      setFeedbackMsg("Failed to persist decision to API / DB.");
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
SMA Status: ${b.sma_status} | Recommended Action: ${b.action} (Cadence: ${b.cadence}, Owner: ${b.owner})
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

  const pdGauge = [{ name: "pd", value: Math.round(b.pd * 100), fill: "var(--color-primary)" }];

  return (
    <div className="p-4 md:p-6 space-y-6">
      {/* Header */}
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <Button variant="ghost" size="sm" className="-ml-2 mb-1 text-xs no-print" asChild>
            <Link to="/" viewTransition>
              <ArrowLeft className="mr-1 h-3.5 w-3.5" /> Portfolio console
            </Link>
          </Button>
          <div className="text-[10px] uppercase tracking-widest text-muted-foreground">
            {b.segment} · {(b.sector ?? "—").replace(/_/g, " ")} · {b.state ?? "—"} ·{" "}
            {b.sub_segment ?? "—"}
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
        <div className="flex items-center gap-2">
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

          <Dialog open={modalOpen} onOpenChange={setModalOpen}>
            <DialogTrigger asChild>
              <Button size="sm" className="no-print gap-1.5 bg-primary text-primary-foreground hover:bg-primary/90">
                <UserCheck className="h-3.5 w-3.5" /> Credit Committee Decision
              </Button>
            </DialogTrigger>
            <DialogContent className="max-w-md">
              <DialogHeader>
                <DialogTitle>Credit Committee HITL Decision</DialogTitle>
                <DialogDescription className="text-xs">
                  Review borrower {b.loan_id} ({b.risk_grade}, PD {formatPercent(b.pd, 1)}) and log an immutable credit committee governance decision.
                </DialogDescription>
              </DialogHeader>

              <div className="space-y-3.5 py-2 text-xs">
                <div>
                  <label className="text-[11px] font-medium text-muted-foreground uppercase">
                    Decision Action
                  </label>
                  <div className="mt-1.5 grid grid-cols-4 gap-1.5">
                    {(["accept", "override", "defer", "reject"] as const).map((type) => (
                      <Button
                        key={type}
                        type="button"
                        variant={decisionType === type ? "default" : "outline"}
                        size="sm"
                        className="text-xs capitalize h-8"
                        onClick={() => setDecisionType(type)}
                      >
                        {type}
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

                <div className="grid grid-cols-2 gap-2">
                  <div>
                    <label className="text-[11px] font-medium text-muted-foreground uppercase">
                      Officer ID
                    </label>
                    <Input
                      className="mt-1 h-8 text-xs"
                      value={officerId}
                      onChange={(e) => setOfficerId(e.target.value)}
                      placeholder="e.g. CRO_COMM_01"
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

      <div className="grid gap-4 lg:grid-cols-3">
        {/* PD gauge + grade */}
        <Card className="bg-surface">
          <CardHeader className="pb-0">
            <CardTitle className="text-sm">12-month default probability</CardTitle>
            <CardDescription className="text-xs">
              Calibrated (isotonic) · discrimination AUC {model.auc.toFixed(3)}
            </CardDescription>
          </CardHeader>
          <CardContent className="relative h-48">
            <ResponsiveContainer width="100%" height="100%">
              <RadialBarChart
                data={pdGauge}
                innerRadius="70%"
                outerRadius="100%"
                startAngle={210}
                endAngle={-30}
              >
                <PolarAngleAxis type="number" domain={[0, 60]} tick={false} />
                <RadialBar dataKey="value" cornerRadius={8} background={{ fill: "var(--color-muted)" }} />
              </RadialBarChart>
            </ResponsiveContainer>
            <div className="pointer-events-none absolute inset-0 grid place-items-center">
              <div className="text-center">
                <div className="text-3xl font-semibold tabular-nums text-foreground">
                  {formatPercent(b.pd, 1)}
                </div>
                <Badge variant="outline" className={`mt-1 ${pdTone(b.pd)} font-normal`}>
                  {b.risk_grade}
                </Badge>
              </div>
            </div>
          </CardContent>
        </Card>

        {/* Framework card */}
        <Card className="bg-surface">
          <CardHeader className="pb-2">
            <CardTitle className="text-sm">Interpretation framework</CardTitle>
            <CardDescription className="text-xs">
              One common framework across every segment.
            </CardDescription>
          </CardHeader>
          <CardContent className="space-y-2.5 text-xs">
            <Row label="RAG bucket">
              <Badge variant="outline" className={`${ragTone[b.rag]} font-normal`}>
                {b.rag}
              </Badge>
            </Row>
            <Separator />
            <Row label="SMA watch">{b.sma_status}</Row>
            <Separator />
            <Row label="Action">{b.action}</Row>
            <Separator />
            <Row label="Cadence">{b.cadence}</Row>
            <Separator />
            <Row label="Owner">{b.owner}</Row>
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
                  ? "Stage 2 (Lifetime ECL / SICR)"
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
      <div className="grid gap-4 lg:grid-cols-2">
        <Card className="bg-surface">
          <CardHeader className="pb-2">
            <CardTitle className="text-sm">Why this score — reason codes</CardTitle>
            <CardDescription className="text-xs">
              SHAP attributions mapped to the frozen reason taxonomy.
            </CardDescription>
          </CardHeader>
          <CardContent>
            <ReasonList reasons={b.reason_codes} />
          </CardContent>
        </Card>

        <Card className="bg-surface">
          <CardHeader className="pb-2">
            <CardTitle className="text-sm">Early-warning signals (RBI EWS)</CardTitle>
            <CardDescription className="text-xs">
              Rule engine over GST / AA / bureau / behavioural fields.
            </CardDescription>
          </CardHeader>
          <CardContent>
            {b.ews_triggers.length === 0 ? (
              <p className="text-xs text-muted-foreground">
                No EWS triggers fired for this account in the snapshot build. Live scoring via the
                API evaluates all 15 rules per request.
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
                      <span className="font-medium">{t.name}</span>{" "}
                      <span className="text-muted-foreground">({t.code})</span>
                      <div className="text-muted-foreground">{t.detail}</div>
                    </div>
                  </li>
                ))}
              </ul>
            )}
          </CardContent>
        </Card>
      </div>

      {/* Interactive Recourse What-If Simulator */}
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
              <Badge variant="outline" className="border-primary/30 bg-primary/10 text-primary text-[10px]">
                Dynamic Sensitivity
              </Badge>
            </div>
          </div>
          <CardDescription className="text-xs">
            Simulate covenant restructuring or remedial recovery actions to see immediate PD, Risk Grade, and ECL capital relief.
          </CardDescription>
        </CardHeader>
        <CardContent className="space-y-4 text-xs">
          <div className="grid gap-4 sm:grid-cols-3">
            <div>
              <div className="flex items-center justify-between">
                <span className="text-[11px] font-medium text-muted-foreground flex items-center">
                  Drawing Power Gap (%)
                  <HintIcon text="Reducing DP Erosion: Under RBI working capital norms, Drawing Power (DP) is calculated from eligible hypothecated stock and debtors less margin. A DP gap ≥25% triggers mandatory Early Warning Signal EWS18. Reducing this gap (by auditing stock or infusing promoter margin) directly reduces probability of default and releases provision reserves." />
                </span>
                <div className="flex items-center gap-1 font-mono text-xs">
                  <span className="font-semibold text-foreground">{simulatedDpGap}%</span>
                  {simulatedDpGap !== initialDpGap && (
                    <span className={`text-[10px] ${simulatedDpGap < initialDpGap ? "text-emerald-500 font-semibold" : "text-rose-500"}`}>
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
              <div className="flex items-center justify-between text-[10px] text-muted-foreground mt-0.5">
                <span>Baseline: {initialDpGap}%</span>
                <span className="text-primary/80">Covenant: regularize stock statements</span>
              </div>
            </div>

            <div>
              <div className="flex items-center justify-between">
                <span className="text-[11px] font-medium text-muted-foreground flex items-center">
                  Demanded vs Collected
                  <HintIcon text="Margin Enhancement & Collections: Ratio of cash collected against scheduled debt service obligations over trailing 12 months. Ratios <0.80 trigger RBI EWS19 collection shortfall. Recovering overdue interest and mandating higher cash retention covenants boosts debt service reliability." />
                </span>
                <div className="flex items-center gap-1 font-mono text-xs">
                  <span className="font-semibold text-foreground">{(simulatedCollection * 100).toFixed(0)}%</span>
                  {Math.abs(simulatedCollection - initialCollection) > 0.005 && (
                    <span className={`text-[10px] ${simulatedCollection > initialCollection ? "text-emerald-500 font-semibold" : "text-rose-500"}`}>
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
              <div className="flex items-center justify-between text-[10px] text-muted-foreground mt-0.5">
                <span>Baseline: {(initialCollection * 100).toFixed(0)}%</span>
                <span className="text-primary/80">Covenant: recover overdue interest</span>
              </div>
            </div>

            <div>
              <div className="flex items-center justify-between">
                <span className="text-[11px] font-medium text-muted-foreground flex items-center">
                  Account Lien / Encumbrance
                  <HintIcon text="Statutory Lien Clearance: Finacle API 362 Lien Inquiry tracks statutory tax notices, GST attachments, or court orders on borrower accounts. Clearing statutory liens removes legal encumbrance on primary collateral, lifting default multipliers." />
                </span>
                <Badge
                  variant="outline"
                  className={`font-mono text-[10px] h-5 px-1.5 ${
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
              <div className="flex items-center justify-between text-[10px] text-muted-foreground mt-0.5">
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
                  <Badge variant="outline" className="text-[9px] h-4 px-1.5 border-emerald-500/30 text-emerald-600 bg-emerald-500/10">
                    Live ML Evaluated
                  </Badge>
                ) : (
                  <Badge variant="outline" className="text-[9px] h-4 px-1.5 border-blue-500/30 text-blue-600 bg-blue-500/10">
                    Sensitivity Rescored
                  </Badge>
                )}
                {isRecourseModified ? (
                  <Badge className="bg-emerald-500/15 text-emerald-600 dark:text-emerald-400 border border-emerald-500/30 text-[9px] h-4 px-1.5">
                    Covenants Applied
                  </Badge>
                ) : (
                  <span className="text-[10px] text-muted-foreground">Adjust sliders to apply covenants</span>
                )}
              </div>
            </div>

            <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
              {/* Diff 1: Ind AS 109 ECL */}
              <div className="rounded-md border border-border/70 bg-background/60 p-2.5 space-y-1.5">
                <div className="flex items-center justify-between text-[10px] uppercase tracking-wider text-muted-foreground">
                  <span className="flex items-center">
                    Ind AS 109 ECL
                    <HintIcon text="Expected Credit Loss impairment provision required under Ind AS 109. Visual diff displays direct capital relief achieved by mitigating borrower risk factors." />
                  </span>
                  {capitalSaved > 0 && (
                    <span className="font-semibold text-emerald-600 dark:text-emerald-400 font-mono text-[10px]">
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
                  <div className="flex justify-between text-[9px] text-muted-foreground font-mono">
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
                <div className="flex items-center justify-between text-[10px] uppercase tracking-wider text-muted-foreground">
                  <span className="flex items-center">
                    Calibrated 12M PD
                    <HintIcon text="Isotonically calibrated 12-month Probability of Default and corresponding Risk Grade (RG1–RG10) under the counterfactual scenario." />
                  </span>
                  {effectiveRecourse.liftPct > 0 && (
                    <span className="font-semibold text-emerald-600 dark:text-emerald-400 font-mono text-[10px]">
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
                  <Badge variant="outline" className={`text-[10px] py-0 h-4 ${pdTone(b.pd)} font-mono`}>
                    {b.risk_grade}
                  </Badge>
                  <span className="text-xs text-muted-foreground">→</span>
                  <Badge variant="outline" className={`text-[10px] py-0 h-4 ${pdTone(effectiveRecourse.newPd)} font-mono font-semibold`}>
                    {effectiveRecourse.newGrade}
                  </Badge>
                  {effectiveRecourse.newGrade < b.risk_grade && (
                    <span className="text-[10px] text-emerald-600 dark:text-emerald-400 font-medium flex items-center">
                      <TrendingUp className="h-3 w-3 mr-0.5" /> Upgrade
                    </span>
                  )}
                </div>
              </div>

              {/* Diff 3: Capital Relieved */}
              <div className="rounded-md border border-emerald-500/30 bg-emerald-500/5 p-2.5 flex flex-col justify-between">
                <div className="text-[10px] uppercase tracking-wider text-emerald-700 dark:text-emerald-300 font-semibold flex items-center justify-between">
                  <span>Capital Relieved</span>
                  <CheckCircle2 className="h-3.5 w-3.5 text-emerald-500" />
                </div>
                <div className="my-1">
                  <div className="text-lg font-bold font-mono text-emerald-600 dark:text-emerald-400">
                    {formatInr(capitalSaved)}
                  </div>
                  <p className="text-[10px] text-muted-foreground leading-tight">
                    {capitalSaved > 0
                      ? "Direct P&L provision write-back unlocked upon covenant execution."
                      : "Simulate covenants above to unlock regulatory capital."}
                  </p>
                </div>
                <div className="text-[9px] text-emerald-800/80 dark:text-emerald-300/80 font-medium flex items-center gap-1">
                  <ShieldCheck className="h-3 w-3 shrink-0" />
                  <span>RBI Prudential Buffer Relieved</span>
                </div>
              </div>
            </div>
          </div>
        </CardContent>
      </Card>

      {/* Cure path — live API only */}
      {b.curePath && b.curePath.changes.length > 0 && (
        <Card className="bg-surface">
          <CardHeader className="pb-2">
            <CardTitle className="flex items-center gap-1.5 text-sm">
              <RouteIcon className="h-4 w-4 text-primary" />
              Cure path — cheapest route back to safety
            </CardTitle>
            <CardDescription className="text-xs">
              Counterfactual levers re-scored through the model, not a heuristic rescale.
            </CardDescription>
          </CardHeader>
          <CardContent className="space-y-3 text-xs">
            <div className="flex flex-wrap items-center gap-2">
              <span className="text-muted-foreground">PD</span>
              <Badge variant="outline" className={`${pdTone(b.curePath.baseline_pd)} font-normal`}>
                {formatPercent(b.curePath.baseline_pd, 1)}
              </Badge>
              <span className="text-muted-foreground">→</span>
              <Badge variant="outline" className={`${pdTone(b.curePath.achieved_pd)} font-normal`}>
                {formatPercent(b.curePath.achieved_pd, 1)}
              </Badge>
              {b.curePath.baseline_ecl != null && b.curePath.achieved_ecl != null && (
                <span className="text-muted-foreground">
                  · ECL {formatInrCompact(b.curePath.baseline_ecl)} →{" "}
                  <span className="font-medium text-foreground">
                    {formatInrCompact(b.curePath.achieved_ecl)}
                  </span>
                </span>
              )}
              <Badge
                variant="outline"
                className={`font-normal ${
                  b.curePath.target_met
                    ? "border-band-a/30 bg-band-a/10 text-band-a"
                    : "border-band-c/30 bg-band-c/10 text-band-c"
                }`}
              >
                {b.curePath.target_met ? "target met" : "best effort"}
              </Badge>
            </div>
            <ol className="space-y-1.5">
              {b.curePath.changes.map((c, i) => (
                <li key={c.change} className="flex items-baseline gap-2">
                  <span className="grid h-4 w-4 shrink-0 place-items-center rounded-full bg-primary/10 text-[10px] font-semibold text-primary">
                    {i + 1}
                  </span>
                  <span className="flex-1">{c.change}</span>
                  <span className="tabular-nums text-muted-foreground">
                    PD {formatPercent(c.pd_after, 1)}
                  </span>
                </li>
              ))}
            </ol>
          </CardContent>
        </Card>
      )}

      {/* Stress horizon + committee actions */}
      {/* Formal Credit Appraisal Memo (CAM) & Committee Sign-Off */}
      <Card className="bg-surface print-page">
        <CardHeader className="pb-2">
          <div className="flex flex-wrap items-center justify-between gap-2">
            <CardTitle className="text-sm font-semibold">
              Credit Appraisal Memo (CAM) — Zonal Review Dossier
            </CardTitle>
            <span className="text-[10px] uppercase font-mono text-muted-foreground">
              REF: IDBI/CAM/{b.loan_id}/2026
            </span>
          </div>
          <CardDescription className="text-xs text-muted-foreground">
            Standardized bank memorandum for Credit Sanction &amp; Supervisory Committee approval.
          </CardDescription>
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
            <strong>{b.sma_status}</strong> status. Prescribed action: {b.action.toLowerCase()} at{" "}
            {b.cadence.toLowerCase()} owned by the {b.owner.toLowerCase()}. Expected credit loss is{" "}
            <strong>{formatInr(b.ecl)}</strong> on an exposure of {formatInr(b.ead)} (LGD 45%).
          </p>

          {/* Committee Sign-Off Block for Print */}
          <div className="pt-4 border-t border-border mt-4 grid grid-cols-3 gap-4 text-center text-[10px] text-muted-foreground">
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

function ReasonList({ reasons }: { reasons: ReasonCode[] }) {
  if (reasons.length === 0) {
    return (
      <p className="text-xs text-muted-foreground">
        Reason codes are produced by the live scorer per request; the offline snapshot keeps only
        portfolio-level aggregates. Run{" "}
        <code className="rounded bg-muted px-1 py-0.5 text-[10px]">uvicorn src.serving.api:app</code>{" "}
        and open this page in live mode to see them.
      </p>
    );
  }
  const max = Math.max(...reasons.map((r) => Math.abs(r.impact)), 1e-9);
  return (
    <ul className="space-y-2.5">
      {reasons.map((r) => (
        <li key={r.feature}>
          <div className="flex items-center justify-between text-xs">
            <span className="flex items-center gap-1.5 font-medium">
              {r.direction === "raises_risk" ? (
                <TrendingDown className="h-3.5 w-3.5 text-negative" />
              ) : (
                <CalendarClock className="h-3.5 w-3.5 text-positive" />
              )}
              {r.label || r.feature}
            </span>
            <span className="tabular-nums text-muted-foreground">{r.taxonomy_code}</span>
          </div>
          <div className="mt-1 h-1.5 overflow-hidden rounded-full bg-muted">
            <div
              className={`h-full rounded-full ${
                r.direction === "raises_risk" ? "bg-negative" : "bg-positive"
              }`}
              style={{ width: `${Math.max((Math.abs(r.impact) / max) * 100, 6)}%` }}
            />
          </div>
        </li>
      ))}
    </ul>
  );
}

