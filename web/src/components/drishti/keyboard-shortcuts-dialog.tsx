import * as React from "react";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Badge } from "@/components/ui/badge";
import { Keyboard } from "lucide-react";

interface KeyboardShortcutsDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
}

interface ShortcutItem {
  keys: string[];
  description: string;
  scope?: string;
}

const SHORTCUTS: { category: string; items: ShortcutItem[] }[] = [
  {
    category: "Global Navigation & Search",
    items: [
      { keys: ["⌘", "K"], description: "Open Command Palette / Search any Loan ID or Desk" },
      { keys: ["?"], description: "Show this Keyboard Shortcuts cheat sheet" },
      { keys: ["Esc"], description: "Close modal / Clear active search & filters" },
    ],
  },
  {
    category: "Morning Triage & Watchlist Desk (/)",
    items: [
      { keys: ["1"], description: "Filter 🔴 Urgent Action Queue (24h Critical Accounts)" },
      { keys: ["2"], description: "Filter 🟡 Covenant Watchlist (Weekly Review)" },
      { keys: ["3"], description: "Filter 🟢 Fast-Track Clean Renewals (Prime RG1–RG3)" },
      { keys: ["0"], description: "Reset all triage filters to show Full Portfolio" },
    ],
  },
  {
    category: "Credit Appraisal & Borrower 360",
    items: [
      { keys: ["P"], description: "Open Print / PDF export for formal CAM Dossier", scope: "Borrower / Underwrite" },
      { keys: ["C"], description: "Copy standardized Credit Committee Briefing to clipboard", scope: "Borrower 360" },
    ],
  },
];

export function KeyboardShortcutsDialog({ open, onOpenChange }: KeyboardShortcutsDialogProps) {
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-lg p-0 overflow-hidden bg-surface border-border">
        <DialogHeader className="p-4 border-b border-border bg-muted/20">
          <div className="flex items-center gap-2">
            <div className="p-1.5 rounded-md bg-primary/10 text-primary">
              <Keyboard className="h-4 w-4" />
            </div>
            <div>
              <DialogTitle className="text-base font-semibold text-foreground">
                DRISHTI Keyboard Shortcuts
              </DialogTitle>
              <DialogDescription className="text-xs text-muted-foreground mt-0.5">
                Speed up your daily credit underwriting and early warning monitoring routines.
              </DialogDescription>
            </div>
          </div>
        </DialogHeader>

        <div className="p-4 space-y-4 max-h-[70vh] overflow-y-auto">
          {SHORTCUTS.map((group) => (
            <div key={group.category} className="space-y-2">
              <h4 className="text-[11px] font-semibold uppercase tracking-wider text-muted-foreground">
                {group.category}
              </h4>
              <div className="rounded-md border border-border/70 bg-card divide-y divide-border/60">
                {group.items.map((item, idx) => (
                  <div
                    key={idx}
                    className="flex items-center justify-between px-3 py-2 text-xs hover:bg-muted/30 transition-colors"
                  >
                    <span className="text-foreground flex items-center gap-1.5">
                      {item.description}
                      {item.scope && (
                        <Badge variant="outline" className="text-[9px] px-1 py-0 border-muted text-muted-foreground">
                          {item.scope}
                        </Badge>
                      )}
                    </span>
                    <div className="flex items-center gap-1 shrink-0 ml-2">
                      {item.keys.map((k, kIdx) => (
                        <kbd
                          key={kIdx}
                          className="min-w-5 h-5 px-1.5 inline-flex items-center justify-center font-mono text-[11px] font-medium bg-muted text-foreground rounded border border-border shadow-xs"
                        >
                          {k}
                        </kbd>
                      ))}
                    </div>
                  </div>
                ))}
              </div>
            </div>
          ))}
        </div>

        <div className="p-3 border-t border-border bg-muted/10 text-center text-[11px] text-muted-foreground">
          Press <kbd className="px-1 py-0.5 bg-muted rounded border text-[10px]">Esc</kbd> anytime to dismiss.
        </div>
      </DialogContent>
    </Dialog>
  );
}
