import { useState, type ReactNode } from "react";
import { Sidebar } from "./sidebar";
import { TopBar } from "./top-bar";
import { LoginScreen } from "./login-screen";
import { BrandMark } from "./brand";
import { useRole } from "@/lib/role-context";

export function AppShell({ children }: { children: ReactNode }) {
  const { user, hydrated } = useRole();
  const [sidebarCollapsed, setSidebarCollapsed] = useState(false);

  // Neutral splash during hydration so SSR and first client render match.
  if (!hydrated) {
    return (
      <div className="grid min-h-screen w-full place-items-center bg-background">
        <BrandMark className="h-12 w-12 animate-pulse" />
      </div>
    );
  }

  if (!user) return <LoginScreen />;

  return (
    <div className="flex min-h-screen w-full bg-background text-foreground">
      <Sidebar collapsed={sidebarCollapsed} onCollapsedChange={setSidebarCollapsed} />
      <div className="flex flex-1 flex-col min-w-0">
        <TopBar />
        <main className="flex-1 min-w-0">{children}</main>
        <footer
          data-no-print="true"
          className="border-t border-border bg-surface px-4 md:px-6 py-3 text-[11px] leading-relaxed text-muted-foreground"
        >
          DRISHTI is a decision-support engine for IDBI's controlling office. The bank remains the
          regulated entity and final decision owner. All figures shown are synthetic data.
        </footer>
      </div>
    </div>
  );
}
