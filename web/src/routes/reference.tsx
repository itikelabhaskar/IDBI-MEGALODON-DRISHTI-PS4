import { createFileRoute } from "@tanstack/react-router";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { GRADE_EDGES, formatPercent, gradeIndexToRag, gradeRange, ragTone } from "@/lib/format";
import { FLAG_PD } from "@/lib/sector-rollup";
import { Badge } from "@/components/ui/badge";

export const Route = createFileRoute("/reference")({ component: ReferencePage });

const GRADES = [...GRADE_EDGES.map(([g]) => g), "RG10"];

const RULES: [string, string][] = [
  ["Flagged for stress", `PD ≥ ${formatPercent(FLAG_PD, 0)} (RG6 and above). Used by the Portfolio, Branch and Market pages.`],
  ["RAG colour", "From the grade: Green RG1–4, Amber RG5–7, Red RG8–10. Days overdue can raise it (never lower it): the colour is never kinder than the repayment status."],
  ["RBI SMA (regulatory)", "From days past due only: Standard 0, SMA-0 1–30, SMA-1 31–60, SMA-2 61–90, NPA over 90."],
  ["Model watch (DRISHTI)", "From the PD grade: No watch, Early watch 1/2/3, High-slippage risk. Separate from RBI SMA."],
  ["Urgent queue (24h)", "Red, or PD ≥ 12%, or Stage 2–3 with PD ≥ 8%. Amber accounts with high PD land here too."],
  ["Covenant watchlist (weekly)", "Amber or PD 4–12%, not already urgent."],
  ["Fast-track renewals", "Green, Stage 1, PD below 3%."],
  ["ECL", "PD × LGD 45% × exposure, staged Ind AS 109-style (Stage 1/2/3). Prototype staging, not RBI IRAC provisioning rates."],
  ["Action plan target", "PD below 11% (back to Green, RG4 or better). Borrower steps first, bank steps only if needed."],
  ["Sector alert", "Sector's flagged share ≥ 2 standard deviations above the book: sector-wide if spread over 3+ branches, 40%+ of the branches holding it and 2+ zones; otherwise a local cluster. 1–2 SD = watch."],
  ["PD calibration", "Raw model score mapped to PD by isotonic calibration (steps). Ranking metrics (AUC, capture) use the raw score; PD quality (Brier) uses the calibrated PD."],
];

function ReferencePage() {
  return (
    <div className="space-y-6 p-4 md:p-6">
      <div>
        <h1 className="text-xl font-semibold text-foreground">Thresholds &amp; Rating Scale</h1>
        <p className="mt-0.5 text-sm text-muted-foreground">
          Every cut-off the console uses, in one place. Grade edges come from the same constants the scoring engine uses.
        </p>
      </div>
      <Card className="bg-surface">
        <CardHeader className="pb-2">
          <CardTitle className="text-sm">Risk grades (12-month PD)</CardTitle>
        </CardHeader>
        <CardContent className="p-0">
          <Table className="text-xs">
            <TableHeader>
              <TableRow>
                <TableHead className="pl-4">Grade</TableHead>
                <TableHead>PD range</TableHead>
                <TableHead>RAG</TableHead>
                <TableHead className="pr-4">Flagged</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {GRADES.map((g, i) => {
                const [lo, hi] = gradeRange(g);
                const rag = gradeIndexToRag(i);
                return (
                  <TableRow key={g}>
                    <TableCell className="pl-4 font-mono font-medium">{g}</TableCell>
                    <TableCell className="tabular-nums">
                      {formatPercent(lo, 0)} – {hi >= 1 ? "100%" : formatPercent(hi, 0)}
                    </TableCell>
                    <TableCell>
                      <Badge variant="outline" className={`${ragTone[rag]} font-normal`}>{rag}</Badge>
                    </TableCell>
                    <TableCell className="pr-4">{lo >= FLAG_PD ? "Yes" : "—"}</TableCell>
                  </TableRow>
                );
              })}
            </TableBody>
          </Table>
        </CardContent>
      </Card>
      <Card className="bg-surface">
        <CardHeader className="pb-2">
          <CardTitle className="text-sm">Rules</CardTitle>
        </CardHeader>
        <CardContent className="space-y-2 text-xs">
          {RULES.map(([k, v]) => (
            <div key={k} className="grid gap-1 border-b border-border/60 pb-2 last:border-0 md:grid-cols-[220px_1fr]">
              <span className="font-medium text-foreground">{k}</span>
              <span className="text-muted-foreground">{v}</span>
            </div>
          ))}
        </CardContent>
      </Card>
    </div>
  );
}
