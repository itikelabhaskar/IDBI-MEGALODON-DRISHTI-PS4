"use client";

import * as React from "react";
import {
  Popover,
  PopoverContent,
  PopoverTrigger,
} from "@/components/ui/popover";
import {
  Tooltip,
  TooltipContent,
  TooltipTrigger,
} from "@/components/ui/tooltip";
import { HelpCircle, Sparkles, EyeOff, Lightbulb, X } from "lucide-react";
import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";
import { useGuidedTips } from "@/components/drishti/guided-tips";

/**
 * Extract plain text from ReactNode for infallible native HTML title tooltip fallback.
 */
function extractText(node: React.ReactNode): string {
  if (typeof node === "string") return node;
  if (typeof node === "number") return String(node);
  if (!node) return "";
  if (Array.isArray(node)) return node.map(extractText).join(" ");
  if (React.isValidElement(node) && (node.props as any)?.children) {
    return extractText((node.props as any).children);
  }
  return "";
}

/**
 * Hook to manage whether guidance tooltips and explanatory hints are enabled.
 * Fully synchronized with platform-wide GuidedTipsContext and localStorage.
 */
export function useTooltipsEnabled() {
  const { tipsEnabled, toggleTips, setTipsEnabled } = useGuidedTips();
  return { enabled: tipsEnabled, toggle: toggleTips, setTipsEnabled };
}

export interface GuidedTooltipProps {
  content?: React.ReactNode;
  tip?: React.ReactNode;
  step?: number | string;
  title?: string;
  children: React.ReactNode;
  side?: "top" | "bottom" | "left" | "right";
  align?: "start" | "center" | "end";
  className?: string;
  asChild?: boolean;
}

/**
 * Context-aware tooltip that honors the user's guidance mode toggle.
 * Equipped with instant hover (0ms delay), click-to-pin popover capability,
 * and native HTML title fallback.
 */
export function GuidedTooltip({
  content,
  tip,
  step,
  title,
  children,
  side = "top",
  align = "center",
  className,
  asChild = true,
}: GuidedTooltipProps) {
  const { enabled, setTipsEnabled } = useTooltipsEnabled();
  const effectiveTip = content ?? tip;
  const plainText = extractText(effectiveTip);

  if (!effectiveTip) {
    return <>{children}</>;
  }

  // When tips are turned off, still pass native title for accessibility without tooltip overhead
  if (!enabled) {
    if (React.isValidElement(children) && asChild) {
      return React.cloneElement(children as React.ReactElement<any>, {
        title: (children as React.ReactElement<any>).props?.title || plainText,
      });
    }
    return <span title={plainText}>{children}</span>;
  }

  const isChildValid = React.isValidElement(children);
  const useAsChild = asChild && isChildValid;

  return (
    <Tooltip delayDuration={0}>
      <TooltipTrigger asChild={useAsChild}>
        {useAsChild ? (
          React.cloneElement(children as React.ReactElement<any>, {
            title: (children as React.ReactElement<any>).props?.title || plainText,
          })
        ) : (
          <span title={plainText}>{children}</span>
        )}
      </TooltipTrigger>
      <TooltipContent
        side={side}
        align={align}
        sideOffset={6}
        className={cn(
          "max-w-xs sm:max-w-sm rounded-lg border border-border/90 bg-surface/98 text-foreground p-3 text-xs shadow-2xl backdrop-blur-md z-50 pointer-events-auto break-words [text-wrap:pretty]",
          className,
        )}
      >
        <div className="space-y-2 text-left">
          <div className="flex items-center justify-between gap-2 border-b border-border/60 pb-1.5">
            <div className="flex items-center gap-1.5">
              <Lightbulb className="h-3.5 w-3.5 text-amber-500 shrink-0" />
              {step && (
                <span className="rounded bg-amber-500/20 px-1.5 py-0.5 text-[10px] font-bold text-amber-600 dark:text-amber-300">
                  Step {step}
                </span>
              )}
              <span className="text-xs font-semibold tracking-wide text-foreground">
                {title || "Supervisory Guidance"}
              </span>
            </div>
          </div>
          <div className="text-[11px] leading-relaxed text-muted-foreground">
            {effectiveTip}
          </div>
          <div className="flex items-center justify-between pt-1.5 text-[10px] text-muted-foreground border-t border-border/60">
            <span className="text-[9px] text-muted-foreground flex items-center gap-1">
              <span className="h-1.5 w-1.5 rounded-full bg-emerald-500" />
              RBI Regulatory Context
            </span>
            <button
              type="button"
              onClick={(e) => {
                e.preventDefault();
                e.stopPropagation();
                setTipsEnabled?.(false);
              }}
              className="text-[10px] font-medium text-amber-600 dark:text-amber-400 hover:underline cursor-pointer transition-colors"
            >
              Turn off tips
            </button>
          </div>
        </div>
      </TooltipContent>
    </Tooltip>
  );
}

/**
 * Inline helper [?] icon with instant hover preview and click-to-pin popover behavior.
 * Guaranteed to display reliably across all browsers, trackpads, and mobile screens.
 */
export function HintIcon({
  text,
  side = "top",
  className,
}: {
  text: React.ReactNode;
  side?: "top" | "bottom" | "left" | "right";
  className?: string;
}) {
  const { enabled } = useTooltipsEnabled();
  const [pinned, setPinned] = React.useState(false);
  const [hovered, setHovered] = React.useState(false);
  const hoverTimerRef = React.useRef<ReturnType<typeof setTimeout> | null>(null);

  const plainText = extractText(text);

  const handleMouseEnter = () => {
    if (hoverTimerRef.current) clearTimeout(hoverTimerRef.current);
    setHovered(true);
  };

  const handleMouseLeave = () => {
    hoverTimerRef.current = setTimeout(() => {
      setHovered(false);
    }, 120);
  };

  const handleClick = (e: React.MouseEvent) => {
    e.preventDefault();
    e.stopPropagation();
    setPinned((prev) => !prev);
  };

  // Popover is open if manually pinned via click, or actively hovered when tips are on
  const isOpen = pinned || (enabled && hovered);

  return (
    <Popover open={isOpen} onOpenChange={setPinned}>
      <PopoverTrigger asChild>
        <button
          type="button"
          onClick={handleClick}
          onMouseEnter={handleMouseEnter}
          onMouseLeave={handleMouseLeave}
          onFocus={handleMouseEnter}
          onBlur={handleMouseLeave}
          aria-label="Guidance note"
          title={plainText}
          className={cn(
            "inline-flex items-center justify-center p-0.5 -my-1 rounded-full text-muted-foreground/70 hover:text-primary hover:bg-primary/10 cursor-pointer ml-1 align-baseline transition-all focus:outline-none focus:ring-1 focus:ring-primary/40",
            isOpen && "text-primary bg-primary/15 ring-1 ring-primary/30",
            className,
          )}
        >
          <HelpCircle className="h-3.5 w-3.5 shrink-0" />
        </button>
      </PopoverTrigger>
      <PopoverContent
        side={side}
        sideOffset={6}
        onMouseEnter={handleMouseEnter}
        onMouseLeave={handleMouseLeave}
        className="w-72 sm:w-80 max-w-sm rounded-lg border border-border/90 bg-surface/98 text-foreground p-3 text-xs shadow-2xl backdrop-blur-md z-50 font-normal leading-relaxed pointer-events-auto break-words [text-wrap:pretty]"
      >
        <div className="space-y-1.5">
          <div className="flex items-center justify-between gap-2 border-b border-border/60 pb-1">
            <div className="flex items-center gap-1.5 text-[11px] font-semibold text-foreground">
              <Lightbulb className="h-3.5 w-3.5 text-amber-500 shrink-0" />
              <span>Credit Officer Guidance</span>
            </div>
            {pinned && (
              <button
                type="button"
                onClick={() => setPinned(false)}
                className="text-muted-foreground hover:text-foreground rounded p-0.5 transition-colors"
                title="Close"
              >
                <X className="h-3 w-3" />
              </button>
            )}
          </div>
          <div className="text-[11px] leading-relaxed text-muted-foreground">
            {text}
          </div>
          <div className="pt-1 flex items-center justify-between text-[9px] text-muted-foreground/80 border-t border-border/40">
            <span className="flex items-center gap-1">
              <span className="h-1.5 w-1.5 rounded-full bg-emerald-500" />
              IDBI Risk Framework
            </span>
            <span className="text-[9px] text-muted-foreground/60">
              {pinned ? "Pinned · click outside to close" : "Click to pin note"}
            </span>
          </div>
        </div>
      </PopoverContent>
    </Popover>
  );
}

/**
 * Interactive button to toggle guidance hints on/off across the platform.
 */
export function TooltipToggle({ className }: { className?: string }) {
  const { enabled, toggle } = useTooltipsEnabled();

  return (
    <Button
      variant="outline"
      size="sm"
      onClick={toggle}
      title={
        enabled
          ? "Guidance tooltips are active. Click to turn off helper hints."
          : "Guidance tooltips are hidden. Click to enable helper hints."
      }
      className={cn(
        "h-7 px-2.5 text-xs gap-1.5 transition-all font-normal select-none cursor-pointer",
        enabled
          ? "border-amber-500/50 bg-amber-500/10 text-amber-800 dark:text-amber-300 hover:bg-amber-500/20"
          : "border-border bg-background text-muted-foreground hover:text-foreground",
        className,
      )}
    >
      {enabled ? (
        <>
          <Sparkles className="h-3 w-3 text-amber-500 animate-pulse" />
          <span>Tooltips: ON</span>
        </>
      ) : (
        <>
          <EyeOff className="h-3 w-3 text-muted-foreground" />
          <span>Tooltips: OFF</span>
        </>
      )}
    </Button>
  );
}
