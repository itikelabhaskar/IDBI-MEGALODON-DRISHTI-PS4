import { useState } from "react";
import { ArrowRight, Download, FileJson, FileText, Landmark, Loader2, ShieldCheck } from "lucide-react";
import { toast } from "sonner";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Textarea } from "@/components/ui/textarea";
import {
  analyseNote,
  analyseStatement,
  fetchSampleStatement,
  type NoteAnalysis,
  type StatementAnalysis,
  type UnstructuredVerdict,
} from "@/lib/api";
import { formatInrCompact, formatPercent, ragTone } from "@/lib/format";
import { cn } from "@/lib/utils";

// Example field-visit notes. The second carries personal data on purpose, to
// show it being masked before anything reads it.
const NOTE_PRESETS: { label: string; text: string }[] = [
  {
    label: "Stressed visit",
    text:
      "Visited the unit on 2 Oct. Major buyer cancelled two orders; one of three machines idle and the unit runs a single shift. " +
      "Promoter had promised to clear the overdue EMI by month-end; commitment not honoured. Litigation notice from a supplier seen at the premises.",
  },
  {
    label: "With personal data",
    text:
      "Spoke to the promoter at the unit (PAN ABCDE1234F, mobile 98765 43210, ramesh.p@gmail.com, GSTIN 27ABCDE1234F1Z5). " +
      "Stock statement for the last quarter still awaited despite reminders; cheque returns noted on the operating account.",
  },
  {
    label: "Healthy visit",
    text:
      "Unit running full capacity; strong order book for the next two quarters. New export order received and the promoter is investing own funds in expansion.",
  },
];

const STATEMENT_LABELS: Record<string, { label: string; fmt: (v: number) => string; usedByModel?: boolean }> = {
  emi_bounce_6m: { label: "EMI / cheque returns (6-month rate)", fmt: (v) => v.toFixed(1), usedByModel: true },
  balance_trend_pct: { label: "Balance trend (first vs last month)", fmt: (v) => `${v > 0 ? "+" : ""}${v.toFixed(0)}%`, usedByModel: true },
  cashflow_volatility: { label: "Receipts volatility (month to month)", fmt: (v) => v.toFixed(2), usedByModel: true },
  upi_inflow_stability: { label: "Regularity of receipts (0–1)", fmt: (v) => v.toFixed(2), usedByModel: true },
  amb_l3m: { label: "Average balance", fmt: (v) => formatInrCompact(v) },
  mmb_l3m: { label: "Lowest balance", fmt: (v) => formatInrCompact(v) },
  inflow_outflow_ratio: { label: "Money in ÷ money out", fmt: (v) => v.toFixed(2) },
  circular_tx_flag: { label: "Same-day round trips (> ₹50,000)", fmt: (v) => (v ? "Yes" : "No") },
};

function Verdict({ v }: { v: UnstructuredVerdict }) {
  return (
    <span className="inline-flex items-center gap-1.5">
      <span className="font-mono font-semibold tabular-nums">{v.pd_12m == null ? "—" : formatPercent(v.pd_12m, 1)}</span>
      <span className="font-mono">{v.risk_grade ?? "—"}</span>
      {v.rag && (
        <Badge variant="outline" className={cn("font-normal", ragTone[v.rag as keyof typeof ragTone])}>
          {v.rag}
        </Badge>
      )}
    </span>
  );
}

function BeforeAfter({
  before,
  after,
  note,
  raw,
}: {
  before: UnstructuredVerdict;
  after: UnstructuredVerdict;
  note?: string;
  raw?: { before: number | null; after: number | null };
}) {
  const delta = (after.pd_12m ?? 0) - (before.pd_12m ?? 0);
  const rawDelta = raw?.before != null && raw?.after != null ? raw.after - raw.before : null;
  const score = (v: number) => (v * 100).toFixed(2);
  // The PD comes from the raw score through isotonic calibration, which is a
  // staircase: a real move in the score can stay on one step, or cross one.
  const rawLine =
    rawDelta == null
      ? null
      : Math.abs(rawDelta) < 0.0001
        ? "This input did not move the model's score."
        : `Model score before calibration: ${score(raw!.before!)} → ${score(raw!.after!)}. ` +
          (Math.abs(delta) < 0.0005
            ? "The input did register, but not enough to reach the next calibrated PD step, so the PD and grade stay the same."
            : "PD is read from this score in steps, so a move that crosses a step changes the PD by a whole step.");
  return (
    <div className="rounded-md border border-border bg-muted/30 p-3 text-xs">
      <div className="mb-1 text-[11px] font-semibold uppercase tracking-wider text-muted-foreground">
        12-month PD for this account
      </div>
      <div className="flex flex-wrap items-center gap-2">
        <span className="text-muted-foreground">Stored inputs</span>
        <Verdict v={before} />
        <ArrowRight className="h-3.5 w-3.5 text-muted-foreground" />
        <span className="text-muted-foreground">with this input</span>
        <Verdict v={after} />
        <span className={cn("font-medium", delta > 0.0005 ? "text-band-d" : delta < -0.0005 ? "text-band-a" : "text-muted-foreground")}>
          {Math.abs(delta) < 0.0005 ? "no change" : `${delta > 0 ? "+" : "−"}${formatPercent(Math.abs(delta), 1)}`}
        </span>
      </div>
      {rawLine && <p className="mt-1.5 text-[11px] text-foreground/80">{rawLine}</p>}
      {note && <p className="mt-1 text-[11px] text-muted-foreground">{note}</p>}
    </div>
  );
}

// Direction of stress for each statement input the model uses: +1 = higher is worse.
const STRESS_DIRECTION: Record<string, 1 | -1> = {
  emi_bounce_6m: 1,
  cashflow_volatility: 1,
  balance_trend_pct: -1,
  upi_inflow_stability: -1,
};

function milderInputs(r: StatementAnalysis): string[] {
  return Object.entries(STRESS_DIRECTION)
    .filter(([k, dir]) => {
      const was = r.stored_inputs?.[k];
      const now = r.model_inputs_updated[k];
      return was != null && now != null && (now - was) * dir < -1e-6;
    })
    .map(([k]) => STATEMENT_LABELS[k as keyof typeof STATEMENT_LABELS]?.label.toLowerCase() ?? k);
}

/** Shows unstructured inputs flowing into one account's score. Nothing is saved. */
export function UnstructuredPanel({ loanId, segment }: { loanId: string; segment: string }) {
  const [note, setNote] = useState(NOTE_PRESETS[0].text);
  const [useFinbert, setUseFinbert] = useState(false);
  const [noteResult, setNoteResult] = useState<NoteAnalysis | null>(null);
  const [stmt, setStmt] = useState<Record<string, unknown> | null>(null);
  const [stmtName, setStmtName] = useState<string>("");
  const [stmtResult, setStmtResult] = useState<StatementAnalysis | null>(null);
  const [busy, setBusy] = useState<"note" | "statement" | null>(null);
  const [error, setError] = useState<string | null>(null);

  const offline = "Reading notes and statements needs the scoring API, which is not reachable from this page.";

  const readNote = async () => {
    setBusy("note");
    setError(null);
    const res = await analyseNote(loanId, note, useFinbert);
    setBusy(null);
    if (!res) return setError(offline);
    if ("error" in res) return setError(res.error);
    setNoteResult(res);
  };

  const readStatement = async (payload: Record<string, unknown>, name: string) => {
    setStmt(payload);
    setStmtName(name);
    setBusy("statement");
    setError(null);
    const res = await analyseStatement(loanId, payload);
    setBusy(null);
    if (!res) return setError(offline);
    if ("error" in res) return setError(res.error);
    setStmtResult(res);
  };

  const loadSample = async (kind: "healthy" | "stressed") => {
    const sample = await fetchSampleStatement(kind);
    if (!sample) return setError(offline);
    await readStatement(sample, `sample ${kind} statement (synthetic, 90 days)`);
  };

  const onFile = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    e.target.value = "";
    if (!file) return;
    try {
      await readStatement(JSON.parse(await file.text()), file.name);
    } catch {
      toast.error("That file is not valid JSON. Use an Account Aggregator FI-JSON or a core-banking statement export.");
    }
  };

  const downloadStmt = () => {
    if (!stmt) return;
    const url = URL.createObjectURL(new Blob([JSON.stringify(stmt, null, 2)], { type: "application/json" }));
    const a = document.createElement("a");
    a.href = url;
    a.download = `statement_${loanId}.json`;
    a.click();
    URL.revokeObjectURL(url);
  };

  return (
    <Card className="bg-surface no-print">
      <CardHeader className="pb-2">
        <CardTitle className="text-sm">Read unstructured inputs</CardTitle>
        <CardDescription className="text-xs">
          Paste a field-visit note or load a bank statement to see what DRISHTI reads from it and how it moves this
          account&apos;s score. Analysis only: nothing here is saved to the account.
        </CardDescription>
      </CardHeader>
      <CardContent>
        <Tabs defaultValue="note">
          <TabsList className="mb-3 flex-wrap h-auto">
            <TabsTrigger value="note" className="text-xs gap-1">
              <FileText className="h-3.5 w-3.5" /> Officer note
            </TabsTrigger>
            <TabsTrigger value="statement" className="text-xs gap-1">
              <FileJson className="h-3.5 w-3.5" /> Bank statement (Account Aggregator)
            </TabsTrigger>
            <TabsTrigger value="gst" className="text-xs gap-1">
              <Landmark className="h-3.5 w-3.5" /> GST returns
            </TabsTrigger>
          </TabsList>

          {error && (
            <div className="mb-3 rounded-md border border-band-c/40 bg-band-c/10 px-3 py-2 text-xs">{error}</div>
          )}

          <TabsContent value="note" className="space-y-3">
            <div className="flex flex-wrap gap-1.5">
              {NOTE_PRESETS.map((p) => (
                <Button key={p.label} variant="outline" size="sm" className="h-7 text-xs" onClick={() => setNote(p.text)}>
                  {p.label}
                </Button>
              ))}
            </div>
            <Textarea value={note} onChange={(e) => setNote(e.target.value)} rows={4} className="text-sm" />
            <div className="flex flex-wrap items-center gap-3">
              <Button size="sm" className="h-8 text-xs gap-1" onClick={readNote} disabled={busy !== null || !note.trim()}>
                {busy === "note" ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <FileText className="h-3.5 w-3.5" />}
                Read note
              </Button>
              <label className="flex items-center gap-1.5 text-xs text-muted-foreground">
                <input type="checkbox" checked={useFinbert} onChange={(e) => setUseFinbert(e.target.checked)} />
                Also read the tone with FinBERT (self-hosted)
              </label>
            </div>

            {noteResult && (
              <div className="space-y-3">
                <div className="rounded-md border border-border p-3 text-xs">
                  <div className="mb-1 flex items-center gap-1.5 text-[11px] font-semibold uppercase tracking-wider text-muted-foreground">
                    <ShieldCheck className="h-3.5 w-3.5 text-band-a" /> {noteResult.model_uses_notes ? "What the model reads" : "What DRISHTI reads"}
                    {noteResult.pii_masked && <span className="normal-case tracking-normal font-normal">· personal data masked first</span>}
                  </div>
                  <p className="leading-relaxed">
                    {noteResult.masked_text.split(/(\[REDACTED_[A-Z]+\])/g).map((part, i) =>
                      part.startsWith("[REDACTED_") ? (
                        <mark key={i} className="rounded bg-band-a/15 px-0.5 font-mono text-[11px] text-band-a">
                          {part}
                        </mark>
                      ) : (
                        <span key={i}>{part}</span>
                      ),
                    )}
                  </p>
                </div>
                <div className="grid gap-1.5 sm:grid-cols-2">
                  {noteResult.signals.map((s) => {
                    const isTone = s.key === "note_sentiment";
                    const on = isTone ? s.value !== 0 : s.value > 0;
                    return (
                      <div
                        key={s.key}
                        className={cn(
                          "flex items-center justify-between rounded border px-2.5 py-1.5 text-xs",
                          on ? "border-primary/30 bg-primary/5" : "border-border text-muted-foreground",
                        )}
                      >
                        <span>{s.label}</span>
                        <span className="font-mono font-semibold">
                          {isTone ? (s.value > 0 ? `+${s.value.toFixed(2)}` : s.value.toFixed(2)) : on ? "found" : "—"}
                        </span>
                      </div>
                    );
                  })}
                </div>
                {noteResult.finbert_tone != null && (
                  <div className="flex items-center justify-between rounded border border-primary/30 bg-primary/5 px-2.5 py-1.5 text-xs">
                    <span>
                      FinBERT tone (self-hosted language model, −1 to +1)
                      <span className="ml-1 text-[11px] text-muted-foreground">
                        · second opinion{noteResult.model_uses_notes ? "; the PD uses the keyword tone the model was trained on" : ""}
                      </span>
                    </span>
                    <span className="font-mono font-semibold">
                      {noteResult.finbert_tone > 0 ? "+" : ""}
                      {noteResult.finbert_tone.toFixed(2)}
                    </span>
                  </div>
                )}
                {noteResult.model_uses_notes ? (
                  <BeforeAfter
                    before={noteResult.before}
                    after={noteResult.after}
                    raw={noteResult.raw_score}
                    note={`Signals read by keyword${noteResult.finbert_tone != null ? "; tone also read by FinBERT" : ""}. The PD uses the six keyword signals together with the account's other inputs.${noteResult.method.includes("not installed") ? " (FinBERT weights are not installed on this server.)" : ""}`}
                  />
                ) : (
                  // A before/after box here could only ever read "no change", which looks
                  // like a failure. Say plainly what the flags are for instead.
                  <p className="rounded-md border border-border bg-muted/30 p-3 text-[11px] text-muted-foreground">
                    <span className="font-semibold text-foreground">Early-warning flags only.</span> This account&apos;s
                    model ({segment}) was trained without officer notes, because the bank&apos;s sandbox supplies none, so
                    these flags sit beside its score and do not change its PD. On India-book accounts the same signals are
                    model inputs and move the PD.
                  </p>
                )}
              </div>
            )}
          </TabsContent>

          <TabsContent value="statement" className="space-y-3">
            <div className="flex flex-wrap items-center gap-1.5">
              <Button variant="outline" size="sm" className="h-7 text-xs" onClick={() => loadSample("stressed")} disabled={busy !== null}>
                Load sample: stressed
              </Button>
              <Button variant="outline" size="sm" className="h-7 text-xs" onClick={() => loadSample("healthy")} disabled={busy !== null}>
                Load sample: healthy
              </Button>
              <label className="inline-flex h-7 cursor-pointer items-center gap-1 rounded-md border border-input px-2.5 text-xs hover:bg-muted">
                <FileJson className="h-3.5 w-3.5" /> Upload statement JSON
                <input type="file" accept=".json,application/json" className="hidden" onChange={onFile} />
              </label>
              {stmt && (
                <Button variant="ghost" size="sm" className="h-7 text-xs gap-1" onClick={downloadStmt}>
                  <Download className="h-3.5 w-3.5" /> Download this JSON
                </Button>
              )}
              {busy === "statement" && <Loader2 className="h-3.5 w-3.5 animate-spin text-muted-foreground" />}
            </div>
            <p className="text-[11px] text-muted-foreground">
              Accepts Sahamati Account Aggregator FI-JSON or a core-banking statement export. The samples are
              generated for the demo, not bank data.
            </p>

            {stmtResult && (
              <div className="space-y-3">
                <div className="text-xs text-muted-foreground">
                  Read <span className="font-medium text-foreground">{stmtName}</span>:{" "}
                  {stmtResult.transactions} transactions, {stmtResult.period.from ?? "?"} to {stmtResult.period.to ?? "?"}.
                </div>
                <div className="grid gap-1.5 sm:grid-cols-2">
                  {Object.entries(STATEMENT_LABELS).map(([key, meta]) => (
                    <div key={key} className="flex items-center justify-between rounded border border-border px-2.5 py-1.5 text-xs">
                      <span>
                        {meta.label}
                        {meta.usedByModel && <span className="ml-1 text-[11px] text-primary">· model input</span>}
                      </span>
                      <span className="text-right font-mono font-semibold">
                        {meta.usedByModel && stmtResult.stored_inputs?.[key] != null && (
                          <span className="mr-1 font-normal text-muted-foreground" title={stmtResult.inputs_were_inferred?.includes(key) ? "No statement data was stored; this value was inferred from the account's repayment and collection data" : "Stored value"}>
                            {meta.fmt(stmtResult.stored_inputs[key]!)}
                            {stmtResult.inputs_were_inferred?.includes(key) ? " (inferred)" : ""} →
                          </span>
                        )}
                        {stmtResult.derived[key] == null ? "—" : meta.fmt(stmtResult.derived[key])}
                      </span>
                    </div>
                  ))}
                </div>
                <BeforeAfter
                  before={stmtResult.before}
                  after={stmtResult.after}
                  raw={stmtResult.raw_score}
                  note="The four model inputs marked above replace the account's stored values; everything else stays as recorded."
                />
                {(() => {
                  const milder = milderInputs(stmtResult);
                  return (stmtResult.after.pd_12m ?? 0) < (stmtResult.before.pd_12m ?? 0) - 0.0005 && milder.length > 0 ? (
                    <p className="rounded-md border border-band-c/30 bg-band-c/5 p-2.5 text-[11px]">
                      <span className="font-semibold">Why the PD fell:</span> this statement shows milder stress than the
                      values the model held for {milder.join(", ")}.
                      {stmtResult.inputs_were_inferred?.length
                        ? " The account had no statement data, so those were inferred from its repayment and collection record; a real statement replaces the estimate."
                        : ""}
                    </p>
                  ) : null;
                })()}
              </div>
            )}
          </TabsContent>

          <TabsContent value="gst" className="text-xs leading-relaxed text-muted-foreground space-y-2">
            <p>
              <span className="font-medium text-foreground">Not available in the bank&apos;s sandbox.</span> The 25 sandbox
              APIs include a GSTIN search but no GST returns (GSTR-1 / GSTR-3B), so there is nothing real to
              parse here.
            </p>
            <p>
              The model already takes GST filing delay, GST turnover trend and input-credit mismatch as inputs; in this
              prototype those values are synthetic. In production they would come from GSTN via the Account Aggregator
              (GSTN is a registered data provider), read the same way as the bank statement on the previous tab.
            </p>
          </TabsContent>
        </Tabs>
      </CardContent>
    </Card>
  );
}
