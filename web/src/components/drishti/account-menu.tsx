import { useNavigate } from "@tanstack/react-router";
import { ChevronsUpDown, LogOut, UserCog } from "lucide-react";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { PERSONAS, type Persona } from "@/lib/personas";
import { ROLE_CAPABILITIES, useRole } from "@/lib/role-context";
import { cn } from "@/lib/utils";

/**
 * The one place to see who is signed in, switch role and sign out. The sidebar
 * footer shows it on desktop; on phones, where the sidebar is hidden, the top
 * bar shows it as an avatar (`compact`).
 */
export function AccountMenu({ collapsed = false, compact = false }: { collapsed?: boolean; compact?: boolean }) {
  const { role, user, signIn, signOut } = useRole();
  const navigate = useNavigate();
  // Switching swaps the whole persona (name, role and branch together), the
  // same three people the sign-in screen offers.
  const switchTo = async (p: Persona) => {
    await signIn(p.name, p.role, { employeeId: p.empId, department: p.title, branch: p.office, branchCode: p.branchCode });
    navigate({ to: ROLE_CAPABILITIES[p.role].home });
  };
  const roleLine = user?.branchCode && role === "Branch Officer" ? `${role} · branch ${user.branchCode}` : role;

  const name = user?.name ?? "Officer";
  const initials = name
    .split(" ")
    .map((p) => p[0])
    .join("")
    .slice(0, 2)
    .toUpperCase();
  const iconOnly = collapsed || compact;

  return (
    <DropdownMenu>
      <DropdownMenuTrigger asChild>
        <button
          type="button"
          aria-label="Open account menu"
          title={iconOnly ? `${name} · ${roleLine}` : undefined}
          className={cn(
            "flex items-center gap-2.5 rounded-md text-left transition-colors cursor-pointer",
            compact
              ? "p-0.5 hover:bg-muted/70"
              : "w-full px-2 py-2 hover:bg-sidebar-accent/60",
            collapsed && "justify-center px-1",
          )}
        >
          <span
            className={cn(
              "grid shrink-0 place-items-center rounded-full font-semibold",
              compact
                ? "h-7 w-7 bg-primary text-primary-foreground text-[11px]"
                : "h-8 w-8 bg-sidebar-primary text-sidebar-primary-foreground text-xs",
            )}
          >
            {initials}
          </span>
          {!iconOnly && (
            <>
              <span className="min-w-0 flex-1 leading-tight">
                <span className="block truncate text-[13px] font-medium">{name}</span>
                <span className="block truncate text-[11px] text-sidebar-foreground/60">{roleLine}</span>
              </span>
              <ChevronsUpDown className="h-3.5 w-3.5 shrink-0 text-sidebar-foreground/50" />
            </>
          )}
        </button>
      </DropdownMenuTrigger>
      <DropdownMenuContent side={compact ? "bottom" : "top"} align={compact ? "end" : "start"} className="w-56">
        {compact && (
          <>
            <DropdownMenuLabel className="leading-tight">
              <span className="block truncate">{name}</span>
              <span className="block truncate text-[11px] font-normal text-muted-foreground">{roleLine}</span>
            </DropdownMenuLabel>
            <DropdownMenuSeparator />
          </>
        )}
        <DropdownMenuLabel>Switch officer (demo)</DropdownMenuLabel>
        {PERSONAS.map((p) => (
          <DropdownMenuItem key={p.id} onClick={() => switchTo(p)} className="cursor-pointer items-start">
            <UserCog className="mr-2 mt-0.5 h-4 w-4 shrink-0" />
            <span className="min-w-0 flex-1 leading-tight">
              <span className="block truncate">{p.name}</span>
              <span className="block truncate text-[11px] text-muted-foreground">
                {p.role}
                {p.branchCode ? ` · branch ${p.branchCode}` : ""}
              </span>
            </span>
            {user?.name === p.name && role === p.role && <span className="text-xs text-muted-foreground">active</span>}
          </DropdownMenuItem>
        ))}
        <DropdownMenuSeparator />
        <DropdownMenuItem onClick={signOut} className="text-destructive cursor-pointer">
          <LogOut className="mr-2 h-4 w-4" />
          Sign out / Lock
        </DropdownMenuItem>
      </DropdownMenuContent>
    </DropdownMenu>
  );
}
