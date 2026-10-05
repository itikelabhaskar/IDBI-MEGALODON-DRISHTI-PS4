import { useEffect, useMemo, useState } from "react";
import { Building2, Printer, Route as RouteIcon, UserRound } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { applyActions, fetchActionPlan, type ActionPlan, type PlanVerdict } from "@/lib/api";
import { formatPercent, ragTone } from "@/lib/format";
import { whyFlaggedLine } from "@/lib/plain-language";
import type { BorrowerScore } from "@/lib/types";
import { cn } from "@/lib/utils";

function Verdict({ v }: { v: PlanVerdict }) {
  return (
    <span className="inline-flex items-center gap-1.5">
      <span className="font-mono font-semibold tabular-nums">{formatPercent(v.pd_12m, 1)}</span>
      <span className="font-mono">{v.risk_grade}</span>
      <Badge variant="outline" className={cn("font-normal", ragTone[v.rag as keyof typeof ragTone])}>
        {v.rag}
      </Badge>
    </span>
  );
}

const esc = (s: string) => s.replace(/[&<>"]/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" })[c]!);

/** One-page note for the relationship manager to hand to the borrower. */
function printImprovementNote(b: BorrowerScore, plan: ActionPlan, chosen: string[], result: PlanVerdict | null) {
  const borrowerSteps = plan.levers.filter((l) => l.actor === "borrower" && chosen.includes(l.label));
  const bankSteps = plan.levers.filter((l) => l.actor === "bank" && chosen.includes(l.label));
  const today = new Date().toLocaleDateString("en-IN", { day: "numeric", month: "long", year: "numeric" });
  const html = `<!doctype html><html><head><meta charset="utf-8"><title>Account improvement note · ${esc(b.loan_id)}</title>
<style>body{font:14px/1.55 system-ui,sans-serif;color:#1a1a1a;max-width:720px;margin:32px auto;padding:0 24px}
h1{font-size:20px;margin:0 0 4px}h2{font-size:15px;margin:22px 0 6px}.muted{color:#666;font-size:12px}
ol{padding-left:20px}li{margin:6px 0}.box{border:1px solid #ddd;border-radius:6px;padding:10px 14px;background:#fafafa}
footer{margin-top:28px;border-top:1px solid #ddd;padding-top:8px;color:#777;font-size:11px}@media print{body{margin:0}}</style></head><body>
<h1>How to improve your account's rating</h1>
<div class="muted">Account ${esc(b.loan_id)} · ${esc((b.sector ?? "").replace(/_/g, " "))} · ${esc(b.branch_name ?? "")} · ${esc(today)}</div>
<h2>Where the account stands</h2>
<div class="box">Current internal rating <b>${esc(plan.current?.risk_grade ?? b.risk_grade)}</b>
(${esc(plan.current?.rag ?? b.rag)}). What we see: ${esc(whyFlaggedLine(b, 4))}.</div>
<h2>Steps that would help most</h2>
${borrowerSteps.length ? `<ol>${borrowerSteps.map((s) => `<li>${esc(s.plain)}</li>`).join("")}</ol>` : "<p>No borrower steps selected.</p>"}
${bankSteps.length ? `<h2>What the bank may also consider</h2><ol>${bankSteps.map((s) => `<li>${esc(s.plain)}</li>`).join("")}</ol>` : ""}
${result ? `<h2>Expected effect</h2><div class="box">Taken together, these steps would bring the account's internal rating to about <b>${esc(result.risk_grade)}</b> (${esc(result.rag)}).</div>` : ""}
<footer>Indicative guidance from the DRISHTI prototype (IDBI Innovate 2026, synthetic data). It is not a sanction, renewal or restructuring decision; your relationship manager will confirm the next review.</footer>
<script>window.onload=()=>window.print()</script></body></html>`;
  const w = window.open("", "_blank");
  if (!w) return;
  w.document.write(html);
  w.document.close();
}

/**
 * The engine's levers for this account, split into what the borrower can do and
 * what the bank can do. The suggested route comes from the recourse search; the
 * officer can tick any combination and see the PD it would give.
 */
export function ActionPlanCard({ b }: { b: BorrowerScore }) {
  const [plan, setPlan] = useState<ActionPlan | null>(null);
  const [unavailable, setUnavailable] = useState(false);
  const [chosen, setChosen] = useState<string[]>([]);
  const [result, setResult] = useState<PlanVerdict | null>(null);

  useEffect(() => {
    let active = true;
    fetchActionPlan(b.loan_id).then((p) => {
      if (!active) return;
      if (!p || !p.current || p.levers.length === 0) return setUnavailable(true);
      setPlan(p);
      setChosen(p.suggested?.changes.map((c) => c.change) ?? []);
    });
    return () => {
      active = false;
    };
  }, [b.loan_id]);

  useEffect(() => {
    if (!plan) return;
    if (chosen.length === 0) return setResult(plan.current);
    let active = true;
    applyActions(b.loan_id, chosen).then((r) => active && r && setResult(r.after));
    return () => {
      active = false;
    };
  }, [b.loan_id, plan, chosen]);

  const groups = useMemo(
    () => ({
      borrower: plan?.levers.filter((l) => l.actor === "borrower") ?? [],
      bank: plan?.levers.filter((l) => l.actor === "bank") ?? [],
    }),
    [plan],
  );

  if (unavailable) {
    return (
      <Card className="bg-surface">
        <CardHeader className="pb-2">
          <CardTitle className="flex items-center gap-1.5 text-sm">
            <RouteIcon className="h-4 w-4 text-primary" /> Action plan
          </CardTitle>
          <CardDescription className="text-xs">
            Needs the scoring API (not reachable from this page), or this segment has no recourse levers.
          </CardDescription>
        </CardHeader>
      </Card>
    );
  }
  if (!plan || !plan.current) return null;

  const toggle = (label: string) =>
    setChosen((xs) => (xs.includes(label) ? xs.filter((x) => x !== label) : [...xs, label]));
  const suggestedAt = (label: string) => plan.suggested?.changes.find((c) => c.change === label);
  const targetMet = (result?.pd_12m ?? 1) <= plan.target_pd;

  const leverList = (items: typeof groups.borrower, Icon: typeof UserRound, title: string) =>
    items.length === 0 ? null : (
      <div className="space-y-1.5">
        <div className="flex items-center gap-1.5 text-[11px] font-semibold uppercase tracking-wider text-muted-foreground">
          <Icon className="h-3.5 w-3.5" /> {title}
        </div>
        {items.map((l) => {
          const s = suggestedAt(l.label);
          return (
            <label
              key={l.label}
              className={cn(
                "flex cursor-pointer items-start gap-2 rounded-md border px-3 py-2 text-xs",
                chosen.includes(l.label) ? "border-primary/40 bg-primary/5" : "border-border",
              )}
            >
              <input type="checkbox" className="mt-0.5" checked={chosen.includes(l.label)} onChange={() => toggle(l.label)} />
              <span className="flex-1">
                {l.plain}
                <span className="mt-0.5 block text-[11px] text-muted-foreground">{l.label}</span>
              </span>
              {s && (
                <span className="shrink-0 text-[11px] text-primary" title="Step in the engine's suggested route">
                  suggested → PD {formatPercent(s.pd_after, 1)}
                </span>
              )}
            </label>
          );
        })}
      </div>
    );

  return (
    <Card className="bg-surface">
      <CardHeader className="pb-2">
        <div className="flex flex-wrap items-start justify-between gap-2">
          <div>
            <CardTitle className="flex items-center gap-1.5 text-sm">
              <RouteIcon className="h-4 w-4 text-primary" /> Action plan — what would bring this account back
            </CardTitle>
            <CardDescription className="text-xs">
              The engine tries the borrower&apos;s own steps first and the bank&apos;s only if those are not enough.
              Tick any combination to see the PD it gives. Nothing is saved.
            </CardDescription>
          </div>
          <Button
            variant="outline"
            size="sm"
            className="h-8 gap-1.5 text-xs no-print"
            onClick={() => printImprovementNote(b, plan, chosen, result)}
            disabled={chosen.length === 0}
            title="One-page note for the relationship manager to hand to the borrower"
          >
            <Printer className="h-3.5 w-3.5" /> Print improvement note
          </Button>
        </div>
      </CardHeader>
      <CardContent className="space-y-3">
        <div className="grid gap-3 md:grid-cols-2">
          {leverList(groups.borrower, UserRound, "Borrower can")}
          {leverList(groups.bank, Building2, "Bank can")}
        </div>
        <div className="rounded-md border border-border bg-muted/30 p-3 text-xs">
          <div className="flex flex-wrap items-center gap-2">
            <span className="text-muted-foreground">Now</span>
            <Verdict v={plan.current} />
            <span className="text-muted-foreground">→ with the ticked steps</span>
            {result ? <Verdict v={result} /> : <span className="text-muted-foreground">…</span>}
            <Badge
              variant="outline"
              className={cn(
                "font-normal",
                targetMet ? "border-band-a/30 bg-band-a/10 text-band-a" : "border-band-c/30 bg-band-c/10 text-band-c",
              )}
            >
              {targetMet ? `below ${formatPercent(plan.target_pd, 0)} (Green)` : `still above ${formatPercent(plan.target_pd, 0)}`}
            </Badge>
          </div>
          {plan.suggested && plan.current.pd_12m > plan.target_pd && !plan.suggested.borrower_target_met && (
            <p className="mt-1.5 text-[11px] text-muted-foreground">
              The borrower&apos;s own steps reach {formatPercent(plan.suggested.borrower_pd, 1)} at best; getting below{" "}
              {formatPercent(plan.target_pd, 0)} needs a bank-side change or a restructuring review.
            </p>
          )}
          {plan.current.pd_12m <= plan.target_pd && (
            <p className="mt-1.5 text-[11px] text-muted-foreground">
              Already below {formatPercent(plan.target_pd, 0)}; the steps show what would strengthen it further.
            </p>
          )}
        </div>
      </CardContent>
    </Card>
  );
}
