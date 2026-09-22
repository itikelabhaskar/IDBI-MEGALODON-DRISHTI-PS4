import { useEffect, useMemo, useState } from "react";
import { createFileRoute } from "@tanstack/react-router";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Slider } from "@/components/ui/slider";
import { Badge } from "@/components/ui/badge";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import {
  ResponsiveContainer,
  ComposedChart,
  Bar,
  XAxis,
  YAxis,
  CartesianGrid,
  Tooltip,
} from "recharts";
import { getSnapshot, simulateScenario, fetchBranches } from "@/lib/api";
import type { ScenarioSimulateResponse, BranchSummary } from "@/lib/types";
import { formatInrCompact, formatPercent } from "@/lib/format";
import { cn } from "@/lib/utils";
import { FlaskConical, Layers, TrendingUp, AlertTriangle, Building2, RotateCcw, Sparkles, ArrowDown, Target } from "lucide-react";
import {
  GuidedTooltip,
  HintIcon,
} from "@/components/drishti/guided-tooltip";

export const Route = createFileRoute("/scenario")({
  component: ScenarioLab,
});

/**
 * Sector sensitivity of default odds by sector (1.0 = portfolio average).
 * Mirrors SECTOR_BETA in src/features/macro_overlay.py.
 */
export const SECTOR_BETAS: Record<string, number> = {
  construction: 1.4,
  hospitality: 1.4,
  auto_components: 1.3,
  textiles: 1.25,
  transport: 1.2,
  retail_trade: 1.1,
  agri_processing: 1.0,
  food_processing: 0.85,
  it_services: 0.7,
  pharma: 0.6,
  other: 1.0,
};

export function applyScenario(
  pd: number,
  repoBps: number,
  gdpDropPct: number,
  beta: number,
  sectorStress: number = 0,
  targetSector: string = "all_cyclical",
  facilitySector?: string,
): number {
  const z = Math.log(Math.max(pd, 1e-4) / (1 - Math.max(pd, 1e-4)));
  const targetNorm = targetSector.toLowerCase();
  const fSec = (facilitySector ?? "other").toLowerCase();
  let sectorMult = 0;
  if (sectorStress > 0) {
    if (targetNorm === "all_cyclical" || targetNorm === "all") {
      sectorMult = beta >= 1.2 ? beta * sectorStress : 0;
    } else if (fSec === targetNorm) {
      sectorMult = beta * sectorStress;
    }
  }
  const shock = (0.002 * repoBps + 0.08 * gdpDropPct) * beta + 2.0 * sectorMult;
  const z2 = z + shock;
  return 1 / (1 + Math.exp(-z2));
}

function ScenarioLab() {
  const borrowers = getSnapshot().borrowers;
  const [repoBps, setRepoBps] = useState(0);
  const [gdpDrop, setGdpDrop] = useState(0);
  const [sectorStress, setSectorStress] = useState(0);
  const [targetSector, setTargetSector] = useState<string>("all_cyclical");
  const [branchCode, setBranchCode] = useState<string>("all");
  const [branches, setBranches] = useState<BranchSummary[]>([]);
  const [liveData, setLiveData] = useState<ScenarioSimulateResponse | null>(null);
  const [isSimulating, setIsSimulating] = useState(false);
  const [isLiveEngine, setIsLiveEngine] = useState(false);
  const [highlightSectorMatrix, setHighlightSectorMatrix] = useState(false);
  const [highlightShockCard, setHighlightShockCard] = useState(false);

  const handleScrollToSectorMatrix = () => {
    const el = document.getElementById("sector-matrix-card");
    if (el) {
      el.scrollIntoView({ behavior: "smooth", block: "start" });
    }
    setHighlightSectorMatrix(true);
    setTimeout(() => setHighlightSectorMatrix(false), 2500);
  };

  const handleSelectTargetSector = (sec: string) => {
    setTargetSector(sec);
    if (sectorStress === 0) {
      setSectorStress(15);
    }
    const el = document.getElementById("macro-shocks-card");
    if (el) {
      el.scrollIntoView({ behavior: "smooth", block: "start" });
    }
    setHighlightShockCard(true);
    setTimeout(() => setHighlightShockCard(false), 2500);
  };

  useEffect(() => {
    fetchBranches().then((res) => {
      if (Array.isArray(res) && res.length > 0) setBranches(res);
    }).catch(() => {});
  }, []);

  // Trigger live backend simulation when sliders, presets, target sector, or branch changes
  useEffect(() => {
    let active = true;
    const controller = new AbortController();

    const runSimulation = async () => {
      setIsSimulating(true);
      try {
        const res = await simulateScenario(
          {
            repo_bps: repoBps,
            gdp_shock_pct: gdpDrop / 10,
            sector_stress: sectorStress / 100,
            target_sector: targetSector,
            branch_code: branchCode !== "all" ? branchCode : undefined,
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

    const timer = setTimeout(runSimulation, 120);
    return () => {
      active = false;
      controller.abort();
      clearTimeout(timer);
    };
  }, [repoBps, gdpDrop, sectorStress, targetSector, branchCode]);


  const filteredBorrowers = useMemo(() => {
    if (branchCode === "all") return borrowers;
    return borrowers.filter((b) => b.branch_code === branchCode);
  }, [borrowers, branchCode]);

  // Fallback client calculations if backend is loading or unavailable
  const fallbackBaseline = useMemo(() => filteredBorrowers.reduce((s, b) => s + b.ecl, 0), [filteredBorrowers]);

  const fallbackStressed = useMemo(() => {
    return filteredBorrowers.reduce((s, b) => {
      const beta = SECTOR_BETAS[b.sector ?? "other"] ?? 1;
      const pd2 = applyScenario(b.pd, repoBps, gdpDrop / 10, beta, sectorStress / 100, targetSector, b.sector);
      const scale = b.pd > 0 ? pd2 / b.pd : 1;
      return s + b.ecl * scale;
    }, 0);
  }, [filteredBorrowers, repoBps, gdpDrop, sectorStress, targetSector]);

  const fallbackByGrade = useMemo(() => {
    const map = new Map<string, { base: number; stress: number }>();
    for (const b of filteredBorrowers) {
      const e = map.get(b.risk_grade) ?? { base: 0, stress: 0 };
      e.base += b.ecl;
      const beta = SECTOR_BETAS[b.sector ?? "other"] ?? 1;
      const pd2 = applyScenario(b.pd, repoBps, gdpDrop / 10, beta, sectorStress / 100, targetSector, b.sector);
      const scale = b.pd > 0 ? pd2 / b.pd : 1;
      e.stress += b.ecl * scale;
      map.set(b.risk_grade, e);
    }
    return [...map.entries()]
      .sort((a, b) => {
        const numA = parseInt(a[0].replace(/\D/g, ""), 10) || 0;
        const numB = parseInt(b[0].replace(/\D/g, ""), 10) || 0;
        return numA - numB;
      })
      .map(([grade, v]) => ({ grade, base: Math.round(v.base), stress: Math.round(v.stress) }));
  }, [filteredBorrowers, repoBps, gdpDrop, sectorStress, targetSector]);

  const fallbackBySector = useMemo(() => {
    const map = new Map<string, { base: number; stress: number; accounts: number }>();
    for (const b of filteredBorrowers) {
      const sec = b.sector ?? "other";
      const cur = map.get(sec) ?? { base: 0, stress: 0, accounts: 0 };
      cur.base += b.ecl;
      cur.accounts += 1;
      const beta = SECTOR_BETAS[sec] ?? 1.0;
      const pd2 = applyScenario(b.pd, repoBps, gdpDrop / 10, beta, sectorStress / 100, targetSector, b.sector);
      const scale = b.pd > 0 ? pd2 / b.pd : 1;
      cur.stress += b.ecl * scale;
      map.set(sec, cur);
    }
    return [...map.entries()]
      .map(([sector, v]) => {
        const beta = SECTOR_BETAS[sector] ?? 1.0;
        const upliftPct = v.base > 0 ? ((v.stress - v.base) / v.base) * 100 : 0;
        return {
          sector,
          beta,
          accounts: v.accounts,
          base_ecl: Math.round(v.base),
          stressed_ecl: Math.round(v.stress),
          uplift_pct: Math.round(upliftPct * 10) / 10,
        };
      })
      .sort((a, b) => b.uplift_pct - a.uplift_pct);
  }, [filteredBorrowers, repoBps, gdpDrop, sectorStress, targetSector]);

  const baseline = liveData?.baseline_ecl ?? fallbackBaseline;
  const stressed = liveData?.stressed_ecl ?? fallbackStressed;
  const uplift = liveData ? liveData.ecl_uplift_pct / 100 : (stressed > 0 ? stressed / Math.max(baseline, 1) - 1 : 0);
  const byGrade = liveData?.by_grade ?? fallbackByGrade;
  const bySector = (liveData?.by_sector && liveData.by_sector.length > 0) ? liveData.by_sector : fallbackBySector;

  return (
    <div className="p-4 md:p-6 space-y-6">
      <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-2">
        <div>
          <div className="text-[10px] uppercase tracking-widest text-muted-foreground">
            RBI macro overlay · sector betas · log-odds shift
          </div>
          <div className="flex items-center gap-2 mt-0.5">
            <h1 className="text-xl font-semibold text-foreground">Scenario Lab</h1>
            {isLiveEngine ? (
              <Badge variant="outline" className="bg-emerald-500/10 text-emerald-600 border-emerald-500/30 text-[10px] font-normal">
                ● Live DB Engine ({liveData?.total_accounts ?? 556} Facilities)
              </Badge>
            ) : (
              <Badge variant="outline" className="bg-muted text-muted-foreground text-[10px] font-normal">
                Offline Snapshot
              </Badge>
            )}
            {isSimulating && (
              <span className="text-[10px] text-muted-foreground animate-pulse">Running shock simulation...</span>
            )}
          </div>
          <p className="mt-0.5 text-sm text-muted-foreground">
            Stress the book with rate hikes and growth shocks — watch expected credit loss respond across sectors.
          </p>
        </div>

        <div className="flex flex-wrap items-center gap-2">
          {branches.length > 0 && (
            <div className="flex items-center gap-2">
              <Building2 className="h-4 w-4 text-muted-foreground shrink-0" />
              <Select value={branchCode} onValueChange={setBranchCode}>
                <SelectTrigger className="h-8 w-52 text-xs">
                  <SelectValue placeholder="All Branches" />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="all">Bank-wide Book ({borrowers.length})</SelectItem>
                  {branches.map((b) => (
                    <SelectItem key={b.branch_code} value={b.branch_code}>
                      {b.branch_name || `Branch ${b.branch_code}`} ({b.accounts})
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
          )}
        </div>
      </div>

      {/* Urgent Macro Stress Alert Banner */}
      {uplift > 0.15 && (
        <GuidedTooltip content="Urgent Supervisory Stress Alert: Current macro parameters generate substantial impairment expansion. Click to inspect sector vulnerability drivers below.">
          <div
            onClick={handleScrollToSectorMatrix}
            className="flex items-center justify-between p-3 rounded-lg border border-band-d/40 bg-band-d/10 text-band-d cursor-pointer hover:bg-band-d/15 transition-all shadow-sm group"
          >
            <div className="flex items-center gap-2.5 text-xs font-medium">
              <AlertTriangle className="h-4 w-4 shrink-0 text-band-d animate-pulse" />
              <span>
                <strong>Urgent Stress Warning:</strong> Macro shock triggers <strong>+{formatPercent(uplift, 1)}</strong> portfolio ECL expansion (+{formatInrCompact(stressed - baseline)} capital impairment).
              </span>
            </div>
            <span className="text-[11px] font-semibold text-band-d group-hover:underline flex items-center gap-1 shrink-0">
              Inspect Sector Vulnerabilities ↓
            </span>
          </div>
        </GuidedTooltip>
      )}

      <div className="grid gap-4 lg:grid-cols-3">
        <Card
          id="macro-shocks-card"
          className={cn(
            "bg-surface lg:col-span-1 scroll-mt-20 transition-all duration-500",
            highlightShockCard && "ring-4 ring-primary ring-offset-2 shadow-2xl animate-pulse border-primary",
          )}
        >
          <CardHeader className="pb-2">
            <div className="flex items-center justify-between">
              <CardTitle className="text-sm">Macro Shocks</CardTitle>
              <HintIcon text="Calibrated to RBI Financial Stability Report (FSR) macro stress test matrices (2015–2024)." />
            </div>
            <CardDescription className="text-xs">
              Calibrated to the RBI_MACRO table (2015–2024).
            </CardDescription>
          </CardHeader>
          <CardContent className="space-y-5 pt-2">
            {/* Regulatory Presets */}
            <div className="space-y-1.5">
              <div className="flex items-center justify-between text-[11px]">
                <span className="font-medium text-muted-foreground">Regulatory Scenarios</span>
                <button
                  type="button"
                  onClick={() => { setRepoBps(0); setGdpDrop(0); setSectorStress(0); }}
                  className="text-[10px] text-muted-foreground hover:text-foreground inline-flex items-center gap-1 underline"
                  title="Reset macro shock parameters to zero"
                >
                  <RotateCcw className="h-2.5 w-2.5" /> Reset
                </button>
              </div>
              <div className="grid grid-cols-2 sm:grid-cols-4 gap-1.5">
                <GuidedTooltip content="Baseline Scenario: Current macroeconomic environment (0 bps repo hike, 0% GDP shock, 0% sector stress). Establishes reference baseline.">
                  <button
                    type="button"
                    onClick={() => { setRepoBps(0); setGdpDrop(0); setSectorStress(0); }}
                    className={`px-2 py-1.5 rounded-md border text-[11px] font-medium transition-colors ${
                      repoBps === 0 && gdpDrop === 0 && sectorStress === 0
                        ? "border-primary bg-primary/10 text-primary font-semibold"
                        : "border-border bg-background text-muted-foreground hover:text-foreground"
                    }`}
                  >
                    Baseline
                  </button>
                </GuidedTooltip>
                <GuidedTooltip content="RBI Baseline Stress Guideline: +150 bps repo hike, -1.5% GDP contraction, +10% sector distress.">
                  <button
                    type="button"
                    onClick={() => { setRepoBps(150); setGdpDrop(15); setSectorStress(10); }}
                    className={`px-2 py-1.5 rounded-md border text-[11px] font-medium transition-colors ${
                      repoBps === 150 && gdpDrop === 15 && sectorStress === 10
                        ? "border-amber-500 bg-amber-500/10 text-amber-600 font-semibold"
                        : "border-border bg-background text-muted-foreground hover:text-foreground"
                    }`}
                  >
                    Moderate
                  </button>
                </GuidedTooltip>
                <GuidedTooltip content="RBI Severely Adverse Stress Guideline: +300 bps repo hike, -3.5% GDP contraction, +25% sector distress.">
                  <button
                    type="button"
                    onClick={() => { setRepoBps(300); setGdpDrop(35); setSectorStress(25); }}
                    className={`px-2 py-1.5 rounded-md border text-[11px] font-medium transition-colors ${
                      repoBps === 300 && gdpDrop === 35 && sectorStress === 25
                        ? "border-rose-500 bg-rose-500/10 text-rose-600 font-semibold"
                        : "border-border bg-background text-muted-foreground hover:text-foreground"
                    }`}
                  >
                    Severe
                  </button>
                </GuidedTooltip>
                <GuidedTooltip content="RBI Stagflation Stress: +200 bps repo hike, -4.0% severe growth contraction, +30% cyclical sector distress.">
                  <button
                    type="button"
                    onClick={() => { setRepoBps(200); setGdpDrop(40); setSectorStress(30); }}
                    className={`px-2 py-1.5 rounded-md border text-[11px] font-medium transition-colors ${
                      repoBps === 200 && gdpDrop === 40 && sectorStress === 30
                        ? "border-purple-500 bg-purple-500/10 text-purple-600 font-semibold"
                        : "border-border bg-background text-muted-foreground hover:text-foreground"
                    }`}
                  >
                    Stagflation
                  </button>
                </GuidedTooltip>
              </div>
            </div>

            <div>
              <div className="mb-2 flex items-center justify-between text-xs">
                <span className="font-medium flex items-center gap-1">
                  Repo rate hike
                  <HintIcon text="Simulates RBI policy rate tightening. Each 25 bps increases borrowing costs, raising working capital default probabilities in log-odds space." />
                </span>
                <Badge variant="outline" className="tabular-nums font-normal">
                  +{repoBps} bps
                </Badge>
              </div>
              <Slider
                value={[repoBps]}
                min={0}
                max={400}
                step={25}
                onValueChange={(v) => setRepoBps(v[0])}
              />
              <div className="mt-1 flex justify-between text-[10px] text-muted-foreground">
                <span>0</span><span>400 bps</span>
              </div>
            </div>

            <div>
              <div className="mb-2 flex items-center justify-between text-xs">
                <span className="font-medium flex items-center gap-1">
                  GDP contraction
                  <HintIcon text="Simulates systemic economic deceleration (0% to -5.0%) based on historical RBI stress test matrices." />
                </span>
                <Badge variant="outline" className="tabular-nums font-normal">
                  −{(gdpDrop / 10).toFixed(1)}%
                </Badge>
              </div>
              <Slider
                value={[gdpDrop]}
                min={0}
                max={50}
                step={5}
                onValueChange={(v) => setGdpDrop(v[0])}
              />
              <div className="mt-1 flex justify-between text-[10px] text-muted-foreground">
                <span>0%</span><span>−5.0%</span>
              </div>
            </div>

            <div className="space-y-3 rounded-lg border border-border/70 bg-muted/20 p-3">
              <div>
                <div className="mb-1.5 flex items-center justify-between text-xs">
                  <span className="font-medium flex items-center gap-1">
                    Target Sector
                    <HintIcon text="Select which sector receives the targeted sector-specific shock. You can target all high-beta cyclical industries or isolate a specific industry (e.g., Construction, Auto Components, Textiles)." />
                  </span>
                  <Badge variant="outline" className="text-[10px] font-medium text-primary border-primary/30 bg-primary/5">
                    {targetSector === "all_cyclical"
                      ? "All Cyclical (β ≥ 1.2)"
                      : `${targetSector.replace(/_/g, " ")} (β = ${(SECTOR_BETAS[targetSector] ?? 1.0).toFixed(2)})`}
                  </Badge>
                </div>
                <Select value={targetSector} onValueChange={setTargetSector}>
                  <SelectTrigger className="h-8 text-xs bg-surface border-border">
                    <SelectValue placeholder="Select target sector" />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="all_cyclical">
                      <span className="font-semibold text-primary">All High-Beta Cyclical (β ≥ 1.2)</span>
                    </SelectItem>
                    <SelectItem value="construction">Construction & Real Estate (β = 1.40)</SelectItem>
                    <SelectItem value="hospitality">Hospitality & Tourism (β = 1.40)</SelectItem>
                    <SelectItem value="auto_components">Auto Components & Engineering (β = 1.30)</SelectItem>
                    <SelectItem value="textiles">Textiles & Apparel (β = 1.25)</SelectItem>
                    <SelectItem value="transport">Transport & Logistics (β = 1.20)</SelectItem>
                    <SelectItem value="retail_trade">Retail Trade (β = 1.10)</SelectItem>
                    <SelectItem value="agri_processing">Agri Processing (β = 1.00)</SelectItem>
                    <SelectItem value="food_processing">Food Processing (β = 0.85)</SelectItem>
                    <SelectItem value="it_services">IT & Digital Services (β = 0.70)</SelectItem>
                    <SelectItem value="pharma">Pharma & Healthcare (β = 0.60)</SelectItem>
                  </SelectContent>
                </Select>
                <div className="mt-1 flex items-center justify-between text-[10px] text-muted-foreground">
                  <span>
                    {targetSector === "all_cyclical"
                      ? "Applies to Construction, Hospitality, Auto, Textiles, Transport"
                      : `${bySector.find((s) => s.sector === targetSector)?.accounts ?? 0} facilities in portfolio`}
                  </span>
                  <span className="font-medium text-foreground/80">
                    β = {(SECTOR_BETAS[targetSector] ?? 1.2).toFixed(2)}
                  </span>
                </div>
              </div>

              <div>
                <div className="mb-1.5 flex items-center justify-between text-xs">
                  <span className="font-medium flex items-center gap-1">
                    {targetSector === "all_cyclical"
                      ? "Targeted shock: Cyclical Sectors"
                      : `Targeted shock: ${targetSector.replace(/_/g, " ")}`}
                    <HintIcon text="Distress intensity (+0% to +50%) applied specifically to the chosen sector (or all cyclical industries) scaled by its calibrated macro beta." />
                  </span>
                  <Badge variant="outline" className="tabular-nums font-normal">
                    +{sectorStress}%
                  </Badge>
                </div>
                <Slider
                  value={[sectorStress]}
                  min={0}
                  max={50}
                  step={5}
                  onValueChange={(v) => setSectorStress(v[0])}
                />
                <div className="mt-1 flex justify-between text-[10px] text-muted-foreground">
                  <span>0% (Neutral)</span>
                  <span>+50% (Severe)</span>
                </div>
              </div>
            </div>

            <div className="rounded-lg border border-border bg-muted/40 p-3 space-y-2">
              <div className="flex items-center justify-between text-xs">
                <span className="text-muted-foreground">Baseline ECL</span>
                <span className="font-medium tabular-nums">{formatInrCompact(baseline)}</span>
              </div>
              <div className="flex items-center justify-between text-xs">
                <span className="text-muted-foreground">Stressed ECL</span>
                <span className="font-semibold tabular-nums text-band-d">
                  {formatInrCompact(stressed)}
                </span>
              </div>
              <GuidedTooltip content="Click to scroll down to Sector Vulnerability Matrix and see industry-by-industry distress drivers ↓">
                <div
                  className="flex items-center justify-between text-xs cursor-pointer hover:bg-muted/70 p-1 -mx-1 rounded transition-colors group"
                  onClick={() => {
                    const el = document.getElementById("sector-matrix-card");
                    if (el) el.scrollIntoView({ behavior: "smooth", block: "start" });
                  }}
                >
                  <span className="text-muted-foreground group-hover:text-foreground flex items-center gap-1">
                    Portfolio ECL Uplift
                    <ArrowDown className="h-3 w-3 opacity-0 group-hover:opacity-100 text-primary transition-opacity" />
                  </span>
                  <Badge
                    variant="outline"
                    className={`tabular-nums font-normal transition-transform group-hover:scale-105 ${
                      uplift > 0.25 ? "bg-band-d/15 text-band-d border-band-d/30" : "bg-band-c/15 text-band-c border-band-c/30"
                    }`}
                  >
                    +{formatPercent(Math.max(0, uplift), 1)}
                  </Badge>
                </div>
              </GuidedTooltip>
              {liveData && (
                <div className="pt-2 border-t border-border/60 flex items-center justify-between text-[11px]">
                  <span className="text-muted-foreground">Weighted Avg PD</span>
                  <span className="font-medium tabular-nums">
                    {formatPercent(liveData.weighted_avg_pd_base, 2)} ➔{" "}
                    <span className="text-band-d font-semibold">{formatPercent(liveData.weighted_avg_pd_stressed, 2)}</span>
                  </span>
                </div>
              )}
            </div>
          </CardContent>
        </Card>

        <Card className="bg-surface lg:col-span-2">
          <CardHeader className="pb-2">
            <div className="flex items-center justify-between">
              <div>
                <CardTitle className="text-sm flex items-center gap-1.5">
                  <span>ECL by Risk Grade — Baseline vs Stressed</span>
                  <HintIcon text="Compares pre-shock Baseline ECL (blue) against post-shock Stressed ECL (rose) across risk grades RG1–RG10. Higher risk tiers (RG7+) experience non-linear loss amplification under stress." />
                </CardTitle>
                <CardDescription className="text-xs">
                  RG7+ grades absorb most of the shock — exactly where the watchlist committee intervenes.
                </CardDescription>
              </div>
              <div className="flex items-center gap-3 text-xs">
                <span className="inline-flex items-center gap-1">
                  <span className="h-2.5 w-2.5 rounded bg-[var(--color-chart-1)]"></span> Baseline
                </span>
                <span className="inline-flex items-center gap-1">
                  <span className="h-2.5 w-2.5 rounded bg-[var(--color-band-d)]"></span> Stressed
                </span>
              </div>
            </div>
          </CardHeader>
          <CardContent className="h-80">
            <ResponsiveContainer width="100%" height="100%">
              <ComposedChart data={byGrade} margin={{ top: 8, right: 8, left: 8, bottom: 0 }}>
                <CartesianGrid strokeDasharray="3 3" stroke="var(--color-border)" vertical={false} />
                <XAxis dataKey="grade" tick={{ fontSize: 11 }} tickLine={false} axisLine={false} />
                <YAxis
                  tick={{ fontSize: 11 }}
                  tickLine={false}
                  axisLine={false}
                  tickFormatter={(v: number) => formatInrCompact(v)}
                />
                <Tooltip
                  cursor={{ fill: "var(--color-muted)" }}
                  content={({ active, payload, label }: any) => {
                    if (!active || !payload || !payload.length) return null;
                    const base = Number(payload[0]?.value ?? 0);
                    const stress = Number(payload[1]?.value ?? 0);
                    const delta = stress - base;
                    const pct = base > 0 ? (delta / base) * 100 : 0;
                    return (
                      <div className="rounded-lg border border-border bg-surface p-2.5 shadow-xl text-xs space-y-1.5 min-w-44">
                        <div className="font-semibold text-foreground border-b border-border/60 pb-1">
                          Risk Grade: {label}
                        </div>
                        <div className="space-y-0.5 text-[11px]">
                          <div className="flex justify-between">
                            <span className="text-muted-foreground">Baseline ECL:</span>
                            <span className="font-mono">{formatInrCompact(base)}</span>
                          </div>
                          <div className="flex justify-between">
                            <span className="text-muted-foreground">Stressed ECL:</span>
                            <span className="font-mono text-band-d font-semibold">{formatInrCompact(stress)}</span>
                          </div>
                          <div className="flex justify-between pt-1 border-t border-border/40">
                            <span className="text-muted-foreground">Stress Delta:</span>
                            <span className="font-mono font-medium text-band-d">
                              +{formatInrCompact(delta)} (+{pct.toFixed(1)}%)
                            </span>
                          </div>
                        </div>
                      </div>
                    );
                  }}
                />
                <Bar isAnimationActive={false} dataKey="base" name="Baseline" fill="var(--color-chart-1)" radius={[4, 4, 0, 0]} />
                <Bar isAnimationActive={false} dataKey="stress" name="Stressed" fill="var(--color-band-d)" radius={[4, 4, 0, 0]} />
              </ComposedChart>
            </ResponsiveContainer>
          </CardContent>
        </Card>
      </div>

      {/* Sector Sensitivity Matrix */}
      {bySector.length > 0 && (
        <Card
          id="sector-matrix-card"
          className={cn(
            "bg-surface scroll-mt-20 transition-all duration-500",
            highlightSectorMatrix && "ring-4 ring-red-500/80 ring-offset-2 animate-pulse shadow-2xl border-red-500/60"
          )}
        >
          <CardHeader className="pb-2">
            <div className="flex items-center justify-between">
              <div>
                <CardTitle className="text-sm flex items-center gap-1.5">
                  <Layers className="h-4 w-4 text-primary" />
                  Sector Vulnerability Matrix
                  <HintIcon text="Industry macro-betas applied to the live IDBI portfolio. Beta > 1.0 reflects cyclical amplification; Beta < 1.0 reflects defensive resilience." />
                </CardTitle>
                <CardDescription className="text-xs">
                  Industry macro-betas applied to the live IDBI portfolio. Higher beta indicates higher cyclical sensitivity.
                </CardDescription>
              </div>
              <Badge variant="outline" className="text-xs font-normal">
                {bySector.length} Sectors Active
              </Badge>
            </div>
          </CardHeader>
          <CardContent className="p-0">
            <div className="overflow-x-auto">
              <table className="w-full text-xs min-w-[780px]">
                <thead>
                  <tr className="border-b border-border bg-muted/30 text-left text-muted-foreground">
                    <th className="px-4 py-2 font-medium">Sector</th>
                    <th className="px-4 py-2 font-medium">
                      <span className="inline-flex items-center gap-1">
                        Macro Beta
                        <HintIcon text="Cyclical vulnerability factor (β). Higher β amplifies GDP and repo shocks." />
                      </span>
                    </th>
                    <th className="px-4 py-2 font-medium">
                      <span className="inline-flex items-center gap-1">
                        Facilities
                        <HintIcon text="Count of commercial credit facilities active in this industry sector." />
                      </span>
                    </th>
                    <th className="px-4 py-2 font-medium">
                      <span className="inline-flex items-center gap-1">
                        Baseline ECL
                        <HintIcon text="Current pre-shock Ind AS 109 impairment reserve for this sector in INR." />
                      </span>
                    </th>
                    <th className="px-4 py-2 font-medium">
                      <span className="inline-flex items-center gap-1">
                        Stressed ECL
                        <HintIcon text="Simulated post-shock Ind AS 109 impairment reserve under applied macro stress." />
                      </span>
                    </th>
                    <th className="px-4 py-2 font-medium text-right">
                      <span className="inline-flex items-center justify-end gap-1 w-full">
                        ECL Uplift
                        <HintIcon text="Percentage expansion in impairment reserves due to applied macro distress." />
                      </span>
                    </th>
                    <th className="px-4 py-2 font-medium text-right">
                      <span className="inline-flex items-center justify-end gap-1 w-full">
                        Action
                        <HintIcon text="Click to target this sector for specific shock simulation." />
                      </span>
                    </th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-border">
                  {bySector.map((s) => (
                    <tr
                      key={s.sector}
                      onClick={() => handleSelectTargetSector(s.sector)}
                      className={cn(
                        "hover:bg-muted/30 cursor-pointer transition-colors",
                        targetSector === s.sector && "bg-primary/5 font-medium",
                      )}
                      title={`Click to set ${s.sector.replace(/_/g, " ")} as the target sector for shock`}
                    >
                      <td className="px-4 py-2.5 font-medium capitalize flex items-center gap-1.5">
                        {targetSector === s.sector && (
                          <span className="h-1.5 w-1.5 rounded-full bg-primary shrink-0" />
                        )}
                        {s.sector.replace(/_/g, " ")}
                      </td>
                      <td className="px-4 py-2.5 tabular-nums">
                        <Badge variant="outline" className={`text-[10px] font-normal ${s.beta >= 1.3 ? "border-rose-500/30 text-rose-600 bg-rose-500/10" : s.beta <= 0.85 ? "border-emerald-500/30 text-emerald-600 bg-emerald-500/10" : ""}`}>
                          β = {s.beta.toFixed(2)}
                        </Badge>
                      </td>
                      <td className="px-4 py-2.5 tabular-nums text-muted-foreground">
                        {s.accounts}
                      </td>
                      <td className="px-4 py-2.5 tabular-nums font-medium">
                        {formatInrCompact(s.base_ecl)}
                      </td>
                      <td className="px-4 py-2.5 tabular-nums font-semibold text-band-d">
                        {formatInrCompact(s.stressed_ecl)}
                      </td>
                      <td className="px-4 py-2.5 tabular-nums text-right font-medium">
                        <span className={s.uplift_pct > 30 ? "text-rose-600 font-semibold" : s.uplift_pct > 0 ? "text-amber-600" : "text-emerald-600"}>
                          +{s.uplift_pct.toFixed(1)}%
                        </span>
                      </td>
                      <td className="px-4 py-2.5 text-right">
                        {targetSector === s.sector ? (
                          <Badge variant="outline" className="text-[10px] font-medium border-rose-500/40 text-rose-600 bg-rose-500/15">
                            🎯 Target (+{sectorStress}%)
                          </Badge>
                        ) : targetSector === "all_cyclical" && s.beta >= 1.2 && sectorStress > 0 ? (
                          <Badge variant="outline" className="text-[10px] font-normal border-amber-500/30 text-amber-600 bg-amber-500/10">
                            ⚡ Cyclical Shock
                          </Badge>
                        ) : (
                          <button
                            type="button"
                            onClick={(e) => {
                              e.stopPropagation();
                              handleSelectTargetSector(s.sector);
                            }}
                            className="inline-flex items-center gap-1 rounded border border-border px-2 py-0.5 text-[10px] font-medium text-muted-foreground hover:text-primary hover:border-primary/40 hover:bg-primary/5 transition-colors cursor-pointer"
                            title={`Set ${s.sector} as the target sector for simulation`}
                          >
                            <Target className="h-2.5 w-2.5" />
                            Target
                          </button>
                        )}
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
          <FlaskConical className="mt-0.5 h-4 w-4 shrink-0 text-accent" />
          <p className="text-xs leading-relaxed text-muted-foreground">
            Methodology: Each facility's calibrated PD is shifted in log-odds space by{" "}
            <code className="rounded bg-muted px-1 py-0.5 text-[10px]">
              β × (0.002 × repo_bps + 0.08 × gdp_drop)
            </code>{" "}
            via the live backend <code className="rounded bg-muted px-1 py-0.5 text-[10px]">/scenario/simulate</code> service.
            Origination-year macro features were evaluated and discarded to prevent chronological distribution bias; scenario stress testing across the active book provides actionable controlling-office oversight without model degradation.
          </p>
        </CardContent>
      </Card>
    </div>
  );
}
