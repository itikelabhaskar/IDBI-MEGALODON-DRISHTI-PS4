import { cn } from "@/lib/utils";

/**
 * DRISHTI brand mark — a rounded IDBI-teal tile holding an eye + radar pulse
 * motif (Drishti = sight/foresight; stress seen 12 months ahead). Not IDBI's
 * registered logo; an original lockup carrying the bank's green for the pilot.
 */
export function BrandMark({ className }: { className?: string }) {
  return (
    <span
      className={cn(
        "grid shrink-0 place-items-center rounded-lg bg-primary text-primary-foreground shadow-sm",
        className,
      )}
      aria-hidden="true"
    >
      <svg
        viewBox="0 0 24 24"
        fill="none"
        className="h-[62%] w-[62%]"
        xmlns="http://www.w3.org/2000/svg"
      >
        {/* eye outline */}
        <path
          d="M2.5 12 C6 6.5, 18 6.5, 21.5 12 C18 17.5, 6 17.5, 2.5 12 Z"
          stroke="currentColor"
          strokeWidth="1.7"
          strokeLinejoin="round"
        />
        {/* pupil */}
        <circle cx="12" cy="12" r="3.1" fill="currentColor" />
        {/* foresight pulse — the 12-month horizon signal */}
        <path
          d="M4.5 4.5 L7.5 4.5 M16.5 4.5 L19.5 4.5 M4.5 19.5 L7.5 19.5 M16.5 19.5 L19.5 19.5"
          stroke="var(--color-accent)"
          strokeWidth="1.6"
          strokeLinecap="round"
        />
      </svg>
    </span>
  );
}

/** Full brand lockup: mark + wordmark. `tone` adapts to dark (sidebar) or light. */
export function BrandLockup({
  tone = "light",
  className,
}: {
  tone?: "light" | "dark";
  className?: string;
}) {
  return (
    <div className={cn("flex items-center gap-2.5", className)}>
      <BrandMark className="h-9 w-9" />
      <div className="min-w-0 leading-tight">
        <div
          className={cn(
            "flex items-center whitespace-nowrap text-[15px] font-bold tracking-tight",
            tone === "dark" ? "text-sidebar-foreground" : "text-foreground",
          )}
        >
          DRISHTI
          <span
            className={cn(
              "text-[15px] font-semibold",
              tone === "dark" ? "text-sidebar-foreground/85" : "text-primary",
            )}
          >
            &nbsp;Risk Engine
          </span>
        </div>
        <div
          className={cn(
            "whitespace-nowrap text-[10px] font-medium uppercase tracking-[0.14em]",
            tone === "dark" ? "text-sidebar-foreground/55" : "text-muted-foreground",
          )}
        >
          12-Month Stress Horizon
        </div>
      </div>
    </div>
  );
}
