import { useState } from "react";
import { Link, useRouterState } from "@tanstack/react-router";
import { Menu, Search } from "lucide-react";
import { Sheet, SheetContent, SheetHeader, SheetTitle, SheetTrigger } from "@/components/ui/sheet";
import { useRole } from "@/lib/role-context";
import { cn } from "@/lib/utils";
import { NAV_GROUPS, isNavActive } from "./sidebar";
import { BrandMark } from "./brand";

/**
 * Phone / small-tablet navigation. The desktop sidebar is hidden below `md`,
 * which used to leave no way to move between pages on a phone.
 */
export function MobileNav() {
  const [open, setOpen] = useState(false);
  const { role, user } = useRole();
  const pathname = useRouterState({ select: (s) => s.location.pathname });
  const hash = useRouterState({ select: (s) => s.location.hash });

  return (
    <div className="flex items-center gap-1 md:hidden">
      <Sheet open={open} onOpenChange={setOpen}>
        <SheetTrigger asChild>
          <button
            type="button"
            aria-label="Open menu"
            className="inline-flex h-9 w-9 items-center justify-center rounded-md border border-border text-foreground hover:bg-muted"
          >
            <Menu className="h-5 w-5" />
          </button>
        </SheetTrigger>
        <SheetContent side="left" className="w-72 p-0">
          <SheetHeader className="border-b border-border p-4 text-left">
            <SheetTitle className="flex items-center gap-2 text-base">
              <BrandMark className="h-7 w-7" /> DRISHTI
            </SheetTitle>
            {user && (
              <p className="text-xs text-muted-foreground">
                {user.name} · {role}
              </p>
            )}
          </SheetHeader>
          <nav className="space-y-4 p-3">
            {NAV_GROUPS.map((group) => {
              const items = group.items.filter((n) => n.roles.includes(role));
              if (items.length === 0) return null;
              return (
                <div key={group.heading}>
                  <div className="px-2 pb-1 text-[11px] font-semibold uppercase tracking-wider text-muted-foreground">
                    {group.heading}
                  </div>
                  {items.map((item) => {
                    const active = isNavActive(item, pathname, hash);
                    const Icon = item.icon;
                    return (
                      <Link
                        key={item.to + (item.hash ?? "")}
                        to={item.to}
                        hash={item.hash}
                        onClick={() => setOpen(false)}
                        className={cn(
                          "flex items-center gap-3 rounded-md px-2 py-2.5 text-sm",
                          active ? "bg-primary/10 font-semibold text-primary" : "text-foreground hover:bg-muted",
                        )}
                      >
                        <Icon className="h-4 w-4 shrink-0" />
                        {item.label}
                      </Link>
                    );
                  })}
                </div>
              );
            })}
          </nav>
        </SheetContent>
      </Sheet>
      <button
        type="button"
        aria-label="Search accounts and branches"
        onClick={() => window.dispatchEvent(new CustomEvent("drishti:open-command-palette"))}
        className="inline-flex h-9 w-9 items-center justify-center rounded-md border border-border text-foreground hover:bg-muted sm:hidden"
      >
        <Search className="h-4 w-4" />
      </button>
    </div>
  );
}
