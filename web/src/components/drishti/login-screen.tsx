import { useState } from "react";
import { useRole, type Role } from "@/lib/role-context";
import { BrandMark } from "./brand";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { cn } from "@/lib/utils";
import { ShieldCheck, UserRound, Lock, ArrowRight } from "lucide-react";

/**
 * Prototype sign-in gate. No real identity provider — a bank pilot would wire
 * this to IDBI SSO / AD with RBAC. It exists so the app opens with an
 * authenticated controlling-office identity that drives the audit trail,
 * instead of an anonymous session.
 */
export function LoginScreen() {
  const { signIn } = useRole();
  const [name, setName] = useState("Vikram Rao");
  const [role, setRole] = useState<Role>("Controlling Office");

  return (
    <div className="grid min-h-screen w-full place-items-center bg-background px-4">
      <div className="w-full max-w-sm">
        <div className="mb-6 flex items-center gap-3">
          <BrandMark className="h-11 w-11" />
          <div>
            <div className="text-lg font-bold tracking-tight text-foreground">
              DRISHTI <span className="text-primary">Risk Engine</span>
            </div>
            <div className="text-[11px] uppercase tracking-[0.14em] text-muted-foreground">
              12-month stress horizon
            </div>
          </div>
        </div>

        <form
          onSubmit={(e) => {
            e.preventDefault();
            signIn(name, role);
          }}
          className="rounded-lg border border-border bg-surface p-5 shadow-sm"
        >
          <h1 className="text-sm font-semibold text-foreground">Sign in to continue</h1>
          <p className="mt-0.5 text-[11px] text-muted-foreground">
            Submission access — no real credentials are checked or stored off-device.
          </p>

          <div className="mt-4 space-y-1.5">
            <Label htmlFor="officer-name" className="text-xs">
              Officer name
            </Label>
            <div className="relative">
              <UserRound className="pointer-events-none absolute left-2.5 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
              <Input
                id="officer-name"
                value={name}
                onChange={(e) => setName(e.target.value)}
                className="pl-8"
                placeholder="Your name"
                autoComplete="off"
              />
            </div>
          </div>

          <div className="mt-3 space-y-1.5">
            <Label htmlFor="officer-pass" className="text-xs">
              Password
            </Label>
            <div className="relative">
              <Lock className="pointer-events-none absolute left-2.5 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
              <Input
                id="officer-pass"
                type="password"
                defaultValue="demo"
                className="pl-8"
                placeholder="••••••"
                autoComplete="off"
              />
            </div>
          </div>

          <div className="mt-4 space-y-1.5">
            <Label className="text-xs">Role</Label>
            <div className="grid grid-cols-2 gap-2">
              {(["Controlling Office", "Risk Admin"] as Role[]).map((r) => (
                <button
                  key={r}
                  type="button"
                  onClick={() => setRole(r)}
                  className={cn(
                    "flex items-center gap-1.5 rounded-md border px-2.5 py-2 text-xs font-medium transition-colors",
                    role === r
                      ? "border-primary bg-primary/10 text-primary"
                      : "border-border bg-background text-muted-foreground hover:text-foreground",
                  )}
                >
                  {r === "Risk Admin" ? (
                    <ShieldCheck className="h-3.5 w-3.5" />
                  ) : (
                    <UserRound className="h-3.5 w-3.5" />
                  )}
                  {r}
                </button>
              ))}
            </div>
            <p className="text-[10px] text-muted-foreground">
              Controlling Office = portfolio oversight. Risk Admin = governance &amp; model health.
            </p>
          </div>

          <Button type="submit" className="mt-5 w-full">
            Sign in
            <ArrowRight className="ml-1.5 h-4 w-4" />
          </Button>
        </form>

        <p className="mt-4 text-center text-[11px] leading-relaxed text-muted-foreground">
          Decision-support console for IDBI's controlling office. The bank remains the regulated
          entity and final decision owner. All data shown is synthetic.
        </p>
      </div>
    </div>
  );
}
