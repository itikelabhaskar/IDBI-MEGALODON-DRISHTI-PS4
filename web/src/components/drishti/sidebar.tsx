import { Link, useRouterState } from "@tanstack/react-router";
import {
  LayoutDashboard,
  Users,
  FlaskConical,
  Network,
  Building2,
  ShieldCheck,
  Workflow,
  ChevronsUpDown,
  PanelLeftClose,
  PanelLeftOpen,
  UserRound,
  Settings,
  LogOut,
  UserCog,
  Calculator,
  FileSpreadsheet,
  BookOpen,
  type LucideIcon,
} from "lucide-react";
import { useRole, type Role } from "@/lib/role-context";
import { BrandLockup, BrandMark } from "./brand";
import {
  DropdownMenu,
  DropdownMenuTrigger,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
} from "@/components/ui/dropdown-menu";
import { cn } from "@/lib/utils";

type NavItem = {
  to: string;
  label: string;
  icon: LucideIcon;
  roles: Role[];
};

type NavGroup = {
  heading: string;
  items: NavItem[];
};

const NAV_GROUPS: NavGroup[] = [
  {
    heading: "Daily Operations",
    items: [
      {
        to: "/",
        label: "Portfolio Console",
        icon: LayoutDashboard,
        roles: ["Controlling Office", "Risk Admin"],
      },
      {
        to: "/underwrite",
        label: "Loan Appraisal",
        icon: Calculator,
        roles: ["Controlling Office", "Risk Admin"],
      },
      {
        to: "/batch",
        label: "Batch Screener",
        icon: FileSpreadsheet,
        roles: ["Controlling Office", "Risk Admin"],
      },
    ],
  },
  {
    heading: "Supervision & Strategy",
    items: [
      {
        to: "/branches",
        label: "Branch Network",
        icon: Building2,
        roles: ["Controlling Office", "Risk Admin"],
      },
      {
        to: "/scenario",
        label: "Scenario Lab",
        icon: FlaskConical,
        roles: ["Controlling Office", "Risk Admin"],
      },
      {
        to: "/contagion",
        label: "Supplier Contagion",
        icon: Network,
        roles: ["Controlling Office", "Risk Admin"],
      },
    ],
  },
  {
    heading: "Governance & Reference",
    items: [
      {
        to: "/guide",
        label: "Operations Guide",
        icon: BookOpen,
        roles: ["Controlling Office", "Risk Admin"],
      },
      {
        to: "/governance",
        label: "Model Governance",
        icon: ShieldCheck,
        roles: ["Controlling Office", "Risk Admin"],
      },
      {
        to: "/architecture",
        label: "Architecture",
        icon: Workflow,
        roles: ["Controlling Office", "Risk Admin"],
      },
    ],
  },
];

type SidebarProps = {
  collapsed: boolean;
  onCollapsedChange: (collapsed: boolean) => void;
};

export function Sidebar({ collapsed, onCollapsedChange }: SidebarProps) {
  const { role, setRole, user, signOut } = useRole();
  const pathname = useRouterState({ select: (s) => s.location.pathname });
  const name = user?.name ?? "Officer";
  const initials = name
    .split(" ")
    .map((p) => p[0])
    .join("")
    .slice(0, 2)
    .toUpperCase();

  return (
    <aside
      data-no-print="true"
      className={cn(
        "sticky top-0 hidden h-screen shrink-0 flex-col border-r border-sidebar-border bg-sidebar text-sidebar-foreground transition-[width] duration-200 md:flex",
        collapsed ? "w-16" : "w-60",
      )}
    >
      <div
        className={cn(
          "flex items-center gap-2 px-4 pb-4 pt-5",
          collapsed && "flex-col justify-center px-2",
        )}
      >
        {collapsed ? <BrandMark className="h-9 w-9" /> : <BrandLockup tone="dark" />}
        <button
          type="button"
          aria-label={collapsed ? "Expand sidebar" : "Collapse sidebar"}
          title={collapsed ? "Expand sidebar" : "Collapse sidebar"}
          onClick={() => onCollapsedChange(!collapsed)}
          className={cn(
            "ml-auto grid h-8 w-8 shrink-0 place-items-center rounded-md text-sidebar-foreground/70 transition-colors hover:bg-sidebar-accent/60 hover:text-sidebar-foreground",
            collapsed && "ml-0",
          )}
        >
          {collapsed ? (
            <PanelLeftOpen className="h-4 w-4" />
          ) : (
            <PanelLeftClose className="h-4 w-4" />
          )}
        </button>
      </div>

      <nav className="min-h-0 flex-1 overflow-y-auto px-2 space-y-4">
        {NAV_GROUPS.map((group) => {
          const visibleItems = group.items.filter((n) => n.roles.includes(role));
          if (visibleItems.length === 0) return null;
          return (
            <div key={group.heading} className="space-y-1">
              <div
                className={cn(
                  "px-3 py-1 text-[10px] font-semibold uppercase tracking-widest text-sidebar-foreground/50",
                  collapsed && "sr-only",
                )}
              >
                {group.heading}
              </div>
              <ul className="space-y-0.5">
                {visibleItems.map((item) => {
                  const Icon = item.icon;
                  const active =
                    pathname === item.to || (item.to !== "/" && pathname.startsWith(item.to));
                  return (
                    <li key={item.to}>
                      <Link
                        to={item.to}
                        viewTransition
                        aria-label={collapsed ? item.label : undefined}
                        title={collapsed ? item.label : undefined}
                        className={cn(
                          "flex items-center gap-2.5 rounded-md px-3 py-2 text-sm transition-colors",
                          collapsed && "justify-center px-2",
                          active
                            ? "bg-sidebar-accent text-sidebar-accent-foreground font-medium"
                            : "text-sidebar-foreground/80 hover:bg-sidebar-accent/60 hover:text-sidebar-foreground",
                        )}
                      >
                        <Icon className="h-4 w-4 shrink-0" />
                        <span className={cn("truncate", collapsed && "sr-only")}>{item.label}</span>
                      </Link>
                    </li>
                  );
                })}
              </ul>
            </div>
          );
        })}
      </nav>

      <div className="border-t border-sidebar-border/60 p-2">
        <DropdownMenu>
          <DropdownMenuTrigger asChild>
            <button
              type="button"
              aria-label="Open account menu"
              title={collapsed ? `${name} · ${role}` : undefined}
              className={cn(
                "flex w-full items-center gap-2.5 rounded-md px-2 py-2 text-left transition-colors hover:bg-sidebar-accent/60",
                collapsed && "justify-center px-1",
              )}
            >
              <span className="grid h-8 w-8 shrink-0 place-items-center rounded-full bg-sidebar-primary text-sidebar-primary-foreground text-xs font-semibold">
                {initials}
              </span>
              <span className={cn("min-w-0 flex-1 leading-tight", collapsed && "sr-only")}>
                <span className="block truncate text-[13px] font-medium">{name}</span>
                <span className="block truncate text-[11px] text-sidebar-foreground/60">
                  {role}
                </span>
              </span>
              <ChevronsUpDown
                className={cn(
                  "h-3.5 w-3.5 shrink-0 text-sidebar-foreground/50",
                  collapsed && "hidden",
                )}
              />
            </button>
          </DropdownMenuTrigger>
          <DropdownMenuContent side="top" align="start" className="w-56">
            <DropdownMenuLabel>Switch role</DropdownMenuLabel>
            {(["Controlling Office", "Risk Admin"] as Role[]).map((r) => (
              <DropdownMenuItem key={r} onClick={() => setRole(r)}>
                <UserCog className="mr-2 h-4 w-4" />
                <span className="flex-1">{r}</span>
                {r === role && <span className="text-xs text-muted-foreground">active</span>}
              </DropdownMenuItem>
            ))}
            <DropdownMenuSeparator />
            <DropdownMenuItem>
              <UserRound className="mr-2 h-4 w-4" />
              Profile
            </DropdownMenuItem>
            <DropdownMenuItem>
              <Settings className="mr-2 h-4 w-4" />
              Settings
            </DropdownMenuItem>
            <DropdownMenuSeparator />
            <DropdownMenuItem onClick={signOut}>
              <LogOut className="mr-2 h-4 w-4" />
              Sign out
            </DropdownMenuItem>
          </DropdownMenuContent>
        </DropdownMenu>
      </div>
    </aside>
  );
}
