import { useMemo, useState, useEffect, useRef } from "react";
import { createFileRoute, Link } from "@tanstack/react-router";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
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
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Tabs, TabsList, TabsTrigger } from "@/components/ui/tabs";
import {
  BarChart,
  Bar,
  XAxis,
  YAxis,
  CartesianGrid,
  Tooltip,
  ResponsiveContainer,
  PieChart,
  Pie,
  Cell,
} from "recharts";
import { listBorrowers, fetchPortfolio, fetchPortfolioSummary } from "@/lib/api";
import type { BorrowerScore, RiskGrade, RagBucket } from "@/lib/types";
import {
  formatInrCompact,
  formatPercent,
  ragHex,
  ragTone,
  pdTone,
  gradeIndexToRag,
  RAG_LEGEND,
} from "@/lib/format";
import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";
import { toast } from "sonner";
import {
  GuidedTooltip,
  GuidedTipsBanner,
  useGuidedTips,
} from "@/components/drishti/guided-tips";
import {
  Search,
  TrendingUp,
  Target,
  IndianRupee,
  Radar,
  Building2,
  AlertOctagon,
  ShieldAlert,
  CheckCircle2,
  Clock,
  ArrowRight,
  FileText,
  Sparkles,
  Filter,
  Copy,
  Check,
  Lightbulb,
  Info,
  Download,
  CheckCheck,
  RotateCcw,
  FileSpreadsheet,
  Share2,
  AlertCircle,
} from "lucide-react";

export const Route = createFileRoute("/")({
  // ?branch=<code> arrives from the Branch Network drill-down.
  validateSearch: (search: Record<string, unknown>): { branch?: string } => ({
    branch: typeof search.branch === "string" ? search.branch : undefined,
  }),
  loader: async () => await listBorrowers(),
  component: PortfolioConsole,
});

const GRADES: RiskGrade[] = [
  "RG1", "RG2", "RG3", "RG4", "RG5", "RG6", "RG7", "RG8", "RG9", "RG10",
];

function KpiTile({
  label,
  value,
  sub,
  icon: Icon,
  guidedTip,
  step,
}: {
  label: string;
  value: string;
  sub: string;
  icon: typeof Target;
  guidedTip?: string;
  step?: string | number;
}) {
  const { tipsEnabled } = useGuidedTips();

  const tileContent = (
    <Card className="bg-surface transition-all hover:border-primary/40 h-full">
      <CardContent className="pt-5">
        <div className="flex items-start justify-between">
          <div>
            <div className="flex items-center gap-1.5 text-[10px] uppercase tracking-widest text-muted-foreground">
              <span>{label}</span>
              {guidedTip && tipsEnabled && (
                <span className="text-amber-500/80">
                  <Lightbulb className="h-2.5 w-2.5" />
                </span>
              )}
            </div>
            <div className="mt-1 text-2xl font-semibold tabular-nums text-foreground">{value}</div>
            <div className="mt-0.5 text-[11px] text-muted-foreground">{sub}</div>
          </div>
          <span className="grid h-9 w-9 place-items-center rounded-lg bg-primary/10 text-primary shrink-0">
            <Icon className="h-4.5 w-4.5" />
          </span>
        </div>
      </CardContent>
    </Card>
  );

  if (guidedTip) {
    return (
      <GuidedTooltip tip={guidedTip} title={label} step={step} side="top">
        {tileContent}
      </GuidedTooltip>
    );
  }

  return tileContent;
}

function TableHeaderTip({
  title,
  tip,
  children,
  side = "top",
  align = "center",
}: {
  title: string;
  tip: string;
  children: React.ReactNode;
  side?: "top" | "bottom" | "left" | "right";
  align?: "start" | "center" | "end";
}) {
  const { tipsEnabled } = useGuidedTips();

  if (!tipsEnabled) {
    return <>{children}</>;
  }

  return (
    <GuidedTooltip title={title} tip={tip} side={side} align={align}>
      <span className="inline-flex items-center gap-1 cursor-help border-b border-dotted border-muted-foreground/60 hover:border-amber-500/80 transition-colors">
        {children}
        <Info className="h-2.5 w-2.5 opacity-60 text-amber-500/80" />
      </span>
    </GuidedTooltip>
  );
}

function PortfolioConsole() {
  const initialData = Route.useLoaderData();
  const { branch: branchCode } = Route.useSearch();
  const navigate = Route.useNavigate();

  const [data, setData] = useState(initialData);
  const [liveSummary, setLiveSummary] = useState<any>(null);

  useEffect(() => {
    let active = true;
    fetchPortfolio({ branch_code: branchCode, limit: 2000 }).then((res) => {
      if (active && res && res.source.mode === "live") {
        setData(res);
      }
    });
    fetchPortfolioSummary(branchCode).then((s) => {
      if (active && s) {
        setLiveSummary(s);
      }
    });
    return () => {
      active = false;
    };
  }, [branchCode]);

  const borrowers = useMemo(
    () =>
      branchCode
        ? data.borrowers.filter((b) => b.branch_code === branchCode)
        : data.borrowers,
    [data.borrowers, branchCode],
  );
  const branchName = borrowers[0]?.branch_name;

  const [query, setQuery] = useState("");
  const [ragFilter, setRagFilter] = useState<string>("all");
  const [segmentFilter, setSegmentFilter] = useState<string>("all");
  const [sortKey, setSortKey] = useState<"pd" | "ecl">("pd");
  const [triageFilter, setTriageFilter] = useState<"all" | "critical" | "watchlist" | "renewals">("all");

  const { tipsEnabled, setTipsEnabled } = useGuidedTips();
  const tableRef = useRef<HTMLDivElement>(null);
  const [highlightTable, setHighlightTable] = useState(false);
  const highlightTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  useEffect(() => {
    return () => {
      if (highlightTimerRef.current) clearTimeout(highlightTimerRef.current);
    };
  }, []);

  const handleClearAllFilters = () => {
    setQuery("");
    setRagFilter("all");
    setSegmentFilter("all");
    setTriageFilter("all");
    toast.info("All watchlist filters cleared", { duration: 1500 });
  };

  const handleTriageClick = (queue: "critical" | "watchlist" | "renewals") => {
    setTriageFilter(queue);
    setTimeout(() => {
      if (tableRef.current) {
        const prefersReducedMotion =
          typeof window !== "undefined" &&
          window.matchMedia("(prefers-reduced-motion: reduce)").matches;
        tableRef.current.scrollIntoView({
          behavior: prefersReducedMotion ? "auto" : "smooth",
          block: "start",
        });
      }
    }, 40);
    setHighlightTable(true);
    if (highlightTimerRef.current) clearTimeout(highlightTimerRef.current);
    highlightTimerRef.current = setTimeout(() => {
      setHighlightTable(false);
    }, 2500);
  };

  // Keyboard shortcut listener for morning triage workflow:
  // 1: Urgent Queue, 2: Watchlist, 3: Renewals, 0/Esc: Clear Filters
  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      if (["INPUT", "TEXTAREA", "SELECT"].includes((e.target as HTMLElement)?.tagName)) {
        return;
      }
      if (e.key === "1") {
        e.preventDefault();
        handleTriageClick("critical");
      } else if (e.key === "2") {
        e.preventDefault();
        handleTriageClick("watchlist");
      } else if (e.key === "3") {
        e.preventDefault();
        handleTriageClick("renewals");
      } else if (e.key === "0" || e.key === "Escape") {
        e.preventDefault();
        handleClearAllFilters();
      }
    };
    window.addEventListener("keydown", handleKeyDown);
    return () => window.removeEventListener("keydown", handleKeyDown);
  }, [triageFilter]);

  const model = useMemo(() => getSnapshotMeta(), [data]);

  const triageQueues = useMemo(() => {
    const critical = borrowers.filter(
      (b) => b.rag === "Red" || b.pd >= 0.12 || ((b.ecl_stage ?? 1) >= 2 && b.pd >= 0.08)
    );
    const watchlist = borrowers.filter(
      (b) => (b.rag === "Amber" || (b.pd >= 0.04 && b.pd < 0.12)) && !critical.includes(b)
    );
    const renewals = borrowers.filter(
      (b) => b.rag === "Green" && (b.ecl_stage ?? 1) === 1 && b.pd < 0.03
    );

    const criticalEad = critical.reduce((acc, b) => acc + (b.ead || 0), 0);
    const watchlistEad = watchlist.reduce((acc, b) => acc + (b.ead || 0), 0);
    const renewalsEad = renewals.reduce((acc, b) => acc + (b.ead || 0), 0);

    return {
      critical: { accounts: critical, ead: criticalEad },
      watchlist: { accounts: watchlist, ead: watchlistEad },
      renewals: { accounts: renewals, ead: renewalsEad },
    };
  }, [borrowers]);

  const kpis = useMemo(() => {
    if (liveSummary && liveSummary.total_accounts > 0) {
      return {
        flagged: liveSummary.flagged_count,
        flagRate: liveSummary.flag_rate,
        propensity: liveSummary.model_card?.propensity_at_threshold ?? model?.propensity_at_threshold,
        totalEcl: liveSummary.total_ecl,
        red: liveSummary.red_count,
      };
    }
    const flagged = borrowers.filter((b) => b.pd >= (model?.threshold ?? 0.08));
    const totalEcl = borrowers.reduce((s, b) => s + b.ecl, 0);
    const red = borrowers.filter((b) => b.rag === "Red").length;
    return {
      flagged: flagged.length,
      flagRate: flagged.length / Math.max(borrowers.length, 1),
      propensity: model?.propensity_at_threshold,
      totalEcl,
      red,
    };
  }, [borrowers, model, liveSummary]);

  const gradeHistogram = useMemo(() => {
    const counts = new Map<string, number>();
    for (const g of GRADES) counts.set(g, 0);
    for (const b of borrowers) counts.set(b.risk_grade, (counts.get(b.risk_grade) ?? 0) + 1);
    return GRADES.map((g) => ({ grade: g, count: counts.get(g) ?? 0 }));
  }, [borrowers]);

  const ragDistribution = useMemo(() => {
    const counts: Record<RagBucket, number> = { Green: 0, Amber: 0, Red: 0 };
    for (const b of borrowers) counts[b.rag]++;
    return (Object.entries(counts) as [RagBucket, number][]).map(([name, value]) => ({
      name,
      value,
    }));
  }, [borrowers]);

  const filtered = useMemo(() => {
    let rows = borrowers;
    if (triageFilter === "critical") {
      rows = triageQueues.critical.accounts;
    } else if (triageFilter === "watchlist") {
      rows = triageQueues.watchlist.accounts;
    } else if (triageFilter === "renewals") {
      rows = triageQueues.renewals.accounts;
    }

    if (segmentFilter !== "all") rows = rows.filter((b) => b.segment === segmentFilter);
    if (ragFilter !== "all") rows = rows.filter((b) => b.rag === ragFilter);
    if (query.trim()) {
      const q = query.trim().toLowerCase();
      rows = rows.filter(
        (b) =>
          b.loan_id.toLowerCase().includes(q) ||
          (b.sector ?? "").toLowerCase().includes(q) ||
          (b.state ?? "").toLowerCase().includes(q) ||
          (b.branch_name ?? "").toLowerCase().includes(q) ||
          (b.branch_code ?? "").includes(q),
      );
    }
    return [...rows].sort((a, b) => b[sortKey] - a[sortKey]);
  }, [borrowers, query, ragFilter, segmentFilter, sortKey, triageFilter, triageQueues]);

  const hasActiveFilters = Boolean(
    query.trim() ||
    ragFilter !== "all" ||
    segmentFilter !== "all" ||
    triageFilter !== "all"
  );

  const handleExportCsv = () => {
    if (filtered.length === 0) {
      toast.error("No facilities to export");
      return;
    }
    const headers = [
      "Loan ID",
      "Segment",
      "Sector",
      "State",
      "Branch Code",
      "Branch Name",
      "PD 12M (%)",
      "Risk Grade",
      "Ind AS 109 Stage",
      "RAG Status",
      "SMA Status",
      "EAD (INR)",
      "ECL (INR)",
      "Recommended Action",
    ];
    const rows = filtered.map((b) => [
      b.loan_id,
      b.segment,
      `"${(b.sector ?? "").replace(/"/g, '""')}"`,
      b.state ?? "",
      b.branch_code ?? "",
      `"${(b.branch_name ?? "").replace(/"/g, '""')}"`,
      (b.pd * 100).toFixed(2) + "%",
      b.risk_grade,
      `Stage ${b.ecl_stage ?? 1}`,
      b.rag,
      b.sma_status,
      b.ead ?? 0,
      b.ecl ?? 0,
      `"${(b.action ?? "").replace(/"/g, '""')}"`,
    ]);
    const csvContent = [headers.join(","), ...rows.map((r) => r.join(","))].join("\n");
    const blob = new Blob([csvContent], { type: "text/csv;charset=utf-8;" });
    const url = URL.createObjectURL(blob);
    const link = document.createElement("a");
    link.href = url;
    link.setAttribute("download", `idbi_watchlist_${new Date().toISOString().slice(0, 10)}.csv`);
    document.body.appendChild(link);
    link.click();
    document.body.removeChild(link);
    toast.success(`Exported ${filtered.length} facilities to CSV for Credit Committee`);
  };

  return (
    <div className="p-4 md:p-6 space-y-6">
      {/* Guided Tips Tour Banner */}
      <GuidedTipsBanner
        title="Officer Guided Tour Active"
        description="Hover over morning triage cards, KPI metrics, and table column headers for RBI early warning definitions."
      />

      {/* eyebrow */}
      <div>
        <div className="flex flex-wrap items-center gap-2 text-[10px] uppercase tracking-widest text-muted-foreground">
          <span>
            India MSME book · {data.source.mode === "live" ? "Live Master Database" : "synthetic snapshot"} · {borrowers.length} accounts
          </span>
          <Badge
            variant="outline"
            className={
              data.source.mode === "live"
                ? "border-emerald-500/40 text-emerald-600 bg-emerald-500/10 font-medium text-[9px] px-1.5 py-0 h-4"
                : "border-muted-foreground/30 text-muted-foreground font-normal text-[9px] px-1.5 py-0 h-4"
            }
          >
            {data.source.mode === "live" ? "Live RDS / SQLite" : "Snapshot Mode"}
          </Badge>
        </div>
        <h1 className="mt-1 text-xl font-semibold text-foreground">Portfolio Console</h1>
        <p className="mt-0.5 text-sm text-muted-foreground">
          Stress seen 12 months ahead — calibrated PD, RBI-aligned grades and watch actions.
        </p>
        {branchCode && (
          <div className="mt-2 flex flex-wrap items-center gap-2">
            <Badge variant="outline" className="border-primary/30 bg-primary/10 font-normal">
              <Building2 className="mr-1 h-3 w-3" />
              Branch {branchCode}
              {branchName ? ` · ${branchName}` : ""}
            </Badge>
            <button
              type="button"
              onClick={() => navigate({ search: {} })}
              className="text-[11px] text-muted-foreground underline underline-offset-2 hover:text-foreground"
            >
              clear filter
            </button>
            {borrowers.length === 0 && (
              <span className="text-[11px] text-muted-foreground">
                No sampled accounts for this branch — the 400-row sample does not cover every
                branch. Branch totals come from the full cohort on the Branch Network page.
              </span>
            )}
          </div>
        )}
      </div>

      {/* Daily Action Queue / Morning Triage */}
      <Card className="border-border/80 bg-surface shadow-sm overflow-hidden">
        <CardHeader className="pb-3 pt-4 px-4 sm:px-5 border-b border-border/60">
          <div className="flex flex-wrap items-center justify-between gap-2">
            <div className="flex items-center gap-2">
              <span className="flex h-2.5 w-2.5 rounded-full bg-amber-500 animate-pulse" />
              <CardTitle className="text-sm font-semibold uppercase tracking-wider text-foreground">
                Officer Morning Triage · Action Queue
              </CardTitle>
              <Badge variant="outline" className="text-[10px] px-1.5 py-0 h-4 font-normal text-muted-foreground border-border/80">
                Daily Priority
              </Badge>
            </div>
            <div className="flex items-center gap-2">
              {triageFilter !== "all" && (
                <Button
                  variant="ghost"
                  size="sm"
                  onClick={() => setTriageFilter("all")}
                  className="h-7 text-xs text-muted-foreground hover:text-foreground cursor-pointer"
                >
                  Reset Triage Filter
                </Button>
              )}
              <GuidedTooltip
                title="Daily Credit Operating Procedures"
                tip="Step-by-step credit officer playbook for handling RBI early warning triggers, customer call scripts, demand notice protocols, and restructuring."
                side="left"
              >
                <Link to="/guide">
                  <Button variant="outline" size="sm" className="h-7 text-xs gap-1 cursor-pointer">
                    <Clock className="h-3 w-3" />
                    View Daily SOPs
                  </Button>
                </Link>
              </GuidedTooltip>
            </div>
          </div>
        </CardHeader>
        <CardContent className="p-3 sm:p-4">
          <div className="grid gap-3 sm:grid-cols-3">
            {/* Card 1: Critical 24h Queue */}
            <GuidedTooltip
              step="1"
              title="Step 1: Morning 24h Urgent Queue"
              tip="Start here each morning to triage 24h high-risk accounts. Accounts with drawing power erosion ≥ 25%, multiple NACH returns, or Stage 2/3 slippage risk. Clicking filters and smoothly scrolls down to the queue table."
              side="top"
            >
              <div
                role="button"
                tabIndex={0}
                onClick={() => handleTriageClick("critical")}
                onKeyDown={(e) => {
                  if (e.key === "Enter" || e.key === " ") {
                    e.preventDefault();
                    handleTriageClick("critical");
                  }
                }}
                className={`cursor-pointer rounded-lg border p-3.5 transition-all outline-none focus-visible:ring-2 focus-visible:ring-primary ${
                  triageFilter === "critical"
                    ? "border-red-500 bg-red-500/10 ring-2 ring-red-500/30 shadow-md"
                    : "border-red-500/30 bg-red-500/5 hover:border-red-500/60 hover:bg-red-500/10"
                }`}
              >
                <div className="flex items-center justify-between">
                  <span className="flex items-center gap-1.5 text-xs font-semibold text-red-600 dark:text-red-400">
                    <AlertOctagon className="h-4 w-4" />
                    🔴 Urgent Action (Act within 24h)
                  </span>
                  <Badge variant="outline" className="text-[10px] px-1.5 py-0 border-red-500/40 text-red-600 font-medium">
                    High Risk / SMA-1/2
                  </Badge>
                </div>
                <div className="mt-2 flex items-baseline gap-2">
                  <span className="text-xl font-bold tabular-nums text-foreground">
                    {triageQueues.critical.accounts.length}
                  </span>
                  <span className="text-xs text-muted-foreground">
                    accounts · {formatInrCompact(triageQueues.critical.ead)} EAD
                  </span>
                </div>
                <p className="mt-1 text-[11px] text-muted-foreground line-clamp-2">
                  Drawing power erosion ≥ 25%, multiple NACH returns, or Stage 2/3 slippage risk. Immediate intervention required.
                </p>
                <div className="mt-3 flex items-center justify-between text-[11px]">
                  <span className="font-medium text-red-600 dark:text-red-400">
                    {triageFilter === "critical" ? "✓ Viewing Urgent Queue (Click to scroll)" : "Filter & Scroll to 24h Queue"}
                  </span>
                  <ArrowRight className="h-3 w-3 text-red-600 dark:text-red-400" />
                </div>
              </div>
            </GuidedTooltip>

            {/* Card 2: Covenant Watchlist */}
            <GuidedTooltip
              step="2"
              title="Step 2: Weekly Covenant Watchlist"
              tip="Weekly review for borrowers with incipient stress signals — GST filing delays > 15 days, minor drawing power dips, or SMA-0 status. Click to filter and smoothly scroll to the queue table."
              side="top"
            >
              <div
                role="button"
                tabIndex={0}
                onClick={() => handleTriageClick("watchlist")}
                onKeyDown={(e) => {
                  if (e.key === "Enter" || e.key === " ") {
                    e.preventDefault();
                    handleTriageClick("watchlist");
                  }
                }}
                className={`cursor-pointer rounded-lg border p-3.5 transition-all outline-none focus-visible:ring-2 focus-visible:ring-primary ${
                  triageFilter === "watchlist"
                    ? "border-amber-500 bg-amber-500/10 ring-2 ring-amber-500/30 shadow-md"
                    : "border-amber-500/30 bg-amber-500/5 hover:border-amber-500/60 hover:bg-amber-500/10"
                }`}
              >
                <div className="flex items-center justify-between">
                  <span className="flex items-center gap-1.5 text-xs font-semibold text-amber-600 dark:text-amber-400">
                    <ShieldAlert className="h-4 w-4" />
                    🟡 Covenant Watchlist (Weekly)
                  </span>
                  <Badge variant="outline" className="text-[10px] px-1.5 py-0 border-amber-500/40 text-amber-600 font-medium">
                    Moderate Risk / SMA-0
                  </Badge>
                </div>
                <div className="mt-2 flex items-baseline gap-2">
                  <span className="text-xl font-bold tabular-nums text-foreground">
                    {triageQueues.watchlist.accounts.length}
                  </span>
                  <span className="text-xs text-muted-foreground">
                    accounts · {formatInrCompact(triageQueues.watchlist.ead)} EAD
                  </span>
                </div>
                <p className="mt-1 text-[11px] text-muted-foreground line-clamp-2">
                  Incipient stress, GST filing delays &gt; 15 days, or drawing power monitoring. Audit covenants and demand margin.
                </p>
                <div className="mt-3 flex items-center justify-between text-[11px]">
                  <span className="font-medium text-amber-600 dark:text-amber-400">
                    {triageFilter === "watchlist" ? "✓ Viewing Watchlist (Click to scroll)" : "Filter & Scroll to Weekly Queue"}
                  </span>
                  <ArrowRight className="h-3 w-3 text-amber-600 dark:text-amber-400" />
                </div>
              </div>
            </GuidedTooltip>

            {/* Card 3: Fast-Track Clean Renewals */}
            <GuidedTooltip
              step="3"
              title="Step 3: Fast-Track Clean Renewals"
              tip="Prime borrowers (RG1–RG3) with 0 bounces, spotless debt service, and low PD (< 3%). Fast-track for facility renewal and pre-approved limit enhancement."
              side="top"
            >
              <div
                role="button"
                tabIndex={0}
                onClick={() => handleTriageClick("renewals")}
                onKeyDown={(e) => {
                  if (e.key === "Enter" || e.key === " ") {
                    e.preventDefault();
                    handleTriageClick("renewals");
                  }
                }}
                className={`cursor-pointer rounded-lg border p-3.5 transition-all outline-none focus-visible:ring-2 focus-visible:ring-primary ${
                  triageFilter === "renewals"
                    ? "border-emerald-500 bg-emerald-500/10 ring-2 ring-emerald-500/30 shadow-md"
                    : "border-emerald-500/30 bg-emerald-500/5 hover:border-emerald-500/60 hover:bg-emerald-500/10"
                }`}
              >
                <div className="flex items-center justify-between">
                  <span className="flex items-center gap-1.5 text-xs font-semibold text-emerald-600 dark:text-emerald-400">
                    <CheckCircle2 className="h-4 w-4" />
                    🟢 Fast-Track Renewals (Clean Book)
                  </span>
                  <Badge variant="outline" className="text-[10px] px-1.5 py-0 border-emerald-500/40 text-emerald-600 font-medium">
                    Prime RG1–RG3
                  </Badge>
                </div>
                <div className="mt-2 flex items-baseline gap-2">
                  <span className="text-xl font-bold tabular-nums text-foreground">
                    {triageQueues.renewals.accounts.length}
                  </span>
                  <span className="text-xs text-muted-foreground">
                    accounts · {formatInrCompact(triageQueues.renewals.ead)} EAD
                  </span>
                </div>
                <p className="mt-1 text-[11px] text-muted-foreground line-clamp-2">
                  Clean repayment track, 0 bounces, perfect debt service. Eligible for 1-click renewal and facility limit top-up.
                </p>
                <div className="mt-3 flex items-center justify-between text-[11px]">
                  <span className="font-medium text-emerald-600 dark:text-emerald-400">
                    {triageFilter === "renewals" ? "✓ Viewing Clean Renewals (Click to scroll)" : "Filter & Scroll to Clean Renewals"}
                  </span>
                  <ArrowRight className="h-3 w-3 text-emerald-600 dark:text-emerald-400" />
                </div>
              </div>
            </GuidedTooltip>
          </div>
        </CardContent>
      </Card>

      {/* KPI row */}
      <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-4">
        <KpiTile
          label="Flagged for stress"
          value={String(kpis.flagged)}
          sub={`${formatPercent(kpis.flagRate)} of sampled book at PD ≥ ${formatPercent(model?.threshold ?? 0.08)}`}
          icon={Radar}
          step="4"
          guidedTip="Identifies accounts whose 12-month Probability of Default (PD) exceeds the 8.0% decision threshold. Prioritized for proactive credit intervention before SMA migration."
        />
        <KpiTile
          label="Default propensity"
          value={kpis.propensity != null ? formatPercent(kpis.propensity) : "—"}
          sub="of loans we flag actually default within 12m"
          icon={Target}
          step="5"
          guidedTip="Precision metric: percentage of flagged borrowers that actually experience default within 12 months. Calibrated via isotonic regression to prevent false-alarm fatigue."
        />
        <KpiTile
          label="Expected credit loss"
          value={formatInrCompact(kpis.totalEcl)}
          sub={`LGD 45% · base rate ${formatPercent(model?.base_default_rate ?? 0.039, 1)}`}
          icon={IndianRupee}
          step="6"
          guidedTip="Ind AS 109 accounting provision = Exposure at Default (EAD) × Calibrated PD × Loss Given Default (LGD 45%). Pre-emptive provisioning calculation."
        />
        <KpiTile
          label="Model discrimination"
          value={`AUC ${(model?.auc ?? 0.856).toFixed(3)}`}
          sub={`capture@top-10% ${formatPercent(model?.capture_top10 ?? 0.58)} · lift ${(model?.lift_top10 ?? 5.8).toFixed(1)}×`}
          icon={TrendingUp}
          step="7"
          guidedTip="Model discrimination: AUC 0.856 measures ranking separation between defaulters and healthy facilities. Top decile captures 58% of all defaults (5.8× lift)."
        />
      </div>

      {/* Charts */}
      <div className="grid gap-4 lg:grid-cols-5">
        <Card className="bg-surface lg:col-span-3">
          <CardHeader className="pb-2">
            <CardTitle className="text-sm">Risk grade distribution</CardTitle>
            <CardDescription className="text-xs">
              RG1 (safest) → RG10 (severe). RG7+ enters the watchlist committee.
            </CardDescription>
          </CardHeader>
          <CardContent className="h-64">
            <ResponsiveContainer width="100%" height="100%">
              <BarChart data={gradeHistogram} margin={{ top: 8, right: 8, left: -18, bottom: 0 }}>
                <CartesianGrid strokeDasharray="3 3" stroke="var(--color-border)" vertical={false} />
                <XAxis dataKey="grade" tick={{ fontSize: 11 }} tickLine={false} axisLine={false} />
                <YAxis tick={{ fontSize: 11 }} tickLine={false} axisLine={false} allowDecimals={false} />
                <Tooltip
                  cursor={{ fill: "var(--color-muted)" }}
                  contentStyle={{
                    background: "var(--color-surface)",
                    border: "1px solid var(--color-border)",
                    borderRadius: 8,
                    fontSize: 12,
                  }}
                />
                <Bar isAnimationActive={false} dataKey="count" radius={[4, 4, 0, 0]}>
                  {gradeHistogram.map((d, i) => (
                    <Cell key={d.grade} fill={ragHex[gradeIndexToRag(i)]} />
                  ))}
                </Bar>
              </BarChart>
            </ResponsiveContainer>
          </CardContent>
        </Card>

        <Card className="bg-surface lg:col-span-2">
          <CardHeader className="pb-2">
            <CardTitle className="text-sm">RAG buckets</CardTitle>
            <CardDescription className="text-xs">
              {RAG_LEGEND}
            </CardDescription>
          </CardHeader>
          <CardContent className="h-64">
            <ResponsiveContainer width="100%" height="100%">
              <PieChart>
                <Pie
                  isAnimationActive={false}
                  data={ragDistribution}
                  dataKey="value"
                  nameKey="name"
                  innerRadius="55%"
                  outerRadius="80%"
                  paddingAngle={2}
                  strokeWidth={0}
                >
                  {ragDistribution.map((d) => (
                    <Cell key={d.name} fill={ragHex[d.name as RagBucket]} />
                  ))}
                </Pie>
                <Tooltip
                  contentStyle={{
                    background: "var(--color-surface)",
                    border: "1px solid var(--color-border)",
                    borderRadius: 8,
                    fontSize: 12,
                  }}
                />
              </PieChart>
            </ResponsiveContainer>
            <div className="-mt-2 flex justify-center gap-4">
              {ragDistribution.map((d) => (
                <span key={d.name} className="flex items-center gap-1.5 text-[11px] text-muted-foreground">
                  <span className="h-2 w-2 rounded-full" style={{ background: ragHex[d.name as RagBucket] }} />
                  {d.name} · {d.value}
                </span>
              ))}
            </div>
          </CardContent>
        </Card>
      </div>

      {/* Watchlist */}
      <Card
        ref={tableRef}
        className={cn(
          "bg-surface scroll-mt-20 transition-all duration-500",
          highlightTable && triageFilter === "critical" && "ring-4 ring-red-500/80 ring-offset-2 animate-pulse shadow-2xl border-red-500/60",
          highlightTable && triageFilter === "watchlist" && "ring-4 ring-amber-500/80 ring-offset-2 animate-pulse shadow-2xl border-amber-500/60",
          highlightTable && triageFilter === "renewals" && "ring-4 ring-emerald-500/80 ring-offset-2 animate-pulse shadow-2xl border-emerald-500/60",
          highlightTable && triageFilter === "all" && "ring-4 ring-primary/80 ring-offset-2 animate-pulse shadow-2xl border-primary/60",
        )}
      >
        <CardHeader className="pb-3 space-y-3">
          <div className="flex flex-col xl:flex-row xl:items-center justify-between gap-3">
            <div className="min-w-0">
              <CardTitle className="text-sm font-semibold">Watchlist queue</CardTitle>
              <CardDescription className="text-xs text-muted-foreground">
                Sorted by PD — click a borrower for reason codes, EWS and recourse.
              </CardDescription>
            </div>
            <div className="flex flex-wrap items-center gap-2.5">
              <div className="relative w-full sm:w-60">
                <Search className="pointer-events-none absolute left-2.5 top-1/2 h-3.5 w-3.5 -translate-y-1/2 text-muted-foreground" />
                <Input
                  value={query}
                  onChange={(e) => setQuery(e.target.value)}
                  placeholder="Search ID, sector, state, branch…"
                  className="h-8 pl-8 text-xs"
                />
              </div>
              <Select value={segmentFilter} onValueChange={setSegmentFilter}>
                <SelectTrigger className="h-8 w-44 text-xs">
                  <SelectValue placeholder="All Segments" />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="all">All Segments ({borrowers.length})</SelectItem>
                  <SelectItem value="msme_idbi">IDBI Finacle Sandbox (150)</SelectItem>
                  <SelectItem value="msme_india">India MSME Cashflow (400)</SelectItem>
                </SelectContent>
              </Select>
              <Tabs value={ragFilter} onValueChange={setRagFilter}>
                <TabsList className="h-8">
                  <TabsTrigger value="all" className="text-xs px-2.5">All</TabsTrigger>
                  <TabsTrigger value="Red" className="text-xs px-2.5">Red</TabsTrigger>
                  <TabsTrigger value="Amber" className="text-xs px-2.5">Amber</TabsTrigger>
                  <TabsTrigger value="Green" className="text-xs px-2.5">Green</TabsTrigger>
                </TabsList>
              </Tabs>
              <Select value={sortKey} onValueChange={(v) => setSortKey(v as "pd" | "ecl")}>
                <SelectTrigger className="h-8 w-32 text-xs">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="pd">Sort by PD</SelectItem>
                  <SelectItem value="ecl">Sort by ECL</SelectItem>
                </SelectContent>
              </Select>
              <Button
                variant="outline"
                size="sm"
                onClick={handleExportCsv}
                className="h-8 text-xs gap-1.5 border-border/80 hover:border-primary/40 hover:bg-primary/5 cursor-pointer shrink-0"
                title="Export filtered watchlist facilities to CSV for credit committee review"
              >
                <Download className="h-3.5 w-3.5 text-primary" />
                <span>Export CSV</span>
                <span className="text-[10px] text-muted-foreground tabular-nums">({filtered.length})</span>
              </Button>
            </div>
          </div>
        </CardHeader>
        <CardContent className="p-0">
          {hasActiveFilters && (
            <div
              className={cn(
                "flex flex-wrap items-center justify-between gap-2 border-b px-4 py-2 text-xs transition-colors duration-500",
                highlightTable
                  ? "bg-primary/20 border-primary/50 text-foreground animate-pulse"
                  : "bg-muted/30 border-border/80 text-foreground"
              )}
            >
              <div className="flex flex-wrap items-center gap-2 min-w-0">
                <Filter className="h-3.5 w-3.5 text-primary shrink-0" />
                <span className="font-semibold text-foreground shrink-0">
                  {triageFilter !== "all" ? "Active Triage Queue:" : "Active Filters:"}
                </span>
                {triageFilter !== "all" && (
                  <Badge variant="outline" className="text-xs bg-background border-primary/40 text-foreground font-medium shrink-0">
                    {triageFilter === "critical"
                      ? "🔴 Urgent Action Queue (24h)"
                      : triageFilter === "watchlist"
                      ? "🟡 Covenant Watchlist (Weekly)"
                      : "🟢 Fast-Track Clean Renewals"}
                  </Badge>
                )}
                <span className="text-muted-foreground shrink-0">
                  — Showing <strong className="text-foreground tabular-nums">{filtered.length}</strong> of {borrowers.length} facilities
                </span>
                {query.trim() && (
                  <Badge variant="outline" className="text-[10px] bg-background truncate max-w-44">
                    Search: "{query}"
                  </Badge>
                )}
                {segmentFilter !== "all" && (
                  <Badge variant="outline" className="text-[10px] bg-background shrink-0">
                    Segment: {segmentFilter}
                  </Badge>
                )}
                {ragFilter !== "all" && (
                  <Badge variant="outline" className="text-[10px] bg-background shrink-0">
                    RAG: {ragFilter}
                  </Badge>
                )}
              </div>
              <Button
                variant="ghost"
                size="sm"
                onClick={handleClearAllFilters}
                className="h-6 text-xs text-primary hover:underline cursor-pointer gap-1 shrink-0 ml-auto"
              >
                <RotateCcw className="h-3 w-3" />
                <span>Reset all filters (Esc)</span>
              </Button>
            </div>
          )}
          <Table containerClassName="max-h-[520px] overflow-auto" className="min-w-[1150px]">
            <TableHeader className="sticky top-0 bg-surface z-20 shadow-[0_1px_0_0_var(--color-border)]">
              <TableRow>
                <TableHead className="text-xs bg-surface pl-4">
                  <TableHeaderTip
                    title="Loan / Facility ID"
                    tip="Core Finacle / CBS account identifier. Click ID to inspect borrower CAM dossier, or click the copy icon to copy the loan ID to clipboard."
                  >
                    Loan ID
                  </TableHeaderTip>
                </TableHead>
                <TableHead className="text-xs bg-surface">Sector</TableHead>
                <TableHead className="text-xs bg-surface">State</TableHead>
                <TableHead className="text-xs bg-surface">Branch</TableHead>
                <TableHead className="text-xs bg-surface">Sub-segment</TableHead>
                <TableHead className="text-xs bg-surface text-right">
                  <TableHeaderTip
                    title="Probability of Default (12-Month PD)"
                    tip="Calibrated likelihood that borrower defaults within 12 months. Calibrated via isotonic regression across 35+ banking, GST, and behavioral features."
                  >
                    PD (12m)
                  </TableHeaderTip>
                </TableHead>
                <TableHead className="text-xs bg-surface">
                  <TableHeaderTip
                    title="Risk Grade (RG1–RG10)"
                    tip="DRISHTI 10-tier rating grade aligned with RBI supervisory rating guidelines. RG1–RG3: Prime; RG4–RG6: Watch; RG7–RG10: High / Severe Stress (enters Watchlist Committee)."
                  >
                    Grade
                  </TableHeaderTip>
                </TableHead>
                <TableHead className="text-xs bg-surface">
                  <TableHeaderTip
                    title="Ind AS 109 Asset Stage"
                    tip="Stage 1: Performing loan (12m ECL required). Stage 2: Significant Increase in Credit Risk (SICR, Lifetime ECL). Stage 3: Credit-impaired / NPA (>90 DPD)."
                  >
                    Stage
                  </TableHeaderTip>
                </TableHead>
                <TableHead className="text-xs bg-surface">
                  <TableHeaderTip
                    title="RAG Operational Status"
                    tip="Red: Action within 24h (drawing power erosion, bounce spike). Amber: Weekly covenant audit. Green: Clean standard servicing."
                  >
                    RAG
                  </TableHeaderTip>
                </TableHead>
                <TableHead className="text-xs bg-surface">
                  <TableHeaderTip
                    title="Special Mention Account (SMA)"
                    tip="RBI SMA tagging: Standard: 0 DPD; SMA-0: 1–30 DPD; SMA-1: 31–60 DPD; SMA-2: 61–90 DPD; NPA: >90 DPD."
                  >
                    SMA
                  </TableHeaderTip>
                </TableHead>
                <TableHead className="text-xs bg-surface text-right">
                  <TableHeaderTip
                    title="Exposure at Default (EAD)"
                    tip="Total sanctioned limit plus drawn balance exposed to credit risk at the point of default."
                  >
                    EAD
                  </TableHeaderTip>
                </TableHead>
                <TableHead className="text-xs bg-surface text-right">
                  <TableHeaderTip
                    title="Expected Credit Loss (ECL)"
                    tip="Ind AS 109 accounting provision = EAD × PD × LGD (Loss Given Default: 45%). Pre-emptive provisioning."
                  >
                    ECL
                  </TableHeaderTip>
                </TableHead>
                <TableHead className="text-xs bg-surface text-right pr-4">
                  <TableHeaderTip
                    title="Credit Action / CAM Dossier"
                    tip="Jump to full Credit Assessment Memorandum (CAM) containing SHAP driver reasons, GST-banking reconciliation, and RBI early warning triggers."
                    side="left"
                  >
                    Action
                  </TableHeaderTip>
                </TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {filtered.slice(0, 200).map((b) => (
                <BorrowerRow key={b.loan_id} b={b} />
              ))}
              {filtered.length === 0 && (
                <TableRow>
                  <TableCell colSpan={13} className="py-8 text-center text-xs text-muted-foreground">
                    No borrowers match the current filters.
                  </TableCell>
                </TableRow>
              )}
            </TableBody>
          </Table>
          {filtered.length > 200 && (
            <div className="border-t border-border px-4 py-2 text-[11px] text-muted-foreground">
              Showing top 200 of {filtered.length} by {sortKey.toUpperCase()}.
            </div>
          )}
        </CardContent>
      </Card>
    </div>
  );
}

function BorrowerRow({ b }: { b: BorrowerScore }) {
  const [copied, setCopied] = useState(false);
  const [reviewed, setReviewed] = useState(false);
  const [sarbEscalated, setSarbEscalated] = useState(false);

  useEffect(() => {
    try {
      const reviewedLoans = JSON.parse(localStorage.getItem("drishti_reviewed_loans") || "[]");
      setReviewed(reviewedLoans.includes(b.loan_id));
      const sarbLoans = JSON.parse(localStorage.getItem("drishti_sarb_loans") || "[]");
      setSarbEscalated(sarbLoans.includes(b.loan_id));
    } catch {
      // ignore
    }
  }, [b.loan_id]);

  const handleToggleReviewed = (e: React.MouseEvent) => {
    e.stopPropagation();
    e.preventDefault();
    try {
      const current = JSON.parse(localStorage.getItem("drishti_reviewed_loans") || "[]");
      const next = current.includes(b.loan_id)
        ? current.filter((id: string) => id !== b.loan_id)
        : [...current, b.loan_id];
      localStorage.setItem("drishti_reviewed_loans", JSON.stringify(next));
      setReviewed(!reviewed);
      if (!reviewed) {
        toast.success(`Marked ${b.loan_id} as Reviewed today`, { duration: 1800 });
      } else {
        toast.info(`Unmarked ${b.loan_id}`, { duration: 1200 });
      }
    } catch {
      toast.error("Failed to update status");
    }
  };

  const handleCopyBriefing = (e: React.MouseEvent) => {
    e.stopPropagation();
    e.preventDefault();
    const briefing = `IDBI BANK CREDIT BRIEFING · MSME\nFacility ID: ${b.loan_id} | Sector: ${(b.sector ?? "MSME").replace(/_/g, " ")} | Branch: ${b.branch_name ?? "—"}\nRating Grade: ${b.risk_grade} | 12m PD: ${(b.pd * 100).toFixed(1)}% | Ind AS 109: Stage ${b.ecl_stage ?? 1} | RAG: ${b.rag}\nEAD: ₹${(b.ead || 0).toLocaleString("en-IN")} | ECL Provision: ₹${(b.ecl || 0).toLocaleString("en-IN")} | SMA Tag: ${b.sma_status}\nAction: ${b.action}`;
    navigator.clipboard.writeText(briefing);
    toast.success(`Copied Credit Briefing for ${b.loan_id}`, { duration: 2000 });
  };

  const handleCopy = (e: React.MouseEvent) => {
    e.stopPropagation();
    e.preventDefault();
    try {
      navigator.clipboard.writeText(b.loan_id);
      setCopied(true);
      toast.success(`Copied ${b.loan_id} to clipboard`, { duration: 1500 });
      setTimeout(() => setCopied(false), 1800);
    } catch {
      toast.error("Failed to copy to clipboard");
    }
  };

  return (
    <TableRow className="cursor-pointer transition-colors hover:bg-muted/60">
      <TableCell className="text-xs font-medium pl-4">
        <div className="flex items-center gap-1.5 flex-wrap">
          <Link
            to="/borrowers/$id"
            params={{ id: b.loan_id }}
            viewTransition
            className="hover:text-primary hover:underline font-mono"
          >
            {b.loan_id}
          </Link>
          <button
            type="button"
            onClick={handleCopy}
            title={copied ? "Copied!" : `Copy ${b.loan_id}`}
            aria-label={`Copy loan ID ${b.loan_id}`}
            className="group/copy inline-flex h-5 w-5 items-center justify-center rounded p-0.5 text-muted-foreground hover:bg-muted hover:text-foreground transition-colors cursor-pointer"
          >
            {copied ? (
              <Check className="h-3 w-3 text-emerald-600 animate-in zoom-in-50" />
            ) : (
              <Copy className="h-3 w-3 opacity-60 group-hover/copy:opacity-100 transition-opacity" />
            )}
          </button>
          {reviewed && (
            <Badge variant="outline" className="text-[9px] px-1 py-0 h-4 border-emerald-500/40 text-emerald-600 bg-emerald-500/10 font-medium">
              ✓ Reviewed
            </Badge>
          )}
          {sarbEscalated && (
            <Badge variant="outline" className="text-[9px] px-1 py-0 h-4 border-rose-500/40 text-rose-600 bg-rose-500/10 font-medium">
              ⚠️ SARB
            </Badge>
          )}
          {b.segment === "msme_idbi" && (
            <Badge variant="outline" className="text-[9px] px-1 py-0 h-4 border-primary/40 text-primary font-normal">
              IDBI
            </Badge>
          )}
        </div>
      </TableCell>
      <TableCell className="text-xs capitalize">{(b.sector ?? "—").replace(/_/g, " ")}</TableCell>
      <TableCell className="text-xs">{b.state ?? "—"}</TableCell>
      <TableCell className="max-w-36 truncate text-xs text-muted-foreground" title={b.branch_name}>
        {b.branch_name ?? "—"}
      </TableCell>
      <TableCell className="text-xs capitalize">{b.sub_segment ?? "—"}</TableCell>
      <TableCell className="text-xs text-right tabular-nums">
        <Badge variant="outline" className={`${pdTone(b.pd)} font-normal tabular-nums`}>
          {formatPercent(b.pd, 1)}
        </Badge>
      </TableCell>
      <TableCell className="text-xs font-medium">{b.risk_grade}</TableCell>
      <TableCell className="text-xs">
        <Badge
          variant="outline"
          className={`font-normal text-[10px] px-1.5 py-0 ${
            (b.ecl_stage ?? 1) === 1
              ? "bg-band-a/10 text-band-a border-band-a/30"
              : (b.ecl_stage ?? 1) === 2
              ? "bg-band-c/10 text-band-c border-band-c/30"
              : "bg-band-d/10 text-band-d border-band-d/30"
          }`}
        >
          Stage {b.ecl_stage ?? 1}
        </Badge>
      </TableCell>
      <TableCell className="text-xs">
        <Badge variant="outline" className={`${ragTone[b.rag]} font-normal`}>
          {b.rag}
        </Badge>
      </TableCell>
      <TableCell className="max-w-40 truncate text-xs text-muted-foreground" title={b.action}>
        {b.sma_status}
      </TableCell>
      <TableCell className="text-xs text-right tabular-nums">{formatInrCompact(b.ead)}</TableCell>
      <TableCell className="text-xs text-right tabular-nums">{formatInrCompact(b.ecl)}</TableCell>
      <TableCell className="text-xs text-right pr-4">
        <div className="flex items-center justify-end gap-1">
          <button
            type="button"
            onClick={handleToggleReviewed}
            title={reviewed ? "Marked as reviewed today (Click to unmark)" : "Mark as reviewed today"}
            className={cn(
              "inline-flex h-6 w-6 items-center justify-center rounded border transition-colors cursor-pointer",
              reviewed
                ? "border-emerald-500/40 bg-emerald-500/15 text-emerald-600"
                : "border-border/70 bg-background/80 text-muted-foreground hover:text-foreground hover:bg-muted"
            )}
          >
            <CheckCheck className="h-3.5 w-3.5" />
          </button>
          <button
            type="button"
            onClick={handleCopyBriefing}
            title="Copy standardized Credit Briefing for committee notes"
            className="inline-flex h-6 w-6 items-center justify-center rounded border border-border/70 bg-background/80 text-muted-foreground hover:text-foreground hover:bg-muted transition-colors cursor-pointer"
          >
            <Share2 className="h-3 w-3" />
          </button>
          <Link
            to="/borrowers/$id"
            params={{ id: b.loan_id }}
            className="inline-flex items-center gap-1 rounded border border-border/70 bg-background/80 px-2 py-0.5 text-[11px] font-medium text-foreground hover:bg-primary/10 hover:text-primary transition-colors"
            title="Open full Credit Appraisal Memorandum"
          >
            <FileText className="h-3 w-3" />
            <span>CAM</span>
          </Link>
        </div>
      </TableCell>
    </TableRow>
  );
}

// Snapshot is imported statically in lib/api; this helper just surfaces its card.
import { getSnapshot } from "@/lib/api";
function getSnapshotMeta() {
  return getSnapshot().model_card;
}
