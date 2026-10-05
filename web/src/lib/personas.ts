import type { Role } from "./role-context";

/**
 * The demo officers. The sign-in screen and the account menu both read this
 * list, so the people you can sign in as are the people you can switch to.
 */
export interface Persona {
  id: string;
  name: string;
  role: Role;
  title: string;
  office: string;
  empId: string;
  badge: string;
  description: string;
  /** Set for a branch officer: their view and their decisions stay on this branch. */
  branchCode?: string;
}

export const PERSONAS: Persona[] = [
  {
    id: "vikram",
    name: "Vikram Rao",
    role: "Controlling Office",
    title: "Zonal Head · Commercial Credit",
    office: "Mumbai Zonal Controlling Office",
    empId: "IDBI-CO-4921",
    badge: "Controlling Office",
    description: "Whole book: portfolio triage, appraisal approval and committee decisions",
  },
  {
    id: "rajesh",
    name: "Rajesh Iyer",
    role: "Branch Officer",
    title: "Senior Credit Appraisal Officer",
    office: "Bengaluru — Peenya Branch (1019)",
    empId: "IDBI-BR-7734",
    badge: "Branch Officer",
    description: "His branch only: its watchlist, its appraisals and its early-warning reviews",
    branchCode: "1019",
  },
  {
    id: "ananya",
    name: "Dr. Ananya Sharma",
    role: "Risk Admin",
    title: "Chief Risk Officer · Model Governance",
    office: "Central Risk Management Dept",
    empId: "IDBI-CRMD-1082",
    badge: "Risk Admin",
    description: "Model health, drift and fairness; reviews the override audit trail (does not take credit decisions)",
  },
];

export const ROLE_BADGE: Record<Role, string> = {
  "Controlling Office": "bg-emerald-100 text-emerald-800 dark:bg-emerald-950 dark:text-emerald-200",
  "Branch Officer": "bg-sky-100 text-sky-800 dark:bg-sky-950 dark:text-sky-200",
  "Risk Admin": "bg-purple-100 text-purple-800 dark:bg-purple-950 dark:text-purple-200",
};
