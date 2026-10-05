import { useMemo, useState } from "react";
import { createFileRoute, Link, redirect } from "@tanstack/react-router";
import { AlertTriangle, Factory, MapPinned } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { useBook } from "@/lib/api";
import { formatInrCompact, formatPercent } from "@/lib/format";
import { FLAG_PD, sectorRollup, type SectorStatus } from "@/lib/sector-rollup";
import { cn } from "@/lib/utils";

export const Route = createFileRoute("/sectors")({
  // Folded into Market Explorer; the old address still works.
  beforeLoad: () => {
    throw redirect({ to: "/market", search: { tab: "sectors" } });
  },
});

const STATUS_STYLE: Record<SectorStatus, string> = {
  "sector-wide": "border-band-d/40 bg-band-d/10 text-band-d",
  "local cluster": "border-band-c/40 bg-band-c/10 text-band-c",
  watch: "border-amber-500/30 bg-amber-500/5 text-amber-700 dark:text-amber-300",
  "in line": "border-border text-muted-foreground",
};

const STATUS_MEANING: Record<SectorStatus, string> = {
  "sector-wide": "Stress well above the book and spread across branches and zones: likely a sector cause. Act on sector policy.",
  "local cluster": "Stress well above the book but concentrated in a few branches: likely a local cause. Act on those branches.",
  watch: "Somewhat above the book; not yet clearly different. Keep watching.",
  "in line": "In line with the rest of the book.",
};

const label = (s: string) => s.replace(/_/g, " ").replace(/\b\w/g, (c) => c.toUpperCase());

// Raise every account's default odds in one sector by a factor, to show what a
// sector-wide shock looks like on this page. Display only, clearly labelled.
function shockBook(book: ReturnType<typeof useBook>, sector: string, oddsFactor: number) {
  if (!sector || oddsFactor === 1) return book;
  return book.map((b) => {
    if (b.sector !== sector) return b;
    const p = Math.min(Math.max(b.pd, 1e-4), 0.9999);
    const odds = (p / (1 - p)) * oddsFactor;
    return { ...b, pd: odds / (1 + odds) };
  });
}

export function SectorView() {
  const liveBook = useBook();
  const [shockSector, setShockSector] = useState("");
  const [shockFactor, setShockFactor] = useState(10);
  const book = useMemo(() => shockBook(liveBook, shockSector, shockFactor), [liveBook, shockSector, shockFactor]);
  const rows = useMemo(() => sectorRollup(book), [book]);
  const sectors = useMemo(() => [...new Set(liveBook.map((b) => b.sector).filter(Boolean))].sort() as string[], [liveBook]);
  const alerts = rows.filter((r) => r.status === "sector-wide" || r.status === "local cluster");
  const bookRate = rows[0]?.bookFlagRate ?? 0;

  return (
    <div className="p-4 md:p-6 space-y-6">
      <div>
        <h2 className="text-lg font-semibold text-foreground">Sector View</h2>
        <p className="mt-0.5 text-sm text-muted-foreground">
          Is a whole sector under stress, or a few branches within it? {book.length.toLocaleString("en-IN")} accounts;
          {" "}{formatPercent(bookRate, 1)} of the book is flagged (PD ≥ {formatPercent(FLAG_PD, 0)}).
        </p>
      </div>

      <Card className="bg-surface">
        <CardContent className="flex flex-wrap items-center gap-2 py-3 text-xs">
          <span className="font-medium">Try a sector shock:</span>
          <select
            value={shockSector}
            onChange={(e) => setShockSector(e.target.value)}
            className="h-7 rounded-md border border-input bg-background px-2 text-xs"
            aria-label="Sector to shock"
          >
            <option value="">None (actual book)</option>
            {sectors.map((s) => (
              <option key={s} value={s}>
                {label(s)}
              </option>
            ))}
          </select>
          <select
            value={shockFactor}
            onChange={(e) => setShockFactor(Number(e.target.value))}
            className="h-7 rounded-md border border-input bg-background px-2 text-xs"
            aria-label="Shock size"
            disabled={!shockSector}
          >
            {[3, 5, 10].map((f) => (
              <option key={f} value={f}>
                default odds ×{f}{f === 10 ? " (severe)" : ""}
              </option>
            ))}
          </select>
          {shockSector ? (
            <Badge variant="outline" className="border-band-c/40 bg-band-c/10 font-normal text-band-c">
              Simulated: every {label(shockSector)} account&apos;s odds ×{shockFactor}. Not the real book.
            </Badge>
          ) : (
            <span className="text-muted-foreground">
              {alerts.length === 0
                ? "Shows how a sector-wide hit would appear here; the actual book has no sector alert right now."
                : "Pick a sector to see how a sector-wide hit would appear here."}
            </span>
          )}
        </CardContent>
      </Card>

      {alerts.length > 0 && (
        <div className="space-y-2">
          {alerts.map((r) => (
            <Link
              key={r.sector}
              to="/"
              search={{ sector: r.sector }}
              className={cn("flex flex-wrap items-center gap-2 rounded-lg border p-3 text-sm hover:shadow-sm", STATUS_STYLE[r.status])}
            >
              <AlertTriangle className="h-4 w-4 shrink-0" />
              <span className="font-semibold">{label(r.sector)}:</span>
              <span>
                {r.status === "sector-wide" ? "sector-wide stress" : "local cluster"} —{" "}
                {formatPercent(r.flagRate, 1)} flagged vs {formatPercent(r.bookFlagRate, 1)} for the book,
                {" "}in {r.branchesFlagged} of {r.branchesHolding} branches ({r.zonesFlagged} zone{r.zonesFlagged === 1 ? "" : "s"}).
                {r.drivers[0] && ` Most common: ${r.drivers[0].label.toLowerCase()} (${Math.round(r.drivers[0].share * 100)}% of flagged).`}
              </span>
              <span className="ml-auto text-xs font-medium underline-offset-2 hover:underline">Open accounts ↓</span>
            </Link>
          ))}
        </div>
      )}

      <Card className="bg-surface">
        <CardHeader className="pb-2">
          <CardTitle className="flex items-center gap-1.5 text-sm">
            <Factory className="h-4 w-4 text-primary" /> Sectors, most unusual first
          </CardTitle>
          <CardDescription className="text-xs">
            &quot;vs book&quot; is how many standard deviations the sector&apos;s flagged share sits above the book&apos;s
            (2 or more is unlikely to be chance). &quot;Spread&quot; is how many of the branches that lend to the sector
            have flagged accounts in it.
          </CardDescription>
        </CardHeader>
        <CardContent className="p-0">
          <Table containerClassName="overflow-auto" className="min-w-[1000px] text-xs">
            <TableHeader>
              <TableRow>
                <TableHead className="pl-4">Sector</TableHead>
                <TableHead className="text-right">Accounts</TableHead>
                <TableHead className="text-right">Share of book</TableHead>
                <TableHead className="text-right">Avg PD (EAD-weighted)</TableHead>
                <TableHead className="text-right">Flagged</TableHead>
                <TableHead className="text-right">vs book</TableHead>
                <TableHead>Spread</TableHead>
                <TableHead className="text-right">ECL</TableHead>
                <TableHead>Reading</TableHead>
                <TableHead className="pr-4">Shared stress pattern (flagged accounts)</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {rows.map((r) => (
                <TableRow key={r.sector}>
                  <TableCell className="pl-4 font-medium">
                    <Link to="/" search={{ sector: r.sector }} className="text-primary hover:underline">
                      {label(r.sector)}
                    </Link>
                  </TableCell>
                  <TableCell className="text-right tabular-nums">{r.accounts}</TableCell>
                  <TableCell className="text-right tabular-nums">{formatPercent(r.eadShare, 1)}</TableCell>
                  <TableCell className="text-right tabular-nums">{formatPercent(r.weightedPd, 1)}</TableCell>
                  <TableCell className="text-right tabular-nums">
                    {r.flagged} <span className="text-muted-foreground">({formatPercent(r.flagRate, 1)})</span>
                  </TableCell>
                  <TableCell
                    className={cn("text-right tabular-nums font-medium", r.z >= 2 ? "text-band-d" : r.z >= 1 ? "text-band-c" : "")}
                  >
                    {r.z >= 0 ? "+" : ""}
                    {r.z.toFixed(1)}σ
                  </TableCell>
                  <TableCell>
                    <div className="flex items-center gap-1.5" title={r.topBranches.map((b) => `${b.name}: ${b.flagged}`).join(" · ")}>
                      <MapPinned className="h-3.5 w-3.5 text-muted-foreground" />
                      {r.branchesFlagged}/{r.branchesHolding} branches · {r.zonesFlagged} zone{r.zonesFlagged === 1 ? "" : "s"}
                    </div>
                  </TableCell>
                  <TableCell className="text-right tabular-nums">{formatInrCompact(r.ecl)}</TableCell>
                  <TableCell>
                    <Badge variant="outline" className={cn("whitespace-nowrap font-normal", STATUS_STYLE[r.status])} title={STATUS_MEANING[r.status]}>
                      {r.status}
                    </Badge>
                  </TableCell>
                  <TableCell className="pr-4 text-muted-foreground">
                    {r.drivers.length
                      ? r.drivers.map((d) => `${d.label} (${Math.round(d.share * 100)}%)`).join(" · ")
                      : r.flagged
                        ? "No single pattern dominates"
                        : "—"}
                  </TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        </CardContent>
      </Card>

      <div className="grid gap-3 md:grid-cols-2 text-xs text-muted-foreground">
        {(Object.keys(STATUS_MEANING) as SectorStatus[]).map((s) => (
          <div key={s} className="flex items-start gap-2">
            <Badge variant="outline" className={cn("whitespace-nowrap font-normal", STATUS_STYLE[s])}>
              {s}
            </Badge>
            <span>{STATUS_MEANING[s]}</span>
          </div>
        ))}
        <p className="md:col-span-2">
          Built from the live book (or the bundled snapshot when the API is down). For a forward-looking view, stress a
          sector in the <Link to="/market" search={{ tab: "scenario" }} className="text-primary hover:underline">Scenario stress</Link> tab.
        </p>
      </div>
    </div>
  );
}
