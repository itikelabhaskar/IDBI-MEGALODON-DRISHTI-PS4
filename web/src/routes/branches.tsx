import { Fragment, useMemo, useState, useEffect } from "react";
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
import { cn } from "@/lib/utils";
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
import { listBranches, fetchBranches, getSnapshot } from "@/lib/api";
import { formatInrCompact, formatPercent, ragHex } from "@/lib/format";
import type { BranchSummary } from "@/lib/types";
import {
  Search,
  Building2,
  ChevronRight,
  ChevronDown,
  TriangleAlert,
  Info,
  ArrowUpRight,
  ArrowDown,
  ArrowUpDown,
  ChevronsUpDown,
  Sparkles,
} from "lucide-react";
import { Button } from "@/components/ui/button";
import {
  GuidedTooltip,
  HintIcon,
} from "@/components/drishti/guided-tooltip";

export const Route = createFileRoute("/branches")({
  loader: async () => {
    const branches = await fetchBranches();
    return { branches };
  },
  component: BranchNetwork,
});

type SortKey = "avg_pd" | "flag_rate" | "ecl" | "accounts";

/** Zone → region → branches, preserving the riskiest-first order within each. */
function groupByZone(rows: BranchSummary[]) {
  const zones = new Map<string, Map<string, BranchSummary[]>>();
  for (const b of rows) {
    if (!zones.has(b.zone)) zones.set(b.zone, new Map());
    const regions = zones.get(b.zone)!;
    if (!regions.has(b.region)) regions.set(b.region, []);
    regions.get(b.region)!.push(b);
  }
  return zones;
}

function agg(rows: BranchSummary[]) {
  const accounts = rows.reduce((s, b) => s + b.accounts, 0);
  const flagged = rows.reduce((s, b) => s + b.flagged, 0);
  return {
    branches: rows.length,
    accounts,
    flagged,
    flagRate: accounts ? flagged / accounts : 0,
    // Account-weighted, not a mean of means — branches differ in size.
    avgPd: accounts ? rows.reduce((s, b) => s + b.avg_pd * b.accounts, 0) / accounts : 0,
    ecl: rows.reduce((s, b) => s + b.ecl, 0),
    red: rows.reduce((s, b) => s + b.red, 0),
  };
}

/** Proportional Green/Amber/Red strip — the RAG mix at a glance. */
function RagBar({ b }: { b: BranchSummary }) {
  const total = Math.max(b.green + b.amber + b.red, 1);
  const seg = [
    { v: b.green, c: ragHex.Green },
    { v: b.amber, c: ragHex.Amber },
    { v: b.red, c: ragHex.Red },
  ];
  return (
    <div
      className="flex h-2 w-24 overflow-hidden rounded-full bg-muted"
      title={`${b.green} green · ${b.amber} amber · ${b.red} red`}
    >
      {seg.map((s, i) =>
        s.v > 0 ? (
          <div key={i} style={{ width: `${(s.v / total) * 100}%`, background: s.c }} />
        ) : null,
      )}
    </div>
  );
}

function BranchNetwork() {
  const loaderData = Route.useLoaderData();
  const [branches, setBranches] = useState<BranchSummary[]>(
    loaderData?.branches && loaderData.branches.length > 0 ? loaderData.branches : listBranches(),
  );
  const [isLive, setIsLive] = useState(false);
  const threshold = getSnapshot().model_card.threshold;

  useEffect(() => {
    let active = true;
    fetchBranches().then((res) => {
      if (active && res && res.length > 0) {
        setBranches(res);
        setIsLive(true);
      }
    });
    return () => {
      active = false;
    };
  }, []);

  const [query, setQuery] = useState("");
  const [zoneFilter, setZoneFilter] = useState("all");
  const [sortKey, setSortKey] = useState<SortKey>("avg_pd");
  const [open, setOpen] = useState<Record<string, boolean>>({});
  const [highlightedBranch, setHighlightedBranch] = useState<string | null>(null);
  const [allExpanded, setAllExpanded] = useState<boolean>(true);

  const zones = useMemo(
    () => ["all", ...Array.from(new Set(branches.map((b) => b.zone))).sort()],
    [branches],
  );

  const filtered = useMemo(() => {
    let rows = branches;
    if (zoneFilter !== "all") rows = rows.filter((b) => b.zone === zoneFilter);
    if (query.trim()) {
      const q = query.trim().toLowerCase();
      rows = rows.filter(
        (b) =>
          b.branch_name.toLowerCase().includes(q) ||
          b.branch_code.includes(q) ||
          b.region.toLowerCase().includes(q),
      );
    }
    return [...rows].sort((a, b) => b[sortKey] - a[sortKey]);
  }, [branches, query, zoneFilter, sortKey]);

  const grouped = useMemo(() => groupByZone(filtered), [filtered]);
  const totals = useMemo(() => agg(filtered), [filtered]);
  // Always select highest-risk branch based on avg_pd regardless of current table sorting
  const worst = useMemo(() => {
    if (filtered.length === 0) return null;
    return [...filtered].sort((a, b) => b.avg_pd - a.avg_pd)[0];
  }, [filtered]);

  const handleScrollToWorst = () => {
    if (!worst) return;
    setOpen((prev) => ({
      ...prev,
      [`z:${worst.zone}`]: true,
      [`r:${worst.zone}:${worst.region}`]: true,
    }));
    setHighlightedBranch(worst.branch_code);
    setTimeout(() => {
      const row = document.getElementById(`branch-row-${worst.branch_code}`);
      if (row) {
        row.scrollIntoView({ behavior: "smooth", block: "center" });
      } else {
        const table = document.getElementById("branch-table-container");
        if (table) table.scrollIntoView({ behavior: "smooth", block: "start" });
      }
    }, 100);
    setTimeout(() => setHighlightedBranch(null), 4000);
  };

  const handleSort = (key: SortKey) => {
    setSortKey(key);
    const table = document.getElementById("branch-table-container");
    if (table) table.scrollIntoView({ behavior: "smooth", block: "start" });
  };

  const toggleExpandAll = () => {
    const nextState = !allExpanded;
    setAllExpanded(nextState);
    const nextOpen: Record<string, boolean> = {};
    for (const [zone, regions] of grouped.entries()) {
      nextOpen[`z:${zone}`] = nextState;
      for (const region of regions.keys()) {
        nextOpen[`r:${zone}:${region}`] = nextState;
      }
    }
    setOpen(nextOpen);
  };

  if (branches.length === 0) {
    return (
      <div className="p-6">
        <p className="text-sm text-muted-foreground">
          No branch rollup in the snapshot. Rebuild it with{" "}
          <code className="rounded bg-muted px-1 py-0.5 text-xs">
            uv run python -m src.pipelines.make_ui_snapshot
          </code>
          .
        </p>
      </div>
    );
  }

  return (
    <div className="space-y-6 p-4 md:p-6">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <div className="flex flex-wrap items-center gap-2 text-[10px] uppercase tracking-widest text-muted-foreground">
            <span>Zone → Region → Branch · {totals.accounts.toLocaleString("en-IN")} accounts</span>
            <Badge
              variant="outline"
              className={
                isLive
                  ? "border-emerald-500/40 text-emerald-600 bg-emerald-500/10 font-medium text-[9px] px-1.5 py-0 h-4"
                  : "border-muted-foreground/30 text-muted-foreground font-normal text-[9px] px-1.5 py-0 h-4"
              }
            >
              {isLive ? "Live Branch Rollup (RDS / SQLite)" : "Snapshot Rollup"}
            </Badge>
          </div>
          <h1 className="mt-1 text-xl font-semibold text-foreground">Branch Network</h1>
          <p className="mt-0.5 text-sm text-muted-foreground">
            Where the stress sits in the network — and which branch to take it up with.
          </p>
        </div>
      </div>

      {/* Summary strip: 5-Card Grid with Active Sort Highlights */}
      <div className="grid gap-3 sm:grid-cols-2 md:grid-cols-3 xl:grid-cols-5">
        <GuidedTooltip content="Total operational IDBI branches in view across selected zonal filters.">
          <Card className="bg-surface transition-shadow hover:shadow-sm">
            <CardContent className="pt-5">
              <div className="text-[10px] uppercase tracking-widest text-muted-foreground flex items-center gap-1">
                Branches in view
                <HintIcon text="Count of branches currently matching search and zone criteria." />
              </div>
              <div className="mt-1 text-2xl font-semibold tabular-nums">{totals.branches}</div>
              <div className="mt-0.5 text-[11px] text-muted-foreground">
                {totals.accounts.toLocaleString("en-IN")} accounts
              </div>
            </CardContent>
          </Card>
        </GuidedTooltip>

        <GuidedTooltip content="Exposure-weighted 12-month Probability of Default across all commercial borrowers in the filtered network. Click to sort branches by highest PD.">
          <Card
            className={cn(
              "bg-surface cursor-pointer transition-all hover:border-primary/50 hover:shadow-sm group",
              sortKey === "avg_pd" && "border-primary bg-primary/5 ring-1 ring-primary/40",
            )}
            onClick={() => handleSort("avg_pd")}
          >
            <CardContent className="pt-5">
              <div className="text-[10px] uppercase tracking-widest text-muted-foreground flex items-center justify-between">
                <span>Average PD</span>
                <span className={cn(
                  "text-[9px] font-normal text-primary transition-opacity",
                  sortKey === "avg_pd" ? "opacity-100 font-semibold" : "opacity-0 group-hover:opacity-100"
                )}>
                  {sortKey === "avg_pd" ? "✓ Sorted" : "Sort table ↓"}
                </span>
              </div>
              <div className="mt-1 text-2xl font-semibold tabular-nums text-foreground group-hover:text-primary transition-colors">
                {formatPercent(totals.avgPd, 2)}
              </div>
              <div className="mt-0.5 text-[11px] text-muted-foreground">
                portfolio weighted avg
              </div>
            </CardContent>
          </Card>
        </GuidedTooltip>

        <GuidedTooltip content="Accounts with 12-month PD ≥ cutoff threshold (16%). Click to sort branches by highest flag rate.">
          <Card
            className={cn(
              "bg-surface cursor-pointer transition-all hover:border-amber-500/50 hover:shadow-sm group",
              sortKey === "flag_rate" && "border-amber-500 bg-amber-500/5 ring-1 ring-amber-500/40",
            )}
            onClick={() => handleSort("flag_rate")}
          >
            <CardContent className="pt-5">
              <div className="text-[10px] uppercase tracking-widest text-muted-foreground flex items-center justify-between">
                <span>Stressed accounts</span>
                <span className={cn(
                  "text-[9px] font-normal text-amber-600 transition-opacity",
                  sortKey === "flag_rate" ? "opacity-100 font-semibold" : "opacity-0 group-hover:opacity-100"
                )}>
                  {sortKey === "flag_rate" ? "✓ Sorted" : "Sort table ↓"}
                </span>
              </div>
              <div className="mt-1 text-2xl font-semibold tabular-nums text-amber-600 dark:text-amber-400">
                {totals.flagged.toLocaleString("en-IN")}
              </div>
              <div className="mt-0.5 text-[11px] text-muted-foreground">
                {formatPercent(totals.flagRate, 1)} at PD ≥ {formatPercent(threshold)}
              </div>
            </CardContent>
          </Card>
        </GuidedTooltip>

        <GuidedTooltip content="Total Ind AS 109 Expected Credit Loss impairment reserve required across all active facilities. Click to sort by ECL.">
          <Card
            className={cn(
              "bg-surface cursor-pointer transition-all hover:border-rose-500/50 hover:shadow-sm group",
              sortKey === "ecl" && "border-rose-500 bg-rose-500/5 ring-1 ring-rose-500/40",
            )}
            onClick={() => handleSort("ecl")}
          >
            <CardContent className="pt-5">
              <div className="text-[10px] uppercase tracking-widest text-muted-foreground flex items-center justify-between">
                <span>Expected credit loss</span>
                <span className={cn(
                  "text-[9px] font-normal text-rose-600 transition-opacity",
                  sortKey === "ecl" ? "opacity-100 font-semibold" : "opacity-0 group-hover:opacity-100"
                )}>
                  {sortKey === "ecl" ? "✓ Sorted" : "Sort table ↓"}
                </span>
              </div>
              <div className="mt-1 text-2xl font-semibold tabular-nums text-rose-600 dark:text-rose-400">
                {formatInrCompact(totals.ecl)}
              </div>
              <div className="mt-0.5 text-[11px] text-muted-foreground">
                Stage 1, 2 & 3 total
              </div>
            </CardContent>
          </Card>
        </GuidedTooltip>

        <GuidedTooltip content="Urgent Supervisory Action: Highest-risk branch in portfolio. Click to scroll down, expand hierarchy, and inspect this branch in the table below.">
          <Card
            className="bg-surface border-band-d/40 cursor-pointer transition-all hover:border-band-d hover:shadow-md active:scale-[0.99] group relative overflow-hidden"
            onClick={handleScrollToWorst}
          >
            <CardContent className="pt-5">
              <div className="flex items-start justify-between">
                <div className="min-w-0">
                  <div className="flex items-center gap-1.5 text-[10px] uppercase tracking-widest text-band-d font-semibold">
                    <span>Needs attention first</span>
                    <span className="text-[9px] px-1.5 py-0.2 rounded bg-band-d/10 border border-band-d/30 group-hover:bg-band-d group-hover:text-white transition-colors">
                      Scroll to branch ↓
                    </span>
                  </div>
                  <div className="mt-1 truncate text-sm font-semibold text-foreground group-hover:text-band-d transition-colors" title={worst?.branch_name}>
                    {worst?.branch_name ?? "—"}
                  </div>
                  <div className="mt-0.5 text-[11px] text-muted-foreground">
                    {worst ? `avg PD ${formatPercent(worst.avg_pd, 2)} · ${worst.zone}` : "No matching branch"}
                  </div>
                </div>
                <TriangleAlert className="h-4.5 w-4.5 shrink-0 text-band-d animate-pulse" />
              </div>
            </CardContent>
          </Card>
        </GuidedTooltip>
      </div>

      {/* Urgent Supervisory Action Alert Banner */}
      {worst && (
        <GuidedTooltip content="Urgent Supervisory Queue: Highlights the branch with the highest credit default risk in current view. Click to expand hierarchical region tree and smooth-scroll to this branch.">
          <div
            onClick={handleScrollToWorst}
            className="flex items-center justify-between p-3 rounded-lg border border-band-d/40 bg-band-d/10 text-band-d cursor-pointer hover:bg-band-d/15 transition-all shadow-sm group"
          >
            <div className="flex items-center gap-2.5 text-xs font-medium">
              <TriangleAlert className="h-4 w-4 shrink-0 text-band-d animate-pulse" />
              <span>
                <strong>Urgent Supervisory Action:</strong> Branch <strong>{worst.branch_name}</strong> ({worst.branch_code} · {worst.zone} zone) carries highest average PD at <strong>{formatPercent(worst.avg_pd, 2)}</strong> ({worst.flagged} flagged accounts, {formatInrCompact(worst.ecl)} ECL).
              </span>
            </div>
            <span className="text-[11px] font-semibold text-band-d group-hover:underline flex items-center gap-1 shrink-0">
              Expand & Scroll to Branch ↓
            </span>
          </div>
        </GuidedTooltip>
      )}

      {/* Controls */}
      <Card id="branch-table-container" className="bg-surface scroll-mt-20">
        <CardHeader className="pb-3">
          <div className="flex flex-wrap items-center justify-between gap-3">
            <div className="min-w-0 flex-1 basis-48">
              <CardTitle className="flex items-center gap-1.5 text-sm">
                <Building2 className="h-4 w-4 text-primary" />
                Branch Performance Roster
              </CardTitle>
              <CardDescription className="text-xs">
                Grouped by zone and region. Click any branch to filter its accounts in the watchlist.
              </CardDescription>
            </div>
            <div className="flex flex-wrap items-center gap-2">
              <div className="relative w-full sm:w-56">
                <Search className="pointer-events-none absolute left-2.5 top-1/2 h-3.5 w-3.5 -translate-y-1/2 text-muted-foreground" />
                <Input
                  value={query}
                  onChange={(e) => setQuery(e.target.value)}
                  placeholder="Search branch, code, region…"
                  className="h-8 pl-8 text-xs"
                />
              </div>
              <Select value={zoneFilter} onValueChange={setZoneFilter}>
                <SelectTrigger className="h-8 w-36 text-xs">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  {zones.map((z) => (
                    <SelectItem key={z} value={z}>
                      {z === "all" ? "All zones" : z}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
              <Button
                variant="outline"
                size="sm"
                onClick={toggleExpandAll}
                className="h-8 text-xs gap-1"
                title="Expand or collapse all zones and regions"
              >
                <ChevronsUpDown className="h-3.5 w-3.5" />
                {allExpanded ? "Collapse All" : "Expand All"}
              </Button>
            </div>
          </div>

          {/* Interactive Sort Dynamics Bar */}
          <div className="mt-3 pt-3 border-t border-border/60 flex flex-wrap items-center justify-between gap-2 text-xs">
            <div className="flex items-center gap-1 text-[11px] text-muted-foreground">
              <span className="font-medium text-foreground">Sort Priority:</span>
            </div>
            <div className="flex flex-wrap items-center gap-1.5">
              <GuidedTooltip content="Sort branches by exposure-weighted average PD to identify severe risk concentrations">
                <button
                  type="button"
                  onClick={() => setSortKey("avg_pd")}
                  className={`px-2.5 py-1 rounded-md text-[11px] font-medium border transition-colors ${
                    sortKey === "avg_pd"
                      ? "bg-primary text-primary-foreground border-primary"
                      : "bg-muted/40 text-muted-foreground border-border hover:text-foreground"
                  }`}
                >
                  Highest Avg PD
                </button>
              </GuidedTooltip>
              <GuidedTooltip content="Sort branches by percentage of accounts breaching early warning threshold">
                <button
                  type="button"
                  onClick={() => setSortKey("flag_rate")}
                  className={`px-2.5 py-1 rounded-md text-[11px] font-medium border transition-colors ${
                    sortKey === "flag_rate"
                      ? "bg-primary text-primary-foreground border-primary"
                      : "bg-muted/40 text-muted-foreground border-border hover:text-foreground"
                  }`}
                >
                  Most Flagged (%)
                </button>
              </GuidedTooltip>
              <GuidedTooltip content="Sort branches by absolute Ind AS 109 Expected Credit Loss provision">
                <button
                  type="button"
                  onClick={() => setSortKey("ecl")}
                  className={`px-2.5 py-1 rounded-md text-[11px] font-medium border transition-colors ${
                    sortKey === "ecl"
                      ? "bg-primary text-primary-foreground border-primary"
                      : "bg-muted/40 text-muted-foreground border-border hover:text-foreground"
                  }`}
                >
                  Largest ECL (₹)
                </button>
              </GuidedTooltip>
              <GuidedTooltip content="Sort branches by total active sanctioned facility volume">
                <button
                  type="button"
                  onClick={() => setSortKey("accounts")}
                  className={`px-2.5 py-1 rounded-md text-[11px] font-medium border transition-colors ${
                    sortKey === "accounts"
                      ? "bg-primary text-primary-foreground border-primary"
                      : "bg-muted/40 text-muted-foreground border-border hover:text-foreground"
                  }`}
                >
                  Most Accounts
                </button>
              </GuidedTooltip>
            </div>
          </div>
        </CardHeader>

        <CardContent className="p-0">
          <Table containerClassName="max-h-[620px] overflow-auto" className="min-w-[960px]">
            <TableHeader className="sticky top-0 z-20 bg-surface shadow-[0_1px_0_0_var(--color-border)]">
              <TableRow>
                <TableHead className="text-xs bg-surface pl-4">
                  <span className="inline-flex items-center gap-1">
                    Zone / Region / Branch
                    <HintIcon text="Hierarchical operational tree: Controlling Zonal Office → Regional Office → Operating Branch." />
                  </span>
                </TableHead>
                <TableHead className="text-xs bg-surface">
                  <span className="inline-flex items-center gap-1">
                    Code
                    <HintIcon text="Finacle Branch SOL ID." />
                  </span>
                </TableHead>
                <TableHead
                  className={cn(
                    "text-xs text-right cursor-pointer hover:text-primary transition-colors select-none bg-surface",
                    sortKey === "accounts" && "bg-primary/10 text-primary font-semibold",
                  )}
                  onClick={() => handleSort("accounts")}
                  title="Click to sort by accounts volume"
                >
                  <GuidedTooltip content="Total active commercial credit facilities under this operational unit. Click to sort.">
                    <span className="inline-flex items-center gap-1 justify-end w-full">
                      Accounts {sortKey === "accounts" && <ArrowDown className="h-3 w-3 text-primary" />}
                    </span>
                  </GuidedTooltip>
                </TableHead>
                <TableHead
                  className={cn(
                    "text-xs text-right cursor-pointer hover:text-primary transition-colors select-none bg-surface",
                    sortKey === "avg_pd" && "bg-primary/10 text-primary font-semibold",
                  )}
                  onClick={() => handleSort("avg_pd")}
                  title="Click to sort by Average PD"
                >
                  <GuidedTooltip content="Exposure-weighted 12-month Probability of Default predicted by LightGBM model. Click to sort.">
                    <span className="inline-flex items-center gap-1 justify-end w-full">
                      Avg PD {sortKey === "avg_pd" && <ArrowDown className="h-3 w-3 text-primary" />}
                    </span>
                  </GuidedTooltip>
                </TableHead>
                <TableHead
                  className={cn(
                    "text-xs text-right cursor-pointer hover:text-primary transition-colors select-none bg-surface",
                    sortKey === "flag_rate" && "bg-primary/10 text-primary font-semibold",
                  )}
                  onClick={() => handleSort("flag_rate")}
                  title="Click to sort by Flagged rate"
                >
                  <GuidedTooltip content="Borrowers exceeding the early-warning PD cutoff threshold (≥ 16%). Click to sort.">
                    <span className="inline-flex items-center gap-1 justify-end w-full">
                      Flagged {sortKey === "flag_rate" && <ArrowDown className="h-3 w-3 text-primary" />}
                    </span>
                  </GuidedTooltip>
                </TableHead>
                <TableHead className="text-xs bg-surface">
                  <span className="inline-flex items-center gap-1">
                    RAG mix
                    <HintIcon text="Green: PD < 5% | Amber: 5% ≤ PD < 16% | Red: PD ≥ 16%" />
                  </span>
                </TableHead>
                <TableHead
                  className={cn(
                    "text-xs text-right cursor-pointer hover:text-primary transition-colors select-none bg-surface",
                    sortKey === "ecl" && "bg-primary/10 text-primary font-semibold",
                  )}
                  onClick={() => handleSort("ecl")}
                  title="Click to sort by Ind AS 109 ECL"
                >
                  <GuidedTooltip content="Ind AS 109 3-stage Expected Credit Loss impairment reserve in INR. Click to sort.">
                    <span className="inline-flex items-center gap-1 justify-end w-full">
                      ECL {sortKey === "ecl" && <ArrowDown className="h-3 w-3 text-primary" />}
                    </span>
                  </GuidedTooltip>
                </TableHead>
                <TableHead className="text-xs text-right bg-surface pr-4">
                  <GuidedTooltip content="Realised 12-month default rate observed in historical out-of-time validation test cohort.">
                    <span className="inline-flex items-center gap-1 justify-end w-full cursor-help">
                      Realised
                      <HintIcon text="12-month actual empirical default rate in the held-out validation cohort." />
                    </span>
                  </GuidedTooltip>
                </TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {[...grouped.entries()].map(([zone, regions]) => {
                const zoneRows = [...regions.values()].flat();
                const z = agg(zoneRows);
                const zKey = `z:${zone}`;
                const zOpen = open[zKey] !== false; // default expanded
                return (
                  <ZoneBlock
                    key={zone}
                    zone={zone}
                    z={z}
                    zOpen={zOpen}
                    onToggle={() => setOpen((o) => ({ ...o, [zKey]: !zOpen }))}
                    regions={regions}
                    open={open}
                    setOpen={setOpen}
                    highlightedBranch={highlightedBranch}
                    sortKey={sortKey}
                  />
                );
              })}
              {filtered.length === 0 && (
                <TableRow>
                  <TableCell colSpan={8} className="py-8 text-center text-xs text-muted-foreground">
                    No branches match the current filters.
                  </TableCell>
                </TableRow>
              )}
            </TableBody>
          </Table>
        </CardContent>
      </Card>

      <p className="flex items-start gap-1.5 text-[11px] leading-relaxed text-muted-foreground">
        <Info className="mt-0.5 h-3.5 w-3.5 shrink-0" />
        <span>
          Branch placement is a synthetic overlay on the demo book — there is no true
          branch effect to find, so the spread here reflects borrower mix, not branch
          performance. It demonstrates the controlling-office drill-down; against sandbox
          data the branch code arrives on the loan master and these become real. Branch is
          never a model input.
        </span>
      </p>
    </div>
  );
}

function ZoneBlock({
  zone,
  z,
  zOpen,
  onToggle,
  regions,
  open,
  setOpen,
  highlightedBranch,
  sortKey,
}: {
  zone: string;
  z: ReturnType<typeof agg>;
  zOpen: boolean;
  onToggle: () => void;
  regions: Map<string, BranchSummary[]>;
  open: Record<string, boolean>;
  setOpen: React.Dispatch<React.SetStateAction<Record<string, boolean>>>;
  highlightedBranch?: string | null;
  sortKey: SortKey;
}) {
  return (
    <>
      <TableRow className="cursor-pointer bg-muted/40 hover:bg-muted/60" onClick={onToggle}>
        <TableCell className="text-xs font-semibold">
          <span className="flex items-center gap-1">
            {zOpen ? (
              <ChevronDown className="h-3.5 w-3.5" />
            ) : (
              <ChevronRight className="h-3.5 w-3.5" />
            )}
            {zone} zone
            <span className="ml-1 font-normal text-muted-foreground">
              · {z.branches} branches
            </span>
          </span>
        </TableCell>
        <TableCell />
        <TableCell className={cn("text-xs text-right font-medium tabular-nums", sortKey === "accounts" && "bg-primary/5 font-semibold text-primary")}>
          {z.accounts.toLocaleString("en-IN")}
        </TableCell>
        <TableCell className={cn("text-xs text-right font-medium tabular-nums", sortKey === "avg_pd" && "bg-primary/5 font-semibold text-primary")}>
          {formatPercent(z.avgPd, 2)}
        </TableCell>
        <TableCell className={cn("text-xs text-right font-medium tabular-nums", sortKey === "flag_rate" && "bg-primary/5 font-semibold text-primary")}>
          {z.flagged} ({formatPercent(z.flagRate, 1)})
        </TableCell>
        <TableCell />
        <TableCell className={cn("text-xs text-right font-medium tabular-nums", sortKey === "ecl" && "bg-primary/5 font-semibold text-primary")}>
          {formatInrCompact(z.ecl)}
        </TableCell>
        <TableCell />
      </TableRow>

      {zOpen &&
        [...regions.entries()].map(([region, rows]) => {
          const r = agg(rows);
          const rKey = `r:${zone}:${region}`;
          const rOpen = open[rKey] !== false;
          return (
            <Fragment key={rKey}>
              <TableRow
                className="cursor-pointer hover:bg-muted/40"
                onClick={() => setOpen((o) => ({ ...o, [rKey]: !rOpen }))}
              >
                <TableCell className="pl-8 text-xs font-medium">
                  <span className="flex items-center gap-1">
                    {rOpen ? (
                      <ChevronDown className="h-3 w-3" />
                    ) : (
                      <ChevronRight className="h-3 w-3" />
                    )}
                    {region}
                    <span className="ml-1 font-normal text-muted-foreground">
                      · {r.branches}
                    </span>
                  </span>
                </TableCell>
                <TableCell />
                <TableCell className={cn("text-xs text-right tabular-nums", sortKey === "accounts" && "bg-primary/5 font-semibold text-primary")}>
                  {r.accounts.toLocaleString("en-IN")}
                </TableCell>
                <TableCell className={cn("text-xs text-right tabular-nums", sortKey === "avg_pd" && "bg-primary/5 font-semibold text-primary")}>
                  {formatPercent(r.avgPd, 2)}
                </TableCell>
                <TableCell className={cn("text-xs text-right tabular-nums", sortKey === "flag_rate" && "bg-primary/5 font-semibold text-primary")}>
                  {formatPercent(r.flagRate, 1)}
                </TableCell>
                <TableCell />
                <TableCell className={cn("text-xs text-right tabular-nums", sortKey === "ecl" && "bg-primary/5 font-semibold text-primary")}>
                  {formatInrCompact(r.ecl)}
                </TableCell>
                <TableCell />
              </TableRow>

              {rOpen &&
                rows.map((b) => {
                  const isHighlighted = b.branch_code === highlightedBranch;
                  return (
                    <TableRow
                      key={b.branch_code}
                      id={`branch-row-${b.branch_code}`}
                      className={cn(
                        "hover:bg-muted/60 transition-colors scroll-mt-12",
                        isHighlighted && "bg-band-d/20 ring-2 ring-band-d animate-pulse font-medium",
                      )}
                    >
                      <TableCell className="pl-14 text-xs">
                        <GuidedTooltip
                          content={`1-Click Deep Link: Filter entire Portfolio Watchlist to only accounts in ${b.branch_name} (${b.branch_code})`}
                        >
                          <Link
                            to="/"
                            search={{ branch: b.branch_code }}
                            viewTransition
                            className="hover:text-primary hover:underline inline-flex items-center gap-1.5 group font-medium"
                          >
                            <span>{b.branch_name}</span>
                            <span className="text-[10px] px-1.5 py-0.2 rounded bg-primary/10 text-primary border border-primary/20 opacity-0 group-hover:opacity-100 transition-opacity flex items-center gap-0.5">
                              Filter ↗
                            </span>
                          </Link>
                        </GuidedTooltip>
                      </TableCell>
                      <TableCell className="text-xs tabular-nums text-muted-foreground">
                        {b.branch_code}
                      </TableCell>
                      <TableCell className={cn("text-xs text-right tabular-nums", sortKey === "accounts" && "bg-primary/5 font-semibold text-primary")}>
                        {b.accounts}
                      </TableCell>
                      <TableCell className={cn("text-xs text-right tabular-nums", sortKey === "avg_pd" && "bg-primary/5 font-semibold text-primary")}>
                        <Badge
                          variant="outline"
                          className={cn(
                            "border-border bg-transparent font-normal tabular-nums",
                            sortKey === "avg_pd" && "border-primary text-primary font-medium",
                          )}
                        >
                          {formatPercent(b.avg_pd, 2)}
                        </Badge>
                      </TableCell>
                      <TableCell className={cn("text-xs text-right tabular-nums", sortKey === "flag_rate" && "bg-primary/5 font-semibold text-primary")}>
                        {b.flagged} ({formatPercent(b.flag_rate, 1)})
                      </TableCell>
                      <TableCell>
                        <RagBar b={b} />
                      </TableCell>
                      <TableCell className={cn("text-xs text-right tabular-nums", sortKey === "ecl" && "bg-primary/5 font-semibold text-primary")}>
                        {formatInrCompact(b.ecl)}
                      </TableCell>
                      <TableCell
                        className="text-xs text-right tabular-nums text-muted-foreground"
                        title="Realised 12-month default rate in the held-out cohort"
                      >
                        {formatPercent(b.actual_default_rate, 1)}
                      </TableCell>
                    </TableRow>
                  );
                })}
            </Fragment>
          );
        })}
    </>
  );
}
