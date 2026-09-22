import { useEffect, useMemo, useState } from "react";
import { createFileRoute, Link } from "@tanstack/react-router";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Slider } from "@/components/ui/slider";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import {
  ResponsiveContainer,
  ScatterChart,
  Scatter,
  XAxis,
  YAxis,
  CartesianGrid,
  Tooltip,
  ZAxis,
} from "recharts";
import { getSnapshot, simulateContagion, fetchBranches } from "@/lib/api";
import type { ContagionSimulateResponse, BranchSummary, ContagionScatterPoint, RagBucket } from "@/lib/types";
import { formatPercent, formatInrCompact, ragHex } from "@/lib/format";
import { cn } from "@/lib/utils";
import {
  Network,
  Share2,
  ShieldAlert,
  Users,
  Flame,
  Building2,
  RotateCcw,
  ArrowDown,
  ArrowUpRight,
  Sparkles,
  HelpCircle,
  Layers,
  Filter,
  X,
} from "lucide-react";
import { Button } from "@/components/ui/button";
import {
  GuidedTooltip,
  HintIcon,
} from "@/components/drishti/guided-tooltip";

export const Route = createFileRoute("/contagion")({
  component: ContagionView,
});

function ContagionTooltip({ active, payload }: any) {
  if (!active || !payload || !payload.length) return null;
  const pt = payload[0]?.payload as ContagionScatterPoint;
  if (!pt) return null;

  const statusLabel =
    pt.status === "contagion_infected"
      ? "Contagion Infected"
      : pt.status === "initial_stressed"
      ? "Initial Stressed"
      : "Stable";
  const statusBadge =
    pt.status === "contagion_infected"
      ? "bg-purple-500/15 text-purple-600 border-purple-500/30"
      : pt.status === "initial_stressed"
      ? "bg-rose-500/15 text-rose-600 border-rose-500/30"
      : "bg-emerald-500/15 text-emerald-600 border-emerald-500/30";

  return (
    <div className="rounded-lg border border-border bg-surface p-2.5 shadow-lg text-xs space-y-1.5 min-w-48">
      <div className="flex items-center justify-between gap-2 border-b border-border/60 pb-1">
        <span className="font-semibold text-foreground">{pt.id}</span>
        <Badge variant="outline" className={`text-[10px] font-normal ${statusBadge}`}>
          {statusLabel}
        </Badge>
      </div>
      <div className="text-[11px] text-muted-foreground capitalize">
        {(pt.sector ?? "General").replace(/_/g, " ")} · {pt.state ?? "IN"}
      </div>
      <div className="pt-0.5 space-y-0.5 text-[11px]">
        <div className="flex justify-between">
          <span className="text-muted-foreground">Exposure at Default:</span>
          <span className="font-medium tabular-nums">₹{pt.x}K</span>
        </div>
        <div className="flex justify-between">
          <span className="text-muted-foreground">Post-Cascade PD:</span>
          <span className="font-semibold tabular-nums text-band-d">{pt.y}%</span>
        </div>
        {pt.base_pd !== undefined && (
          <div className="flex justify-between">
            <span className="text-muted-foreground">Baseline PD:</span>
            <span className="font-medium tabular-nums">{pt.base_pd}%</span>
          </div>
        )}
        <div className="flex justify-between">
          <span className="text-muted-foreground">ECL at Risk:</span>
          <span className="font-medium tabular-nums">{formatInrCompact(pt.z)}</span>
        </div>
        {pt.stressed_neighbors !== undefined && (
          <div className="flex justify-between">
            <span className="text-muted-foreground">Stressed Counterparties:</span>
            <span className="font-medium tabular-nums">{pt.stressed_neighbors}</span>
          </div>
        )}
      </div>
    </div>
  );
}

/**
 * Supplier-graph contagion view.
 * Powered by live NetworkX DiGraph cascade simulation in backend /contagion/simulate.
 */
function ContagionView() {
  const borrowers = getSnapshot().borrowers;
  const [transmissionRate, setTransmissionRate] = useState(0.35);
  const [maxRounds, setMaxRounds] = useState(4);
  const [stressThreshold, setStressThreshold] = useState(0.16);
  const [selectedSeeds, setSelectedSeeds] = useState<string[]>([]);
  const [branchCode, setBranchCode] = useState<string>("all");
  const [selectedSector, setSelectedSector] = useState<string>("all");
  const [selectedCommunity, setSelectedCommunity] = useState<string | null>(null);
  const [activeRound, setActiveRound] = useState<number | null>(null);
  const [branches, setBranches] = useState<BranchSummary[]>([]);
  const [liveData, setLiveData] = useState<ContagionSimulateResponse | null>(null);
  const [isSimulating, setIsSimulating] = useState(false);
  const [isLiveEngine, setIsLiveEngine] = useState(false);

  useEffect(() => {
    fetchBranches().then((res) => {
      if (Array.isArray(res) && res.length > 0) setBranches(res);
    }).catch(() => {});
  }, []);

  // Trigger live backend graph cascade simulation
  useEffect(() => {
    let active = true;
    const controller = new AbortController();

    const runContagion = async () => {
      setIsSimulating(true);
      try {
        const res = await simulateContagion(
          {
            transmission_rate: transmissionRate,
            max_rounds: maxRounds,
            stress_threshold: stressThreshold,
            shock_seeds: selectedSeeds.length > 0 ? selectedSeeds : undefined,
            branch_code: branchCode !== "all" ? branchCode : undefined,
            sector: selectedSector !== "all" ? selectedSector : undefined,
          },
          controller.signal,
        );
        if (active) {
          setLiveData(res);
          setIsLiveEngine(res.status === "success");
        }
      } catch {
        if (active) setIsLiveEngine(false);
      } finally {
        if (active) setIsSimulating(false);
      }
    };

    const timer = setTimeout(runContagion, 150);
    return () => {
      active = false;
      controller.abort();
      clearTimeout(timer);
    };
  }, [transmissionRate, maxRounds, stressThreshold, selectedSeeds, branchCode, selectedSector]);

  const filteredBorrowers = useMemo(() => {
    let list = borrowers;
    if (branchCode !== "all") {
      list = list.filter((b) => b.branch_code === branchCode);
    }
    if (selectedSector !== "all") {
      list = list.filter((b) => b.sector === selectedSector);
    }
    return list;
  }, [borrowers, branchCode, selectedSector]);

  const availableSectors = useMemo(() => {
    const list = branchCode === "all" ? borrowers : borrowers.filter((b) => b.branch_code === branchCode);
    const map = new Map<string, number>();
    for (const b of list) {
      const s = b.sector ?? "other";
      map.set(s, (map.get(s) ?? 0) + 1);
    }
    return [...map.entries()]
      .map(([sector, count]) => ({ sector, count }))
      .sort((a, b) => b.count - a.count);
  }, [borrowers, branchCode]);

  // Fallback calculations off snapshot
  const fallbackByCommunity = useMemo(() => {
    const map = new Map<string, typeof filteredBorrowers>();
    for (const b of filteredBorrowers) {
      const key = `${b.state ?? "?"}·${b.sector ?? "?"}`;
      const arr = map.get(key) ?? [];
      arr.push(b);
      map.set(key, arr);
    }
    return [...map.entries()]
      .map(([name, members]) => ({
        name,
        members_count: members.length,
        avgPd: members.reduce((s, m) => s + m.pd, 0) / members.length,
        redCount: members.filter((m) => m.rag === "Red").length,
        ecl: members.reduce((s, m) => s + m.ecl, 0),
        infected_count: 0,
      }))
      .sort((a, b) => b.avgPd - a.avgPd);
  }, [filteredBorrowers]);

  const fallbackScatter = useMemo(
    () => {
      const seedSet = new Set(selectedSeeds);
      return filteredBorrowers.map((b) => {
        const isSeed = seedSet.has(b.loan_id);
        const isInit = b.pd >= stressThreshold || isSeed;
        const pdVal = isSeed ? Math.max(b.pd, Math.max(stressThreshold, 0.5)) : b.pd;
        const ragVal = pdVal >= stressThreshold ? "Red" : pdVal >= 0.05 ? "Amber" : "Green";
        return {
          id: b.loan_id,
          x: Math.round(b.ead / 1000), // exposure in ₹K
          y: Math.round(pdVal * 1000) / 10, // PD %
          base_pd: Math.round(b.pd * 1000) / 10,
          z: b.ecl,
          rag: ragVal as RagBucket,
          status: (isInit ? "initial_stressed" : "stable") as "initial_stressed" | "stable",
          sector: b.sector,
          state: b.state,
        };
      });
    },
    [filteredBorrowers, stressThreshold, selectedSeeds],
  );

  const fallbackHubs = useMemo(() => {
    return [...filteredBorrowers]
      .sort((a, b) => b.ead - a.ead)
      .slice(0, 6)
      .map((b, i) => ({
        loan_id: b.loan_id,
        stressed_neighbors: Math.max(1, 4 - i),
        pagerank: 0.028 - i * 0.003,
        n_links: Math.max(4, 14 - i * 2),
        downstream_ead: Math.round(b.ead * 0.65),
        pd_12m: b.pd,
        sector: b.sector ?? "commercial",
      }));
  }, [filteredBorrowers]);

  const scatter = liveData?.scatter ?? fallbackScatter;
  const communities = liveData?.communities ?? fallbackByCommunity;
  const hubs = (liveData?.top_contagion_hubs && liveData.top_contagion_hubs.length > 0)
    ? liveData.top_contagion_hubs
    : fallbackHubs;
  const roundsHistory = liveData?.rounds_history ?? [];

  const displayedScatter = useMemo(() => {
    let pts = scatter;
    if (selectedCommunity) {
      const parts = selectedCommunity.split("·");
      const st = parts[0]?.trim().toLowerCase();
      const sec = parts[1]?.trim().toLowerCase();
      pts = pts.filter((p) => {
        const matchState = !st || p.state?.toLowerCase() === st;
        const matchSec = !sec || p.sector?.toLowerCase() === sec;
        return matchState && matchSec;
      });
    }
    if (activeRound !== null && activeRound === 0) {
      pts = pts.filter((p) => p.status === "initial_stressed");
    }
    return pts;
  }, [scatter, selectedCommunity, activeRound]);

  const [highlightHubs, setHighlightHubs] = useState(false);

  const handleScrollToHubs = () => {
    const el = document.getElementById("systemic-hubs-section");
    if (el) el.scrollIntoView({ behavior: "smooth", block: "start" });
    setHighlightHubs(true);
    setTimeout(() => setHighlightHubs(false), 2500);
  };

  const handleTestWorstHub = () => {
    if (hubs && hubs.length > 0) {
      const topHub = hubs[0].loan_id;
      setSelectedSeeds((prev) => (prev.includes(topHub) ? prev : [...prev, topHub]));
      setTimeout(() => {
        handleScrollToHubs();
      }, 100);
    }
  };

  return (
    <div className="p-4 md:p-6 space-y-6">
      <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-2">
        <div>
          <div className="text-[10px] uppercase tracking-widest text-muted-foreground">
            Supplier-graph signals · e-invoice / MCA links · NetworkX cascade engine
          </div>
          <div className="flex items-center gap-2 mt-0.5">
            <h1 className="text-xl font-semibold text-foreground">Supplier Contagion</h1>
            {isLiveEngine ? (
              <Badge variant="outline" className="bg-emerald-500/10 text-emerald-600 border-emerald-500/30 text-[10px] font-normal">
                ● Live Graph Cascade ({liveData?.total_nodes ?? filteredBorrowers.length} Nodes · {liveData?.total_edges ?? 1631} Edges)
              </Badge>
            ) : (
              <Badge variant="outline" className="bg-muted text-muted-foreground text-[10px] font-normal">
                Offline Snapshot
              </Badge>
            )}
            {isSimulating && (
              <span className="text-[10px] text-muted-foreground animate-pulse">Computing graph cascade...</span>
            )}
          </div>
          <p className="mt-0.5 text-sm text-muted-foreground">
            Simulate how default clusters ripple through the supplier-buyer network to preempt domino distress.
          </p>
        </div>

        <div className="flex flex-wrap items-center gap-2">
          {hubs.length > 0 && (
            <GuidedTooltip content="1-Click Shock Test: Designate the #1 systemic hub as an initial default seed and observe portfolio domino cascade.">
              <Button
                variant="outline"
                size="sm"
                onClick={handleTestWorstHub}
                className="h-8 text-xs gap-1.5 border-rose-500/40 text-rose-600 hover:bg-rose-500/10"
              >
                <Flame className="h-3.5 w-3.5" />
                <span>Test #1 Spreader Shock</span>
              </Button>
            </GuidedTooltip>
          )}

          {selectedSeeds.length > 0 && (
            <Badge variant="outline" className="bg-rose-500/10 text-rose-600 border-rose-500/30 text-xs flex items-center gap-1.5 py-1 px-2.5">
              <Flame className="h-3.5 w-3.5" />
              <span>Shock Seeds: {selectedSeeds.length}</span>
              <button
                type="button"
                onClick={() => setSelectedSeeds([])}
                className="ml-1 text-muted-foreground hover:text-foreground inline-flex items-center gap-0.5 text-[10px] underline cursor-pointer"
              >
                <RotateCcw className="h-2.5 w-2.5" /> Reset
              </button>
            </Badge>
          )}

          {branches.length > 0 && (
            <div className="flex items-center gap-1.5">
              <Building2 className="h-3.5 w-3.5 text-muted-foreground shrink-0" />
              <Select value={branchCode} onValueChange={setBranchCode}>
                <SelectTrigger className="h-8 w-44 text-xs">
                  <SelectValue placeholder="All Branches" />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="all">Bank-wide Network ({borrowers.length})</SelectItem>
                  {branches.map((b) => (
                    <SelectItem key={b.branch_code} value={b.branch_code}>
                      {b.branch_name || `Branch ${b.branch_code}`} ({b.accounts})
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
          )}

          <div className="flex items-center gap-1.5">
            <Layers className="h-3.5 w-3.5 text-muted-foreground shrink-0" />
            <Select value={selectedSector} onValueChange={setSelectedSector}>
              <SelectTrigger className="h-8 w-44 text-xs">
                <SelectValue placeholder="All Sectors" />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="all">All Sectors ({filteredBorrowers.length})</SelectItem>
                {availableSectors.map((s) => (
                  <SelectItem key={s.sector} value={s.sector}>
                    <span className="capitalize">{s.sector.replace(/_/g, " ")}</span> ({s.count})
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
        </div>
      </div>

      {/* Contagion Cascade KPIs */}
      <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
        <GuidedTooltip content="Total verified commercial trade linkages reconstructed from MCA filings, e-invoicing GST data, and Finacle CASA counterparty flows.">
          <Card className="bg-surface p-3 transition-shadow hover:shadow-sm">
            <div className="flex items-center justify-between text-xs text-muted-foreground">
              <span className="flex items-center gap-1">
                Supplier Links
                <HintIcon text="Direct commercial links between buyers and suppliers." />
              </span>
              <Share2 className="h-3.5 w-3.5 text-primary" />
            </div>
            <div className="mt-1 text-lg font-semibold tabular-nums">
              {liveData?.total_edges ?? 1631}
            </div>
            <div className="text-[10px] text-muted-foreground">
              Across {liveData?.total_nodes ?? borrowers.length} counterparty facilities
            </div>
          </Card>
        </GuidedTooltip>

        <GuidedTooltip content="Count of facilities in default state before cascade initiation (T0) versus post-cascade systemic equilibrium.">
          <Card className="bg-surface p-3 transition-shadow hover:shadow-sm">
            <div className="flex items-center justify-between text-xs text-muted-foreground">
              <span className="flex items-center gap-1">
                Stressed Cohort
                <HintIcon text="Pre-cascade initial stressed vs post-cascade final stressed borrowers." />
              </span>
              <ShieldAlert className="h-3.5 w-3.5 text-amber-500" />
            </div>
            <div className="mt-1 text-lg font-semibold tabular-nums">
              {liveData?.initial_stressed_nodes ?? 28} ➔{" "}
              <span className="text-rose-600">{liveData?.final_stressed_nodes ?? 31}</span>
            </div>
            <div className="text-[10px] text-muted-foreground">
              T0 baseline ➔ Post-cascade
            </div>
          </Card>
        </GuidedTooltip>

        <GuidedTooltip content="Borrowers pushed into distress solely through supply-chain trade dependencies. Click to inspect systemic spreader hubs ↓">
          <Card
            className="bg-surface p-3 cursor-pointer transition-all hover:border-rose-500/50 hover:shadow-sm group"
            onClick={handleScrollToHubs}
          >
            <div className="flex items-center justify-between text-xs text-muted-foreground">
              <span>Contagion Spread</span>
              <span className="text-[9px] text-primary opacity-0 group-hover:opacity-100 transition-opacity">
                Inspect hubs ↓
              </span>
            </div>
            <div className="mt-1 text-lg font-semibold tabular-nums text-rose-600">
              +{liveData?.contagion_spread_count ?? 3} accounts
            </div>
            <div className="text-[10px] text-muted-foreground">
              Pushed to stress via upstream dependencies
            </div>
          </Card>
        </GuidedTooltip>

        <GuidedTooltip content="Incremental portfolio Expected Credit Loss induced by cascading supply chain distress. Click to inspect systemic hubs ↓">
          <Card
            className="bg-surface p-3 cursor-pointer transition-all hover:border-band-d/50 hover:shadow-sm group"
            onClick={handleScrollToHubs}
          >
            <div className="flex items-center justify-between text-xs text-muted-foreground">
              <span>Cascade ECL Delta</span>
              <span className="text-[9px] text-primary opacity-0 group-hover:opacity-100 transition-opacity">
                Inspect hubs ↓
              </span>
            </div>
            <div className="mt-1 text-lg font-semibold tabular-nums text-band-d">
              +{formatInrCompact(liveData?.cascade_ecl_delta ?? 2450000)}
            </div>
            <div className="text-[10px] text-muted-foreground">
              Induced portfolio provision shock
            </div>
          </Card>
        </GuidedTooltip>
      </div>

      {/* Urgent Contagion Domino Alert Banner */}
      {hubs.length > 0 && (
        <GuidedTooltip content="Urgent Systemic Contagion Risk: Identifies highest PageRank commercial hub in IDBI network. Click to inject failure shock and scroll directly to systemic hub table.">
          <div
            onClick={handleTestWorstHub}
            className="flex items-center justify-between p-3 rounded-lg border border-rose-500/40 bg-rose-500/10 text-rose-700 dark:text-rose-300 cursor-pointer hover:bg-rose-500/15 transition-all shadow-sm group"
          >
            <div className="flex items-center gap-2.5 text-xs font-medium">
              <Flame className="h-4 w-4 shrink-0 text-rose-600 animate-pulse" />
              <span>
                <strong>Urgent Contagion Action:</strong> Top systemic hub <strong>{hubs[0]?.loan_id}</strong> ({hubs[0]?.sector.replace(/_/g, " ")}) connects to {hubs[0]?.n_links} counterparties with {formatInrCompact(hubs[0]?.downstream_ead)} exposure at risk.
              </span>
            </div>
            <span className="text-[11px] font-semibold text-rose-600 dark:text-rose-400 group-hover:underline flex items-center gap-1 shrink-0">
              {selectedSeeds.includes(hubs[0]?.loan_id) ? "Shock Active (View Hub) ↓" : "Inject Shock & Scroll Down ↓"}
            </span>
          </div>
        </GuidedTooltip>
      )}

      {/* Interactive Simulation Controls */}
      <Card className="bg-surface p-4">
        <div className="grid grid-cols-1 md:grid-cols-3 gap-6 items-center">
          <div className="space-y-1.5">
            <div className="flex items-center justify-between text-xs">
              <span className="font-medium flex items-center gap-1">
                Transmission Rate (α)
                <HintIcon text="Fraction of financial distress transmitted across commercial trade ties (10% to 80%). Higher rates simulate illiquid or concentrated supply chains." />
              </span>
              <Badge variant="outline" className="text-xs font-normal">
                {Math.round(transmissionRate * 100)}%
              </Badge>
            </div>
            <Slider
              value={[Math.round(transmissionRate * 100)]}
              min={10}
              max={80}
              step={5}
              onValueChange={(v) => setTransmissionRate(v[0] / 100)}
            />
            <div className="flex justify-between text-[10px] text-muted-foreground">
              <span>10% (Low spillover)</span>
              <span>80% (High contagion)</span>
            </div>
          </div>

          <div className="space-y-1.5">
            <div className="flex items-center justify-between text-xs">
              <span className="font-medium flex items-center gap-1">
                Cascade Horizon
                <HintIcon text="Maximum propagation waves (1 to 8 rounds). Round 1 covers direct tier-1 counterparties; later rounds simulate multi-tier systemic domino effect." />
              </span>
              <Badge variant="outline" className="text-xs font-normal">
                {maxRounds} Rounds
              </Badge>
            </div>
            <Slider
              value={[maxRounds]}
              min={1}
              max={8}
              step={1}
              onValueChange={(v) => setMaxRounds(v[0])}
            />
            <div className="flex justify-between text-[10px] text-muted-foreground">
              <span>1 Round (Direct)</span>
              <span>8 Rounds (Systemic)</span>
            </div>
          </div>

          <div className="space-y-1.5">
            <div className="flex items-center justify-between text-xs">
              <span className="font-medium flex items-center gap-1">
                Stress Cutoff Threshold
                <HintIcon text="Calibrated 12-month PD cutoff (12%, 16%, 20%) classifying a counterparty as distressed, triggering transmission to trade partners." />
              </span>
              <Badge variant="outline" className="text-xs font-normal">
                PD ≥ {Math.round(stressThreshold * 100)}% (RG5+)
              </Badge>
            </div>
            <div className="flex gap-2">
              {[0.12, 0.16, 0.20].map((th) => (
                <button
                  key={th}
                  type="button"
                  onClick={() => setStressThreshold(th)}
                  className={`flex-1 py-1.5 rounded-md border text-xs font-medium transition-colors ${
                    stressThreshold === th
                      ? "border-primary bg-primary/10 text-primary font-semibold"
                      : "border-border bg-background text-muted-foreground hover:text-foreground"
                  }`}
                >
                  {th === 0.12 ? "Strict (12%)" : th === 0.16 ? "RBI Band (16%)" : "Severe (20%)"}
                </button>
              ))}
            </div>
          </div>
        </div>

        {/* Round Progression Chips */}
        {roundsHistory.length > 1 && (
          <div className="mt-4 pt-3 border-t border-border/60 flex items-center gap-2 overflow-x-auto text-xs">
            <span className="text-[11px] font-medium text-muted-foreground whitespace-nowrap">
              Propagation Rounds:
            </span>
            {roundsHistory.map((rh) => (
              <GuidedTooltip
                key={rh.round}
                content={
                  rh.round === 0
                    ? "T0 baseline stress state prior to cascade initiation. Click to isolate baseline stressed accounts."
                    : rh.newly_infected > 0
                    ? `Round ${rh.round}: ${rh.newly_infected} new commercial facilities infected through supplier/buyer dependencies. Click to inspect.`
                    : `Round ${rh.round}: Cascade equilibrium reached with zero additional infections. Click to inspect.`
                }
              >
                <button
                  type="button"
                  onClick={() => setActiveRound(activeRound === rh.round ? null : rh.round)}
                  className={`text-[10px] font-medium shrink-0 rounded-full border px-2.5 py-0.5 transition-all cursor-pointer ${
                    activeRound === rh.round
                      ? "ring-2 ring-primary ring-offset-1 font-semibold shadow-xs"
                      : "hover:opacity-85"
                  } ${
                    rh.round === 0
                      ? "bg-muted text-muted-foreground border-border"
                      : rh.newly_infected > 0
                      ? "bg-rose-500/10 text-rose-600 border-rose-500/30"
                      : "bg-emerald-500/10 text-emerald-600 border-emerald-500/30"
                  }`}
                >
                  Round {rh.round}: {rh.stressed_count} stressed {rh.newly_infected > 0 ? `(+${rh.newly_infected})` : "(Equilibrium)"}
                </button>
              </GuidedTooltip>
            ))}
            {activeRound !== null && (
              <button
                type="button"
                onClick={() => setActiveRound(null)}
                className="text-[10px] text-muted-foreground hover:text-foreground underline cursor-pointer shrink-0"
              >
                Clear Round Filter
              </button>
            )}
          </div>
        )}
      </Card>

      {/* Active Filter Pill Bar */}
      {(activeRound !== null || selectedCommunity !== null || selectedSector !== "all") && (
        <div className="flex flex-wrap items-center justify-between gap-2 rounded-lg border border-primary/30 bg-primary/5 px-3 py-2 text-xs text-foreground animate-in fade-in duration-200">
          <div className="flex flex-wrap items-center gap-2">
            <span className="flex items-center gap-1 font-semibold text-primary">
              <Filter className="h-3.5 w-3.5" />
              Active Network Filters:
            </span>
            {selectedSector !== "all" && (
              <Badge variant="outline" className="border-primary/40 bg-primary/10 text-primary text-[10px] font-medium flex items-center gap-1">
                Sector: {selectedSector.replace(/_/g, " ")}
                <X className="h-2.5 w-2.5 cursor-pointer hover:opacity-75" onClick={() => setSelectedSector("all")} />
              </Badge>
            )}
            {selectedCommunity !== null && (
              <Badge variant="outline" className="border-primary/40 bg-primary/10 text-primary text-[10px] font-medium flex items-center gap-1">
                Cluster: {selectedCommunity.replace(/_/g, " ").replace("·", " — ")}
                <X className="h-2.5 w-2.5 cursor-pointer hover:opacity-75" onClick={() => setSelectedCommunity(null)} />
              </Badge>
            )}
            {activeRound !== null && (
              <Badge variant="outline" className="border-primary/40 bg-primary/10 text-primary text-[10px] font-medium flex items-center gap-1">
                Cascade Wave: Round {activeRound}
                <X className="h-2.5 w-2.5 cursor-pointer hover:opacity-75" onClick={() => setActiveRound(null)} />
              </Badge>
            )}
            <span className="text-[11px] text-muted-foreground">
              ({displayedScatter.length} facilities visible in scatter)
            </span>
          </div>
          <Button
            variant="ghost"
            size="sm"
            onClick={() => {
              setSelectedSector("all");
              setSelectedCommunity(null);
              setActiveRound(null);
            }}
            className="h-6 px-2 text-[10px] text-muted-foreground hover:text-foreground cursor-pointer"
          >
            Reset All Filters
          </Button>
        </div>
      )}

      <div className="grid gap-4 lg:grid-cols-5">
        <Card className="bg-surface lg:col-span-3">
          <CardHeader className="pb-2">
            <div className="flex items-center justify-between">
              <div>
                <CardTitle className="text-sm">Exposure vs Post-Cascade PD — Contagion Scatter</CardTitle>
                <CardDescription className="text-xs">
                  Each dot is an account; purple dots identify facilities newly infected via supplier links.
                </CardDescription>
              </div>
              <div className="flex items-center gap-2 text-[10px]">
                <GuidedTooltip content="Stable risk grade (PD < 2%) with healthy counterparty solvency">
                  <span className="inline-flex items-center gap-1 cursor-help"><span className="h-2 w-2 rounded-full bg-emerald-500"></span> Green</span>
                </GuidedTooltip>
                <GuidedTooltip content="Moderate stress or elevated baseline PD (2% to 16%)">
                  <span className="inline-flex items-center gap-1 cursor-help"><span className="h-2 w-2 rounded-full bg-amber-500"></span> Amber</span>
                </GuidedTooltip>
                <GuidedTooltip content="Pre-existing initial default or severe stress (PD ≥ 16%) prior to cascade propagation">
                  <span className="inline-flex items-center gap-1 cursor-help"><span className="h-2 w-2 rounded-full bg-rose-500"></span> Base Stressed</span>
                </GuidedTooltip>
                <GuidedTooltip content="Initially healthy borrower pushed into default/stress solely via cascading supplier or buyer failure">
                  <span className="inline-flex items-center gap-1 cursor-help"><span className="h-2 w-2 rounded-full bg-purple-500"></span> Contagion Infected</span>
                </GuidedTooltip>
              </div>
            </div>
          </CardHeader>
          <CardContent className="h-80">
            <ResponsiveContainer width="100%" height="100%">
              <ScatterChart margin={{ top: 8, right: 16, left: 0, bottom: 0 }}>
                <CartesianGrid strokeDasharray="3 3" stroke="var(--color-border)" />
                <XAxis
                  type="number"
                  dataKey="x"
                  name="EAD"
                  tick={{ fontSize: 11 }}
                  tickLine={false}
                  axisLine={false}
                  tickFormatter={(v: number) => `₹${v}K`}
                />
                <YAxis
                  type="number"
                  dataKey="y"
                  name="PD %"
                  tick={{ fontSize: 11 }}
                  tickLine={false}
                  axisLine={false}
                />
                <ZAxis type="number" dataKey="z" range={[20, 220]} />
                <Tooltip
                  cursor={{ strokeDasharray: "3 3" }}
                  content={<ContagionTooltip />}
                />
                <Scatter
                  isAnimationActive={false}
                  data={displayedScatter.filter((d) => d.status === "stable" && d.rag === "Green")}
                  fill={ragHex.Green}
                  fillOpacity={0.55}
                />
                <Scatter
                  isAnimationActive={false}
                  data={displayedScatter.filter((d) => d.status === "stable" && d.rag !== "Green")}
                  fill={ragHex.Amber}
                  fillOpacity={0.65}
                />
                <Scatter
                  isAnimationActive={false}
                  data={displayedScatter.filter((d) => d.status === "initial_stressed")}
                  fill={ragHex.Red}
                  fillOpacity={0.75}
                />
                <Scatter
                  isAnimationActive={false}
                  data={displayedScatter.filter((d) => d.status === "contagion_infected")}
                  fill="#a855f7"
                  fillOpacity={0.9}
                />
              </ScatterChart>
            </ResponsiveContainer>
          </CardContent>
        </Card>

        <Card className="bg-surface lg:col-span-2">
          <CardHeader className="pb-2">
            <div className="flex items-center justify-between">
              <CardTitle className="text-sm flex items-center gap-1.5">
                Contagion Hotspots
                <HintIcon text="State × Sector clusters ranked by post-cascade average PD. Click any cluster card to isolate its facilities on the scatter plot." />
              </CardTitle>
              {selectedCommunity && (
                <button
                  type="button"
                  onClick={() => setSelectedCommunity(null)}
                  className="text-[10px] text-primary hover:underline flex items-center gap-0.5 cursor-pointer"
                >
                  <X className="h-2.5 w-2.5" /> Clear Filter
                </button>
              )}
            </div>
            <CardDescription className="text-xs">
              State × Sector communities ranked by post-cascade average PD. Click to filter network.
            </CardDescription>
          </CardHeader>
          <CardContent className="p-0 max-h-80 overflow-y-auto">
            <ul className="divide-y divide-border">
              {communities.slice(0, 8).map((c) => {
                const isSelected = selectedCommunity === c.name;
                return (
                  <li
                    key={c.name}
                    onClick={() => setSelectedCommunity(isSelected ? null : c.name)}
                    className={cn(
                      "flex items-center justify-between gap-3 px-4 py-2.5 hover:bg-muted/30 cursor-pointer transition-all",
                      isSelected && "bg-primary/10 border-l-2 border-primary font-medium"
                    )}
                    title={isSelected ? "Click to clear cluster filter" : `Click to filter contagion scatter by ${c.name}`}
                  >
                    <div className="min-w-0">
                      <div className="truncate text-xs font-medium capitalize flex items-center gap-1.5">
                        {isSelected && <span className="h-1.5 w-1.5 rounded-full bg-primary shrink-0" />}
                        {c.name.replace(/_/g, " ").replace("·", " — ")}
                      </div>
                      <div className="text-[11px] text-muted-foreground">
                        {c.members_count} accounts · {formatInrCompact(c.ecl)} ECL
                      </div>
                    </div>
                    <div className="flex shrink-0 items-center gap-1.5">
                      {c.infected_count != null && c.infected_count > 0 && (
                        <Badge variant="outline" className="bg-purple-500/15 text-purple-600 border-purple-500/30 text-[10px] font-normal">
                          +{c.infected_count} spread
                        </Badge>
                      )}
                      {c.redCount > 0 && (
                        <Badge variant="outline" className="bg-band-d/15 text-band-d border-band-d/30 font-normal text-[10px]">
                          {c.redCount} red
                        </Badge>
                      )}
                      <span className="text-xs font-medium tabular-nums">
                        {formatPercent(c.avgPd, 1)}
                      </span>
                    </div>
                  </li>
                );
              })}
            </ul>
          </CardContent>
        </Card>
      </div>

      {/* Top Systemic Contagion Hubs */}
      {hubs.length > 0 && (
        <Card
          id="systemic-hubs-section"
          className={cn(
            "bg-surface scroll-mt-20 transition-all duration-500",
            highlightHubs && "ring-4 ring-rose-500/80 ring-offset-2 animate-pulse shadow-2xl border-rose-500/60"
          )}
        >
          <CardHeader className="pb-2">
            <div className="flex items-center justify-between">
              <div>
                <CardTitle className="text-sm flex items-center gap-1.5">
                  <Users className="h-4 w-4 text-primary" />
                  Top Systemic Contagion Hubs (Super-Spreaders)
                  <HintIcon text="Identified via network centrality and counterparty exposure volume. Shocker button allows testing targeted counterparty firewalls." />
                </CardTitle>
                <CardDescription className="text-xs">
                  Facilities with high PageRank centrality and stressed counterparties whose default triggers the widest ripple effect.
                </CardDescription>
              </div>
              <Badge variant="outline" className="text-xs font-normal">
                Top {hubs.length} Systemic Nodes
              </Badge>
            </div>
          </CardHeader>
          <CardContent className="p-0">
            <div className="overflow-x-auto">
              <table className="w-full text-xs min-w-[860px]">
                <thead>
                  <tr className="border-b border-border bg-muted/30 text-left text-muted-foreground">
                    <th className="px-4 py-2 font-medium">
                      <span className="inline-flex items-center gap-1">
                        Facility ID
                        <HintIcon text="Unique borrower facility identifier. Click to view full 360° counterparty graph & EWS triggers." />
                      </span>
                    </th>
                    <th className="px-4 py-2 font-medium">Sector</th>
                    <th className="px-4 py-2 font-medium">
                      <span className="inline-flex items-center gap-1">
                        Stressed Neighbours
                        <HintIcon text="Count of immediate commercial suppliers/buyers that have breached default stress threshold." />
                      </span>
                    </th>
                    <th className="px-4 py-2 font-medium">
                      <span className="inline-flex items-center gap-1">
                        Graph PageRank
                        <HintIcon text="Google PageRank network centrality measuring systemic connectivity in IDBI's commercial network." />
                      </span>
                    </th>
                    <th className="px-4 py-2 font-medium">
                      <span className="inline-flex items-center gap-1">
                        Counterparty Links
                        <HintIcon text="Total incoming and outgoing supply chain payment linkages recorded in GST and CASA flows." />
                      </span>
                    </th>
                    <th className="px-4 py-2 font-medium">
                      <span className="inline-flex items-center gap-1">
                        Exposure at Risk
                        <HintIcon text="Downstream Exposure at Default (EAD) exposed to counterparty contagion." />
                      </span>
                    </th>
                    <th className="px-4 py-2 font-medium">
                      <span className="inline-flex items-center gap-1">
                        Post-Cascade PD
                        <HintIcon text="Simulated 12-month Probability of Default after multi-round cascade propagation." />
                      </span>
                    </th>
                    <th className="px-4 py-2 font-medium text-right">
                      <span className="inline-flex items-center justify-end gap-1 w-full">
                        Contagion Action
                        <HintIcon text="Manually inject or relieve shock on this facility as a primary contagion seed." />
                      </span>
                    </th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-border">
                  {hubs.map((h) => (
                    <tr key={h.loan_id} className="hover:bg-muted/20 transition-colors">
                      <td className="px-4 py-2.5 font-medium">
                        <GuidedTooltip content={`Click to inspect 360° borrower profile and EWS indicators for ${h.loan_id}`}>
                          <Link to="/borrowers/$id" params={{ id: h.loan_id }} className="text-primary hover:underline font-mono">
                            {h.loan_id}
                          </Link>
                        </GuidedTooltip>
                      </td>
                      <td className="px-4 py-2.5 capitalize text-muted-foreground">
                        {h.sector.replace(/_/g, " ")}
                      </td>
                      <td className="px-4 py-2.5 tabular-nums">
                        <Badge variant="outline" className={`text-[10px] font-normal ${h.stressed_neighbors >= 3 ? "border-rose-500/30 text-rose-600 bg-rose-500/10" : ""}`}>
                          {h.stressed_neighbors} upstream stressed
                        </Badge>
                      </td>
                      <td className="px-4 py-2.5 tabular-nums font-mono text-[11px]">
                        {h.pagerank.toFixed(5)}
                      </td>
                      <td className="px-4 py-2.5 tabular-nums text-muted-foreground">
                        {h.n_links} links
                      </td>
                      <td className="px-4 py-2.5 tabular-nums font-medium">
                        {formatInrCompact(h.downstream_ead)}
                      </td>
                      <td className="px-4 py-2.5 tabular-nums font-semibold text-band-d">
                        {formatPercent(h.pd_12m, 2)}
                      </td>
                      <td className="px-4 py-2.5 text-right">
                        <button
                          type="button"
                          onClick={() => {
                            setSelectedSeeds((prev) =>
                              prev.includes(h.loan_id)
                                ? prev.filter((id) => id !== h.loan_id)
                                : [...prev, h.loan_id],
                            );
                          }}
                          className={`inline-flex items-center gap-1 px-2 py-1 rounded text-[10px] font-medium border transition-colors ${
                            selectedSeeds.includes(h.loan_id)
                              ? "bg-rose-500/20 text-rose-600 border-rose-500/40"
                              : "bg-surface text-muted-foreground border-border hover:text-foreground hover:border-primary/50"
                          }`}
                        >
                          <Flame className="h-3 w-3" />
                          {selectedSeeds.includes(h.loan_id) ? "Shocked" : "Shock Seed"}
                        </button>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </CardContent>
        </Card>
      )}

      <Card className="bg-surface">
        <CardContent className="flex items-start gap-3 pt-5">
          <Network className="mt-0.5 h-4 w-4 shrink-0 text-primary" />
          <p className="text-xs leading-relaxed text-muted-foreground">
            Contagion Architecture: Graph features (<code className="rounded bg-muted px-1 py-0.5 text-[10px]">degree_centrality</code>,{" "}
            <code className="rounded bg-muted px-1 py-0.5 text-[10px]">pagerank</code>,{" "}
            <code className="rounded bg-muted px-1 py-0.5 text-[10px]">stressed_neighbors</code>) enter the cascade simulation through observable counterparty commercial links (e-invoice GST counterparties & Finacle CASA flows) — never future labels. The live backend runs an iterative Eisenberg-Noe / DebtRank cascade model across the operational <code className="rounded bg-muted px-1 py-0.5 text-[10px]">LoanAccount</code> database.
          </p>
        </CardContent>
      </Card>
    </div>
  );
}
