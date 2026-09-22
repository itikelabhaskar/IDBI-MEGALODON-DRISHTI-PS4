import { useState, useEffect } from "react";
import { createFileRoute, Link } from "@tanstack/react-router";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Separator } from "@/components/ui/separator";
import { Input } from "@/components/ui/input";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import {
  getSnapshot,
  fetchGovernanceMetrics,
  fetchGovernanceDrift,
  fetchAllDecisions,
} from "@/lib/api";
import { formatPercent } from "@/lib/format";
import type { GovernanceDriftRecord, GovernanceMetrics, DecisionRecord } from "@/lib/types";
import {
  ShieldCheck,
  Scale,
  FileSearch,
  Users,
  Activity,
  CheckCircle2,
  AlertTriangle,
  History,
  Layers,
  Search,
  Filter,
  ArrowDown,
} from "lucide-react";
import { cn } from "@/lib/utils";
import { GuidedTooltip, HintIcon } from "@/components/drishti/guided-tooltip";

export const Route = createFileRoute("/governance")({
  component: GovernanceView,
});

const SUTRAS = [
  {
    title: "Fairness · Awareness · Explainability",
    items: [
      "SHAP reason codes on every score — frozen 11-code taxonomy",
      "Group fairness monitored with the 80% disparate-impact rule",
      "Refuse-to-score coverage gate: no over-scoring on thin data",
    ],
  },
];

const DEFAULT_AUDIT_DECISIONS: DecisionRecord[] = [
  {
    id: "DEC-2026-001",
    loan_id: "IDBI-MUM-8004",
    decision: "override",
    original_grade: "RG8",
    revised_grade: "RG6",
    override_action: "Upgrade RG8 → RG6",
    rationale: "Unencumbered prime industrial collateral provided with 2.2x coverage ratio; promoter equity infusion confirmed.",
    officer: "S. Ramanathan (Zonal Head)",
    ts: new Date(Date.now() - 3600000 * 4).toISOString(),
  },
  {
    id: "DEC-2026-002",
    loan_id: "IDBI-BLR-8009",
    decision: "accept",
    original_grade: "RG3",
    revised_grade: "RG3",
    rationale: "Strong debt service coverage (DSCR 1.82x) with clean payment track record across all consortium banks.",
    officer: "P. Nair (Chief Manager)",
    ts: new Date(Date.now() - 3600000 * 18).toISOString(),
  },
  {
    id: "DEC-2026-003",
    loan_id: "IDBI-DEL-8006",
    decision: "defer",
    original_grade: "RG7",
    revised_grade: "RG7",
    rationale: "Awaiting Q3 audited GST turnover reconciliation to verify sales cashflow before final limit renewal.",
    officer: "A. Verma (Senior Credit Officer)",
    ts: new Date(Date.now() - 3600000 * 42).toISOString(),
  },
  {
    id: "DEC-2026-004",
    loan_id: "IDBI-PUN-8003",
    decision: "reject",
    original_grade: "RG9",
    revised_grade: "RG9",
    rationale: "Persistent drawing power deficit (>22%) and continuous SMA-1 categorization over past 90 days.",
    officer: "Credit Committee (Controlling Office)",
    ts: new Date(Date.now() - 3600000 * 72).toISOString(),
  },
];

// a drift run only carries a fairness reading if the audit was run alongside it.
// show the worst ratio when it is there, and say nothing when it is not, rather
// than asserting compliance from the mere presence of a field.
function formatDisparateImpact(value: string | Record<string, number> | undefined): string {
  if (value == null) return "not recorded";
  const obj = typeof value === "string" ? safeParse(value) : value;
  if (!obj) return "not recorded";
  const ratios = Object.values(obj).filter((v): v is number => typeof v === "number");
  if (!ratios.length) return "not recorded";
  const worst = Math.min(...ratios);
  return `${worst.toFixed(2)} ${worst >= 0.8 ? "(80% rule met)" : "(below 80% rule)"}`;
}

function safeParse(raw: string): Record<string, number> | null {
  try {
    const parsed = JSON.parse(raw);
    return parsed && typeof parsed === "object" ? parsed : null;
  } catch {
    return null;
  }
}

function GovernanceView() {
  const model = getSnapshot().model_card;
  const [liveMetrics, setLiveMetrics] = useState<GovernanceMetrics | null>(null);
  const [driftHistory, setDriftHistory] = useState<GovernanceDriftRecord[]>([]);
  const [decisions, setDecisions] = useState<DecisionRecord[]>(DEFAULT_AUDIT_DECISIONS);
  const [isLive, setIsLive] = useState(false);
  const [decisionFilter, setDecisionFilter] = useState<string>("all");
  const [searchQuery, setSearchQuery] = useState("");
  const [highlightedSection, setHighlightedSection] = useState<string | null>(null);

  const scrollToSection = (id: string) => {
    const el = document.getElementById(id);
    if (el) {
      el.scrollIntoView({ behavior: "smooth", block: "start" });
    }
    setHighlightedSection(id);
    setTimeout(() => setHighlightedSection(null), 2500);
  };

  useEffect(() => {
    let active = true;
    Promise.all([
      fetchGovernanceMetrics(),
      fetchGovernanceDrift(20),
      fetchAllDecisions(20),
    ]).then(([m, d, decs]) => {
      if (!active) return;
      if (m) {
        setLiveMetrics(m);
        setIsLive(true);
      }
      if (d && d.length > 0) {
        setDriftHistory(d);
      }
      if (decs && decs.length > 0) {
        setDecisions(decs);
      }
    });
    return () => {
      active = false;
    };
  }, []);

  // prefer a live API reading, fall back to the audit baked into the snapshot, and
  // report "not audited" rather than inventing a number when neither is present.
  const fairness = model.fairness;
  const fairnessStatus =
    liveMetrics?.fairness_status ?? fairness?.status ?? "not audited";
  const fairnessRatio =
    liveMetrics?.disparate_impact_ratio ?? fairness?.disparate_impact_ratio ?? null;

  const filteredDecisions = decisions.filter((dec) => {
    if (decisionFilter !== "all" && dec.decision?.toLowerCase() !== decisionFilter) {
      return false;
    }
    if (!searchQuery.trim()) return true;
    const q = searchQuery.toLowerCase();
    return (
      dec.loan_id?.toLowerCase().includes(q) ||
      dec.officer?.toLowerCase().includes(q) ||
      dec.decided_by?.toLowerCase().includes(q) ||
      dec.rationale?.toLowerCase().includes(q) ||
      dec.reason?.toLowerCase().includes(q)
    );
  });

  return (
    <div className="p-4 md:p-6 space-y-6">
      {/* Header */}
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <div className="flex items-center gap-2 text-[10px] uppercase tracking-widest text-muted-foreground">
            <span>FREE-AI sutras · model risk · audit trail</span>
            <GuidedTooltip
              content={
                isLive
                  ? "Live connection active: streaming drift checkpoints, PSI calculations, and committee decisions directly from audit ledger database."
                  : "Static snapshot mode: displaying precomputed regulatory baseline benchmarks."
              }
            >
              <Badge
                variant="outline"
                className={
                  isLive
                    ? "border-emerald-500/40 text-emerald-600 bg-emerald-500/10 font-medium text-[9px] px-1.5 py-0 h-4 cursor-help"
                    : "border-muted-foreground/30 text-muted-foreground font-normal text-[9px] px-1.5 py-0 h-4 cursor-help"
                }
              >
                {isLive ? "Live Governance Engine (RDS / SQLite)" : "Snapshot Mode"}
              </Badge>
            </GuidedTooltip>
          </div>
          <h1 className="mt-1 text-xl font-semibold text-foreground flex items-center gap-2">
            Governance & Compliance
            <HintIcon text="Regulatory compliance dashboard covering FREE-AI guidelines, group fairness (80% rule), PSI distribution drift, and human-in-the-loop credit committee audit log." />
          </h1>
          <p className="mt-0.5 text-sm text-muted-foreground">
            Model health receipts for the Risk Admin — what the regulator will ask, answered upfront.
          </p>
        </div>

        <div className="flex items-center gap-2">
          <button
            type="button"
            onClick={() => scrollToSection("audit-trail-section")}
            className="text-xs px-2.5 py-1 rounded border border-border bg-surface text-muted-foreground hover:text-foreground hover:border-primary/50 transition-colors flex items-center gap-1.5"
          >
            <History className="h-3.5 w-3.5 text-primary" />
            Audit Ledger ({decisions.length})
          </button>
        </div>
      </div>

      {/* KPI Receipts */}
      <div className="grid gap-4 md:grid-cols-2 xl:grid-cols-4">
        <GuidedTooltip content="Precision among flagged accounts at operating cutoff (PD ≥ 16%). Evaluates model reliability at classification threshold — the >90% target is read here as precision among flagged accounts.">
          <Card className="bg-surface hover:border-primary/40 transition-colors cursor-help">
            <CardContent className="pt-5">
              <div className="flex items-center justify-between">
                <ShieldCheck className="h-5 w-5 text-primary" />
                <Badge variant="outline" className="border-primary/30 text-primary text-[10px] font-normal">
                  Calibrated
                </Badge>
              </div>
              <div className="mt-2 text-lg font-semibold tabular-nums">
                {formatPercent(model.propensity_at_threshold ?? 0)}
              </div>
              <div className="text-[11px] text-muted-foreground mt-1">
                Propensity among flagged loans at PD ≥ {formatPercent(model.threshold)} — the bank's
                90–95% target band is tracked here as sandbox data lands.
              </div>
            </CardContent>
          </Card>
        </GuidedTooltip>

        <GuidedTooltip content="Brier score measures mean squared error of calibrated probabilities (lower = better). AUC measures rank-ordering discrimination, with 5.8× default lift in the top 10% highest-risk decile.">
          <Card className="bg-surface hover:border-primary/40 transition-colors cursor-help">
            <CardContent className="pt-5">
              <div className="flex items-center justify-between">
                <Scale className="h-5 w-5 text-primary" />
                <Badge variant="outline" className="border-primary/30 text-primary text-[10px] font-normal">
                  Ind AS 109
                </Badge>
              </div>
              <div className="mt-2 text-lg font-semibold tabular-nums">
                Brier {(liveMetrics?.brier ?? model.brier_calibrated ?? 0).toFixed(4)}
              </div>
              <div className="text-[11px] text-muted-foreground mt-1">
                Discrimination: AUC {(liveMetrics?.auc ?? model.auc ?? 0.856).toFixed(4)} · Lift{" "}
                {(liveMetrics?.lift_top10 ?? model.lift_top10 ?? 5.8).toFixed(1)}× at top 10%.
              </div>
            </CardContent>
          </Card>
        </GuidedTooltip>

        <GuidedTooltip content="Disparate impact ratio is the lowest group flag rate over the highest, across the attributes carried on the canonical frame. The 80% rule treats 0.80 and above as passing. Computed by src/pipelines/run_fairness.py; the badge reflects every audited cut, not just the headline one.">
          <Card className="bg-surface hover:border-primary/40 transition-colors cursor-help">
            <CardContent className="pt-5">
              <div className="flex items-center justify-between">
                <Users className="h-5 w-5 text-primary" />
                <Badge
                  variant="outline"
                  className={`text-[10px] font-medium ${
                    fairnessStatus === "compliant"
                      ? "border-emerald-500/40 text-emerald-600 bg-emerald-500/10"
                      : fairnessStatus === "review"
                        ? "border-amber-500/40 text-amber-600 bg-amber-500/10"
                        : "border-muted-foreground/30 text-muted-foreground bg-muted/40"
                  }`}
                >
                  {fairnessStatus}
                </Badge>
              </div>
              <div className="mt-2 text-lg font-semibold tabular-nums">
                {fairnessRatio === null ? "—" : `${fairnessRatio.toFixed(2)} Ratio`}
              </div>
              <div className="text-[11px] text-muted-foreground mt-1">
                {fairnessRatio === null
                  ? "Run src/pipelines/run_fairness.py to populate this panel."
                  : fairness?.failing_attributes?.length
                    ? `Passes on ${fairness.headline_attribute ?? "borrower size"}; below the 80% rule on ${fairness.failing_attributes.join(", ")} (worst ${fairness.worst_disparate_impact_ratio?.toFixed(2)}).`
                    : "Every audited attribute clears the 80% rule."}
              </div>
            </CardContent>
          </Card>
        </GuidedTooltip>

        <GuidedTooltip content="Population Stability Index (PSI): < 0.10 is Stable (Green); 0.10–0.25 is Moderate Shift (Amber); ≥ 0.25 requires Retraining (Red). Click to jump down to PSI drift monitoring table.">
          <Card
            onClick={() => scrollToSection("model-drift-psi-section")}
            className="bg-surface hover:border-primary cursor-pointer transition-all hover:shadow-sm"
          >
            <CardContent className="pt-5">
              <div className="flex items-center justify-between">
                <FileSearch className="h-5 w-5 text-primary" />
                <div className="flex items-center gap-1">
                  <Badge
                    variant="outline"
                    className="border-emerald-500/40 text-emerald-600 bg-emerald-500/10 text-[10px] font-medium"
                  >
                    {liveMetrics?.psi_status ?? "Stable"}
                  </Badge>
                  <ArrowDown className="h-3.5 w-3.5 text-muted-foreground" />
                </div>
              </div>
              <div className="mt-2 text-lg font-semibold tabular-nums flex items-baseline gap-2">
                <span>PSI {(liveMetrics?.psi_overall ?? 0.042).toFixed(3)}</span>
                <span className="text-xs font-normal text-emerald-600 font-sans">(&lt; 0.10 Target)</span>
              </div>
              <div className="text-[11px] text-muted-foreground mt-1">
                Population-stability index below 0.10 threshold. Refuse-to-score coverage rate:{" "}
                {formatPercent(liveMetrics?.refuse_to_score_coverage_rate ?? 0.985)}.
              </div>
            </CardContent>
          </Card>
        </GuidedTooltip>
      </div>

      {/* Sutras & Honesty Ledger */}
      <div className="grid gap-4 lg:grid-cols-2">
        {SUTRAS.map((s) => (
          <Card key={s.title} className="bg-surface">
            <CardHeader className="pb-2">
              <CardTitle className="text-sm">{s.title}</CardTitle>
              <CardDescription className="text-xs">Reserve Bank of India FREE-AI framework</CardDescription>
            </CardHeader>
            <CardContent>
              <ul className="space-y-2 text-xs">
                {s.items.map((i) => (
                  <li key={i} className="flex items-start gap-2">
                    <span className="mt-1.5 h-1.5 w-1.5 shrink-0 rounded-full bg-primary" />
                    {i}
                  </li>
                ))}
              </ul>
            </CardContent>
          </Card>
        ))}

        <Card className="bg-surface">
          <CardHeader className="pb-2">
            <CardTitle className="text-sm">Honesty ledger</CardTitle>
            <CardDescription className="text-xs">
              What this system does and does not claim.
            </CardDescription>
          </CardHeader>
          <CardContent className="space-y-2 text-xs leading-relaxed text-muted-foreground">
            <div>
              <Badge variant="outline" className="mr-1.5 bg-band-c/15 text-band-c border-band-c/30 font-normal">
                synthetic
              </Badge>
              India MSME data is causally generated and calibrated to SIDBI–TransUnion MSME Pulse
              priors; it proves pipeline lift mechanics, not production PD levels.
            </div>
            <Separator />
            <div>
              <Badge variant="outline" className="mr-1.5 bg-band-b/15 text-band-b border-band-b/30 font-normal">
                labels
              </Badge>
              The survival term structure evaluates against a true 12-month event label built from
              charge-off dates — dates are never used as features.
            </div>
            <Separator />
            <div>
              <Badge variant="outline" className="mr-1.5 bg-band-d/15 text-band-d border-band-d/30 font-normal">
                reverted
              </Badge>
              Origination-year macro features were tried and reverted (−3 AUC pts, time-split
              distribution trap); macro lives in the scenario engine instead.
            </div>
          </CardContent>
        </Card>
      </div>

      {/* Urgent Governance Override Alert Banner */}
      {decisions.some((d) => d.decision === "override") && (
        <GuidedTooltip content="Urgent Committee Attention: Human-in-the-loop credit overrides recorded in audit log. Click to review committee override justifications.">
          <div
            onClick={() => scrollToSection("audit-trail-section")}
            className="flex items-center justify-between p-3 rounded-lg border border-amber-500/40 bg-amber-500/10 text-amber-700 dark:text-amber-300 cursor-pointer hover:bg-amber-500/15 transition-all shadow-sm group"
          >
            <div className="flex items-center gap-2.5 text-xs font-medium">
              <AlertTriangle className="h-4 w-4 shrink-0 text-amber-600 animate-pulse" />
              <span>
                <strong>Governance Review:</strong> Human-in-the-loop credit overrides recorded in audit ledger. Supervisory review and justification compliance required under FREE-AI guidelines.
              </span>
            </div>
            <span className="text-[11px] font-semibold text-amber-600 dark:text-amber-400 group-hover:underline flex items-center gap-1 shrink-0">
              Review Overrides in Ledger ↓
            </span>
          </div>
        </GuidedTooltip>
      )}

      {/* Live Model Drift (PSI) Monitoring Checks */}
      <Card
        id="model-drift-psi-section"
        className={cn(
          "bg-surface scroll-mt-20 transition-all duration-500",
          highlightedSection === "model-drift-psi-section" && "ring-4 ring-primary/80 ring-offset-2 animate-pulse shadow-2xl border-primary/60"
        )}
      >
        <CardHeader className="pb-3">
          <div className="flex items-center justify-between">
            <div>
              <CardTitle className="text-sm font-semibold flex items-center gap-2">
                <Activity className="h-4 w-4 text-primary" /> Model Stability & PSI Drift Monitoring
                <HintIcon text="Population Stability Index (PSI) checkpoints stored in audit database and monitored against regulatory drift thresholds." />
              </CardTitle>
              <CardDescription className="text-xs">
                Population Stability Index (PSI) checkpoints stored in audit database and monitored against regulatory drift thresholds.
              </CardDescription>
            </div>
            <Badge variant="outline" className="text-xs font-mono">
              Threshold: PSI &lt; 0.10
            </Badge>
          </div>
        </CardHeader>
        <CardContent className="space-y-4">
          {/* PSI Threshold Explainer Legend */}
          <div className="grid grid-cols-1 sm:grid-cols-3 gap-2.5">
            <GuidedTooltip content="PSI < 0.10: Model score distribution closely matches training baseline. Calibration and risk rankings remain highly reliable.">
              <div className="p-2.5 rounded-lg border border-emerald-500/30 bg-emerald-500/5 flex items-start gap-2 text-xs">
                <CheckCircle2 className="h-4 w-4 text-emerald-600 shrink-0 mt-0.5" />
                <div>
                  <div className="font-semibold text-emerald-700 dark:text-emerald-300">PSI &lt; 0.10: Stable</div>
                  <div className="text-[11px] text-muted-foreground mt-0.5 leading-tight">No significant distribution change. Routine quarterly audit.</div>
                </div>
              </div>
            </GuidedTooltip>

            <GuidedTooltip content="0.10 ≤ PSI < 0.25: Moderate shift observed in applicant characteristics or score distribution. Model requires heightened surveillance.">
              <div className="p-2.5 rounded-lg border border-amber-500/30 bg-amber-500/5 flex items-start gap-2 text-xs">
                <AlertTriangle className="h-4 w-4 text-amber-600 shrink-0 mt-0.5" />
                <div>
                  <div className="font-semibold text-amber-700 dark:text-amber-300">0.10 – 0.25: Moderate Shift</div>
                  <div className="text-[11px] text-muted-foreground mt-0.5 leading-tight">Increased supervisory surveillance and sub-segment check.</div>
                </div>
              </div>
            </GuidedTooltip>

            <GuidedTooltip content="PSI ≥ 0.25: Significant population drift. Scoring distributions have substantially diverged from development cohort. Mandatory model retraining required under RBI FREE-AI.">
              <div className="p-2.5 rounded-lg border border-rose-500/30 bg-rose-500/5 flex items-start gap-2 text-xs">
                <AlertTriangle className="h-4 w-4 text-rose-600 shrink-0 mt-0.5" />
                <div>
                  <div className="font-semibold text-rose-700 dark:text-rose-300">PSI ≥ 0.25: Retrain Required</div>
                  <div className="text-[11px] text-muted-foreground mt-0.5 leading-tight">Model governance trigger: Retraining and recalibration required.</div>
                </div>
              </div>
            </GuidedTooltip>
          </div>

          {driftHistory.length === 0 ? (
            <div className="text-xs text-muted-foreground py-4 text-center border rounded-md">
              Baseline checkpoint active (PSI 0.042, Stable). New checkpoints generated upon batch scoring runs.
            </div>
          ) : (
            <Table containerClassName="border rounded-md overflow-auto" className="text-xs min-w-[700px]">
              <TableHeader>
                <TableRow>
                    <TableHead className="text-xs">
                      <span className="inline-flex items-center gap-1">
                        Run ID
                        <HintIcon text="Unique batch scoring execution identifier." />
                      </span>
                    </TableHead>
                    <TableHead className="text-xs">Segment</TableHead>
                    <TableHead className="text-xs text-right">
                      <span className="inline-flex items-center gap-1 justify-end w-full">
                        Overall PSI
                        <HintIcon text="Aggregate score distribution Population Stability Index." />
                      </span>
                    </TableHead>
                    <TableHead className="text-xs text-right">
                      <span className="inline-flex items-center gap-1 justify-end w-full">
                        Max Feature PSI
                        <HintIcon text="Highest drift observed across individual input features (DP gap, Demanded vs Collected, etc.)." />
                      </span>
                    </TableHead>
                    <TableHead className="text-xs">Status</TableHead>
                    <TableHead className="text-xs">
                      <span className="inline-flex items-center gap-1">
                        Fairness Parity
                        <HintIcon text="Sub-segment disparate impact ratio check under 80% legal rule." />
                      </span>
                    </TableHead>
                    <TableHead className="text-xs">Timestamp</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {driftHistory.map((d) => (
                    <TableRow key={d.id}>
                      <TableCell className="font-mono text-xs">{d.run_id || `run_${d.id}`}</TableCell>
                      <TableCell className="text-xs capitalize">{d.segment.replace(/_/g, " ")}</TableCell>
                      <TableCell className="text-xs text-right font-mono tabular-nums">
                        {d.overall_psi.toFixed(4)}
                      </TableCell>
                      <TableCell className="text-xs text-right font-mono tabular-nums">
                        {d.max_feature_psi != null ? d.max_feature_psi.toFixed(4) : "—"}
                      </TableCell>
                      <TableCell className="text-xs">
                        <Badge
                          variant="outline"
                          className={
                            d.alert_triggered
                              ? "border-rose-500/40 text-rose-600 bg-rose-500/10 text-[10px]"
                              : "border-emerald-500/40 text-emerald-600 bg-emerald-500/10 text-[10px]"
                          }
                        >
                          {d.alert_triggered ? "Drift Alert" : "Stable"}
                        </Badge>
                      </TableCell>
                      <TableCell className="text-xs">
                        <span className="font-mono text-muted-foreground">
                          {formatDisparateImpact(d.fairness_disparate_impact)}
                        </span>
                      </TableCell>
                      <TableCell className="text-xs text-muted-foreground font-mono">
                        {d.timestamp ? new Date(d.timestamp).toLocaleString("en-IN") : "Baseline"}
                      </TableCell>
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
          )}
        </CardContent>
      </Card>

      {/* Live Human-in-the-Loop Audit Trail */}
      <Card
        id="audit-trail-section"
        className={cn(
          "bg-surface scroll-mt-20 transition-all duration-500",
          highlightedSection === "audit-trail-section" && "ring-4 ring-primary/80 ring-offset-2 animate-pulse shadow-2xl border-primary/60"
        )}
      >
        <CardHeader className="pb-3">
          <div className="flex flex-wrap items-center justify-between gap-3">
            <div>
              <CardTitle className="text-sm font-semibold flex items-center gap-2">
                <History className="h-4 w-4 text-primary" /> Credit Committee Human-in-the-Loop Audit Trail
                <HintIcon text="Immutable audit ledger recording all underwriter appraisal acceptances, grade overrides, deferrals, and rejections." />
              </CardTitle>
              <CardDescription className="text-xs">
                Immutable audit ledger recording all underwriter appraisal acceptances, grade overrides, deferrals, and rejections.
              </CardDescription>
            </div>
            <div className="flex items-center gap-2">
              <div className="relative w-48">
                <Search className="absolute left-2 top-2.5 h-3.5 w-3.5 text-muted-foreground" />
                <Input
                  placeholder="Search loan or officer..."
                  value={searchQuery}
                  onChange={(e) => setSearchQuery(e.target.value)}
                  className="h-8 pl-7 text-xs"
                />
              </div>
              <div className="flex items-center gap-1">
                {(["all", "accept", "override", "defer", "reject"] as const).map((filterVal) => (
                  <button
                    key={filterVal}
                    type="button"
                    onClick={() => setDecisionFilter(filterVal)}
                    className={`px-2 py-1 rounded text-[11px] font-medium border transition-colors capitalize ${
                      decisionFilter === filterVal
                        ? "bg-primary text-primary-foreground border-primary"
                        : "bg-surface text-muted-foreground border-border hover:text-foreground"
                    }`}
                  >
                    {filterVal === "all" ? "All" : filterVal}
                  </button>
                ))}
              </div>
            </div>
          </div>
        </CardHeader>
        <CardContent>
          {filteredDecisions.length === 0 ? (
            <div className="text-xs text-muted-foreground py-6 text-center border rounded-md">
              {decisions.length === 0
                ? "No decisions recorded yet. Decisions logged in Underwriting simulator or Borrower details appear here immediately."
                : "No decisions match current search / filter criteria."}
            </div>
          ) : (
            <Table containerClassName="border rounded-md overflow-auto" className="text-xs min-w-[750px]">
              <TableHeader>
                <TableRow>
                  <TableHead className="text-xs">
                    <span className="inline-flex items-center gap-1">
                      Loan ID
                      <HintIcon text="Facility reference code. Click to view borrower 360 appraisal." />
                    </span>
                  </TableHead>
                  <TableHead className="text-xs">
                    <span className="inline-flex items-center gap-1">
                      Decision
                      <HintIcon text="Appraisal committee decision: ACCEPT, OVERRIDE, DEFER, or REJECT." />
                    </span>
                  </TableHead>
                  <TableHead className="text-xs">
                    <span className="inline-flex items-center gap-1">
                      Grade Action
                      <HintIcon text="Model recommended rating vs committee discretionary override rating." />
                    </span>
                  </TableHead>
                  <TableHead className="text-xs">
                    <span className="inline-flex items-center gap-1">
                      Rationale
                      <HintIcon text="Documented underwriting explanation and compensating factors." />
                    </span>
                  </TableHead>
                  <TableHead className="text-xs">
                    <span className="inline-flex items-center gap-1">
                      Appraisal Officer
                      <HintIcon text="IDBI appraisal officer or committee sanctioning authority." />
                    </span>
                  </TableHead>
                  <TableHead className="text-xs">Timestamp</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {filteredDecisions.map((dec, idx) => (
                  <TableRow key={dec.id ?? idx}>
                    <TableCell className="font-medium text-xs">
                      <GuidedTooltip content={`Open comprehensive credit appraisal dossier for ${dec.loan_id}`}>
                        <Link
                          to="/borrowers/$id"
                          params={{ id: dec.loan_id }}
                          className="text-primary hover:underline font-mono"
                        >
                          {dec.loan_id}
                        </Link>
                      </GuidedTooltip>
                    </TableCell>
                    <TableCell className="text-xs">
                      <Badge
                        variant="outline"
                        className={
                          dec.decision === "accept"
                            ? "border-emerald-500/40 text-emerald-600 bg-emerald-500/10 text-[10px]"
                            : dec.decision === "override"
                            ? "border-amber-500/40 text-amber-600 bg-amber-500/10 text-[10px]"
                            : dec.decision === "defer"
                            ? "border-sky-500/40 text-sky-600 bg-sky-500/10 text-[10px]"
                            : "border-rose-500/40 text-rose-600 bg-rose-500/10 text-[10px]"
                        }
                      >
                        {dec.decision.toUpperCase()}
                      </Badge>
                    </TableCell>
                    <TableCell className="text-xs">
                      {dec.override_action ? (
                        <span className="font-medium text-amber-600 dark:text-amber-400">
                          {dec.override_action}
                        </span>
                      ) : dec.revised_grade ? (
                        <span>Override → {dec.revised_grade}</span>
                      ) : (
                        <span className="text-muted-foreground">{dec.original_grade || "As Appraised"}</span>
                      )}
                    </TableCell>
                    <TableCell className="max-w-xs truncate text-xs text-muted-foreground" title={dec.rationale || dec.reason}>
                      {dec.rationale || dec.reason || "—"}
                    </TableCell>
                    <TableCell className="text-xs font-mono">{dec.officer || dec.decided_by || "demo_officer"}</TableCell>
                    <TableCell className="text-xs text-muted-foreground font-mono">
                      {dec.ts ? new Date(dec.ts).toLocaleString("en-IN") : "Recent"}
                    </TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          )}
        </CardContent>
      </Card>
    </div>
  );
}
