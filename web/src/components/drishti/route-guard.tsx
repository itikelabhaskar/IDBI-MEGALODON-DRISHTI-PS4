import type { ReactNode } from "react";
import { Link, useRouterState } from "@tanstack/react-router";
import { Lock } from "lucide-react";
import { Card, CardDescription, CardHeader } from "@/components/ui/card";
import { ROLE_CAPABILITIES, useRole, type Role } from "@/lib/role-context";
import { NAV_GROUPS } from "./sidebar";

const WHY_NOT: Partial<Record<Role, string>> = {
  "Branch Officer":
    "Branch officers work their own branch. This page covers the whole bank, so it stays with the controlling office and Risk Admin.",
};

/**
 * Hiding a menu item does not stop someone typing its address. Each page's
 * allowed roles come from the sidebar's own list, so the two cannot disagree.
 * Client-side, like the rest of the prototype's roles.
 */
export function RouteGuard({ children }: { children: ReactNode }) {
  const { role } = useRole();
  const pathname = useRouterState({ select: (s) => s.location.pathname });
  const item = NAV_GROUPS.flatMap((g) => g.items).find(
    (i) => !i.hash && i.to !== "/" && (pathname === i.to || pathname.startsWith(`${i.to}/`)),
  );
  if (!item || item.roles.includes(role)) return <>{children}</>;
  return (
    <div className="p-4 md:p-6">
      <Card className="mx-auto max-w-xl bg-surface">
        <CardHeader>
          <h1 className="flex items-center gap-2 text-base font-semibold">
            <Lock className="h-4 w-4 text-muted-foreground" /> {item.label} is not available to {role}
          </h1>
          <CardDescription className="text-xs">
            {WHY_NOT[role] ?? ROLE_CAPABILITIES[role].readOnlyReason ?? "This page is limited to other roles."}
          </CardDescription>
          <Link to={ROLE_CAPABILITIES[role].home} className="pt-2 text-xs text-primary hover:underline">
            Back to your home page
          </Link>
        </CardHeader>
      </Card>
    </div>
  );
}
