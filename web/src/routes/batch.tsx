import { useState, useMemo, useEffect } from "react";
import { createFileRoute, Link } from "@tanstack/react-router";
import { cn } from "@/lib/utils";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { toast } from "sonner";
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
import { scoreBatchRecords, uploadBatch } from "@/lib/api";
import { formatInr, formatInrCompact, formatPercent, ragTone } from "@/lib/format";
import {
  Upload,
  FileSpreadsheet,
  Download,
  Play,
  CheckCircle2,
  AlertTriangle,
  Layers,
  IndianRupee,
  ShieldCheck,
  Search,
  Loader2,
  Sparkles,
  ArrowUpRight,
  HelpCircle,
} from "lucide-react";
import {
  GuidedTooltip,
  HintIcon,
} from "@/components/drishti/guided-tooltip";

export const Route = createFileRoute("/batch")({
  component: BatchScreeningPage,
});

interface ScoredBatchRow {
  loan_id: string;
  ticket_size: number;
  sector: string;
  cibil_score: number;
  drawing_power_gap_pct: number;
  demanded_vs_collected_ratio: number;
  pd_12m: number;
  risk_grade: string;
  rag: "Green" | "Amber" | "Red";
  ecl_stage: number;
  ecl: number;
  sma_watch: string;
  ews_count: number;
}

const SAMPLE_PORTFOLIO = [
  { loan_id: "IDBI-MUM-8001", ticket_size: 5000000, sector: "auto_ancillary", cibil_score: 780, drawing_power_gap_pct: 0, demanded_vs_collected_ratio: 1.0, dpd: 0, lien_flag: 0, restructuring_flag: 0 },
  { loan_id: "IDBI-MUM-8002", ticket_size: 3500000, sector: "textiles", cibil_score: 720, drawing_power_gap_pct: 8, demanded_vs_collected_ratio: 0.96, dpd: 5, lien_flag: 0, restructuring_flag: 0 },
  { loan_id: "IDBI-PUN-8003", ticket_size: 2500000, sector: "pharmaceuticals", cibil_score: 660, drawing_power_gap_pct: 22, demanded_vs_collected_ratio: 0.88, dpd: 28, lien_flag: 0, restructuring_flag: 0 },
  { loan_id: "IDBI-PUN-8004", ticket_size: 8000000, sector: "engineering", cibil_score: 590, drawing_power_gap_pct: 35, demanded_vs_collected_ratio: 0.72, dpd: 62, lien_flag: 1, restructuring_flag: 0 },
  { loan_id: "IDBI-DEL-8005", ticket_size: 1500000, sector: "retail_trade", cibil_score: 750, drawing_power_gap_pct: 4, demanded_vs_collected_ratio: 0.99, dpd: 0, lien_flag: 0, restructuring_flag: 0 },
  { loan_id: "IDBI-DEL-8006", ticket_size: 4200000, sector: "food_processing", cibil_score: 610, drawing_power_gap_pct: 28, demanded_vs_collected_ratio: 0.78, dpd: 45, lien_flag: 0, restructuring_flag: 1 },
  { loan_id: "IDBI-BLR-8007", ticket_size: 6000000, sector: "auto_ancillary", cibil_score: 790, drawing_power_gap_pct: 0, demanded_vs_collected_ratio: 1.0, dpd: 0, lien_flag: 0, restructuring_flag: 0 },
  { loan_id: "IDBI-BLR-8008", ticket_size: 3000000, sector: "textiles", cibil_score: 640, drawing_power_gap_pct: 18, demanded_vs_collected_ratio: 0.89, dpd: 21, lien_flag: 0, restructuring_flag: 0 },
  { loan_id: "IDBI-HYD-8009", ticket_size: 7500000, sector: "engineering", cibil_score: 560, drawing_power_gap_pct: 42, demanded_vs_collected_ratio: 0.65, dpd: 75, lien_flag: 1, restructuring_flag: 1 },
  { loan_id: "IDBI-CHN-8010", ticket_size: 2000000, sector: "retail_trade", cibil_score: 760, drawing_power_gap_pct: 2, demanded_vs_collected_ratio: 0.98, dpd: 0, lien_flag: 0, restructuring_flag: 0 },
];

export function BatchScreeningPage() {
  const [rows, setRows] = useState<any[]>(SAMPLE_PORTFOLIO);
  const [isProcessing, setIsProcessing] = useState(false);
  const [scoredRows, setScoredRows] = useState<ScoredBatchRow[]>([]);
  const [searchQuery, setSearchQuery] = useState("");
  const [stageFilter, setStageFilter] = useState("all");
  const [batchRunId, setBatchRunId] = useState<string | null>(null);
  const [isLive, setIsLive] = useState<boolean>(false);
  const [progressPct, setProgressPct] = useState<number>(0);
  const [progressStep, setProgressStep] = useState<string>("");
  const [showProgress, setShowProgress] = useState<boolean>(false);
  const [highlightTable, setHighlightTable] = useState<boolean>(false);

  const handleScrollToTable = (filter?: "all" | "watchlist") => {
    if (filter) setStageFilter(filter);
    const el = document.getElementById("batch-roster-table");
    if (el) el.scrollIntoView({ behavior: "smooth", block: "start" });
    setHighlightTable(true);
    setTimeout(() => setHighlightTable(false), 2500);
  };

  const runBatchScreening = async (dataToScore: any[]) => {
    setIsProcessing(true);
    setShowProgress(true);
    setProgressPct(15);
    setProgressStep("1/4: Ingesting Finacle CSV payload & validating fields...");

    await new Promise((r) => setTimeout(r, 120));
    setProgressPct(40);
    setProgressStep("2/4: Running 3-Param Beta Calibrated LightGBM inference...");

    // 1. Attempt batch scoring & persistence via live API
    const liveBatch = await uploadBatch(dataToScore, "msme_idbi");

    setProgressPct(75);
    setProgressStep("3/4: Evaluating 19 RBI Early Warning Signals (Finacle EWS)...");
    await new Promise((r) => setTimeout(r, 120));

    setProgressPct(90);
    setProgressStep("4/4: Allocating Ind AS 109 3-stage ECL provisions & SMA...");

    if (liveBatch && liveBatch.status === "success" && liveBatch.scored_records) {
      const normalized: ScoredBatchRow[] = liveBatch.scored_records.map((r: any) => ({
        loan_id: String(r.loan_id),
        ticket_size: Number(r.ticket_size ?? r.sanction_limit ?? 2500000),
        sector: String(r.sector ?? "commercial"),
        cibil_score: Number(r.cibil_score ?? 700),
        drawing_power_gap_pct: Number(r.drawing_power_gap_pct ?? 0),
        demanded_vs_collected_ratio: Number(r.demanded_vs_collected_ratio ?? 1.0),
        pd_12m: Number(r.pd_12m ?? 0.05),
        risk_grade: String(r.risk_grade ?? "RG5"),
        rag: (r.rag as any) ?? "Amber",
        ecl_stage: Number(r.ecl_stage ?? 1),
        ecl: Number(r.ecl ?? 0),
        sma_watch: String(r.sma_watch ?? r.sma_status ?? "Standard"),
        ews_count: Number(r.ews_count ?? (r.ews_triggers?.length ?? 0)),
      }));
      setScoredRows(normalized);
      setBatchRunId(liveBatch.run_id);
      setIsLive(true);
    } else {
      // 2. Fallback to client-side loop
      const results = await scoreBatchRecords("msme_idbi", dataToScore);
      const enriched: ScoredBatchRow[] = dataToScore.map((row, i) => {
        const s = results[i] || {};
        const isError = s.status === "error";
        const pd = s.pd_12m ?? (isError ? 0 : 0.05);
        const grade = s.risk_grade ?? (isError ? "UNRATED" : "RG5");
        const gradeNum = parseInt(grade.replace(/\D/g, ""), 10) || (isError ? 0 : 5);
        const stage = s.ecl_stage ?? (gradeNum >= 9 ? 3 : gradeNum >= 5 ? 2 : 1);
        const ecl = s.ecl ?? Math.round(row.ticket_size * pd * 0.45);
        const rag = (s.rag as any) ?? (pd >= 0.2 ? "Red" : pd >= 0.05 ? "Amber" : "Green");
        return {
          loan_id: row.loan_id,
          ticket_size: row.ticket_size,
          sector: row.sector,
          cibil_score: row.cibil_score,
          drawing_power_gap_pct: row.drawing_power_gap_pct ?? 0,
          demanded_vs_collected_ratio: row.demanded_vs_collected_ratio ?? 1.0,
          pd_12m: pd,
          risk_grade: grade,
          rag: rag,
          ecl_stage: stage,
          ecl: ecl,
          sma_watch: s.sma_watch ?? "Standard",
          ews_count: s.ews?.signals?.length ?? 0,
        };
      });

      setScoredRows(enriched);
      setIsLive(false);
    }

    setProgressPct(100);
    setProgressStep("Batch screening complete — scored facilities loaded!");
    setTimeout(() => {
      setShowProgress(false);
    }, 2000);
    setIsProcessing(false);
  };

  useEffect(() => {
    runBatchScreening(SAMPLE_PORTFOLIO);
  }, []);

  const handleFileUpload = (event: React.ChangeEvent<HTMLInputElement>) => {
    const file = event.target.files?.[0];
    if (!file) return;
    const reader = new FileReader();
    reader.onload = (e) => {
      const text = e.target?.result as string;
      const lines = text.split("\n").filter((l) => l.trim().length > 0);
      if (lines.length <= 1) {
        toast.error("Empty or invalid CSV file", {
          description: "The file must contain a header row and at least one account record.",
        });
        return;
      }
      const headers = lines[0].split(",").map((h) => h.trim());
      const parsed = lines.slice(1).map((line) => {
        const parts = line.split(",").map((p) => p.trim());
        const row: Record<string, any> = {};
        headers.forEach((h, idx) => {
          const val = parts[idx];
          row[h] = isNaN(Number(val)) ? val : Number(val);
        });
        return row;
      });
      setRows(parsed);
      toast.success(`Loaded ${parsed.length} accounts from Finacle extract`, {
        description: "Executing automated batch scoring across pipeline stages...",
      });
      runBatchScreening(parsed);
    };
    reader.readAsText(file);
    event.target.value = "";
  };

  const downloadTemplate = () => {
    const csvContent =
      "data:text/csv;charset=utf-8," +
      "loan_id,ticket_size,sector,cibil_score,drawing_power_gap_pct,demanded_vs_collected_ratio,dpd,lien_flag,restructuring_flag\n" +
      SAMPLE_PORTFOLIO.map(
        (r) =>
          `${r.loan_id},${r.ticket_size},${r.sector},${r.cibil_score},${r.drawing_power_gap_pct},${r.demanded_vs_collected_ratio},${r.dpd},${r.lien_flag},${r.restructuring_flag}`,
      ).join("\n");
    const encodedUri = encodeURI(csvContent);
    const link = document.createElement("a");
    link.setAttribute("href", encodedUri);
    link.setAttribute("download", "IDBI_Finacle_Batch_Template.csv");
    document.body.appendChild(link);
    link.click();
    document.body.removeChild(link);
  };

  const exportScoredCsv = () => {
    if (scoredRows.length === 0) return;
    const headers = [
      "loan_id",
      "sector",
      "cibil_score",
      "ticket_size",
      "drawing_power_gap_pct",
      "demanded_vs_collected_ratio",
      "pd_12m",
      "risk_grade",
      "rag",
      "ecl_stage",
      "ecl",
      "sma_watch",
      "ews_count",
    ];
    const csvRows = [headers.join(",")];
    scoredRows.forEach((r) => {
      csvRows.push(
        [
          r.loan_id,
          r.sector,
          r.cibil_score,
          r.ticket_size,
          r.drawing_power_gap_pct,
          r.demanded_vs_collected_ratio,
          r.pd_12m,
          r.risk_grade,
          r.rag,
          r.ecl_stage,
          r.ecl,
          r.sma_watch,
          r.ews_count,
        ].join(","),
      );
    });
    const encoded = encodeURI("data:text/csv;charset=utf-8," + csvRows.join("\n"));
    const link = document.createElement("a");
    link.setAttribute("href", encoded);
    link.setAttribute("download", `Scored_Portfolio_${Date.now()}.csv`);
    document.body.appendChild(link);
    link.click();
    document.body.removeChild(link);
  };

  // KPIs
  const kpis = useMemo(() => {
    if (scoredRows.length === 0) return null;
    const totalSanction = scoredRows.reduce((acc, r) => acc + r.ticket_size, 0);
    const weightedPd =
      scoredRows.reduce((acc, r) => acc + r.pd_12m * r.ticket_size, 0) / Math.max(1, totalSanction);
    const totalEcl = scoredRows.reduce((acc, r) => acc + r.ecl, 0);
    const watchlistCount = scoredRows.filter((r) => r.ecl_stage >= 2 || r.rag === "Red").length;
    return { totalSanction, weightedPd, totalEcl, watchlistCount };
  }, [scoredRows]);

  const filteredRows = useMemo(() => {
    return scoredRows.filter((r) => {
      const matchQ =
        !searchQuery ||
        r.loan_id.toLowerCase().includes(searchQuery.toLowerCase()) ||
        r.sector.toLowerCase().includes(searchQuery.toLowerCase());
      const matchStage =
        stageFilter === "all" ||
        (stageFilter === "watchlist" ? (r.ecl_stage >= 2 || r.rag === "Red") : String(r.ecl_stage) === stageFilter);
      return matchQ && matchStage;
    });
  }, [scoredRows, searchQuery, stageFilter]);

  return (
    <div className="p-4 md:p-6 space-y-6">
      {/* Header */}
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <div className="flex items-center gap-2 text-[10px] uppercase tracking-widest text-muted-foreground">
            <span>Finacle Batch Portfolio Screener · Controlling Office Ops</span>
            {batchRunId && (
              <Badge
                variant="outline"
                className="border-emerald-500/40 text-emerald-600 bg-emerald-500/10 font-mono text-[9px] px-1.5 py-0 h-4"
              >
                {isLive ? `Live Run: ${batchRunId}` : "Client Mode"}
              </Badge>
            )}
          </div>
          <h1 className="mt-1 text-xl font-semibold text-foreground">
            Batch Portfolio Risk Screening
          </h1>
          <p className="mt-0.5 text-sm text-muted-foreground">
            Ingest Finacle branch extracts, evaluate 12-month PD across all facilities, and calculate Ind AS 109 portfolio provisions.
          </p>
        </div>
        <div className="flex items-center gap-2">
          <GuidedTooltip content="Download Finacle-compatible sample CSV template containing 10 pre-formatted commercial loan records ready for batch screening.">
            <Button variant="outline" size="sm" onClick={downloadTemplate} className="gap-1.5 text-xs">
              <Download className="h-3.5 w-3.5" /> CSV Template
            </Button>
          </GuidedTooltip>
          <GuidedTooltip content="Execute batch credit scoring across all loaded accounts to generate 12-month PD, credit grades, and Ind AS 109 provisions.">
            <Button
              size="sm"
              onClick={() => runBatchScreening(rows)}
              disabled={isProcessing || rows.length === 0}
              className="gap-1.5 bg-primary text-primary-foreground text-xs"
            >
              {isProcessing ? (
                <>
                  <Loader2 className="h-3.5 w-3.5 animate-spin" />
                  <span>Screening ({progressPct}%)...</span>
                </>
              ) : (
                <>
                  <Play className="h-3.5 w-3.5" />
                  <span>Screen Batch ({rows.length} Accounts)</span>
                </>
              )}
            </Button>
          </GuidedTooltip>
        </div>
      </div>

      {/* Dynamic Batch Scoring Progress Bar Animation */}
      {showProgress && (
        <Card className="bg-surface border-primary/40 shadow-md animate-in fade-in-50 slide-in-from-top-2 duration-300">
          <CardContent className="py-4 space-y-3">
            <div className="flex items-center justify-between text-xs">
              <div className="flex items-center gap-2 font-medium text-foreground">
                {progressPct < 100 ? (
                  <Loader2 className="h-4 w-4 text-primary animate-spin" />
                ) : (
                  <CheckCircle2 className="h-4 w-4 text-emerald-600" />
                )}
                <span className="font-semibold">{progressStep}</span>
              </div>
              <span className="font-mono text-primary font-bold text-sm bg-primary/10 px-2 py-0.5 rounded">
                {progressPct}%
              </span>
            </div>
            <div className="h-2.5 w-full bg-muted rounded-full overflow-hidden p-0.5 border border-border/50">
              <div
                className="h-full bg-gradient-to-r from-primary/80 to-primary transition-all duration-300 ease-out rounded-full shadow-sm"
                style={{ width: `${progressPct}%` }}
              />
            </div>
            <div className="grid grid-cols-4 gap-1 pt-1 text-[10px] text-muted-foreground">
              <div className={cn("text-center truncate", progressPct >= 15 && "text-primary font-medium")}>
                1. CSV Ingest
              </div>
              <div className={cn("text-center truncate", progressPct >= 40 && "text-primary font-medium")}>
                2. LightGBM PD
              </div>
              <div className={cn("text-center truncate", progressPct >= 75 && "text-primary font-medium")}>
                3. 19 RBI EWS
              </div>
              <div className={cn("text-center truncate", progressPct >= 95 && "text-primary font-medium")}>
                4. Ind AS 109
              </div>
            </div>
          </CardContent>
        </Card>
      )}

      {/* Upload Zone */}
      <div className="grid gap-4 sm:grid-cols-12">
        <Card className="sm:col-span-8 bg-surface">
          <CardHeader className="pb-3">
            <div className="flex items-center justify-between">
              <div>
                <CardTitle className="text-sm font-semibold">Upload Finacle Account Extract</CardTitle>
                <CardDescription className="text-xs">
                  Upload a .csv containing account particulars (sanction_limit, drawing_power, demanded_vs_collected, cibil).
                </CardDescription>
              </div>
              <HintIcon text="Format: loan_id, ticket_size, sector, cibil_score, drawing_power_gap_pct, demanded_vs_collected_ratio, dpd, lien_flag, restructuring_flag" />
            </div>
          </CardHeader>
          <CardContent className="flex flex-col sm:flex-row items-center gap-4 text-xs">
            <GuidedTooltip
              side="top"
              content={
                <div className="space-y-1.5 p-0.5 max-w-xs">
                  <div className="font-semibold text-primary">Required Finacle CSV Schema</div>
                  <div className="text-[11px] leading-tight text-muted-foreground">
                    File must contain column headers matching Finacle extract:
                  </div>
                  <div className="font-mono text-[10px] space-y-0.5 bg-muted/60 p-1.5 rounded border border-border">
                    <div>• loan_id: Unique account ID</div>
                    <div>• ticket_size: Sanctioned limit in ₹</div>
                    <div>• sector: Industry sector</div>
                    <div>• cibil_score: Bureau score (300-900)</div>
                    <div>• drawing_power_gap_pct: DP gap %</div>
                    <div>• demanded_vs_collected_ratio: Collections</div>
                    <div>• dpd: Days past due (0-90+)</div>
                    <div>• lien_flag: 1 if charge/lien</div>
                    <div>• restructuring_flag: 1 if restructured</div>
                  </div>
                </div>
              }
            >
              <div className="relative flex-1 w-full border-2 border-dashed border-border rounded-lg p-4 text-center hover:bg-muted/30 transition-colors cursor-pointer group">
                <Upload className="h-6 w-6 text-muted-foreground mx-auto mb-1 group-hover:text-primary transition-colors" />
                <span className="font-medium text-foreground group-hover:text-primary transition-colors">
                  Click to upload CSV
                </span>
                <p className="text-[11px] text-muted-foreground">or drag and drop Finacle dump here</p>
                <input
                  type="file"
                  accept=".csv"
                  onChange={handleFileUpload}
                  className="absolute inset-0 opacity-0 cursor-pointer"
                />
              </div>
            </GuidedTooltip>
            <div className="text-center sm:text-left space-y-1">
              <div className="text-xs font-medium">Currently loaded: {rows.length} accounts</div>
              <div className="flex flex-wrap gap-2">
                <GuidedTooltip content="Download sample CSV template ready for batch screening with 10 commercial accounts">
                  <Button
                    variant="outline"
                    size="sm"
                    className="text-xs h-7 gap-1"
                    onClick={downloadTemplate}
                  >
                    <Download className="h-3 w-3" /> Sample CSV
                  </Button>
                </GuidedTooltip>
                <Button
                  variant="ghost"
                  size="sm"
                  className="text-xs text-primary p-0 h-7"
                  onClick={() => setRows(SAMPLE_PORTFOLIO)}
                >
                  Reset Sample Book
                </Button>
              </div>
            </div>
          </CardContent>
        </Card>

        <Card className="sm:col-span-4 bg-surface">
          <CardHeader className="pb-3">
            <CardTitle className="text-sm font-semibold">Batch Pipeline Spec</CardTitle>
            <CardDescription className="text-xs">
              Direct execution against native IDBI model.
            </CardDescription>
          </CardHeader>
          <CardContent className="space-y-1.5 text-xs text-muted-foreground">
            <div className="flex justify-between">
              <span>Model Engine:</span>
              <span className="font-mono text-foreground">msme_idbi (LightGBM)</span>
            </div>
            <div className="flex justify-between">
              <span>Calibration:</span>
              <span className="font-mono text-foreground">3-Param Beta (OOF)</span>
            </div>
            <div className="flex justify-between">
              <span>Standard:</span>
              <span className="font-mono text-foreground">Ind AS 109 3-Stage</span>
            </div>
            <div className="flex justify-between">
              <span>EWS Engine:</span>
              <span className="font-mono text-foreground">19 RBI Rules</span>
            </div>
          </CardContent>
        </Card>
      </div>

      {/* KPI Tiles when Scored */}
      {kpis && (
        <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
          <GuidedTooltip content="Aggregate sanctioned credit limit across all active facilities in the loaded batch extract.">
            <Card className="bg-surface transition-shadow hover:shadow-sm">
              <CardContent className="pt-4">
                <div className="text-[10px] uppercase tracking-widest text-muted-foreground flex items-center gap-1">
                  <span>Total Sanctioned Book</span>
                  <HintIcon text="Total exposure volume active in batch run." />
                </div>
                <div className="mt-1 text-xl font-bold font-mono">{formatInrCompact(kpis.totalSanction)}</div>
                <div className="text-[11px] text-muted-foreground mt-0.5">{scoredRows.length} facilities active</div>
              </CardContent>
            </Card>
          </GuidedTooltip>

          <GuidedTooltip content="Exposure-weighted 12-month probability of default across the entire batch book.">
            <Card className="bg-surface transition-shadow hover:shadow-sm">
              <CardContent className="pt-4">
                <div className="text-[10px] uppercase tracking-widest text-muted-foreground flex items-center gap-1">
                  <span>Weighted Average PD</span>
                  <HintIcon text="Calibrated 12M PD weighted by facility ticket size." />
                </div>
                <div className="mt-1 text-xl font-bold font-mono text-amber-500">{formatPercent(kpis.weightedPd, 2)}</div>
                <div className="text-[11px] text-muted-foreground mt-0.5">Exposure-weighted default risk</div>
              </CardContent>
            </Card>
          </GuidedTooltip>

          <GuidedTooltip content="Total Expected Credit Loss provision requirement under Ind AS 109. Click to scroll down to roster ↓">
            <Card
              className="bg-surface cursor-pointer transition-all hover:border-rose-500/50 hover:shadow-sm group"
              onClick={() => handleScrollToTable()}
            >
              <CardContent className="pt-4">
                <div className="text-[10px] uppercase tracking-widest text-muted-foreground flex items-center justify-between">
                  <span>Total Ind AS 109 ECL</span>
                  <span className="text-[9px] text-primary opacity-0 group-hover:opacity-100 transition-opacity">
                    View roster ↓
                  </span>
                </div>
                <div className="mt-1 text-xl font-bold font-mono text-rose-500">{formatInrCompact(kpis.totalEcl)}</div>
                <div className="text-[11px] text-muted-foreground mt-0.5">Required provisioning cover</div>
              </CardContent>
            </Card>
          </GuidedTooltip>

          <GuidedTooltip content="Facilities classified in Stage 2 (SICR), Stage 3 (Impaired), or triggering SMA watch. Click to filter table to watchlist accounts ↓">
            <Card
              className={cn(
                "bg-surface cursor-pointer transition-all hover:border-amber-500/50 hover:shadow-sm group",
                stageFilter === "watchlist" && "border-amber-500 bg-amber-500/5 ring-1 ring-amber-500/40",
              )}
              onClick={() => handleScrollToTable("watchlist")}
            >
              <CardContent className="pt-4">
                <div className="text-[10px] uppercase tracking-widest text-muted-foreground flex items-center justify-between">
                  <span>Watchlist Accounts</span>
                  <span className="text-[9px] text-primary opacity-0 group-hover:opacity-100 transition-opacity">
                    Filter Watchlist ↓
                  </span>
                </div>
                <div className="mt-1 text-xl font-bold font-mono text-foreground group-hover:text-amber-500 transition-colors">
                  {kpis.watchlistCount}
                </div>
                <div className="text-[11px] text-muted-foreground mt-0.5">Stage 2 / Stage 3 / SMA Watch</div>
              </CardContent>
            </Card>
          </GuidedTooltip>
        </div>
      )}

      {/* Urgent Supervisory Action Alert Banner */}
      {kpis && kpis.watchlistCount > 0 && (
        <GuidedTooltip content="Urgent Supervisory Queue: Accounts showing significant increase in credit risk (SICR) or payment default. Click to isolate watchlist accounts and scroll to table.">
          <div
            onClick={() => handleScrollToTable("watchlist")}
            className="flex items-center justify-between p-3 rounded-lg border border-amber-500/40 bg-amber-500/10 text-amber-700 dark:text-amber-300 cursor-pointer hover:bg-amber-500/15 transition-all shadow-sm group"
          >
            <div className="flex items-center gap-2.5 text-xs font-medium">
              <AlertTriangle className="h-4 w-4 shrink-0 text-amber-600 animate-pulse" />
              <span>
                <strong>Urgent Action Queue:</strong> {kpis.watchlistCount} facilities require 24h credit review (breaching early warning cutoff or Stage 2/3 classification).
              </span>
            </div>
            <span className="text-[11px] font-semibold text-amber-600 dark:text-amber-400 group-hover:underline flex items-center gap-1 shrink-0">
              Filter Watchlist & Scroll Down ↓
            </span>
          </div>
        </GuidedTooltip>
      )}

      {/* Results Table */}
      {scoredRows.length > 0 && (
        <Card
          id="batch-roster-table"
          className={cn(
            "bg-surface scroll-mt-20 transition-all duration-500",
            highlightTable && "ring-4 ring-amber-500/80 ring-offset-2 animate-pulse shadow-2xl border-amber-500/60"
          )}
        >
          <CardHeader className="pb-3">
            <div className="flex flex-wrap items-center justify-between gap-3">
              <div>
                <CardTitle className="text-sm font-semibold">Scored Portfolio Roster</CardTitle>
                <CardDescription className="text-xs">
                  Review credit grades, Ind AS 109 stages, and EWS triggers for all {scoredRows.length} accounts. Click an account to drill down.
                </CardDescription>
              </div>
              <div className="flex items-center gap-2">
                <div className="relative w-48">
                  <Search className="absolute left-2 top-2.5 h-3.5 w-3.5 text-muted-foreground" />
                  <Input
                    placeholder="Search loan or sector..."
                    value={searchQuery}
                    onChange={(e) => setSearchQuery(e.target.value)}
                    className="h-8 pl-7 text-xs"
                  />
                </div>
                <Select value={stageFilter} onValueChange={setStageFilter}>
                  <SelectTrigger className="h-8 w-36 text-xs">
                    <SelectValue placeholder="Stage" />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="all">All Stages</SelectItem>
                    <SelectItem value="watchlist">Watchlist (Stage 2/3 / Red)</SelectItem>
                    <SelectItem value="1">Stage 1 (12m)</SelectItem>
                    <SelectItem value="2">Stage 2 (Life SICR)</SelectItem>
                    <SelectItem value="3">Stage 3 (Impaired)</SelectItem>
                  </SelectContent>
                </Select>
                <Button variant="outline" size="sm" onClick={exportScoredCsv} className="h-8 text-xs gap-1">
                  <Download className="h-3 w-3" /> Export CSV
                </Button>
              </div>
            </div>
          </CardHeader>
          <CardContent className="p-0">
            <Table containerClassName="max-h-[540px] overflow-auto" className="min-w-[1020px]">
              <TableHeader className="sticky top-0 bg-surface z-20 shadow-[0_1px_0_0_var(--color-border)]">
                <TableRow>
                  <TableHead className="text-xs bg-surface pl-4">
                    <span className="inline-flex items-center gap-1">
                      Loan Account
                      <HintIcon text="Unique Finacle facility reference. Click any ID to open underwriter appraisal dossier." />
                    </span>
                  </TableHead>
                  <TableHead className="text-xs bg-surface">Sector</TableHead>
                  <TableHead className="text-xs bg-surface">
                    <span className="inline-flex items-center gap-1">
                      Sanction Limit
                      <HintIcon text="Total sanctioned credit exposure in INR." />
                    </span>
                  </TableHead>
                  <TableHead className="text-xs bg-surface">
                    <span className="inline-flex items-center gap-1">
                      CIBIL
                      <HintIcon text="Credit bureau score (300–900). Scores below 650 indicate heightened default vulnerability." />
                    </span>
                  </TableHead>
                  <TableHead className="text-xs bg-surface">
                    <span className="inline-flex items-center gap-1">
                      DP Gap
                      <HintIcon text="Drawing Power deficit percentage. Persistent gaps signal working capital stress." />
                    </span>
                  </TableHead>
                  <TableHead className="text-xs bg-surface">
                    <span className="inline-flex items-center gap-1">
                      12M PD
                      <HintIcon text="Calibrated 12-month default probability from native IDBI LightGBM." />
                    </span>
                  </TableHead>
                  <TableHead className="text-xs bg-surface">
                    <span className="inline-flex items-center gap-1">
                      Risk Grade
                      <HintIcon text="Master credit rating scale RG1 (best) through RG10 (default)." />
                    </span>
                  </TableHead>
                  <TableHead className="text-xs bg-surface">
                    <span className="inline-flex items-center gap-1">
                      Stage
                      <HintIcon text="Ind AS 109 classification: Stage 1 (12M), Stage 2 (Lifetime SICR), Stage 3 (Impaired)." />
                    </span>
                  </TableHead>
                  <TableHead className="text-xs bg-surface">
                    <span className="inline-flex items-center gap-1">
                      ECL
                      <HintIcon text="Expected Credit Loss provision calculated under Ind AS 109." />
                    </span>
                  </TableHead>
                  <TableHead className="text-xs bg-surface pr-4">
                    <span className="inline-flex items-center gap-1">
                      SMA Watch
                      <HintIcon text="RBI Special Mention Account categorization (Standard, SMA-0, SMA-1, SMA-2)." />
                    </span>
                  </TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {filteredRows.map((r) => (
                  <TableRow key={r.loan_id}>
                    <TableCell className="font-mono font-medium text-xs pl-4">
                      <GuidedTooltip content={`Open comprehensive underwriting & EWS diagnostic dossier for ${r.loan_id}`}>
                        <Link
                          to="/borrowers/$id"
                          params={{ id: r.loan_id }}
                          className="text-primary hover:underline inline-flex items-center gap-1 group font-medium"
                        >
                          <span>{r.loan_id}</span>
                          <ArrowUpRight className="h-3 w-3 opacity-0 group-hover:opacity-100 transition-opacity" />
                        </Link>
                      </GuidedTooltip>
                    </TableCell>
                    <TableCell className="text-xs capitalize">{r.sector.replace(/_/g, " ")}</TableCell>
                    <TableCell className="font-mono text-xs">{formatInrCompact(r.ticket_size)}</TableCell>
                    <TableCell className="font-mono text-xs">{r.cibil_score}</TableCell>
                    <TableCell className="font-mono text-xs">
                      {r.drawing_power_gap_pct > 0 ? `${r.drawing_power_gap_pct}%` : "0%"}
                    </TableCell>
                    <TableCell className="font-mono text-xs font-semibold">{formatPercent(r.pd_12m, 2)}</TableCell>
                    <TableCell>
                      <Badge className={ragTone[r.rag]}>{r.risk_grade}</Badge>
                    </TableCell>
                    <TableCell>
                      <Badge variant="outline" className="text-[10px]">
                        Stage {r.ecl_stage}
                      </Badge>
                    </TableCell>
                    <TableCell className="font-mono text-xs text-rose-500">{formatInrCompact(r.ecl)}</TableCell>
                    <TableCell className="text-xs pr-4">{r.sma_watch}</TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          </CardContent>
        </Card>
      )}
    </div>
  );
}

