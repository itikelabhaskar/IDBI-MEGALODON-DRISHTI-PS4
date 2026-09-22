import { useRole } from "@/lib/role-context";
import { Badge } from "@/components/ui/badge";
import { BrandMark } from "./brand";
import { FlaskConical, Keyboard } from "lucide-react";
import { GuidedTipsToggle } from "./guided-tips";
import { CommandPaletteTrigger } from "./command-palette";

export function TopBar() {
  const handleOpenShortcuts = () => {
    const event = new KeyboardEvent("keydown", {
      key: "?",
      bubbles: true,
    });
    document.dispatchEvent(event);
  };

  return (
    <header
      data-no-print="true"
      className="h-14 shrink-0 border-b border-border bg-surface flex items-center px-4 md:px-6 gap-3"
    >
      <div className="flex items-center gap-2 md:hidden">
        <BrandMark className="h-7 w-7" />
        <span className="text-sm font-semibold text-foreground">DRISHTI</span>
      </div>
      <div className="hidden md:flex items-center gap-2 min-w-0">
        <span className="text-sm font-semibold text-foreground">DRISHTI Risk Engine</span>
        <span className="text-xs text-muted-foreground">/ Controlling-office console</span>
      </div>

      <div className="flex-1 max-w-sm ml-2 hidden sm:block">
        <CommandPaletteTrigger className="w-full justify-between" />
      </div>

      <div className="ml-auto flex items-center gap-2">
        <button
          type="button"
          onClick={handleOpenShortcuts}
          className="hidden sm:inline-flex items-center gap-1 text-xs text-muted-foreground hover:text-foreground p-1.5 rounded-md hover:bg-muted/70 transition-colors cursor-pointer"
          title="Keyboard shortcuts (?)"
          aria-label="View keyboard shortcuts"
        >
          <Keyboard className="h-4 w-4" />
          <span className="text-[11px] font-mono opacity-80">(?)</span>
        </button>
        <GuidedTipsToggle />
        <Badge
          variant="outline"
          className="hidden xl:inline-flex border-accent/40 bg-accent/10 text-foreground/80 font-normal text-xs"
        >
          <FlaskConical className="h-3 w-3 mr-1 text-accent" />
          Synthetic data — submission build
        </Badge>
      </div>
    </header>
  );
}
