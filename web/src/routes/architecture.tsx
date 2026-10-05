import { useState, useMemo } from "react";
import { createFileRoute, Link } from "@tanstack/react-router";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import {
  Database,
  Search,
  ExternalLink,
  ChevronDown,
  ChevronUp,
  Cpu,
  Workflow,
  CheckCircle2,
  FileCode2,
} from "lucide-react";
import { IDBI_API_REGISTRY, type ApiCategory, type ApiEntry } from "@/lib/data/api-registry";

export const Route = createFileRoute("/architecture")({
  component: ArchitectureView,
});

const PILLARS = [
  {
    step: "01",
    title: "Ingest",
    body: "IDBI Finacle Sandbox APIs (402, 404, 391, 441, 362, 408) + Account Aggregator (590–595) + Kaggle benchmarks land in one canonical schema with T0 performing cohort pruning.",
    tags: ["Finacle APIs", "AA consent", "canonical schema", "leakage guard"],
  },
  {
    step: "02",
    title: "Engineer",
    body: "Drawing Power gaps, debt service demand collection, lien & restructuring flags, cash-flow & alt-data, FinBERT inspection sentiment, macro overlays, and 45-branch org hierarchy.",
    tags: ["Finacle signals", "GST / AA", "FinBERT", "branch network"],
  },
  {
    step: "03",
    title: "Model",
    body: "Optuna-tuned monotone LightGBM + 5-fold Out-Of-Fold Beta Calibration (smooth, zero ties); CatBoost blend; discrete-time hazard model for the PD term structure.",
    tags: ["LightGBM", "Beta calibration", "hazard model", "CatBoost"],
  },
  {
    step: "04",
    title: "Interpret",
    body: "One common framework: calibrated PD → RG1–RG10 → RAG → SMA watch → Ind AS 109 3-stage ECL. SHAP reason codes map to a frozen taxonomy; 19 RBI EWS rules fire alongside.",
    tags: ["grades", "SMA watch", "Ind AS 109", "19 RBI EWS", "cure path"],
  },
  {
    step: "05",
    title: "Serve & Deploy",
    body: "FastAPI gateway (/score, /decisions) backed by RDS PostgreSQL & S3, ECS Fargate containers, SageMaker ml.m5.large endpoint, and this Controlling-Office console with HITL audit logging.",
    tags: ["FastAPI", "ECS Fargate", "RDS PostgreSQL", "HITL audit"],
  },
];

function ArchitectureView() {
  const [apiSearch, setApiSearch] = useState("");
  const [selectedCategory, setSelectedCategory] = useState<string>("all");
  const [expandedApi, setExpandedApi] = useState<string | null>(null);

  const categories = useMemo(() => {
    const list = Array.from(new Set(IDBI_API_REGISTRY.map((a) => a.category)));
    return ["all", ...list];
  }, []);

  const filteredApis = useMemo(() => {
    return IDBI_API_REGISTRY.filter((api) => {
      const matchCat = selectedCategory === "all" || api.category === selectedCategory;
      if (!matchCat) return false;
      if (!apiSearch.trim()) return true;
      const q = apiSearch.toLowerCase();
      return (
        api.apiId.includes(q) ||
        api.name.toLowerCase().includes(q) ||
        api.system.toLowerCase().includes(q) ||
        api.extractedFields.some(
          (f) =>
            f.drishtiFeature.toLowerCase().includes(q) ||
            f.sourceField.toLowerCase().includes(q) ||
            f.description.toLowerCase().includes(q),
        ) ||
        api.rulesOrModels.some((r) => r.toLowerCase().includes(q)) ||
        api.uiLocations.some((u) => u.label.toLowerCase().includes(q))
      );
    });
  }, [apiSearch, selectedCategory]);

  return (
    <div className="p-4 md:p-6 space-y-8">
      <div>
        <h1 className="text-xl font-semibold text-foreground">Architecture & System Blueprint</h1>
      </div>

      {/* 5 Architectural Pillars */}
      <div className="grid gap-3 md:grid-cols-3 xl:grid-cols-5">
        {PILLARS.map((p) => (
          <Card key={p.step} className="bg-surface">
            <CardHeader className="pb-2">
              <div className="text-[11px] font-semibold uppercase tracking-widest text-primary">
                {p.step}
              </div>
              <CardTitle className="text-sm">{p.title}</CardTitle>
            </CardHeader>
            <CardContent className="space-y-2.5">
              <p className="text-xs leading-relaxed text-muted-foreground">{p.body}</p>
              <div className="flex flex-wrap gap-1">
                {p.tags.map((t) => (
                  <Badge
                    key={t}
                    variant="outline"
                    className="bg-muted/60 font-normal text-[11px] text-muted-foreground"
                  >
                    {t}
                  </Badge>
                ))}
              </div>
            </CardContent>
          </Card>
        ))}
      </div>

      {/* IDBI Sandbox API Integration Matrix */}
      <Card id="api-matrix" className="bg-surface border-border shadow-sm">
        <CardHeader className="pb-4 border-b border-border/60">
          <div className="flex flex-col md:flex-row md:items-center justify-between gap-4">
            <div>
              <div className="flex items-center gap-2">
                <Database className="h-4 w-4 text-primary" />
                <CardTitle className="text-base font-semibold">
                  IDBI Sandbox API Lineage & Matrix (PS-4)
                </CardTitle>
                <Badge variant="outline" className="border-emerald-500/40 text-emerald-600 bg-emerald-500/10 text-xs">
                  {IDBI_API_REGISTRY.length} Connected APIs
                </Badge>
              </div>
              <CardDescription className="text-xs text-muted-foreground mt-1">
                Exact end-to-end mapping from IDBI Finacle Core Banking, Account Aggregator (AA), and KYC contracts into DRISHTI's feature matrix, ML models, and console UI routes.
              </CardDescription>
            </div>

            <div className="flex flex-wrap items-center gap-2">
              <div className="relative w-full sm:w-64">
                <Search className="pointer-events-none absolute left-2.5 top-1/2 h-3.5 w-3.5 -translate-y-1/2 text-muted-foreground" />
                <Input
                  value={apiSearch}
                  onChange={(e) => setApiSearch(e.target.value)}
                  placeholder="Filter by API ID, field, rule..."
                  className="h-8 pl-8 text-xs"
                />
              </div>
            </div>
          </div>

          {/* Category Filter Pills */}
          <div className="flex flex-wrap items-center gap-1.5 pt-3">
            {categories.map((cat) => (
              <button
                key={cat}
                type="button"
                onClick={() => setSelectedCategory(cat)}
                className={`px-2.5 py-1 rounded-md text-[11px] font-medium transition-colors ${
                  selectedCategory === cat
                    ? "bg-primary text-primary-foreground font-semibold"
                    : "bg-muted text-muted-foreground hover:text-foreground"
                }`}
              >
                {cat === "all" ? "All APIs (12)" : cat}
              </button>
            ))}
          </div>
        </CardHeader>

        <CardContent className="p-0">
          <div className="overflow-x-auto">
            <Table>
              <TableHeader>
                <TableRow className="text-xs bg-muted/30">
                  <TableHead className="w-24 pl-4">API ID</TableHead>
                  <TableHead className="w-48">Contract Name & System</TableHead>
                  <TableHead className="w-56">Extracted Parameters</TableHead>
                  <TableHead className="w-56">Downstream DRISHTI Rules</TableHead>
                  <TableHead className="w-48">Console UI Location</TableHead>
                  <TableHead className="w-24 text-right pr-4">Schema</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {filteredApis.map((api) => {
                  const isExpanded = expandedApi === api.apiId;
                  return (
                    <>
                      <TableRow
                        key={api.apiId}
                        className={`text-xs transition-colors hover:bg-muted/40 cursor-pointer ${
                          isExpanded ? "bg-muted/20" : ""
                        }`}
                        onClick={() => setExpandedApi(isExpanded ? null : api.apiId)}
                      >
                        <TableCell className="font-mono font-semibold text-primary pl-4">
                          API {api.apiId}
                        </TableCell>
                        <TableCell>
                          <div className="font-medium text-foreground">{api.name}</div>
                          <div className="flex items-center gap-1.5 mt-0.5">
                            <Badge
                              variant="outline"
                              className={`text-[11px] px-1.5 py-0 h-4 ${
                                api.system === "Finacle CBS"
                                  ? "border-blue-500/40 text-blue-600 bg-blue-50/50 dark:bg-blue-950/40"
                                  : api.system.includes("Aggregator")
                                    ? "border-emerald-500/40 text-emerald-600 bg-emerald-50/50 dark:bg-emerald-950/40"
                                    : "border-purple-500/40 text-purple-600 bg-purple-50/50 dark:bg-purple-950/40"
                              }`}
                            >
                              {api.system}
                            </Badge>
                            <span className="text-[11px] text-muted-foreground">{api.category}</span>
                          </div>
                        </TableCell>
                        <TableCell>
                          <div className="space-y-1">
                            {api.extractedFields.map((f) => (
                              <div key={f.drishtiFeature} className="flex items-center gap-1.5">
                                <code className="text-[11px] font-mono text-foreground font-semibold bg-muted px-1 rounded">
                                  {f.drishtiFeature}
                                </code>
                                <span className="text-[11px] text-muted-foreground truncate">
                                  ({f.description})
                                </span>
                              </div>
                            ))}
                          </div>
                        </TableCell>
                        <TableCell>
                          <div className="flex flex-wrap gap-1">
                            {api.rulesOrModels.map((rule) => (
                              <Badge
                                key={rule}
                                variant="outline"
                                className="text-[11px] font-normal border-border bg-background"
                              >
                                {rule}
                              </Badge>
                            ))}
                          </div>
                        </TableCell>
                        <TableCell>
                          <div className="space-y-1">
                            {api.uiLocations.map((loc) => (
                              <div key={loc.route} className="flex items-center gap-1">
                                {loc.route.includes("$") ? (
                                  <span className="text-[11px] font-medium">{loc.label}</span>
                                ) : (
                                <Link
                                  to={loc.route}
                                  onClick={(e) => e.stopPropagation()}
                                  className="text-[11px] text-primary hover:underline font-medium inline-flex items-center gap-0.5"
                                >
                                  {loc.label}
                                  <ExternalLink className="h-2.5 w-2.5" />
                                </Link>
                                )}
                              </div>
                            ))}
                          </div>
                        </TableCell>
                        <TableCell className="text-right pr-4">
                          <Button
                            variant="ghost"
                            size="sm"
                            className="h-7 px-2 text-[11px] gap-1"
                            onClick={(e) => {
                              e.stopPropagation();
                              setExpandedApi(isExpanded ? null : api.apiId);
                            }}
                          >
                            <FileCode2 className="h-3.5 w-3.5" />
                            {isExpanded ? (
                              <ChevronUp className="h-3 w-3" />
                            ) : (
                              <ChevronDown className="h-3 w-3" />
                            )}
                          </Button>
                        </TableCell>
                      </TableRow>

                      {/* Expandable JSON Payload Viewer */}
                      {isExpanded && (
                        <TableRow className="bg-muted/10 border-b border-border/80">
                          <TableCell colSpan={6} className="p-4 pl-6 space-y-3">
                            <div className="text-xs text-muted-foreground leading-relaxed max-w-3xl">
                              <strong>Contract Description:</strong> {api.description}
                            </div>

                            <div className="grid gap-3 md:grid-cols-2">
                              {/* Request Payload */}
                              <div className="rounded-md border border-border bg-card p-3 space-y-1.5">
                                <div className="text-[11px] font-semibold text-foreground flex items-center justify-between">
                                  <span>Sample Sandbox Request Payload</span>
                                  <span className="text-[11px] font-mono text-muted-foreground">
                                    POST {api.endpoint}
                                  </span>
                                </div>
                                <pre className="text-[11px] font-mono bg-muted/60 p-2.5 rounded overflow-x-auto text-foreground max-h-48">
                                  {JSON.stringify(api.sampleRequest, null, 2)}
                                </pre>
                              </div>

                              {/* Response Payload */}
                              <div className="rounded-md border border-border bg-card p-3 space-y-1.5">
                                <div className="text-[11px] font-semibold text-foreground flex items-center justify-between">
                                  <span>Sample Sandbox Response Payload</span>
                                  <span className="text-[11px] font-mono text-emerald-600">
                                    200 OK
                                  </span>
                                </div>
                                <pre className="text-[11px] font-mono bg-muted/60 p-2.5 rounded overflow-x-auto text-foreground max-h-48">
                                  {JSON.stringify(api.sampleResponse, null, 2)}
                                </pre>
                              </div>
                            </div>
                          </TableCell>
                        </TableRow>
                      )}
                    </>
                  );
                })}
                {filteredApis.length === 0 && (
                  <TableRow>
                    <TableCell colSpan={6} className="py-8 text-center text-xs text-muted-foreground">
                      No APIs match "{apiSearch}".
                    </TableCell>
                  </TableRow>
                )}
              </TableBody>
            </Table>
          </div>
        </CardContent>
      </Card>

      {/* Model Lift & Hazard Structure */}
      <div className="grid gap-4 lg:grid-cols-2">
        <Card className="bg-surface">
          <CardHeader className="pb-2">
            <CardTitle className="text-sm">What each data block adds</CardTitle>
            <CardDescription className="text-xs">
              Ablation on the synthetic India MSME book — mean AUC over 3 model seeds.
            </CardDescription>
          </CardHeader>
          <CardContent>
            <ol className="space-y-3 text-xs">
              {[
                ["Structured only (facility + bureau fields)", "0.610 ± 0.006", "capture 17%"],
                ["+ GST / AA cash-flow", "0.852 ± 0.008", "capture 54%"],
                ["+ officer notes (unstructured)", "0.862 ± 0.006", "capture 58%"],
                ["+ supplier graph (negative: −0.025 AUC)", "0.837 ± 0.023", "capture 52%"],
              ].map(([label, auc, cap], i) => (
                <li key={label} className="flex items-center gap-3">
                  <span className="grid h-6 w-6 shrink-0 place-items-center rounded-full bg-primary/10 text-[11px] font-semibold text-primary">
                    {i + 1}
                  </span>
                  <span className="min-w-0 flex-1">{label}</span>
                  <span className="shrink-0 tabular-nums font-medium">{auc}</span>
                  <span className="hidden shrink-0 text-muted-foreground sm:inline">{cap}</span>
                </li>
              ))}
            </ol>
            <p className="mt-3 text-[11px] leading-relaxed text-muted-foreground">
              The bank's three named data scopes — borrower behaviour, internal systems, public
              domain — each buy lift on synthetic data, except the supplier graph: adding it lowered
              AUC from 0.862 to 0.837, inside its own seed spread (±0.023). It stays in the pipeline
              but is not counted as a gain until it is validated on real bank data.
            </p>
          </CardContent>
        </Card>

        <Card className="bg-surface">
          <CardHeader className="pb-2">
            <CardTitle className="text-sm">WHEN, not just IF</CardTitle>
            <CardDescription className="text-xs">
              Discrete-time hazard model over 20 quarters.
            </CardDescription>
          </CardHeader>
          <CardContent className="space-y-3 text-xs leading-relaxed text-muted-foreground">
            <p>
              The binary model answers <em>whether</em> an account slips into stress within 12
              months. The hazard model adds <em>when</em>: a quarterly PD term structure ("expected
              stress window ≈ month N") at no cost to discrimination — PD@12m AUC 0.800 vs the
              binary model's 0.804.
            </p>
            <p>
              Foundation-model routing: TabPFN wins by +4–10 AUC points under 1K training rows; its
              distilled LightGBM student keeps the teacher's lift (0.905 vs 0.909 AUC) at ~2000×
              lower latency (11 ms → 0.011 ms per row).
            </p>
            <p>
              Deployment maps directly onto IDBI's AWS sandbox: ECR → ECS Fargate for the API +
              console, EventBridge batch scoring, S3 artifacts, CloudWatch drift alarms.
            </p>
          </CardContent>
        </Card>
      </div>
    </div>
  );
}
