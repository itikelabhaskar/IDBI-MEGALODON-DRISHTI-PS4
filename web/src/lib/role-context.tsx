import { createContext, useContext, useState, useEffect, useCallback, type ReactNode } from "react";

export type Role = "Controlling Office" | "Risk Admin";

export interface SessionUser {
  name: string;
  role: Role;
}

interface RoleContextValue {
  role: Role;
  setRole: (r: Role) => void;
  user: SessionUser | null;
  hydrated: boolean;
  signIn: (name: string, role: Role) => void;
  signOut: () => void;
}

const RoleContext = createContext<RoleContextValue | null>(null);
const SESSION_KEY = "drishti.session.v1";
export const DEFAULT_USER: SessionUser = { name: "Vikram Rao (Zonal Head)", role: "Controlling Office" };

export function RoleProvider({ children }: { children: ReactNode }) {
  const [user, setUser] = useState<SessionUser | null>(DEFAULT_USER);
  const [role, setRoleState] = useState<Role>("Controlling Office");
  const [hydrated, setHydrated] = useState(false);

  // Hydrate the session on the client only (SSR renders the neutral splash).
  useEffect(() => {
    try {
      const raw = localStorage.getItem(SESSION_KEY);
      if (raw) {
        const parsed = JSON.parse(raw) as SessionUser;
        setUser(parsed);
        setRoleState(parsed.role);
      } else {
        localStorage.setItem(SESSION_KEY, JSON.stringify(DEFAULT_USER));
      }
    } catch {
      /* ignore corrupt storage */
    }
    setHydrated(true);
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
    (name: string, r: Role) => {
      const next: SessionUser = { name: name.trim() || "Officer", role: r };
      setUser(next);
      setRoleState(r);
      persist(next);
    },
    [persist],
  );

  const signOut = useCallback(() => {
    setUser(null);
    persist(null);
  }, [persist]);

  return (
    <RoleContext.Provider value={{ role, setRole, user, hydrated, signIn, signOut }}>
      {children}
    </RoleContext.Provider>
  );
}

export function useRole(): RoleContextValue {
  const ctx = useContext(RoleContext);
  if (!ctx) throw new Error("useRole must be used within RoleProvider");
  return ctx;
}
