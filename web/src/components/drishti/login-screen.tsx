import { useState } from "react";
import { useNavigate } from "@tanstack/react-router";
import { PERSONAS, ROLE_BADGE, type Persona } from "@/lib/personas";
import { ROLE_CAPABILITIES, ROLES, useRole, type Role } from "@/lib/role-context";
import { BrandMark } from "./brand";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Badge } from "@/components/ui/badge";
import { cn } from "@/lib/utils";
import {
  ShieldCheck,
  UserRound,
  Lock,
  ArrowRight,
  Building2,
  Briefcase,
  KeyRound,
  Loader2,
  ChevronDown,
} from "lucide-react";

const ROLE_SHORT: Record<Role, string> = {
  "Controlling Office": "Control",
  "Branch Officer": "Branch",
  "Risk Admin": "Risk",
};

export function LoginScreen() {
  const { signIn, isLoading } = useRole();
  const navigate = useNavigate();
  const [name, setName] = useState("Vikram Rao");
  const [empId, setEmpId] = useState("IDBI-CO-4921");
  const [password, setPassword] = useState("");
  const [role, setRole] = useState<Role>("Controlling Office");
  const [branchCode, setBranchCode] = useState("1019");
  const [submittingId, setSubmittingId] = useState<string | null>(null);
  const [showCustomForm, setShowCustomForm] = useState(false);

  // 1-Click login as a demo persona
  const handleQuickSignIn = async (p: Persona) => {
    setSubmittingId(p.id);
    await signIn(p.name, p.role, {
      employeeId: p.empId,
      department: p.title,
      branch: p.office,
      branchCode: p.branchCode,
    });
    setSubmittingId(null);
    navigate({ to: ROLE_CAPABILITIES[p.role].home });
  };

  // Custom form submission
  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setSubmittingId("custom");
    await signIn(name, role, {
      employeeId: empId,
      department: "Commercial Credit",
      branch: role === "Branch Officer" ? `Branch ${branchCode.trim()}` : role,
      branchCode: role === "Branch Officer" ? branchCode.trim() : undefined,
    });
    setSubmittingId(null);
    navigate({ to: ROLE_CAPABILITIES[role].home });
  };

  return (
    <div className="relative grid min-h-screen w-full place-items-center bg-background px-4 py-8 overflow-hidden select-none">
      {/* Background ambient accents */}
      <div className="pointer-events-none absolute -top-40 -left-40 h-96 w-96 rounded-full bg-primary/10 blur-3xl" />
      <div className="pointer-events-none absolute -bottom-40 -right-40 h-96 w-96 rounded-full bg-accent/10 blur-3xl" />

      <div className="w-full max-w-lg relative z-10 space-y-6">
        {/* Header Branding */}
        <div className="text-center space-y-2">
          <div className="inline-flex items-center gap-1.5 rounded-full border border-primary/20 bg-primary/5 px-3 py-1 text-xs font-semibold text-primary tracking-wide">
            <Building2 className="h-3.5 w-3.5 text-accent" />
            IDBI INNOVATE 2026 · PROBLEM STATEMENT 4
          </div>
          <div className="flex items-center justify-center gap-3 pt-2">
            <BrandMark className="h-11 w-11 shadow-sm ring-1 ring-primary/20" />
            <div className="text-left">
              <div className="text-xl font-bold tracking-tight text-foreground">
                DRISHTI <span className="text-primary font-semibold">Credit Engine</span>
              </div>
              <div className="text-[11px] uppercase tracking-[0.14em] text-muted-foreground font-medium">
                Controlling-Office Risk &amp; Appraisal Terminal
              </div>
            </div>
          </div>
        </div>

        {/* Login Card */}
        <div className="rounded-xl border border-border bg-surface p-6 shadow-md space-y-5">
          <div className="flex items-center justify-between border-b border-border/70 pb-3">
            <div>
              <h1 className="text-sm font-semibold text-foreground flex items-center gap-1.5">
                <KeyRound className="h-4 w-4 text-primary" />
                Sign in to DRISHTI
              </h1>
              <p className="text-xs text-muted-foreground mt-0.5">
                Click any officer persona to launch terminal immediately.
              </p>
            </div>
            <Badge variant="outline" className="border-accent/40 bg-accent/10 text-foreground/80 text-[11px]">
              Prototype · synthetic data
            </Badge>
          </div>

          {/* 1-Click Demo Personas */}
          <div className="space-y-2.5">
            <Label className="text-xs font-medium text-foreground/90 flex items-center justify-between">
              <span>Select Officer Persona (1-Click Sign In)</span>
              <span className="text-[11px] text-muted-foreground font-normal">Instant Demo Access</span>
            </Label>
            <div className="grid grid-cols-1 gap-2.5">
              {PERSONAS.map((p) => {
                const isLoggingIn = submittingId === p.id;
                return (
                  <button
                    key={p.id}
                    type="button"
                    disabled={submittingId !== null || isLoading}
                    onClick={() => handleQuickSignIn(p)}
                    className={cn(
                      "flex items-center justify-between p-3 rounded-lg border transition-all cursor-pointer text-left group",
                      "border-border bg-background hover:border-primary/60 hover:bg-primary/[0.03] hover:shadow-sm",
                      isLoggingIn && "border-primary bg-primary/10",
                    )}
                  >
                    <div className="min-w-0 flex-1 pr-3">
                      <div className="flex items-center gap-2 mb-0.5">
                        <span className="text-xs font-bold text-foreground group-hover:text-primary transition-colors">
                          {p.name}
                        </span>
                        <Badge
                          variant="secondary"
                          className={cn("text-[11px] px-1.5 py-0 font-normal", ROLE_BADGE[p.role])}
                        >
                          {p.badge}
                        </Badge>
                      </div>
                      <div className="text-[11px] text-muted-foreground leading-snug">
                        {p.title} · {p.office}
                      </div>
                    </div>
                    <div className="shrink-0 flex items-center gap-1.5 text-xs font-medium text-primary bg-primary/10 group-hover:bg-primary group-hover:text-primary-foreground px-2.5 py-1.5 rounded-md transition-all">
                      {isLoggingIn ? (
                        <>
                          <Loader2 className="h-3.5 w-3.5 animate-spin" />
                          <span>Connecting...</span>
                        </>
                      ) : (
                        <>
                          <span>Enter</span>
                          <ArrowRight className="h-3.5 w-3.5 group-hover:translate-x-0.5 transition-transform" />
                        </>
                      )}
                    </div>
                  </button>
                );
              })}
            </div>
          </div>

          {/* Collapsible Custom Login Form */}
          <div className="pt-2 border-t border-border/70">
            <button
              type="button"
              onClick={() => setShowCustomForm(!showCustomForm)}
              className="w-full flex items-center justify-between text-xs text-muted-foreground hover:text-foreground py-1 transition-colors cursor-pointer"
            >
              <span>Or sign in with custom credentials</span>
              <ChevronDown
                className={cn(
                  "h-3.5 w-3.5 transition-transform duration-200",
                  showCustomForm && "rotate-180",
                )}
              />
            </button>

            {showCustomForm && (
              <form onSubmit={handleSubmit} className="space-y-4 pt-3">
                <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                  <div className="space-y-1.5">
                    <Label htmlFor="officer-name" className="text-xs">
                      Officer Name
                    </Label>
                    <div className="relative">
                      <UserRound className="pointer-events-none absolute left-2.5 top-1/2 h-3.5 w-3.5 -translate-y-1/2 text-muted-foreground" />
                      <Input
                        id="officer-name"
                        value={name}
                        onChange={(e) => setName(e.target.value)}
                        className="pl-8 text-xs h-9 font-medium"
                        placeholder="Officer Name"
                        required
                      />
                    </div>
                  </div>

                  <div className="space-y-1.5">
                    <Label htmlFor="officer-empid" className="text-xs">
                      Employee ID / Desk
                    </Label>
                    <div className="relative">
                      <Briefcase className="pointer-events-none absolute left-2.5 top-1/2 h-3.5 w-3.5 -translate-y-1/2 text-muted-foreground" />
                      <Input
                        id="officer-empid"
                        value={empId}
                        onChange={(e) => setEmpId(e.target.value)}
                        className="pl-8 text-xs h-9 font-mono"
                        placeholder="IDBI-CO-0000"
                        required
                      />
                    </div>
                  </div>
                </div>

                <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                  <div className="space-y-1.5">
                    <Label htmlFor="officer-pass" className="text-xs">
                      Password <span className="text-muted-foreground font-normal">(not checked in prototype)</span>
                    </Label>
                    <div className="relative">
                      <Lock className="pointer-events-none absolute left-2.5 top-1/2 h-3.5 w-3.5 -translate-y-1/2 text-muted-foreground" />
                      <Input
                        id="officer-pass"
                        type="password"
                        value={password}
                        onChange={(e) => setPassword(e.target.value)}
                        className="pl-8 text-xs h-9"
                        placeholder="••••••••"
                      />
                    </div>
                  </div>

                  <div className="space-y-1.5">
                    <Label className="text-xs">Access Role</Label>
                    <div className="grid grid-cols-3 gap-1.5">
                      {ROLES.map((r) => (
                        <button
                          key={r}
                          type="button"
                          onClick={() => setRole(r)}
                          className={cn(
                            "flex items-center justify-center gap-1 rounded-md border h-9 px-2 text-[11px] font-medium transition-colors cursor-pointer",
                            role === r
                              ? "border-primary bg-primary/10 text-primary font-semibold"
                              : "border-border bg-background text-muted-foreground hover:text-foreground",
                          )}
                        >
                          {r === "Risk Admin" ? (
                            <ShieldCheck className="h-3 w-3" />
                          ) : r === "Branch Officer" ? (
                            <Building2 className="h-3 w-3" />
                          ) : (
                            <UserRound className="h-3 w-3" />
                          )}
                          <span className="truncate">{ROLE_SHORT[r]}</span>
                        </button>
                      ))}
                    </div>
                  </div>
                </div>

                {role === "Branch Officer" && (
                  <div className="space-y-1.5">
                    <Label htmlFor="officer-branch" className="text-xs">
                      Branch code <span className="text-muted-foreground font-normal">(your view and decisions stay on this branch)</span>
                    </Label>
                    <Input
                      id="officer-branch"
                      value={branchCode}
                      onChange={(e) => setBranchCode(e.target.value)}
                      className="text-xs h-9 font-mono"
                      placeholder="1019"
                      required
                    />
                  </div>
                )}

                <Button
                  type="submit"
                  disabled={submittingId !== null || isLoading}
                  className="w-full h-10 text-xs font-semibold gap-2 shadow-sm cursor-pointer"
                >
                  {submittingId === "custom" || isLoading ? (
                    <>
                      <Loader2 className="h-4 w-4 animate-spin" />
                      Signing in...
                    </>
                  ) : (
                    <>
                      Sign in
                      <ArrowRight className="h-4 w-4" />
                    </>
                  )}
                </Button>
              </form>
            )}
          </div>

          {/* Security Notice */}
          <div className="rounded-lg bg-muted/50 p-2.5 text-[11px] text-muted-foreground border border-border/50 flex items-start gap-2">
            <ShieldCheck className="h-4 w-4 text-primary shrink-0 mt-0.5" />
            <div className="leading-relaxed">
              <strong className="text-foreground font-medium">Prototype sign-in:</strong>{" "}
              identity is not verified here. In a bank deployment this screen is replaced by IDBI&apos;s
              single sign-on, and roles come from the bank&apos;s access-control system.
            </div>
          </div>
        </div>

        {/* Regulatory Footer */}
        <p className="text-center text-[11px] text-muted-foreground leading-relaxed">
          DRISHTI prototype for IDBI Innovate 2026 (PS-4) · synthetic data, not a bank system.
          Officer decisions and overrides are written to the prototype&apos;s audit log.
        </p>
      </div>
    </div>
  );
}
