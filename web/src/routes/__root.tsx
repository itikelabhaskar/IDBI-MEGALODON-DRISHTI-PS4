import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import {
  Outlet,
  createRootRouteWithContext,
  useRouter,
  HeadContent,
  Scripts,
} from "@tanstack/react-router";
import { useEffect, type ReactNode } from "react";

import appCss from "../styles.css?url";
import { RoleProvider } from "@/lib/role-context";
import { AppShell } from "@/components/drishti/app-shell";
import { RouteGuard } from "@/components/drishti/route-guard";
import { BrandMark } from "@/components/drishti/brand";
import { Toaster } from "@/components/ui/sonner";
import { Button } from "@/components/ui/button";
import { TooltipProvider } from "@/components/ui/tooltip";
import { GuidedTipsProvider } from "@/components/drishti/guided-tips";
import { CommandPalette } from "@/components/drishti/command-palette";

// NOTE: notFound/error components render OUTSIDE RootComponent's provider tree,
// so they must not use AppShell/useRole. Standalone layouts only.
function BareLayout({ children }: { children: ReactNode }) {
  return (
    <div className="grid min-h-screen w-full place-items-center bg-background px-4">
      <div className="w-full max-w-md rounded-xl border border-border bg-card p-8 text-center shadow-[var(--shadow-card)]">
        <BrandMark className="mx-auto h-10 w-10" />
        {children}
      </div>
    </div>
  );
}

function NotFoundComponent() {
  return (
    <BareLayout>
      <div className="mt-4 text-[11px] uppercase tracking-widest text-muted-foreground">404</div>
      <h1 className="mt-1 text-xl font-semibold text-foreground">Page not found</h1>
      <p className="mt-1 text-sm text-muted-foreground">
        The borrower or page you're looking for doesn't exist.
      </p>
      <div className="mt-5">
        <a
          href="/"
          className="inline-flex items-center justify-center rounded-md bg-primary px-4 py-2 text-sm font-medium text-primary-foreground hover:bg-primary-dark"
        >
          Back to portfolio console
        </a>
      </div>
    </BareLayout>
  );
}

function ErrorComponent({ error, reset }: { error: Error; reset: () => void }) {
  const router = useRouter();
  useEffect(() => {
    // Local, in-app error logging only — no third-party telemetry (DPDP-safe).
    console.error("[DRISHTI] root error boundary:", error);
    // A tab opened before a redeploy asks for page code that no longer exists
    // ("Failed to fetch dynamically imported module"). One reload fetches the new
    // build; the session flag stops a reload loop if the server itself is broken.
    const stale = /dynamically imported module|Importing a module script failed|ChunkLoadError/i.test(String(error?.message));
    if (stale && typeof window !== "undefined" && !sessionStorage.getItem("drishti_chunk_reload")) {
      sessionStorage.setItem("drishti_chunk_reload", "1");
      window.location.reload();
    }
  }, [error]);

  const handleResetSession = () => {
    try {
      sessionStorage.clear();
      localStorage.removeItem("drishti.session.v1");
      localStorage.removeItem("drishti_boot_completed");
    } catch {
      /* ignore */
    }
    window.location.href = "/";
  };

  return (
    <BareLayout>
      <h1 className="mt-4 text-xl font-semibold text-foreground">Something went wrong</h1>
      <p className="mt-1 text-sm text-muted-foreground">
        An unexpected application error occurred. You can retry or reset session state.
      </p>

      {error?.message && (
        <div className="mt-4 max-h-32 overflow-auto rounded bg-muted/60 p-2.5 text-left font-mono text-xs text-muted-foreground break-words border border-border/50">
          <p className="font-semibold text-destructive">{error.name}: {error.message}</p>
        </div>
      )}

      <div className="mt-5 flex flex-wrap justify-center gap-2">
        <Button
          onClick={() => {
            router.invalidate();
            reset();
          }}
        >
          Try again
        </Button>
        <Button
          variant="outline"
          onClick={handleResetSession}
        >
          Reset Session & Reload
        </Button>
        <a
          href="/"
          className="inline-flex items-center justify-center rounded-md border border-input bg-surface px-4 py-2 text-sm font-medium text-foreground hover:bg-muted"
        >
          Back to console
        </a>
      </div>
    </BareLayout>
  );
}

export const Route = createRootRouteWithContext<{ queryClient: QueryClient }>()({
  head: () => ({
    meta: [
      { charSet: "utf-8" },
      { name: "viewport", content: "width=device-width, initial-scale=1" },
      { title: "DRISHTI — IDBI 12-Month Stress Prediction Engine" },
      {
        name: "description",
        content:
          "Controlling-office console for DRISHTI: calibrated PD, risk grades RG1–RG10, SMA watch, RBI EWS triggers, SHAP reason codes and expected credit loss across the MSME loan portfolio.",
      },
      { name: "author", content: "IDBI Innovate 26 · PS-4" },
    ],
    links: [{ rel: "stylesheet", href: appCss }],
  }),
  shellComponent: RootShell,
  component: RootComponent,
  notFoundComponent: NotFoundComponent,
  errorComponent: ErrorComponent,
});

function RootShell({ children }: { children: ReactNode }) {
  return (
    <html lang="en">
      <head>
        <HeadContent />
        {/* Static hosts (Hugging Face Spaces among them) serve "/" by redirecting
            to "/index.html". The router would then match no route and render the
            not-found page, so normalise the path before hydration runs. */}
        <script
          dangerouslySetInnerHTML={{
            __html:
              'if(location.pathname.endsWith("/index.html")){history.replaceState(null,"",location.pathname.slice(0,-10)+location.search+location.hash)}',
          }}
        />
      </head>
      <body>
        {children}
        <Scripts />
      </body>
    </html>
  );
}

function RootComponent() {
  const { queryClient } = Route.useRouteContext();

  return (
    <QueryClientProvider client={queryClient}>
      <RoleProvider>
        <TooltipProvider delayDuration={150}>
          <GuidedTipsProvider>
            <AppShell>
              <RouteGuard>
                <Outlet />
              </RouteGuard>
            </AppShell>
            <CommandPalette />
            <Toaster richColors closeButton position="bottom-right" />
          </GuidedTipsProvider>
        </TooltipProvider>
      </RoleProvider>
    </QueryClientProvider>
  );
}
