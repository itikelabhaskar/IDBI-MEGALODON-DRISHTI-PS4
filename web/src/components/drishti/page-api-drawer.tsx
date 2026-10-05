import * as React from "react";
import { Link } from "@tanstack/react-router";
import {
  Sheet,
  SheetContent,
  SheetDescription,
  SheetHeader,
  SheetTitle,
  SheetTrigger,
} from "@/components/ui/sheet";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import {
  IDBI_API_REGISTRY,
  type ApiEntry,
  type ApiCategory,
} from "@/lib/data/api-registry";
import {
  Database,
  ChevronRight,
  ExternalLink,
  Code2,
  CheckCircle2,
  FileJson,
  Layers,
  Sparkles,
} from "lucide-react";
import { cn } from "@/lib/utils";

interface PageApiDrawerProps {
  routePath: string;
  triggerLabel?: string;
  className?: string;
  variant?: "badge" | "button" | "pill";
}

export function PageApiDrawer({
  routePath,
  triggerLabel,
  className,
  variant = "pill",
}: PageApiDrawerProps) {
  const [open, setOpen] = React.useState(false);
  const [selectedApiId, setSelectedApiId] = React.useState<string | null>(null);
  const [activeTab, setActiveTab] = React.useState<"mapping" | "json">("mapping");

  // Filter APIs that map to this route
  const activeApis = React.useMemo(() => {
    return IDBI_API_REGISTRY.filter((api) =>
      api.uiLocations.some(
        (loc) =>
          loc.route === routePath ||
          (routePath.startsWith("/borrowers") && loc.route.startsWith("/borrowers")) ||
          (routePath === "/" && loc.route === "/"),
      ),
    );
  }, [routePath]);

  // Set default selected API
  React.useEffect(() => {
    if (activeApis.length > 0 && !selectedApiId) {
      setSelectedApiId(activeApis[0].apiId);
    }
  }, [activeApis, selectedApiId]);

  const selectedApi = React.useMemo(() => {
    return activeApis.find((a) => a.apiId === selectedApiId) || activeApis[0];
  }, [activeApis, selectedApiId]);

  if (activeApis.length === 0) return null;

  return (
    <Sheet open={open} onOpenChange={setOpen}>
      <SheetTrigger asChild>
        {variant === "pill" ? (
          <button
            type="button"
            className={cn(
              "inline-flex items-center gap-1.5 rounded-full border border-primary/30 bg-primary/5 px-2.5 py-1 text-xs font-medium text-primary hover:bg-primary/10 hover:border-primary/50 transition-colors cursor-pointer select-none",
              className,
            )}
            title="Inspect IDBI Sandbox APIs feeding this page"
          >
            <Database className="h-3 w-3 shrink-0 text-primary" />
            <span>{triggerLabel ? `${triggerLabel} (${activeApis.length})` : `IDBI Sandbox APIs (${activeApis.length})`}</span>
            <span className="hidden sm:inline text-[11px] text-muted-foreground font-mono ml-0.5">
              [{activeApis.map((a) => a.apiId).join(", ")}]
            </span>
          </button>
        ) : (
          <Button
            variant="outline"
            size="sm"
            className={cn(
              "h-8 gap-1.5 text-xs font-medium border-primary/30 text-primary hover:bg-primary/5",
              className,
            )}
          >
            <Database className="h-3.5 w-3.5 shrink-0" />
            <span>{triggerLabel ? `${triggerLabel} (${activeApis.length})` : `APIs in View (${activeApis.length})`}</span>
          </Button>
        )}
      </SheetTrigger>

      <SheetContent side="right" className="w-full sm:max-w-xl md:max-w-2xl p-0 flex flex-col h-full bg-card">
        {/* Header */}
        <div className="p-6 border-b border-border bg-surface shrink-0">
          <SheetHeader>
            <div className="flex items-center gap-2">
              <Badge variant="outline" className="border-primary/40 bg-primary/10 text-primary text-[11px] font-mono">
                IDBI Sandbox Integration
              </Badge>
              <span className="text-xs text-muted-foreground">
                {activeApis.length} APIs feeding this screen
              </span>
            </div>
            <SheetTitle className="text-lg font-semibold text-foreground pt-1 flex items-center justify-between">
              <span>Sandbox API Lineage & Schema</span>
            </SheetTitle>
            <SheetDescription className="text-xs text-muted-foreground">
              Direct mapping from IDBI Finacle Core Banking & Account Aggregator contracts to DRISHTI feature engineering and RBI early-warning rules.
            </SheetDescription>
          </SheetHeader>

          {/* Quick API Selector Pills */}
          <div className="mt-4 flex flex-wrap gap-1.5 pt-1">
            {activeApis.map((api) => {
              const isSelected = selectedApi?.apiId === api.apiId;
              return (
                <button
                  key={api.apiId}
                  type="button"
                  onClick={() => setSelectedApiId(api.apiId)}
                  className={cn(
                    "inline-flex items-center gap-1.5 px-2.5 py-1 rounded-md text-xs font-mono transition-all cursor-pointer",
                    isSelected
                      ? "bg-primary text-primary-foreground font-medium shadow-xs"
                      : "bg-muted text-muted-foreground hover:bg-muted/80 hover:text-foreground",
                  )}
                >
                  <span className="font-bold">API {api.apiId}</span>
                  <span className="text-[11px] opacity-80 truncate max-w-[120px]">{api.name}</span>
                </button>
              );
            })}
          </div>
        </div>

        {/* Selected API Details Area */}
        {selectedApi && (
          <div className="flex-1 overflow-y-auto p-6 space-y-5">
            {/* API Metadata Box */}
            <div className="rounded-lg border border-border bg-background p-4 space-y-3">
              <div className="flex flex-wrap items-center justify-between gap-2">
                <div className="flex items-center gap-2">
                  <span className="font-mono text-sm font-bold text-foreground">API {selectedApi.apiId}</span>
                  <Badge variant="secondary" className="text-[11px] font-medium">
                    {selectedApi.system}
                  </Badge>
                  <Badge variant="outline" className="text-[11px]">
                    {selectedApi.category}
                  </Badge>
                </div>
                <code className="text-[11px] font-mono text-muted-foreground bg-muted/60 px-2 py-0.5 rounded">
                  {selectedApi.endpoint}
                </code>
              </div>

              <p className="text-xs text-foreground/90 leading-relaxed font-sans">
                {selectedApi.description}
              </p>

              {/* Where it feeds this page specifically */}
              <div className="pt-2 border-t border-border/60">
                <span className="text-[11px] uppercase font-semibold text-muted-foreground tracking-wider block mb-1">
                  Active Operational Use On This Screen:
                </span>
                {selectedApi.uiLocations
                  .filter((loc) => loc.route === routePath || routePath.startsWith("/borrowers"))
                  .map((loc, i) => (
                    <div key={i} className="flex items-start gap-1.5 text-xs text-foreground/80">
                      <CheckCircle2 className="h-3.5 w-3.5 text-emerald-600 dark:text-emerald-400 shrink-0 mt-0.5" />
                      <span>{loc.description}</span>
                    </div>
                  ))}
              </div>
            </div>

            {/* View Mode Toggle: Field Mapping vs Raw JSON Contract */}
            <div className="flex items-center justify-between border-b border-border pb-2">
              <div className="flex items-center gap-2">
                <button
                  type="button"
                  onClick={() => setActiveTab("mapping")}
                  className={cn(
                    "text-xs font-medium pb-1.5 relative transition-colors cursor-pointer",
                    activeTab === "mapping"
                      ? "text-primary border-b-2 border-primary"
                      : "text-muted-foreground hover:text-foreground",
                  )}
                >
                  Extracted Features & Rules ({selectedApi.extractedFields.length})
                </button>
                <button
                  type="button"
                  onClick={() => setActiveTab("json")}
                  className={cn(
                    "text-xs font-medium pb-1.5 relative transition-colors cursor-pointer flex items-center gap-1",
                    activeTab === "json"
                      ? "text-primary border-b-2 border-primary"
                      : "text-muted-foreground hover:text-foreground",
                  )}
                >
                  <FileJson className="h-3.5 w-3.5" />
                  <span>Sandbox JSON Payloads</span>
                </button>
              </div>

              <div className="flex items-center gap-1">
                {selectedApi.rulesOrModels.map((rule, idx) => (
                  <span
                    key={idx}
                    className="inline-flex text-[11px] font-mono bg-primary/10 text-primary px-1.5 py-0.5 rounded"
                  >
                    {rule}
                  </span>
                ))}
              </div>
            </div>

            {/* Content Tab 1: Extracted Fields & Feature Pipeline */}
            {activeTab === "mapping" ? (
              <div className="space-y-3">
                <div className="rounded-lg border border-border overflow-hidden">
                  <table className="w-full text-left text-xs">
                    <thead className="bg-muted/50 border-b border-border text-[11px] font-semibold text-muted-foreground">
                      <tr>
                        <th className="py-2 px-3 font-mono">Finacle / AA Source Field</th>
                        <th className="py-2 px-3 font-mono">DRISHTI Feature</th>
                        <th className="py-2 px-3">Role & Credit Intuition</th>
                      </tr>
                    </thead>
                    <tbody className="divide-y divide-border/60 font-sans">
                      {selectedApi.extractedFields.map((field, idx) => (
                        <tr key={idx} className="hover:bg-muted/20">
                          <td className="py-2 px-3 font-mono text-[11px] text-primary font-medium">
                            {field.sourceField}
                          </td>
                          <td className="py-2 px-3 font-mono text-[11px] text-foreground font-semibold">
                            {field.drishtiFeature}
                          </td>
                          <td className="py-2 px-3 text-muted-foreground leading-normal">
                            {field.description}
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>

                <div className="rounded-md bg-muted/40 p-3 text-xs space-y-1.5 border border-border/50">
                  <div className="font-semibold text-foreground text-[11px] uppercase tracking-wider">
                    Downstream Pipeline Dependencies
                  </div>
                  <ul className="space-y-1 text-muted-foreground">
                    {selectedApi.downstreamUse.map((use, i) => (
                      <li key={i} className="flex items-center gap-1.5">
                        <span className="h-1 w-1 rounded-full bg-primary" />
                        <span>{use}</span>
                      </li>
                    ))}
                  </ul>
                </div>
              </div>
            ) : (
              /* Content Tab 2: Raw Request & Response JSON Contract */
              <div className="space-y-4">
                <div>
                  <div className="flex items-center justify-between mb-1.5">
                    <span className="text-xs font-mono font-medium text-foreground">
                      Sample Request Payload ({selectedApi.system})
                    </span>
                    <span className="text-[11px] font-mono text-muted-foreground">POST {selectedApi.endpoint}</span>
                  </div>
                  <pre className="p-3 rounded-lg bg-zinc-950 text-zinc-100 font-mono text-[11px] overflow-x-auto max-h-48 border border-zinc-800">
                    {JSON.stringify(selectedApi.sampleRequest, null, 2)}
                  </pre>
                </div>

                <div>
                  <div className="flex items-center justify-between mb-1.5">
                    <span className="text-xs font-mono font-medium text-foreground">
                      Sample Response Contract (Extracted Data)
                    </span>
                    <span className="text-[11px] font-mono text-emerald-400">200 OK</span>
                  </div>
                  <pre className="p-3 rounded-lg bg-zinc-950 text-zinc-100 font-mono text-[11px] overflow-x-auto max-h-64 border border-zinc-800">
                    {JSON.stringify(selectedApi.sampleResponse, null, 2)}
                  </pre>
                </div>
              </div>
            )}
          </div>
        )}

        {/* Footer */}
        <div className="p-4 border-t border-border bg-surface shrink-0 flex items-center justify-between text-xs">
          <span className="text-muted-foreground text-[11px]">
            Field names indicative; the bank's contract is the reference
          </span>
          <Link
            to="/architecture"
            hash="api-matrix"
            onClick={() => setOpen(false)}
            className="inline-flex items-center gap-1 text-xs font-medium text-primary hover:underline"
          >
            <span>Full 12-API Matrix</span>
            <ExternalLink className="h-3 w-3" />
          </Link>
        </div>
      </SheetContent>
    </Sheet>
  );
}

