import { createFileRoute } from "@tanstack/react-router";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";

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
  return (
    <div className="p-4 md:p-6 space-y-6">
      <div>
        <div className="text-[10px] uppercase tracking-widest text-muted-foreground">
          DRISHTI · Default Risk Intelligence &amp; Stress-Horizon Tracking Initiative
        </div>
        <h1 className="mt-1 text-xl font-semibold text-foreground">Architecture</h1>
        <p className="mt-0.5 text-sm text-muted-foreground">
          How the engine sees stress 12 months ahead — end to end.
        </p>
      </div>

      {/* Pipeline */}
      <div className="grid gap-3 md:grid-cols-3 xl:grid-cols-5">
        {PILLARS.map((p) => (
          <Card key={p.step} className="bg-surface">
            <CardHeader className="pb-2">
              <div className="text-[10px] font-semibold uppercase tracking-widest text-primary">
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
                    className="bg-muted/60 font-normal text-[10px] text-muted-foreground"
                  >
                    {t}
                  </Badge>
                ))}
              </div>
            </CardContent>
          </Card>
        ))}
      </div>

      <div className="grid gap-4 lg:grid-cols-2">
        <Card className="bg-surface">
          <CardHeader className="pb-2">
            <CardTitle className="text-sm">The moat staircase</CardTitle>
            <CardDescription className="text-xs">
              India MSME ablation — mean AUC over 3 model seeds.
            </CardDescription>
          </CardHeader>
          <CardContent>
            <ol className="space-y-3 text-xs">
              {[
                ["Structured only", "0.610 ± 0.006", "capture 17%"],
                ["+ GST / AA cash-flow + alt-data", "0.852 ± 0.008", "capture 54%"],
                ["+ officer notes (self-hosted FinBERT)", "0.862 ± 0.006", "capture 58%"],
                ["+ supplier graph (noise-neutral)", "0.845 ± 0.022", "capture 52%"],
              ].map(([label, auc, cap], i) => (
                <li key={label} className="flex items-center gap-3">
                  <span className="grid h-6 w-6 shrink-0 place-items-center rounded-full bg-primary/10 text-[10px] font-semibold text-primary">
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
              domain — each buy measurable lift. Supplier-graph contagion ships end-to-end but is
              flagged within seed noise at synthetic signal strength.
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
