import {
  createContext,
  useContext,
  useState,
  useEffect,
  useCallback,
  type ReactNode,
} from "react";

export type Role = "Controlling Office" | "Branch Officer" | "Risk Admin";

export const ROLES: Role[] = ["Controlling Office", "Branch Officer", "Risk Admin"];

/**
 * What each role may do. The split follows the bank's lines of defence:
 * the controlling office (first line) takes credit decisions across its book; a
 * branch officer takes them only on accounts of their own branch; Risk Admin
 * (second line, model risk) reviews models and the decision trail but does not
 * sanction, re-rate or override accounts itself. Client-side only in the
 * prototype; in production the bank's SSO supplies the role and the API checks it.
 */
export interface RoleCapabilities {
  /** Log committee decisions, quick reviews and appraisals. */
  canDecide: boolean;
  /** Write batch results into the loan master (screening alone is open to both). */
  canSaveBatch: boolean;
  /** Route each role starts on. */
  home: "/" | "/governance";
  /** One line shown where an action is withheld. */
  readOnlyReason: string | null;
}

export const ROLE_CAPABILITIES: Record<Role, RoleCapabilities> = {
  "Controlling Office": {
    canDecide: true,
    canSaveBatch: true,
    home: "/",
    readOnlyReason: null,
  },
  "Branch Officer": {
    canDecide: true,
    canSaveBatch: false,
    home: "/",
    readOnlyReason: null,
  },
  "Risk Admin": {
    canDecide: false,
    canSaveBatch: false,
    home: "/governance",
    readOnlyReason:
      "Risk Admin reviews decisions but does not take them: credit decisions belong to the controlling office (segregation of duties).",
  },
};

export interface SessionUser {
  name: string;
  role: Role;
  employeeId?: string;
  department?: string;
  branch?: string;
  /** Branch officers only: the branch their view and decisions are limited to. */
  branchCode?: string;
}

interface RoleContextValue {
  role: Role;
  setRole: (r: Role) => void;
  user: SessionUser | null;
  hydrated: boolean;
  isLoading: boolean;
  signIn: (name: string, role: Role, details?: Partial<SessionUser>) => Promise<void>;
  signOut: () => void;
  lockSession: () => void;
}

const RoleContext = createContext<RoleContextValue | null>(null);
const SESSION_KEY = "drishti.session.v1";

export function RoleProvider({ children }: { children: ReactNode }) {
  const [user, setUser] = useState<SessionUser | null>(null);
  const [role, setRoleState] = useState<Role>("Controlling Office");
  const [hydrated, setHydrated] = useState(false);
  const [isLoading, setIsLoading] = useState(false);

  // Hydrate the session on the client from localStorage.
  useEffect(() => {
    try {
      const raw = localStorage.getItem(SESSION_KEY);
      if (raw) {
        const parsed = JSON.parse(raw) as SessionUser;
        if (parsed && parsed.name) {
          setUser(parsed);
          setRoleState(parsed.role || "Controlling Office");
        } else {
          setUser(null);
        }
      } else {
        setUser(null);
      }
    } catch {
      setUser(null);
    }
    setHydrated(true);
  }, []);

  // Keep every open tab on the same session: a role switch or sign-out in one
  // tab otherwise leaves the others showing the old role's menu.
  useEffect(() => {
    const onStorage = (e: StorageEvent) => {
      if (e.key !== SESSION_KEY) return;
      try {
        const next = e.newValue ? (JSON.parse(e.newValue) as SessionUser) : null;
        setUser(next && next.name ? next : null);
        if (next?.role) setRoleState(next.role);
      } catch {
        /* ignore */
      }
    };
    window.addEventListener("storage", onStorage);
    return () => window.removeEventListener("storage", onStorage);
  }, []);

  const persist = useCallback((next: SessionUser | null) => {
    try {
      if (next) localStorage.setItem(SESSION_KEY, JSON.stringify(next));
      else localStorage.removeItem(SESSION_KEY);
    } catch {
      /* ignore */
    }
  }, []);

  const setRole = useCallback(
    (r: Role) => {
      setRoleState(r);
      setUser((u) => {
        const next = u ? { ...u, role: r } : u;
        persist(next);
        return next;
      });
    },
    [persist],
  );

  const signIn = useCallback(
    async (name: string, r: Role, details?: Partial<SessionUser>) => {
      setIsLoading(true);
      const next: SessionUser = {
        name: name.trim() || "Officer",
        role: r,
        employeeId: details?.employeeId || "IDBI-CO-0001",
        department: details?.department || "Commercial Credit",
        branch: details?.branch || "Controlling Office",
        branchCode: r === "Branch Officer" ? details?.branchCode : undefined,
      };
      setUser(next);
      setRoleState(r);
      persist(next);
      setIsLoading(false);
    },
    [persist],
  );

  const signOut = useCallback(() => {
    setUser(null);
    persist(null);
  }, [persist]);

  const lockSession = useCallback(() => {
    signOut();
  }, [signOut]);

  return (
    <RoleContext.Provider
      value={{
        role,
        setRole,
        user,
        hydrated,
        isLoading,
        signIn,
        signOut,
        lockSession,
      }}
    >
      {children}
    </RoleContext.Provider>
  );
}

export function useRole(): RoleContextValue {
  const ctx = useContext(RoleContext);
  if (!ctx) throw new Error("useRole must be used within RoleProvider");
  return ctx;
}

export function useCapabilities(): RoleCapabilities {
  return ROLE_CAPABILITIES[useRole().role];
}

/** The branch a branch officer is limited to; undefined for every other role. */
export function useScopeBranch(): string | undefined {
  const { role, user } = useRole();
  return role === "Branch Officer" ? user?.branchCode : undefined;
}

/**
 * Whether the signed-in officer may take a decision on an account of this
 * branch, and if not, the one line that says why. A branch officer decides
 * only on accounts of their own branch.
 */
export function useDecisionRights(accountBranch?: string | null): { canDecide: boolean; reason: string | null } {
  const { role } = useRole();
  const caps = ROLE_CAPABILITIES[role];
  const scope = useScopeBranch();
  if (!caps.canDecide) return { canDecide: false, reason: caps.readOnlyReason };
  if (role === "Branch Officer" && (!scope || accountBranch !== scope)) {
    return {
      canDecide: false,
      reason: `This account is outside your branch${scope ? ` (${scope})` : ""}: its own branch and controlling office decide on it.`,
    };
  }
  return { canDecide: true, reason: null };
}
