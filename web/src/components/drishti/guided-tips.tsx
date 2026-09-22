"use client";

import React, {
  createContext,
  useContext,
  useState,
  useEffect,
  useCallback,
  type ReactNode,
} from "react";
import { Lightbulb, Check, X, Info } from "lucide-react";
import { Tooltip, TooltipTrigger, TooltipContent } from "@/components/ui/tooltip";
import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";
import { toast } from "sonner";

const STORAGE_KEY = "drishti_guided_tips";
const COMPAT_STORAGE_KEY = "drishti.hints_enabled.v1";

interface GuidedTipsContextType {
  tipsEnabled: boolean;
  toggleTips: () => void;
  setTipsEnabled: (enabled: boolean) => void;
  hydrated: boolean;
}

const GuidedTipsContext = createContext<GuidedTipsContextType | undefined>(undefined);

export function GuidedTipsProvider({ children }: { children: ReactNode }) {
  // Default to true so first-time users receive guided tooltips automatically.
  const [tipsEnabled, setTipsEnabledState] = useState<boolean>(true);
  const [hydrated, setHydrated] = useState<boolean>(false);

  useEffect(() => {
    try {
      const stored = localStorage.getItem(STORAGE_KEY) ?? localStorage.getItem(COMPAT_STORAGE_KEY);
      if (stored !== null) {
        setTipsEnabledState(stored === "true");
      } else {
        localStorage.setItem(STORAGE_KEY, "true");
        localStorage.setItem(COMPAT_STORAGE_KEY, "true");
        setTipsEnabledState(true);
      }
    } catch {
      // Graceful fallback if localStorage is blocked
    }
    setHydrated(true);

    const handleSync = () => {
      try {
        const val = localStorage.getItem(STORAGE_KEY) ?? localStorage.getItem(COMPAT_STORAGE_KEY);
        setTipsEnabledState(val === null ? true : val === "true");
      } catch {}
    };

    window.addEventListener("drishti:guided_tips_toggle", handleSync);
    window.addEventListener("drishti:hints_toggle", handleSync);
    window.addEventListener("storage", handleSync);
    return () => {
      window.removeEventListener("drishti:guided_tips_toggle", handleSync);
      window.removeEventListener("drishti:hints_toggle", handleSync);
      window.removeEventListener("storage", handleSync);
    };
  }, []);

  const setTipsEnabled = useCallback((enabled: boolean) => {
    setTipsEnabledState(enabled);
    try {
      localStorage.setItem(STORAGE_KEY, String(enabled));
      localStorage.setItem(COMPAT_STORAGE_KEY, String(enabled));
    } catch {
      // Storage unavailable
    }
    setTimeout(() => {
      try {
        window.dispatchEvent(new Event("drishti:guided_tips_toggle"));
        window.dispatchEvent(new Event("drishti:hints_toggle"));
      } catch {}
    }, 0);
    if (!enabled) {
      toast.info("Guided tips turned off", {
        description: "You can turn them back on anytime from the top bar.",
        duration: 2500,
      });
    } else {
      toast.success("Guided tips enabled", {
        description: "Hover over KPI cards, triage queues, and table headers for RBI definitions.",
        duration: 2500,
      });
    }
  }, []);

  const toggleTips = useCallback(() => {
    setTipsEnabledState((prev) => {
      const next = !prev;
      try {
        localStorage.setItem(STORAGE_KEY, String(next));
        localStorage.setItem(COMPAT_STORAGE_KEY, String(next));
      } catch {}
      setTimeout(() => {
        try {
          window.dispatchEvent(new Event("drishti:guided_tips_toggle"));
          window.dispatchEvent(new Event("drishti:hints_toggle"));
        } catch {}
      }, 0);
      if (!next) {
        toast.info("Guided tips turned off", {
          description: "You can turn them back on anytime from the top bar.",
          duration: 2500,
        });
      } else {
        toast.success("Guided tips enabled", {
          description: "Hover over KPI cards, triage queues, and table headers for RBI definitions.",
          duration: 2500,
        });
      }
      return next;
    });
  }, []);

  return (
    <GuidedTipsContext.Provider
      value={{
        tipsEnabled,
        toggleTips,
        setTipsEnabled,
        hydrated,
      }}
    >
      {children}
    </GuidedTipsContext.Provider>
  );
}

export function useGuidedTips(): GuidedTipsContextType {
  const context = useContext(GuidedTipsContext);
  if (!context) {
    return {
      tipsEnabled: true,
      toggleTips: () => {},
      setTipsEnabled: () => {},
      hydrated: true,
    };
  }
  return context;
}

/**
 * Header or floating switch button to toggle guided tips on/off anytime.
 */
export function GuidedTipsToggle({
  className,
  variant = "default",
}: {
  className?: string;
  variant?: "default" | "pill" | "subtle";
}) {
  const { tipsEnabled, toggleTips, hydrated } = useGuidedTips();

  // Prevent layout jump prior to hydration
  const active = hydrated ? tipsEnabled : true;

  if (variant === "pill") {
    return (
      <button
        type="button"
        onClick={toggleTips}
        aria-label="Toggle guided tips"
        title={active ? "Guided tips are ON — click to turn off" : "Guided tips are OFF — click to turn on"}
        className={cn(
          "inline-flex items-center gap-2 rounded-full border px-3 py-1.5 text-xs font-medium shadow-md transition-all cursor-pointer backdrop-blur-md",
          active
            ? "border-amber-500/40 bg-slate-900/90 text-amber-300 hover:bg-slate-900 hover:border-amber-500/70 shadow-amber-500/10"
            : "border-border bg-card/90 text-muted-foreground hover:bg-card hover:text-foreground",
          className
        )}
      >
        <Lightbulb
          className={cn(
            "h-3.5 w-3.5 transition-transform",
            active ? "text-amber-400 fill-amber-400/30 scale-110" : "text-muted-foreground"
          )}
        />
        <span className="font-semibold text-[11px]">Guided Tips:</span>
        <span
          className={cn(
            "rounded px-1.5 py-0.2 text-[10px] font-bold tracking-wider uppercase",
            active ? "bg-amber-500/20 text-amber-300" : "bg-muted text-muted-foreground"
          )}
        >
          {active ? "ON" : "OFF"}
        </span>
      </button>
    );
  }

  return (
    <Button
      type="button"
      variant="outline"
      size="sm"
      onClick={toggleTips}
      className={cn(
        "h-7 text-xs font-medium transition-all gap-1.5 px-2.5 rounded-md cursor-pointer select-none",
        active
          ? "border-amber-500/50 bg-amber-500/10 text-amber-800 dark:text-amber-300 hover:bg-amber-500/20 shadow-xs"
          : "border-border bg-surface text-muted-foreground hover:bg-muted hover:text-foreground",
        className
      )}
      title={active ? "Guided tips are ON — click to turn off" : "Turn on guided tips"}
    >
      <Lightbulb
        className={cn(
          "h-3.5 w-3.5 transition-transform",
          active ? "text-amber-500 fill-amber-500/30 scale-105" : "text-muted-foreground"
        )}
      />
      <span className="hidden sm:inline">Guided Tips:</span>
      <span
        className={cn(
          "font-bold uppercase tracking-wider text-[10px]",
          active ? "text-amber-700 dark:text-amber-400" : "text-muted-foreground"
        )}
      >
        {active ? "ON" : "OFF"}
      </span>
    </Button>
  );
}

export {
  GuidedTooltip,
  HintIcon,
  type GuidedTooltipProps,
} from "./guided-tooltip";


/**
 * Dismissible top banner highlighting that guided mode is active.
 */
export function GuidedTipsBanner({
  title = "Guided Tour Active",
  description = "Hover over morning triage cards, KPI tiles, and table headers for RBI credit officer definitions.",
}: {
  title?: string;
  description?: string;
}) {
  const { tipsEnabled, setTipsEnabled, hydrated } = useGuidedTips();

  if (!hydrated || !tipsEnabled) {
    return null;
  }

  return (
    <div className="flex flex-wrap items-center justify-between gap-2 rounded-lg border border-amber-500/30 bg-amber-500/10 px-3.5 py-2 text-xs text-foreground animate-in fade-in slide-in-from-top-1 duration-300">
      <div className="flex items-center gap-2 min-w-0">
        <span className="grid h-5 w-5 shrink-0 place-items-center rounded-full bg-amber-500/20 text-amber-600 dark:text-amber-400">
          <Lightbulb className="h-3 w-3" />
        </span>
        <div className="text-[12px] leading-normal truncate">
          <strong className="font-semibold text-amber-900 dark:text-amber-200 mr-1.5">
            {title}:
          </strong>
          <span className="text-muted-foreground">{description}</span>
        </div>
      </div>
      <div className="flex items-center gap-2 shrink-0 ml-auto">
        <Button
          variant="ghost"
          size="sm"
          onClick={() => setTipsEnabled(false)}
          className="h-6 px-2 text-[11px] text-amber-800 dark:text-amber-300 hover:bg-amber-500/20 cursor-pointer"
        >
          Turn Off Tips
        </Button>
      </div>
    </div>
  );
}
