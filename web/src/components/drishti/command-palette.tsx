import * as React from "react";
import { useNavigate } from "@tanstack/react-router";
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
import { getSnapshot } from "@/lib/api";
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

export function CommandPalette() {
  const [open, setOpen] = React.useState(false);
  const [shortcutsOpen, setShortcutsOpen] = React.useState(false);
  const navigate = useNavigate();
  const { tipsEnabled, setTipsEnabled } = useGuidedTips();

  // Load borrowers from snapshot for rapid client-side search
  const snapshot = React.useMemo(() => getSnapshot(), []);
  const borrowers = snapshot.borrowers || [];

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

    document.addEventListener("keydown", down);
    return () => document.removeEventListener("keydown", down);
  }, [open]);

  const handleSelect = (callback: () => void) => {
    setOpen(false);
    callback();
  };

  // High-risk critical facilities prioritized at the top of the search list
  const criticalBorrowers = React.useMemo(() => {
    return borrowers
      .filter((b) => b.rag === "Red" || b.pd >= 0.12)
      .slice(0, 6);
  }, [borrowers]);

  return (
    <>
      <CommandDialog open={open} onOpenChange={setOpen}>
        <CommandInput placeholder="Search any loan ID (e.g. IDBI_LN_100361), sector, branch, or desk..." />
        <CommandList className="max-h-[380px]">
          <CommandEmpty>No matching accounts, branches, or desks found.</CommandEmpty>

          {/* Primary Desks */}
          <CommandGroup heading="Controlling Office Desks & Tools">
            <CommandItem
              onSelect={() => handleSelect(() => navigate({ to: "/" }))}
              className="cursor-pointer"
            >
              <LayoutDashboard className="mr-2 h-4 w-4 text-primary" />
              <span>Morning Watchlist Queue & Portfolio Overview</span>
              <CommandShortcut>G P</CommandShortcut>
            </CommandItem>

            <CommandItem
              onSelect={() => handleSelect(() => navigate({ to: "/underwrite" }))}
              className="cursor-pointer"
            >
              <FileCheck2 className="mr-2 h-4 w-4 text-blue-600" />
              <span>Single Borrower Appraisal & Finacle CBS Quick-Fetch</span>
              <CommandShortcut>G U</CommandShortcut>
            </CommandItem>

            <CommandItem
              onSelect={() => handleSelect(() => navigate({ to: "/batch" }))}
              className="cursor-pointer"
            >
              <UploadCloud className="mr-2 h-4 w-4 text-purple-600" />
              <span>Bulk Portfolio Batch Screener (CSV Ingestion)</span>
              <CommandShortcut>G S</CommandShortcut>
            </CommandItem>

            <CommandItem
              onSelect={() => handleSelect(() => navigate({ to: "/branches" }))}
              className="cursor-pointer"
            >
              <Building2 className="mr-2 h-4 w-4 text-amber-600" />
              <span>Branch Network & Surveillance (45 Branches Rollup)</span>
              <CommandShortcut>G B</CommandShortcut>
            </CommandItem>

            <CommandItem
              onSelect={() => handleSelect(() => navigate({ to: "/scenario" }))}
              className="cursor-pointer"
            >
              <FlaskConical className="mr-2 h-4 w-4 text-rose-600" />
              <span>Macro Stress Scenario Lab (RBI Shocks & Betas)</span>
              <CommandShortcut>G L</CommandShortcut>
            </CommandItem>

            <CommandItem
              onSelect={() => handleSelect(() => navigate({ to: "/contagion" }))}
              className="cursor-pointer"
            >
              <Network className="mr-2 h-4 w-4 text-indigo-600" />
              <span>Supply Chain Contagion Network (Cascading Stress)</span>
              <CommandShortcut>G C</CommandShortcut>
            </CommandItem>

            <CommandItem
              onSelect={() => handleSelect(() => navigate({ to: "/governance" }))}
              className="cursor-pointer"
            >
              <ShieldCheck className="mr-2 h-4 w-4 text-emerald-600" />
              <span>Model Governance, PSI Stability & HITL Decisions</span>
              <CommandShortcut>G M</CommandShortcut>
            </CommandItem>

            <CommandItem
              onSelect={() => handleSelect(() => navigate({ to: "/guide" }))}
              className="cursor-pointer"
            >
              <BookOpen className="mr-2 h-4 w-4 text-teal-600" />
              <span>Daily Operations & Banking Usage Guide</span>
              <CommandShortcut>G O</CommandShortcut>
            </CommandItem>
          </CommandGroup>

          <CommandSeparator />

          {/* 🔴 Priority Accounts */}
          <CommandGroup heading="🔴 Urgent Action Facilities (24h Critical)">
            {criticalBorrowers.map((b) => (
              <CommandItem
                key={b.loan_id}
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
                  <Badge variant="outline" className={`text-[10px] px-1 py-0 ${ragTone[b.rag]}`}>
                    {b.risk_grade} ({formatPercent(b.pd, 1)})
                  </Badge>
                  <ArrowRight className="h-3 w-3 text-muted-foreground" />
                </div>
              </CommandItem>
            ))}
          </CommandGroup>

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
              <Badge variant="secondary" className="ml-auto text-[10px]">
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
  };

  return (
    <button
      type="button"
      onClick={handleClick}
      className={`inline-flex items-center gap-2 rounded-md border border-border/80 bg-background/80 px-2.5 py-1 text-xs text-muted-foreground hover:bg-muted/70 hover:text-foreground hover:border-primary/40 transition-colors cursor-pointer shadow-2xs ${className || ""}`}
      title="Open Command Palette (⌘K)"
    >
      <Search className="h-3.5 w-3.5 text-muted-foreground" />
      <span className="hidden lg:inline">Search accounts, branches, desks...</span>
      <span className="lg:hidden">Search...</span>
      <kbd className="pointer-events-none inline-flex h-4.5 select-none items-center gap-0.5 rounded border border-border/80 bg-muted px-1.5 font-mono text-[10px] font-medium text-muted-foreground ml-1.5">
        <span className="text-[11px]">⌘</span>K
      </kbd>
    </button>
  );
}
