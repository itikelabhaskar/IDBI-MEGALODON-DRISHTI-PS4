import * as React from "react";
import { useNavigate } from "@tanstack/react-router";
import { useCapabilities, useScopeBranch } from "@/lib/role-context";
import {
  CommandDialog,
  CommandInput,
  CommandList,
  CommandEmpty,
  CommandGroup,
  CommandItem,
  CommandSeparator,
  CommandShortcut,
} from "@/components/ui/command";
import { Badge } from "@/components/ui/badge";
import { fetchBranches, fetchPortfolio, getSnapshot } from "@/lib/api";
import type { BorrowerScore, BranchSummary } from "@/lib/types";
import { useGuidedTips } from "./guided-tips";
import { KeyboardShortcutsDialog } from "./keyboard-shortcuts-dialog";
import {
  Search,
  LayoutDashboard,
  FileCheck2,
  UploadCloud,
  Building2,
  FlaskConical,
  Network,
  ShieldCheck,
  BookOpen,
  ArrowRight,
  AlertTriangle,
  Lightbulb,
  Keyboard,
  ExternalLink,
} from "lucide-react";
import { ragTone, formatPercent } from "@/lib/format";
import { cn } from "@/lib/utils";

export function CommandPalette() {
  const caps = useCapabilities();
  const scope = useScopeBranch();
  const [open, setOpen] = React.useState(false);
  const [shortcutsOpen, setShortcutsOpen] = React.useState(false);
  const navigate = useNavigate();
  const { tipsEnabled, setTipsEnabled } = useGuidedTips();

  // The whole book and every branch are searchable. Loaded from the API when the
  // palette opens (so new proposals and batch accounts appear), else the snapshot.
  const [borrowers, setBorrowers] = React.useState<BorrowerScore[]>(() => getSnapshot().borrowers ?? []);
  const [branches, setBranches] = React.useState<BranchSummary[]>(() => getSnapshot().branches ?? []);
  const [term, setTerm] = React.useState("");
  React.useEffect(() => {
    if (!open) return;
    let active = true;
    fetchPortfolio({ limit: 2000 }).then((r) => active && r && setBorrowers(r.borrowers));
    fetchBranches().then((b) => active && b.length > 0 && setBranches(b));
    return () => {
      active = false;
    };
  }, [open]);

  // Keybindings listener: Cmd+K / Ctrl+K and ?
  React.useEffect(() => {
    const down = (e: KeyboardEvent) => {
      // Cmd+K / Ctrl+K opens command palette
      if (e.key === "k" && (e.metaKey || e.ctrlKey)) {
        e.preventDefault();
        setOpen((prev) => !prev);
      }

      // '?' opens shortcuts dialog when user is not typing in an input/textarea
      if (
        e.key === "?" &&
        !open &&
        !["INPUT", "TEXTAREA", "SELECT"].includes((e.target as HTMLElement)?.tagName)
      ) {
        e.preventDefault();
        setShortcutsOpen((prev) => !prev);
      }
    };

    const handleCustomOpen = () => setOpen(true);
    window.addEventListener("drishti:open-command-palette", handleCustomOpen);
    document.addEventListener("keydown", down);
    return () => {
      window.removeEventListener("drishti:open-command-palette", handleCustomOpen);
      document.removeEventListener("keydown", down);
    };
  }, [open]);

  const handleSelect = (callback: () => void) => {
    setOpen(false);
    callback();
  };

  // With nothing typed, show the riskiest accounts; once the officer types, every
  // account is a candidate and the list filters on ID, sector and branch.
  const accountHits = React.useMemo(() => {
    // A branch officer searches their own branch only.
    const pool = scope ? borrowers.filter((b) => b.branch_code === scope) : borrowers;
    const byPd = [...pool].sort((a, b) => b.pd - a.pd);
    return term.trim() ? byPd : byPd.filter((b) => b.rag === "Red").slice(0, 8);
  }, [borrowers, term, scope]);

  return (
    <>
      <CommandDialog open={open} onOpenChange={setOpen}>
        <CommandInput
          value={term}
          onValueChange={setTerm}
          placeholder="Search any loan ID (e.g. IDBI_LN_100361), sector, branch, or desk..."
        />
        <CommandList className="max-h-[380px]">
          <CommandEmpty>No matching accounts, branches, or desks found.</CommandEmpty>

          {/* Primary Desks */}
          <CommandGroup heading="Desks & Tools">
            <CommandItem
              onSelect={() => handleSelect(() => navigate({ to: "/" }))}
              className="cursor-pointer"
            >
              <LayoutDashboard className="mr-2 h-4 w-4 text-primary" />
              <span>Morning Watchlist Queue & Portfolio Overview</span>
            </CommandItem>

            {caps.canDecide && (
            <CommandItem
              onSelect={() => handleSelect(() => navigate({ to: "/underwrite" }))}
              className="cursor-pointer"
            >
              <FileCheck2 className="mr-2 h-4 w-4 text-blue-600" />
              <span>Single Borrower Appraisal & Finacle CBS Quick-Fetch</span>
            </CommandItem>
            )}

            {!scope && (
              <>
              <CommandItem
                onSelect={() => handleSelect(() => navigate({ to: "/batch" }))}
                className="cursor-pointer"
              >
                <UploadCloud className="mr-2 h-4 w-4 text-purple-600" />
                <span>Bulk Portfolio Batch Screener (CSV Ingestion)</span>
              </CommandItem>

              <CommandItem
                onSelect={() => handleSelect(() => navigate({ to: "/branches" }))}
                className="cursor-pointer"
              >
                <Building2 className="mr-2 h-4 w-4 text-amber-600" />
                <span>Branch Explorer ({branches.length} branches)</span>
              </CommandItem>

              <CommandItem
                onSelect={() => handleSelect(() => navigate({ to: "/market", search: { tab: "scenario" } }))}
                className="cursor-pointer"
              >
                <FlaskConical className="mr-2 h-4 w-4 text-rose-600" />
                <span>Macro Stress Scenario Lab (RBI Shocks & Betas)</span>
              </CommandItem>

              <CommandItem
                onSelect={() => handleSelect(() => navigate({ to: "/market", search: { tab: "contagion" } }))}
                className="cursor-pointer"
              >
                <Network className="mr-2 h-4 w-4 text-indigo-600" />
                <span>Supply Chain Contagion Network (Cascading Stress)</span>
              </CommandItem>
              </>
            )}

            <CommandItem
              onSelect={() => handleSelect(() => navigate({ to: "/governance" }))}
              className="cursor-pointer"
            >
              <ShieldCheck className="mr-2 h-4 w-4 text-emerald-600" />
              <span>Model Governance, PSI Stability & HITL Decisions</span>
            </CommandItem>

            <CommandItem
              onSelect={() => handleSelect(() => navigate({ to: "/guide" }))}
              className="cursor-pointer"
            >
              <BookOpen className="mr-2 h-4 w-4 text-teal-600" />
              <span>Daily Operations & Banking Usage Guide</span>
            </CommandItem>
          </CommandGroup>

          <CommandSeparator />

          {/* Accounts */}
          <CommandGroup
            heading={term.trim() ? "Accounts" : `Red accounts (type to search ${scope ? "your branch" : "the whole book"})`}
          >
            {accountHits.map((b) => (
              <CommandItem
                key={b.loan_id}
                value={`${b.loan_id} ${b.sector ?? ""} ${b.branch_name ?? ""} ${b.branch_code ?? ""}`}
                onSelect={() =>
                  handleSelect(() =>
                    navigate({ to: "/borrowers/$id", params: { id: b.loan_id } })
                  )
                }
                className="cursor-pointer flex items-center justify-between"
              >
                <div className="flex items-center gap-2 min-w-0">
                  <AlertTriangle className="h-3.5 w-3.5 text-destructive shrink-0" />
                  <span className="font-mono font-medium text-foreground">{b.loan_id}</span>
                  <span className="text-xs text-muted-foreground truncate">
                    {(b.sector ?? "").replace(/_/g, " ")} · {b.branch_name}
                  </span>
                </div>
                <div className="flex items-center gap-1.5 shrink-0 ml-2">
                  <Badge variant="outline" className={`text-[11px] px-1 py-0 ${ragTone[b.rag]}`}>
                    {b.risk_grade} ({formatPercent(b.pd, 1)})
                  </Badge>
                  <ArrowRight className="h-3 w-3 text-muted-foreground" />
                </div>
              </CommandItem>
            ))}
          </CommandGroup>

          {term.trim() && !scope && (
            <CommandGroup heading="Branches">
              {branches.map((br) => (
                <CommandItem
                  key={br.branch_code}
                  value={`branch ${br.branch_code} ${br.branch_name} ${br.region} ${br.zone}`}
                  onSelect={() => handleSelect(() => navigate({ to: "/", search: { branch: br.branch_code } }))}
                  className="cursor-pointer flex items-center justify-between"
                >
                  <div className="flex items-center gap-2 min-w-0">
                    <Building2 className="h-3.5 w-3.5 text-amber-600 shrink-0" />
                    <span className="font-medium">{br.branch_name}</span>
                    <span className="text-xs text-muted-foreground font-mono">{br.branch_code}</span>
                  </div>
                  <span className="text-[11px] text-muted-foreground shrink-0 ml-2">{br.accounts} accounts</span>
                </CommandItem>
              ))}
            </CommandGroup>
          )}

          <CommandSeparator />

          {/* Quick Desk Actions */}
          <CommandGroup heading="Desk Actions & Utilities">
            <CommandItem
              onSelect={() => {
                handleSelect(() => {
                  setTipsEnabled(!tipsEnabled);
                });
              }}
              className="cursor-pointer"
            >
              <Lightbulb className="mr-2 h-4 w-4 text-amber-500" />
              <span>Toggle Guided Tips & Onboarding Hints</span>
              <Badge variant="secondary" className="ml-auto text-[11px]">
                Currently {tipsEnabled ? "ON" : "OFF"}
              </Badge>
            </CommandItem>

            <CommandItem
              onSelect={() => {
                handleSelect(() => {
                  setShortcutsOpen(true);
                });
              }}
              className="cursor-pointer"
            >
              <Keyboard className="mr-2 h-4 w-4 text-muted-foreground" />
              <span>View All Keyboard Shortcuts</span>
              <CommandShortcut>?</CommandShortcut>
            </CommandItem>
          </CommandGroup>
        </CommandList>
      </CommandDialog>

      <KeyboardShortcutsDialog open={shortcutsOpen} onOpenChange={setShortcutsOpen} />
    </>
  );
}

export function CommandPaletteTrigger({ className }: { className?: string }) {
  const handleClick = () => {
    // Trigger synthetic Cmd+K
    const event = new KeyboardEvent("keydown", {
      key: "k",
      metaKey: true,
      bubbles: true,
    });
    document.dispatchEvent(event);
    window.dispatchEvent(new CustomEvent("drishti:open-command-palette"));
  };

  return (
    <button
      type="button"
      onClick={handleClick}
      className={cn(
        "inline-flex h-8 w-full items-center justify-between gap-2 rounded-md border border-border/80 bg-background/80 px-2.5 text-xs text-muted-foreground hover:bg-muted/70 hover:text-foreground hover:border-primary/40 transition-colors cursor-pointer shadow-2xs whitespace-nowrap overflow-hidden select-none",
        className,
      )}
      title="Open Command Palette (⌘K)"
      aria-label="Open Command Palette"
    >
      <div className="flex items-center gap-2 min-w-0 overflow-hidden">
        <Search className="h-3.5 w-3.5 shrink-0 text-muted-foreground" />
        <span className="truncate text-left text-xs">Search accounts, branches...</span>
      </div>
      <kbd className="pointer-events-none inline-flex h-5 shrink-0 select-none items-center gap-0.5 rounded border border-border/80 bg-muted px-1.5 font-mono text-[11px] font-medium text-muted-foreground ml-2">
        <span className="text-[11px]">⌘</span>K
      </kbd>
    </button>
  );
}
