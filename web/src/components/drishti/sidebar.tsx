import { Link, useRouterState } from "@tanstack/react-router";
import { BrandLockup, BrandMark } from "./brand";
import {
  LayoutDashboard,
  Calculator,
  FileSpreadsheet,
  Building2,
  BookOpen,
  ShieldCheck,
  Workflow,
  PanelLeftClose,
  PanelLeftOpen,
  type LucideIcon,
  Globe2,
  Database,
  Ruler,
} from "lucide-react";
import { useRole, type Role } from "@/lib/role-context";
import { AccountMenu } from "./account-menu";
import { cn } from "@/lib/utils";
import { Tooltip, TooltipTrigger, TooltipContent } from "@/components/ui/tooltip";

export type NavItem = {
  to: string;
  label: string;
  icon: LucideIcon;
  roles: Role[];
  hash?: string;
};

export type NavGroup = {
  heading: string;
  items: NavItem[];
};

// Architecture and API Lineage share a page; the hash tells them apart.
export function isNavActive(item: NavItem, pathname: string, hash: string) {
  const onPath = item.to === "/" ? pathname === "/" : pathname.startsWith(item.to);
  if (!onPath) return false;
  return item.hash ? hash === item.hash : !NAV_GROUPS.some((g) => g.items.some((i) => i.to === item.to && i.hash === hash));
}

// Branch officers work their own branch, so the network-wide pages (Batch
// Screener writes to the loan master; Branch and Market Explorer compare the
// whole book) stay with the controlling office and Risk Admin.
export const NAV_GROUPS: NavGroup[] = [
  {
    heading: "Daily Operations",
    items: [
      {
        to: "/",
        label: "Portfolio Console",
        icon: LayoutDashboard,
        roles: ["Controlling Office", "Branch Officer", "Risk Admin"],
      },
      {
        to: "/underwrite",
        label: "Loan Appraisal",
        icon: Calculator,
        roles: ["Controlling Office", "Branch Officer"],
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
    heading: "Branches",
    items: [
      {
        to: "/branches",
        label: "Branch Explorer",
        icon: Building2,
        roles: ["Controlling Office", "Risk Admin"],
      },
    ],
  },
  {
    heading: "Markets",
    items: [
      {
        to: "/market",
        label: "Market Explorer",
        icon: Globe2,
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
        roles: ["Controlling Office", "Branch Officer", "Risk Admin"],
      },
      {
        to: "/governance",
        label: "Model Governance",
        icon: ShieldCheck,
        roles: ["Controlling Office", "Branch Officer", "Risk Admin"],
      },
      {
        to: "/reference",
        label: "Thresholds",
        icon: Ruler,
        roles: ["Controlling Office", "Branch Officer", "Risk Admin"],
      },
      {
        to: "/architecture",
        label: "Architecture",
        icon: Workflow,
        roles: ["Controlling Office", "Branch Officer", "Risk Admin"],
      },
      {
        to: "/architecture",
        hash: "api-matrix",
        label: "API Lineage",
        icon: Database,
        roles: ["Controlling Office", "Branch Officer", "Risk Admin"],
      },
    ],
  },
];

type SidebarProps = {
  collapsed: boolean;
  onCollapsedChange: (collapsed: boolean) => void;
};

export function Sidebar({ collapsed, onCollapsedChange }: SidebarProps) {
  const { role } = useRole();
  const pathname = useRouterState({ select: (s) => s.location.pathname });
  const hash = useRouterState({ select: (s) => s.location.hash });


  return (
    <>
    {/* The sidebar is fixed to the viewport, with this spacer holding its width in
        the layout. It used to be `sticky`: opening any dropdown or dialog locks page
        scroll by setting overflow:hidden on <body>, which makes body the sticky
        container, so the sidebar jumped up by the scroll offset. */}
    <div
      aria-hidden="true"
      data-no-print="true"
      className={cn(
        "hidden shrink-0 transition-[width] duration-200 ease-in-out md:block",
        collapsed ? "w-16" : "w-64",
      )}
    />
    <aside
      data-no-print="true"
      className={cn(
        "fixed inset-y-0 left-0 hidden h-screen shrink-0 flex-col border-r border-sidebar-border bg-sidebar text-sidebar-foreground transition-[width] duration-200 ease-in-out md:flex z-30 select-none",
        collapsed ? "w-16" : "w-64",
      )}
    >
      {/* Sidebar Header with Brand & Collapse/Expand Toggle */}
      <div
        className={cn(
          "flex items-center pb-4 pt-5 min-w-0",
          collapsed
            ? "flex-col justify-center px-2 gap-2"
            : "justify-between px-3.5 gap-2",
        )}
      >
        {collapsed ? (
          <BrandMark className="h-8 w-8 shrink-0" />
        ) : (
          <div className="min-w-0 flex-1 overflow-hidden">
            <BrandLockup tone="dark" />
          </div>
        )}
        <button
          type="button"
          aria-label={collapsed ? "Expand sidebar" : "Collapse sidebar"}
          title={collapsed ? "Expand sidebar" : "Collapse sidebar"}
          onClick={() => onCollapsedChange(!collapsed)}
          className="grid h-8 w-8 shrink-0 place-items-center rounded-md text-sidebar-foreground/70 transition-colors hover:bg-sidebar-accent/60 hover:text-sidebar-foreground cursor-pointer"
        >
          {collapsed ? (
            <PanelLeftOpen className="h-4 w-4" />
          ) : (
            <PanelLeftClose className="h-4 w-4" />
          )}
        </button>
      </div>

      {/* Navigation Links */}
      <nav className="min-h-0 flex-1 overflow-y-auto px-2 space-y-4">
        {NAV_GROUPS.map((group) => {
          const visibleItems = group.items.filter((n) => n.roles.includes(role));
          if (visibleItems.length === 0) return null;
          return (
            <div key={group.heading} className="space-y-1">
              <div
                className={cn(
                  "px-3 py-1 text-[11px] font-semibold uppercase tracking-widest text-sidebar-foreground/50 truncate",
                  collapsed && "sr-only",
                )}
              >
                {group.heading}
              </div>
              <ul className="space-y-0.5">
                {visibleItems.map((item) => {
                  const Icon = item.icon;
                  const active = isNavActive(item, pathname, hash);
                  const linkElement = (
                    <Link
                      to={item.to}
                      hash={item.hash}
                      viewTransition
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
                  );

                  return (
                    <li key={item.to + (item.hash ?? "")}>
                      {collapsed ? (
                        <Tooltip>
                          <TooltipTrigger asChild>{linkElement}</TooltipTrigger>
                          <TooltipContent side="right" className="font-medium text-xs">
                            {item.label}
                          </TooltipContent>
                        </Tooltip>
                      ) : (
                        linkElement
                      )}
                    </li>
                  );
                })}
              </ul>
            </div>
          );
        })}
      </nav>

      {/* User Account / Role Menu in Footer */}
      <div className="border-t border-sidebar-border/60 p-2">
        <AccountMenu collapsed={collapsed} />
      </div>
    </aside>
    </>
  );
}
