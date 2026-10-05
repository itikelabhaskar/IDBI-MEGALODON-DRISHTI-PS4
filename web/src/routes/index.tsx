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
import { listBorrowers, fetchPortfolio, fetchPortfolioSummary, createDecision, localReviewStatus } from "@/lib/api";
import { useDecisionRights, useRole, useScopeBranch } from "@/lib/role-context";
import { dpdOf, rbiSma, watchLabel, whyFlaggedLine } from "@/lib/plain-language";
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
import { PageApiDrawer } from "@/components/drishti/page-api-drawer";
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

type Triage = "all" | "critical" | "watchlist" | "renewals";

type PortfolioSearch = {
  branch?: string;
  sector?: string;
  q?: string;
  rag?: string;
  seg?: string;
  triage?: Triage;
  sort?: "pd" | "ecl";
  view?: "standard" | "compact";
};

const str = (v: unknown): string | undefined => (v == null || v === "" ? undefined : String(v));

export const Route = createFileRoute("/")({
  // Every filter lives in the URL, so opening a borrower and coming back (or
  // sharing the link) keeps the officer's view. ?branch= arrives from the Branch
  // Network drill-down; a typed /?branch=1042 is parsed as a number, hence String().
  validateSearch: (search: Record<string, unknown>): PortfolioSearch => ({
    branch: str(search.branch),
    sector: str(search.sector),
    q: str(search.q),
    rag: str(search.rag),
    seg: str(search.seg),
    triage: (["critical", "watchlist", "renewals"] as const).find((t) => t === search.triage),
    sort: search.sort === "ecl" ? "ecl" : undefined,
    view: search.view === "compact" ? "compact" : undefined,
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
            <div className="flex items-center gap-1.5 text-[11px] uppercase tracking-widest text-muted-foreground">
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

// Queues are set by PD and stage, not by RAG colour alone, so the urgent queue
// also holds Amber accounts (Amber starts at 11%). Shown with the active queue.
const QUEUE_RULE: Record<"critical" | "watchlist" | "renewals", string> = {
  critical:
    "Red accounts, plus any account with PD ≥ 12% or in Stage 2–3 with PD ≥ 8%. Amber accounts with high PD land here too.",
  watchlist: "Amber or PD 4–12% accounts that are not already in the urgent queue.",
  renewals: "Green, Stage 1 and PD below 3%.",
};

function PortfolioConsole() {
  const initialData = Route.useLoaderData();
  const { branch: urlBranch } = Route.useSearch();
  // A branch officer always sees their own branch; the URL can't widen it.
  const scope = useScopeBranch();
  const branchCode = scope ?? urlBranch;
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

  const search = Route.useSearch();
  const setSearch = (patch: Partial<PortfolioSearch>) =>
    navigate({ search: (prev: PortfolioSearch) => ({ ...prev, ...patch }), replace: true });
  const query = search.q ?? "";
  const setQuery = (v: string) => setSearch({ q: v || undefined });
  const ragFilter = search.rag ?? "all";
  const setRagFilter = (v: string) => setSearch({ rag: v === "all" ? undefined : v });
  const segmentFilter = search.seg ?? "all";
  const setSegmentFilter = (v: string) => setSearch({ seg: v === "all" ? undefined : v });
  const sortKey = search.sort ?? "pd";
  const setSortKey = (v: "pd" | "ecl") => setSearch({ sort: v === "pd" ? undefined : v });
  const triageFilter: Triage = search.triage ?? "all";
  const setTriageFilter = (v: Triage) => setSearch({ triage: v === "all" ? undefined : v });
  const viewMode = search.view ?? "standard";
  const setViewMode = (v: "standard" | "compact") => setSearch({ view: v === "standard" ? undefined : v });

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
    // Keeps the view mode; clears every filter including a branch drill-down.
    navigate({ search: (prev: PortfolioSearch) => ({ view: prev.view }), replace: true });
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
      // Esc that closes a dropdown, dialog or the command palette must not also wipe the filters.
      if (
        e.defaultPrevented ||
        document.querySelector('[role="dialog"], [role="listbox"], [role="menu"], [data-radix-popper-content-wrapper]')
      ) {
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
    const flagged = borrowers.filter((b) => b.pd >= (model?.threshold ?? 0.16));
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

    if (search.sector) rows = rows.filter((b) => b.sector === search.sector);
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
  }, [borrowers, query, ragFilter, segmentFilter, sortKey, triageFilter, triageQueues, search.sector]);

  const hasActiveFilters = Boolean(
    (branchCode && !scope) ||
    search.sector ||
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
      "RBI SMA (days past due)",
      "Model early watch",
      "Why flagged",
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
      rbiSma(dpdOf(b)) ?? "",
      watchLabel(b.sma_status),
      `"${whyFlaggedLine(b).replace(/"/g, '""')}"`,
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

      <div>
        <div className="flex flex-wrap items-center justify-between gap-3">
          <h1 className="text-xl font-semibold text-foreground">{scope ? "Branch Watchlist" : "Portfolio Console"}</h1>
          <PageApiDrawer routePath="/" triggerLabel="IDBI Sandbox APIs" />
        </div>
        {search.sector && (
          <div className="mt-2 flex flex-wrap items-center gap-2">
            <Badge variant="outline" className="border-primary/30 bg-primary/10 font-normal capitalize">
              Sector · {search.sector.replace(/_/g, " ")}
            </Badge>
            <button
              type="button"
              onClick={() => setSearch({ sector: undefined })}
              className="text-[11px] text-muted-foreground underline underline-offset-2 hover:text-foreground"
            >
              clear sector
            </button>
            <Link to="/market" search={{ tab: "sectors" }} className="text-[11px] text-primary hover:underline">
              Back to Sectors
            </Link>
          </div>
        )}
        {branchCode && (
          <div className="mt-2 flex flex-wrap items-center gap-2">
            <Badge variant="outline" className="border-primary/30 bg-primary/10 font-normal">
              <Building2 className="mr-1 h-3 w-3" />
              {scope ? "Your branch" : "Branch"} {branchCode}
              {branchName ? ` · ${branchName}` : ""}
            </Badge>
            {scope ? (
              <span className="text-[11px] text-muted-foreground">
                Branch officer view: only this branch&apos;s accounts. The controlling office sees the whole book.
              </span>
            ) : (
              <button
                type="button"
                onClick={() => navigate({ search: {} })}
                className="text-[11px] text-muted-foreground underline underline-offset-2 hover:text-foreground"
              >
                clear filter
              </button>
            )}
            {data.source.mode !== "live" && (
              <span className="text-[11px] text-muted-foreground">
                Offline snapshot: this list holds only the sampled accounts of this branch
                ({borrowers.length}); the Branch Network page counts the branch&apos;s full test cohort.
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
              <Badge variant="outline" className="text-[11px] px-1.5 py-0 h-4 font-normal text-muted-foreground border-border/80">
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
                  <Badge variant="outline" className="text-[11px] px-1.5 py-0 border-red-500/40 text-red-600 font-medium">
                    High risk
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
                  Red accounts, any account with PD ≥ 12%, and Stage 2–3 accounts with PD ≥ 8%. Act within 24 hours.
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
              tip="Weekly review for borrowers with incipient stress signals — GST filing delays > 15 days, minor drawing power dips, or 1–30 days overdue (RBI SMA-0). Click to filter and smoothly scroll to the queue table."
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
                  <Badge variant="outline" className="text-[11px] px-1.5 py-0 border-amber-500/40 text-amber-600 font-medium">
                    Moderate risk
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
                  Amber accounts and PD 4–12% not already urgent. Review covenants and drawing power this week.
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
                  <Badge variant="outline" className="text-[11px] px-1.5 py-0 border-emerald-500/40 text-emerald-600 font-medium">
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
                  Green, Stage 1, PD below 3%. Candidates for renewal or a limit increase.
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
          sub={`${formatPercent(kpis.flagRate)} of ${data.source.mode === "live" ? "the book" : "the snapshot"} at PD ≥ ${formatPercent(model?.threshold ?? 0.16)}`}
          icon={Radar}
          step="4"
          guidedTip="Accounts whose 12-month PD is at or above the model's flag threshold (16%, the start of RG6). The same count the Branch Network page uses."
        />
        <KpiTile
          label="Flag lift"
          value={
            kpis.propensity != null
              ? `${(kpis.propensity / (model?.base_default_rate ?? 0.039)).toFixed(1)}×`
              : "—"
          }
          sub={
            kpis.propensity != null
              ? `flagged loans default ${formatPercent(kpis.propensity, 0)} of the time vs ${formatPercent(model?.base_default_rate ?? 0.039, 1)} for an average loan`
              : "flagged loans vs an average loan"
          }
          icon={Target}
          step="5"
          guidedTip="How much riskier a flagged loan (PD ≥ 16%) is than an average one, on the held-out test set: the share of flagged loans that default within 12 months divided by the base default rate. Read it against the base rate: an average loan defaults 3.9% of the time. A higher cut raises the hit rate but misses more defaults; the operating-point table on Model Governance shows the trade-off."
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
                <span className="text-[11px] text-muted-foreground tabular-nums">({filtered.length})</span>
              </Button>
              <div className="inline-flex items-center rounded border border-border/80 p-0.5 bg-muted/40 shrink-0">
                <button
                  type="button"
                  onClick={() => setViewMode("standard")}
                  className={cn(
                    "px-2 py-1 text-[11px] rounded transition-colors font-medium cursor-pointer",
                    viewMode === "standard"
                      ? "bg-background text-foreground shadow-xs font-semibold"
                      : "text-muted-foreground hover:text-foreground"
                  )}
                  title="Full 13-column portfolio view"
                >
                  Standard (13 col)
                </button>
                <button
                  type="button"
                  onClick={() => setViewMode("compact")}
                  className={cn(
                    "px-2 py-1 text-[11px] rounded transition-colors font-medium cursor-pointer",
                    viewMode === "compact"
                      ? "bg-background text-foreground shadow-xs font-semibold"
                      : "text-muted-foreground hover:text-foreground"
                  )}
                  title="Compact 7-column view (optimized for 14-inch branch laptops)"
                >
                  Compact (7 col)
                </button>
              </div>
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
                      ? "Urgent Action Queue (24h)"
                      : triageFilter === "watchlist"
                      ? "Covenant Watchlist (Weekly)"
                      : "Fast-Track Clean Renewals"}
                  </Badge>
                )}
                <span className="text-muted-foreground shrink-0">
                  — Showing <strong className="text-foreground tabular-nums">{filtered.length}</strong> of {borrowers.length} facilities
                </span>
                {triageFilter !== "all" && (
                  <span className="basis-full text-[11px] text-muted-foreground">{QUEUE_RULE[triageFilter]}</span>
                )}
                {query.trim() && (
                  <Badge variant="outline" className="text-[11px] bg-background truncate max-w-44">
                    Search: "{query}"
                  </Badge>
                )}
                {segmentFilter !== "all" && (
                  <Badge variant="outline" className="text-[11px] bg-background shrink-0">
                    Segment: {segmentFilter}
                  </Badge>
                )}
                {ragFilter !== "all" && (
                  <Badge variant="outline" className="text-[11px] bg-background shrink-0">
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
          <Table
            containerClassName="max-h-[520px] overflow-auto"
            className={viewMode === "compact" ? "min-w-[780px]" : "min-w-[1150px]"}
          >
            <TableHeader className="sticky top-0 bg-surface z-20 shadow-[0_1px_0_0_var(--color-border)]">
              {viewMode === "compact" ? (
                <TableRow>
                  <TableHead className="text-xs bg-surface pl-4">
                    <TableHeaderTip title="Loan / Facility ID" tip="Finacle facility number and MSME sector">
                      Loan ID & Sector
                    </TableHeaderTip>
                  </TableHead>
                  <TableHead className="text-xs bg-surface">Branch & State</TableHead>
                  <TableHead className="text-xs bg-surface text-right">
                    <TableHeaderTip title="Exposure at Default" tip="Sanctioned credit facility limit">
                      Limit (EAD)
                    </TableHeaderTip>
                  </TableHead>
                  <TableHead className="text-xs bg-surface text-right">
                    <TableHeaderTip title="12-Month PD" tip="Calibrated default probability">
                      PD (12m)
                    </TableHeaderTip>
                  </TableHead>
                  <TableHead className="text-xs bg-surface">
                    <TableHeaderTip title="Grade, RBI SMA and model watch" tip="Model grade (→ committee grade after an override). Second line: RBI SMA from days past due · the model's early-watch bucket from PD.">
                      Grade & SMA
                    </TableHeaderTip>
                  </TableHead>
                  <TableHead className="text-xs bg-surface">
                    <TableHeaderTip title="Asset Stage & RAG" tip="Ind AS 109 staging (1, 2, 3) and RAG operational status">
                      Stage & RAG
                    </TableHeaderTip>
                  </TableHead>
                  <TableHead className="text-xs bg-surface text-right pr-4">Action & Review</TableHead>
                </TableRow>
              ) : (
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
                      tip="Stage 1: performing; provision for the next 12 months. Stage 2: risk has risen materially since sanction, or 30+ days overdue; provision for the loan's lifetime. Stage 3: impaired, 90+ days overdue."
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
                      title="RBI SMA status and model early watch"
                      tip="Top line: RBI Special Mention Account status, from days past due only (Standard 0, SMA-0 1–30, SMA-1 31–60, SMA-2 61–90, NPA >90). Bottom line: the model's early-watch bucket, from the 12-month PD — a forecast, not a regulatory status."
                    >
                      RBI SMA / watch
                    </TableHeaderTip>
                  </TableHead>
                  <TableHead className="text-xs bg-surface text-right">
                    <TableHeaderTip
                      title="Exposure at Default (EAD)"
                      tip="Expected outstanding at default: drawn balance plus the share of the undrawn limit expected to be drawn before default."
                    >
                      EAD
                    </TableHeaderTip>
                  </TableHead>
                  <TableHead className="text-xs bg-surface text-right">
                    <TableHeaderTip
                      title="Expected Credit Loss (ECL)"
                      tip="Expected credit loss, staged: Stage 1 = 12-month PD × LGD × EAD; Stage 2 = lifetime PD × LGD × EAD; Stage 3 = credit-impaired, with the RBI provisioning floor applied. Indicative only; not a statutory provision."
                    >
                      ECL
                    </TableHeaderTip>
                  </TableHead>
                  <TableHead className="text-xs bg-surface text-right pr-4">
                    <TableHeaderTip
                      title="Credit Action / CAM Dossier"
                      tip="Jump to full Credit Assessment Memorandum (CAM) with the reasons behind the score, early-warning signals and what would bring the grade down."
                      side="left"
                    >
                      Action
                    </TableHeaderTip>
                  </TableHead>
                </TableRow>
              )}
            </TableHeader>
            <TableBody>
              {filtered.slice(0, 200).map((b) => (
                <BorrowerRow key={b.loan_id} b={b} viewMode={viewMode} />
              ))}
              {filtered.length === 0 && (
                <TableRow>
                  <TableCell colSpan={viewMode === "compact" ? 7 : 13} className="py-8 text-center text-xs text-muted-foreground">
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

function BorrowerRow({ b, viewMode = "standard" }: { b: BorrowerScore; viewMode?: "standard" | "compact" }) {
  const [copied, setCopied] = useState(false);
  const { user } = useRole();
  const rights = useDecisionRights(b.branch_code);
  const reviewer = user?.employeeId ? `${user.employeeId} (${user.name})` : user?.name || "UNIDENTIFIED_OFFICER";
  // One review status per account. The server value wins; with no API, the
  // latest decision kept on this browser (createDecision's offline record) fills in.
  const [status, setStatus] = useState<BorrowerScore["reviewed_status"]>(b.reviewed_status);
  useEffect(() => {
    const local = localReviewStatus(b.loan_id);
    setStatus(b.reviewed_status && b.reviewed_status !== "PENDING" ? b.reviewed_status : local ?? b.reviewed_status);
  }, [b.loan_id, b.reviewed_status]);
  const reviewed = status === "REVIEWED";
  const sarbEscalated = status === "FLAGGED_SARB";
  const restructured = status === "RESTRUCTURE";
  const deferred = status === "DEFERRED";
  const committeeHold = sarbEscalated || restructured || deferred;

  // The row tick is a quick "accept" decision: it goes through the same
  // /decisions path as the committee dialog, so it lands in the audit trail.
  // It cannot undo or overwrite a committee outcome; that needs the borrower page.
  const handleToggleReviewed = async (e: React.MouseEvent) => {
    e.stopPropagation();
    e.preventDefault();
    if (!rights.canDecide) {
      toast.info(rights.reason ?? "Review only", { duration: 2500 });
      return;
    }
    if (reviewed || committeeHold) {
      toast.info(`Open ${b.loan_id} to change its decision`, { duration: 1800 });
      return;
    }
    const res = await createDecision({
      loan_id: b.loan_id,
      segment: b.segment,
      decision: "accept",
      proposed_action: b.action,
      proposed_sma: b.sma_status,
      pd: b.pd,
      risk_grade: b.risk_grade,
      rationale: "Quick review from the portfolio queue: model grade accepted.",
      decided_by: reviewer,
      officer: reviewer,
    });
    if (!res) {
      toast.error(`Review of ${b.loan_id} not saved`);
      return;
    }
    setStatus("REVIEWED");
    toast.success(
      res === "persisted"
        ? `${b.loan_id} reviewed — logged to the audit trail`
        : `${b.loan_id} reviewed — saved on this browser only (API not reachable)`,
      { duration: 2000 },
    );
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

  const loanBadgeDetails = (
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
        <Badge variant="outline" className="text-[11px] px-1 py-0 h-4 border-emerald-500/40 text-emerald-600 bg-emerald-500/10 font-medium">
          ✓ Reviewed
        </Badge>
      )}
      {sarbEscalated && (
        <Badge variant="outline" className="text-[11px] px-1 py-0 h-4 border-rose-500/40 text-rose-600 bg-rose-500/10 font-medium">
          ⚠️ SARB
        </Badge>
      )}
      {restructured && (
        <Badge variant="outline" className="text-[11px] px-1 py-0 h-4 border-amber-500/40 text-amber-600 bg-amber-500/10 font-medium">
          📋 Restructuring review
        </Badge>
      )}
      {deferred && (
        <Badge variant="outline" className="text-[11px] px-1 py-0 h-4 border-sky-500/40 text-sky-600 bg-sky-500/10 font-medium">
          ⏸ Deferred
        </Badge>
      )}
      {b.segment === "msme_idbi" && (
        <Badge variant="outline" className="text-[11px] px-1 py-0 h-4 border-primary/40 text-primary font-normal">
          IDBI
        </Badge>
      )}
    </div>
  );

  // One plain sentence for any account not in the Green band.
  const whyLine =
    b.rag !== "Green" ? (
      <div className="mt-0.5 max-w-xs truncate text-[11px] text-muted-foreground" title={whyFlaggedLine(b, 5)}>
        Why: {whyFlaggedLine(b)}
      </div>
    ) : null;

  const actionButtons = (
    <div className="flex items-center justify-end gap-1">
      <button
        type="button"
        onClick={handleToggleReviewed}
        title={
          reviewed || committeeHold
            ? "Decision recorded; open the account to change it"
            : "Quick review: accept the model grade (logged to the audit trail)"
        }
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
  );

  if (viewMode === "compact") {
    return (
      <TableRow className="cursor-pointer transition-colors hover:bg-muted/60">
        <TableCell className="text-xs font-medium pl-4">
          <div className="space-y-1">
            {loanBadgeDetails}
            {whyLine}
            <div className="text-[11px] text-muted-foreground capitalize">
              {(b.sector ?? "—").replace(/_/g, " ")} {b.sub_segment ? `· ${b.sub_segment}` : ""}
            </div>
          </div>
        </TableCell>
        <TableCell className="text-xs">
          <div className="text-foreground truncate max-w-36" title={b.branch_name}>
            {b.branch_name ?? "—"}
          </div>
          <div className="text-[11px] text-muted-foreground">State: {b.state ?? "—"}</div>
        </TableCell>
        <TableCell className="text-xs text-right tabular-nums">
          <div className="font-semibold">{formatInrCompact(b.ead)}</div>
          <div className="text-[11px] text-muted-foreground">ECL: {formatInrCompact(b.ecl)}</div>
        </TableCell>
        <TableCell className="text-xs text-right tabular-nums">
          <Badge variant="outline" className={`${pdTone(b.pd)} font-normal tabular-nums`}>
            {formatPercent(b.pd, 1)}
          </Badge>
        </TableCell>
        <TableCell className="text-xs">
          <div className="font-semibold">
            {b.risk_grade}
            {b.committee_grade && (
              <span className="ml-1 text-amber-600 dark:text-amber-400" title="Committee override; the model grade is shown first">
                → {b.committee_grade}
              </span>
            )}
          </div>
          <div className="text-[11px] text-muted-foreground">
            {rbiSma(dpdOf(b)) ?? "—"} · {watchLabel(b.sma_status)}
          </div>
        </TableCell>
        <TableCell className="text-xs">
          <div className="flex items-center gap-1.5 flex-wrap">
            <Badge
              variant="outline"
              className={`font-normal text-[11px] px-1 py-0 whitespace-nowrap ${
                (b.ecl_stage ?? 1) === 1
                  ? "bg-band-a/10 text-band-a border-band-a/30"
                  : (b.ecl_stage ?? 1) === 2
                  ? "bg-band-c/10 text-band-c border-band-c/30"
                  : "bg-band-d/10 text-band-d border-band-d/30"
              }`}
            >
              Stage {b.ecl_stage ?? 1}
            </Badge>
            <Badge variant="outline" className={`${ragTone[b.rag]} font-normal text-[11px] px-1 py-0`}>
              {b.rag}
            </Badge>
          </div>
        </TableCell>
        <TableCell className="text-xs text-right pr-4">
          {actionButtons}
        </TableCell>
      </TableRow>
    );
  }

  return (
    <TableRow className="cursor-pointer transition-colors hover:bg-muted/60">
      <TableCell className="text-xs font-medium pl-4">
        {loanBadgeDetails}
        {whyLine}
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
      <TableCell className="text-xs font-medium">
        {b.risk_grade}
        {b.committee_grade && (
          <span className="ml-1 text-amber-600 dark:text-amber-400" title="Committee override; the model grade is shown first">
            → {b.committee_grade}
          </span>
        )}
      </TableCell>
      <TableCell className="text-xs">
        <Badge
          variant="outline"
          className={`font-normal text-[11px] px-1.5 py-0 whitespace-nowrap ${
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
      <TableCell className="text-xs whitespace-nowrap" title={b.action}>
        <div className="font-medium">
          {rbiSma(dpdOf(b)) ?? "—"}
          {(dpdOf(b) ?? 0) > 0 && <span className="text-muted-foreground font-normal"> · {dpdOf(b)}d</span>}
        </div>
        <div className="text-[11px] text-muted-foreground">{watchLabel(b.sma_status)}</div>
      </TableCell>
      <TableCell className="text-xs text-right tabular-nums">{formatInrCompact(b.ead)}</TableCell>
      <TableCell className="text-xs text-right tabular-nums">{formatInrCompact(b.ecl)}</TableCell>
      <TableCell className="text-xs text-right pr-4">
        {actionButtons}
      </TableCell>
    </TableRow>
  );
}

// Snapshot is imported statically in lib/api; this helper just surfaces its card.
import { getSnapshot } from "@/lib/api";
function getSnapshotMeta() {
  return getSnapshot().model_card;
}
