import { useRole } from "@/lib/role-context";
import { Badge } from "@/components/ui/badge";
import { BrandMark } from "./brand";
import { useEffect, useState } from "react";
import { FlaskConical, Keyboard } from "lucide-react";
import { probeApi } from "@/lib/api";
import { GuidedTipsToggle } from "./guided-tips";
import { CommandPaletteTrigger } from "./command-palette";
import { MobileNav } from "./mobile-nav";
import { AccountMenu } from "./account-menu";

export function TopBar() {
  const { user } = useRole();
  // null until the first probe answers; the badge must not claim "live" by default.
  const [apiLive, setApiLive] = useState<boolean | null>(null);

  useEffect(() => {
    let cancelled = false;
    const check = () => probeApi().then((ok) => !cancelled && setApiLive(ok));
    check();
    const id = window.setInterval(check, 60_000);
    return () => {
      cancelled = true;
      window.clearInterval(id);
    };
  }, []);

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
      className="h-14 shrink-0 border-b border-border bg-surface flex items-center px-4 md:px-6 gap-3 select-none"
    >
      <MobileNav />
      <div className="flex items-center gap-2 md:hidden">
        <BrandMark className="h-7 w-7" />
        <span className="text-sm font-semibold text-foreground">DRISHTI</span>
      </div>
      <div className="hidden md:flex items-center gap-2 min-w-0">
        <span className="text-sm font-semibold text-foreground">DRISHTI Risk Engine</span>
      </div>

      <div className="w-56 md:w-64 lg:w-72 shrink-0 ml-2 hidden sm:block">
        <CommandPaletteTrigger />
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

        <div className="hidden sm:block">
          <GuidedTipsToggle />
        </div>

        <Badge
          variant="outline"
          title={
            apiLive
              ? "Scoring API reachable: verdicts come from the trained model"
              : "Scoring API not reachable: pages show the bundled snapshot and the offline reference scorer"
          }
          className={
            apiLive
              ? "border-emerald-500/30 bg-emerald-500/10 text-emerald-700 dark:text-emerald-400 font-medium text-xs px-2.5 py-0.5 hidden sm:inline-flex items-center gap-1.5"
              : "border-amber-500/40 bg-amber-500/10 text-amber-700 dark:text-amber-300 font-medium text-xs px-2.5 py-0.5 hidden sm:inline-flex items-center gap-1.5"
          }
        >
          <span className={apiLive ? "h-1.5 w-1.5 rounded-full bg-emerald-500" : "h-1.5 w-1.5 rounded-full bg-amber-500"} />
          {apiLive === null ? "Checking engine…" : apiLive ? "Live engine" : "Offline snapshot"}
        </Badge>

        <Badge
          variant="outline"
          className="inline-flex border-accent/40 bg-accent/10 text-foreground/80 font-normal text-xs"
        >
          <FlaskConical className="h-3 w-3 mr-1 text-accent" />
          <span className="hidden xl:inline">Synthetic data — submission build</span>
          <span className="xl:hidden">Synthetic data</span>
        </Badge>

        {user && (
          <div className="md:hidden">
            <AccountMenu compact />
          </div>
        )}
      </div>
    </header>
  );
}
