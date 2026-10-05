import { useState, useEffect, useCallback, type ReactNode } from "react";
import { Sidebar } from "./sidebar";
import { TopBar } from "./top-bar";
import { LoginScreen } from "./login-screen";
import { LoadingScreen } from "./loading-screen";
import { useRole } from "@/lib/role-context";

export function AppShell({ children }: { children: ReactNode }) {
  const { user, hydrated } = useRole();
  const [sidebarCollapsed, setSidebarCollapsed] = useState(false);
  const [bootCompleted, setBootCompleted] = useState(false);

  useEffect(() => {
    if (typeof window !== "undefined") {
      if (sessionStorage.getItem("drishti_boot_completed")) {
        setBootCompleted(true);
      }
      if (localStorage.getItem("drishti_sidebar_collapsed") === "1") {
        setSidebarCollapsed(true);
      }
    }
  }, []);

  const handleSidebarCollapse = useCallback((collapsed: boolean) => {
    setSidebarCollapsed(collapsed);
    try {
      localStorage.setItem("drishti_sidebar_collapsed", collapsed ? "1" : "0");
    } catch {
      /* ignore */
    }
  }, []);

  const handleBootComplete = useCallback(() => {
    setBootCompleted(true);
    try {
      sessionStorage.setItem("drishti_boot_completed", "1");
    } catch {
      /* ignore */
    }
  }, []);

  // 1. Short boot screen while the session and snapshot load
  if (!hydrated || !bootCompleted) {
    return (
      <LoadingScreen
        minDurationMs={1000}
        onComplete={handleBootComplete}
      />
    );
  }

  // 2. Unauthenticated gate: render LoginScreen
  if (!user) {
    return <LoginScreen />;
  }

  // 4. Authenticated: render full controlling-office dashboard
  return (
    <div className="flex min-h-screen w-full bg-background text-foreground">
      <Sidebar collapsed={sidebarCollapsed} onCollapsedChange={handleSidebarCollapse} />
      <div className="flex flex-1 flex-col min-w-0">
        <TopBar />
        <main className="flex-1 min-w-0">{children}</main>
        <footer
          data-no-print="true"
          className="border-t border-border bg-surface px-4 md:px-6 py-3 text-[11px] leading-relaxed text-muted-foreground flex flex-wrap items-center justify-between gap-2"
        >
          <span>
            DRISHTI is a decision-support engine for IDBI's controlling office. The bank remains the
            regulated entity and final decision owner. All figures shown are synthetic data.
          </span>
          <span className="font-mono text-[11px] text-muted-foreground/80">
            Session: {user.employeeId || "IDBI-CO-001"} ({user.role})
          </span>
        </footer>
      </div>
    </div>
  );
}
