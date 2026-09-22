import { useState } from "react";
import { createFileRoute, Link } from "@tanstack/react-router";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Accordion, AccordionContent, AccordionItem, AccordionTrigger } from "@/components/ui/accordion";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { Input } from "@/components/ui/input";
import {
  BookOpen,
  CheckCircle2,
  AlertTriangle,
  FileText,
  Workflow,
  ShieldCheck,
  Building2,
  Database,
  ArrowRight,
  HelpCircle,
  Clock,
  Briefcase,
  Search,
  ExternalLink,
  Layers,
  Scale,
  Sparkles,
} from "lucide-react";

export const Route = createFileRoute("/guide")({
  component: OperationsGuidePage,
});

export function OperationsGuidePage() {
  const [activeTab, setActiveTab] = useState("sops");
  const [searchFilter, setSearchFilter] = useState("");

  return (
    <div className="p-4 md:p-6 space-y-6 max-w-7xl mx-auto">
      {/* Header */}
      <div className="flex flex-col md:flex-row md:items-center justify-between gap-4 border-b border-border/60 pb-5">
        <div>
          <div className="flex items-center gap-2 text-[10px] uppercase tracking-widest text-muted-foreground">
            <BookOpen className="h-3.5 w-3.5 text-primary" />
            <span>IDBI DRISHTI Standard Operating Manual</span>
            <Badge variant="outline" className="text-[9px] px-1.5 py-0 h-4 border-primary/40 text-primary">
              v2.4 Production
            </Badge>
          </div>
          <h1 className="mt-1 text-2xl font-bold tracking-tight text-foreground">
            Operations & Usage Guide
          </h1>
          <p className="mt-1 text-sm text-muted-foreground">
            Daily banking SOPs, Core Banking Finacle / Account Aggregator data lifecycle, RG1–RG10 rating scale, and RBI early warning playbooks.
          </p>
        </div>

        <div className="flex items-center gap-2">
          <Link to="/">
            <Button variant="outline" size="sm" className="h-8 text-xs">
              Go to Action Queue
              <ArrowRight className="ml-1.5 h-3.5 w-3.5" />
            </Button>
          </Link>
          <Link to="/underwrite">
            <Button size="sm" className="h-8 text-xs bg-primary text-primary-foreground">
              Appraise New Facility
            </Button>
          </Link>
        </div>
      </div>

      {/* Main Tabs */}
      <Tabs value={activeTab} onValueChange={setActiveTab} className="space-y-6">
        <TabsList className="grid grid-cols-2 md:grid-cols-4 h-11 bg-muted/60 p-1">
          <TabsTrigger value="sops" className="text-xs flex items-center gap-2">
            <Briefcase className="h-3.5 w-3.5" />
            <span>1. Daily Banking SOPs</span>
          </TabsTrigger>
          <TabsTrigger value="lifecycle" className="text-xs flex items-center gap-2">
            <Database className="h-3.5 w-3.5" />
            <span>2. Data Ingestion & I/O</span>
          </TabsTrigger>
          <TabsTrigger value="framework" className="text-xs flex items-center gap-2">
            <Scale className="h-3.5 w-3.5" />
            <span>3. Risk Scale & RBI EWS</span>
          </TabsTrigger>
          <TabsTrigger value="faq" className="text-xs flex items-center gap-2">
            <HelpCircle className="h-3.5 w-3.5" />
            <span>4. Desk FAQ & Troubleshooting</span>
          </TabsTrigger>
        </TabsList>

        {/* TAB 1: DAILY BANKING SOPS */}
        <TabsContent value="sops" className="space-y-6">
          <Card className="bg-surface">
            <CardHeader className="pb-3">
              <div className="flex items-center justify-between">
                <div>
                  <CardTitle className="text-base">Role-Based Standard Operating Procedures (SOPs)</CardTitle>
                  <CardDescription className="text-xs">
                    Clear morning routines, appraisal workflows, and supervisory actions for IDBI officers.
                  </CardDescription>
                </div>
                <Badge className="bg-primary/10 text-primary border-primary/20 text-xs">
                  Operational Workflows
                </Badge>
              </div>
            </CardHeader>
            <CardContent className="space-y-6">
              {/* Role 1: Branch Credit Officer */}
              <div className="rounded-lg border border-border/80 p-5 bg-card/60 space-y-4">
                <div className="flex items-center gap-3">
                  <span className="grid h-8 w-8 place-items-center rounded-lg bg-blue-500/10 text-blue-600 font-semibold text-sm">
                    01
                  </span>
                  <div>
                    <h3 className="text-sm font-semibold text-foreground">Branch Credit Officer (Desk & Field Operations)</h3>
                    <p className="text-xs text-muted-foreground">Primary responsibility: Daily borrower surveillance, appraisal memo preparation, and covenant cure execution.</p>
                  </div>
                </div>

                <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4 pt-2">
                  <div className="rounded-md border border-border/60 p-3 bg-background/50 space-y-1.5">
                    <div className="flex items-center gap-1.5 text-xs font-semibold text-foreground">
                      <Clock className="h-3.5 w-3.5 text-blue-600" />
                      09:00 AM · Morning Triage
                    </div>
                    <p className="text-[11px] text-muted-foreground leading-relaxed">
                      Open <Link to="/" className="text-primary underline">Portfolio Console</Link>. Filter by <strong>🔴 Urgent Action Queue (24h)</strong>. Review accounts slipping into SMA-1/2 or having Drawing Power erosion ≥ 25%.
                    </p>
                  </div>

                  <div className="rounded-md border border-border/60 p-3 bg-background/50 space-y-1.5">
                    <div className="flex items-center gap-1.5 text-xs font-semibold text-foreground">
                      <Clock className="h-3.5 w-3.5 text-blue-600" />
                      10:30 AM · Loan Appraisal
                    </div>
                    <p className="text-[11px] text-muted-foreground leading-relaxed">
                      Navigate to <Link to="/underwrite" className="text-primary underline">Loan Appraisal</Link>. Click <strong>Finacle Quick-Fetch</strong> with the loan ID. Review the plain-English recommendation banner and suggested covenants.
                    </p>
                  </div>

                  <div className="rounded-md border border-border/60 p-3 bg-background/50 space-y-1.5">
                    <div className="flex items-center gap-1.5 text-xs font-semibold text-foreground">
                      <Clock className="h-3.5 w-3.5 text-blue-600" />
                      02:00 PM · CAM Memo Export
                    </div>
                    <p className="text-[11px] text-muted-foreground leading-relaxed">
                      Generate the official <strong>Credit Appraisal Memo (CAM)</strong>. The system embeds calibrated 12M PD, SHAP drivers, and Ind AS 109 stage for the sanctioning committee.
                    </p>
                  </div>

                  <div className="rounded-md border border-border/60 p-3 bg-background/50 space-y-1.5">
                    <div className="flex items-center gap-1.5 text-xs font-semibold text-foreground">
                      <Clock className="h-3.5 w-3.5 text-blue-600" />
                      04:30 PM · Recourse Cure
                    </div>
                    <p className="text-[11px] text-muted-foreground leading-relaxed">
                      Open borrower drill-down. Review <strong>Actionable Recourse Levers</strong> (e.g. 15% margin enhancement drops PD by 6.2%). Issue formal borrower cure notice.
                    </p>
                  </div>
                </div>
              </div>

              {/* Role 2: Controlling Office / Zonal Head */}
              <div className="rounded-lg border border-border/80 p-5 bg-card/60 space-y-4">
                <div className="flex items-center gap-3">
                  <span className="grid h-8 w-8 place-items-center rounded-lg bg-purple-500/10 text-purple-600 font-semibold text-sm">
                    02
                  </span>
                  <div>
                    <h3 className="text-sm font-semibold text-foreground">Controlling Office / Zonal Risk Head</h3>
                    <p className="text-xs text-muted-foreground">Primary responsibility: Multi-branch surveillance, risk concentration, macro stress testing, and supplier contagion.</p>
                  </div>
                </div>

                <div className="grid gap-3 sm:grid-cols-3 pt-2">
                  <div className="rounded-md border border-border/60 p-3 bg-background/50 space-y-1.5">
                    <div className="flex items-center gap-1.5 text-xs font-semibold text-foreground">
                      <Building2 className="h-3.5 w-3.5 text-purple-600" />
                      Branch Network Review
                    </div>
                    <p className="text-[11px] text-muted-foreground leading-relaxed">
                      Open <Link to="/branches" className="text-primary underline">Branch Network</Link>. Sort 45 branches by exposure-weighted PD. Deploy special recovery task force to top 5 stressed branches (e.g., Surat Textiles, Bhiwandi).
                    </p>
                  </div>

                  <div className="rounded-md border border-border/60 p-3 bg-background/50 space-y-1.5">
                    <div className="flex items-center gap-1.5 text-xs font-semibold text-foreground">
                      <Workflow className="h-3.5 w-3.5 text-purple-600" />
                      Macro Scenario Stressing
                    </div>
                    <p className="text-[11px] text-muted-foreground leading-relaxed">
                      Use <Link to="/scenario" className="text-primary underline">Scenario Lab</Link> to simulate RBI rate hikes (+150 bps repo) or commodity shocks. Evaluate impact on total portfolio ECL and capital adequacy ratio.
                    </p>
                  </div>

                  <div className="rounded-md border border-border/60 p-3 bg-background/50 space-y-1.5">
                    <div className="flex items-center gap-1.5 text-xs font-semibold text-foreground">
                      <Layers className="h-3.5 w-3.5 text-purple-600" />
                      Supplier Contagion Tracing
                    </div>
                    <p className="text-[11px] text-muted-foreground leading-relaxed">
                      Use <Link to="/contagion" className="text-primary underline">Supplier Contagion</Link> to trace Tier-1 & Tier-2 automotive/textile supply chains. Ring-fence vulnerable suppliers before anchor buyer distress cascades.
                    </p>
                  </div>
                </div>
              </div>

              {/* Role 3: Credit Committee & Risk Admin */}
              <div className="rounded-lg border border-border/80 p-5 bg-card/60 space-y-4">
                <div className="flex items-center gap-3">
                  <span className="grid h-8 w-8 place-items-center rounded-lg bg-emerald-500/10 text-emerald-600 font-semibold text-sm">
                    03
                  </span>
                  <div>
                    <h3 className="text-sm font-semibold text-foreground">Credit Committee & Risk Admin</h3>
                    <p className="text-xs text-muted-foreground">Primary responsibility: Formal decisioning, grade overrides, model governance, and regulatory compliance.</p>
                  </div>
                </div>

                <div className="grid gap-3 sm:grid-cols-3 pt-2">
                  <div className="rounded-md border border-border/60 p-3 bg-background/50 space-y-1.5">
                    <div className="flex items-center gap-1.5 text-xs font-semibold text-foreground">
                      <CheckCircle2 className="h-3.5 w-3.5 text-emerald-600" />
                      Human-In-The-Loop Approvals
                    </div>
                    <p className="text-[11px] text-muted-foreground leading-relaxed">
                      Review proposed appraisals in the Credit Committee dialog. <strong>Accept</strong>, <strong>Override Grade</strong> (with mandatory rationale), <strong>Defer</strong>, or <strong>Reject</strong>. Decisions are immutably logged to the database.
                    </p>
                  </div>

                  <div className="rounded-md border border-border/60 p-3 bg-background/50 space-y-1.5">
                    <div className="flex items-center gap-1.5 text-xs font-semibold text-foreground">
                      <ShieldCheck className="h-3.5 w-3.5 text-emerald-600" />
                      Model PSI Drift Monitoring
                    </div>
                    <p className="text-[11px] text-muted-foreground leading-relaxed">
                      Access <Link to="/governance" className="text-primary underline">Model Governance</Link>. Verify Population Stability Index (PSI &lt; 0.10). If PSI &ge; 0.25, initiate champion-challenger model retraining.
                    </p>
                  </div>

                  <div className="rounded-md border border-border/60 p-3 bg-background/50 space-y-1.5">
                    <div className="flex items-center gap-1.5 text-xs font-semibold text-foreground">
                      <Scale className="h-3.5 w-3.5 text-emerald-600" />
                      Fair Lending & Disparate Impact
                    </div>
                    <p className="text-[11px] text-muted-foreground leading-relaxed">
                      Audit false-positive parity across protected segments and priority sector lending (PSL). Ensure approval rates adhere to RBI fair lending codes.
                    </p>
                  </div>
                </div>
              </div>
            </CardContent>
          </Card>
        </TabsContent>

        {/* TAB 2: DATA INGESTION & I/O LIFECYCLE */}
        <TabsContent value="lifecycle" className="space-y-6">
          <div className="grid gap-6 lg:grid-cols-2">
            {/* Inputs Card */}
            <Card className="bg-surface">
              <CardHeader className="pb-3">
                <div className="flex items-center gap-2">
                  <Database className="h-4 w-4 text-blue-600" />
                  <CardTitle className="text-sm font-semibold">Input Data Architecture (Where Data Comes From)</CardTitle>
                </div>
                <CardDescription className="text-xs">
                  DRISHTI bridges core banking Finacle APIs, consent-based Account Aggregator, and regulatory bureaus.
                </CardDescription>
              </CardHeader>
              <CardContent className="space-y-3">
                <div className="rounded-md border border-border/60 p-3 bg-card/60 space-y-2">
                  <div className="flex items-center justify-between">
                    <span className="text-xs font-semibold text-foreground">1. IDBI Finacle Core Banking Sandbox</span>
                    <Badge variant="outline" className="text-[9px] px-1 py-0 border-blue-500/30 text-blue-600 font-normal">
                      6 REST APIs
                    </Badge>
                  </div>
                  <ul className="text-[11px] text-muted-foreground space-y-1">
                    <li><strong className="text-foreground">API 402:</strong> Facility limits, drawing power, ledger balance, branch placement.</li>
                    <li><strong className="text-foreground">API 404:</strong> 12M transaction velocity, demand collection ratio, credit summation.</li>
                    <li><strong className="text-foreground">API 391:</strong> Drawing power calculation, paid stock valuation, DP gap percentage.</li>
                    <li><strong className="text-foreground">API 441:</strong> Repayment track, overdue days (DPD), 6M EMI/NACH bounce count.</li>
                    <li><strong className="text-foreground">API 362:</strong> Collateral registry, statutory lien notices, restructuring flags.</li>
                    <li><strong className="text-foreground">API 408:</strong> KYC profile, PAN, entity constitution, Udyam MSME classification.</li>
                  </ul>
                </div>

                <div className="rounded-md border border-border/60 p-3 bg-card/60 space-y-2">
                  <div className="flex items-center justify-between">
                    <span className="text-xs font-semibold text-foreground">2. Sahamati Account Aggregator (AA)</span>
                    <Badge variant="outline" className="text-[9px] px-1 py-0 border-emerald-500/30 text-emerald-600 font-normal">
                      APIs 590–595
                    </Badge>
                  </div>
                  <p className="text-[11px] text-muted-foreground leading-relaxed">
                    Fetches real-time, digital consent-based statements from borrower accounts across 28 scheduled commercial banks. Generates cashflow velocity and NACH return telemetry.
                  </p>
                </div>

                <div className="rounded-md border border-border/60 p-3 bg-card/60 space-y-2">
                  <div className="flex items-center justify-between">
                    <span className="text-xs font-semibold text-foreground">3. Bureau & GSTN Regulatory Interfaces</span>
                    <Badge variant="outline" className="text-[9px] px-1 py-0 border-amber-500/30 text-amber-600 font-normal">
                      External Bureau
                    </Badge>
                  </div>
                  <p className="text-[11px] text-muted-foreground leading-relaxed">
                    TransUnion CIBIL Commercial Score (300–900) combined with GSTN portal returns (GSTR-3B filing delays, GSTR-1 vs 3B input tax credit mismatch flags).
                  </p>
                </div>
              </CardContent>
            </Card>

            {/* Outputs Card */}
            <Card className="bg-surface">
              <CardHeader className="pb-3">
                <div className="flex items-center gap-2">
                  <Workflow className="h-4 w-4 text-emerald-600" />
                  <CardTitle className="text-sm font-semibold">Output Deliverables (What DRISHTI Produces)</CardTitle>
                </div>
                <CardDescription className="text-xs">
                  Real-time, actionable credit decisions, regulatory staging, and CAM dossiers for bank committees.
                </CardDescription>
              </CardHeader>
              <CardContent className="space-y-3">
                <div className="rounded-md border border-border/60 p-3 bg-card/60 space-y-2">
                  <div className="flex items-center justify-between">
                    <span className="text-xs font-semibold text-foreground">1. Calibrated 12-Month PD & Risk Grade</span>
                    <Badge variant="outline" className="text-[9px] px-1 py-0 border-emerald-500/30 text-emerald-600 font-normal">
                      RG1–RG10
                    </Badge>
                  </div>
                  <p className="text-[11px] text-muted-foreground leading-relaxed">
                    Out-Of-Fold Beta Calibration maps raw gradient boosting scores to true default probabilities. Mapped to IDBI's 10-tier Master Rating Scale (RG1 prime to RG10 impaired).
                  </p>
                </div>

                <div className="rounded-md border border-border/60 p-3 bg-card/60 space-y-2">
                  <div className="flex items-center justify-between">
                    <span className="text-xs font-semibold text-foreground">2. Ind AS 109 3-Stage Expected Credit Loss (ECL)</span>
                    <Badge variant="outline" className="text-[9px] px-1 py-0 border-blue-500/30 text-blue-600 font-normal">
                      Stage 1 · 2 · 3
                    </Badge>
                  </div>
                  <p className="text-[11px] text-muted-foreground leading-relaxed">
                    Calculates Stage 1 (12M ECL), Stage 2 (Lifetime ECL upon Significant Increase in Credit Risk), and Stage 3 (RBI regulatory provisioning floors) for immediate statutory reserving.
                  </p>
                </div>

                <div className="rounded-md border border-border/60 p-3 bg-card/60 space-y-2">
                  <div className="flex items-center justify-between">
                    <span className="text-xs font-semibold text-foreground">3. 19 RBI Early Warning Signals & Recourse Playbook</span>
                    <Badge variant="outline" className="text-[9px] px-1 py-0 border-purple-500/30 text-purple-600 font-normal">
                      Actionable Recourse
                    </Badge>
                  </div>
                  <p className="text-[11px] text-muted-foreground leading-relaxed">
                    Surfaces exact RBI EWS triggers (drawing power erosion, cheque bounces, GST defaults) and quantifies how covenant remedies (e.g. 15% margin enhancement) reduce default risk.
                  </p>
                </div>

                <div className="rounded-md border border-border/60 p-3 bg-card/60 space-y-2">
                  <div className="flex items-center justify-between">
                    <span className="text-xs font-semibold text-foreground">4. Formal Credit Appraisal Memo (CAM Dossier)</span>
                    <Badge variant="outline" className="text-[9px] px-1 py-0 border-primary/30 text-primary font-normal">
                      Print & PDF Ready
                    </Badge>
                  </div>
                  <p className="text-[11px] text-muted-foreground leading-relaxed">
                    Generates a complete, audit-compliant appraisal memo with executive summary, borrower financials, SHAP explainability waterfall, and credit committee sign-off sheet.
                  </p>
                </div>
              </CardContent>
            </Card>
          </div>

          {/* Data Hygiene & Pipeline Safeguards */}
          <Card className="bg-surface">
            <CardHeader className="pb-2">
              <CardTitle className="text-sm font-semibold">Regulatory Safeguards & Data Hygiene</CardTitle>
              <CardDescription className="text-xs">
                Guaranteed zero label leakage, T0 performing cohort enforcement, and monotone credit intuition.
              </CardDescription>
            </CardHeader>
            <CardContent>
              <div className="grid gap-3 sm:grid-cols-3">
                <div className="rounded-md border border-border/60 p-3 bg-background/50 space-y-1">
                  <span className="text-xs font-semibold text-foreground flex items-center gap-1.5">
                    <CheckCircle2 className="h-3.5 w-3.5 text-emerald-500" />
                    Zero Label Leakage
                  </span>
                  <p className="text-[11px] text-muted-foreground">
                    Guarded by automated assertions (<code className="text-xs bg-muted px-1 py-0.5 rounded">assert_no_leakage()</code>). Charge-off dates and post-T0 collections are used exclusively for target construction.
                  </p>
                </div>

                <div className="rounded-md border border-border/60 p-3 bg-background/50 space-y-1">
                  <span className="text-xs font-semibold text-foreground flex items-center gap-1.5">
                    <CheckCircle2 className="h-3.5 w-3.5 text-emerald-500" />
                    T0 Performing Pruning
                  </span>
                  <p className="text-[11px] text-muted-foreground">
                    Accounts with DPD &ge; 90 at observation time T0 are strictly excluded. The model predicts <em>future</em> stress 12 months ahead, never classifying loans already defaulted.
                  </p>
                </div>

                <div className="rounded-md border border-border/60 p-3 bg-background/50 space-y-1">
                  <span className="text-xs font-semibold text-foreground flex items-center gap-1.5">
                    <CheckCircle2 className="h-3.5 w-3.5 text-emerald-500" />
                    Monotone Credit Priors
                  </span>
                  <p className="text-[11px] text-muted-foreground">
                    Enforces credit domain intuition: higher EMI bounces, higher DP erosion, and lower CIBIL scores are mathematically constrained to never decrease predicted default probability.
                  </p>
                </div>
              </div>
            </CardContent>
          </Card>
        </TabsContent>

        {/* TAB 3: MASTER RATING SCALE & RBI EWS */}
        <TabsContent value="framework" className="space-y-6">
          {/* Master Rating Scale */}
          <Card className="bg-surface">
            <CardHeader className="pb-3">
              <CardTitle className="text-base">IDBI DRISHTI Master Rating Scale (RG1 to RG10)</CardTitle>
              <CardDescription className="text-xs">
                Calibrated 12-month Probability of Default (PD) bands, RAG categorization, Ind AS 109 staging, and governance review cadence.
              </CardDescription>
            </CardHeader>
            <CardContent className="p-0">
              <div className="overflow-x-auto">
                <Table>
                  <TableHeader>
                    <TableRow>
                      <TableHead className="text-xs">Risk Grade</TableHead>
                      <TableHead className="text-xs">12M Calibrated PD</TableHead>
                      <TableHead className="text-xs">RAG Status</TableHead>
                      <TableHead className="text-xs">Ind AS 109 Stage</TableHead>
                      <TableHead className="text-xs">ECL Floor</TableHead>
                      <TableHead className="text-xs">Review Cadence</TableHead>
                      <TableHead className="text-xs">Delegated Authority</TableHead>
                      <TableHead className="text-xs">Operational Action</TableHead>
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {[
                      { grade: "RG1", pd: "0.00% – 0.50%", rag: "Green", stage: "Stage 1", floor: "0.25%", cadence: "Annual", auth: "Branch Manager", action: "Fast-track renewal; eligible for limit enhancement" },
                      { grade: "RG2", pd: "0.50% – 1.00%", rag: "Green", stage: "Stage 1", floor: "0.40%", cadence: "Annual", auth: "Branch Manager", action: "Standard annual renewal; verify quarterly stock statement" },
                      { grade: "RG3", pd: "1.00% – 2.00%", rag: "Green", stage: "Stage 1", floor: "0.75%", cadence: "Annual", auth: "Assistant General Manager", action: "Standard monitoring; check annual financials" },
                      { grade: "RG4", pd: "2.00% – 4.00%", rag: "Amber", stage: "Stage 1", floor: "1.25%", cadence: "Semi-Annual", auth: "Deputy General Manager", action: "Satisfactory with minor alerts; semi-annual covenant audit" },
                      { grade: "RG5", pd: "4.00% – 7.00%", rag: "Amber", stage: "Stage 2 (SICR)", floor: "3.50%", cadence: "Quarterly", auth: "Zonal Committee", action: "Watchlist flag; demand 10% margin enhancement" },
                      { grade: "RG6", pd: "7.00% – 11.00%", rag: "Amber", stage: "Stage 2 (SICR)", floor: "7.00%", cadence: "Quarterly", auth: "Zonal Committee", action: "Incipient stress; monthly drawing power verification" },
                      { grade: "RG7", pd: "11.00% – 16.00%", rag: "Red", stage: "Stage 2 (SICR)", floor: "12.50%", cadence: "Monthly", auth: "Executive Committee", action: "High default risk; cap facility limit, issue 30-day cure notice" },
                      { grade: "RG8", pd: "16.00% – 22.00%", rag: "Red", stage: "Stage 2 (SICR)", floor: "20.00%", cadence: "Monthly", auth: "Executive Committee", action: "Severe stress; demand full collateral pledge; restrict drawdowns" },
                      { grade: "RG9", pd: "22.00% – 30.00%", rag: "Red", stage: "Stage 3 (Credit Impaired)", floor: "40.00%", cadence: "Fortnightly", auth: "Board Credit Committee", action: "Impaired asset; initiate SMA-2 escalation and recall proceedings" },
                      { grade: "RG10", pd: "≥ 30.00%", rag: "Red", stage: "Stage 3 (Sub-Standard / NPA)", floor: "100.00%", cadence: "Weekly", auth: "Stressed Asset Resolution Branch", action: "Immediate legal recovery under SARFAESI / IBC NCLT petition" },
                    ].map((row) => (
                      <TableRow key={row.grade} className="text-xs">
                        <TableCell className="font-semibold">{row.grade}</TableCell>
                        <TableCell className="tabular-nums">{row.pd}</TableCell>
                        <TableCell>
                          <Badge
                            variant="outline"
                            className={
                              row.rag === "Green"
                                ? "bg-emerald-500/10 text-emerald-600 border-emerald-500/30"
                                : row.rag === "Amber"
                                ? "bg-amber-500/10 text-amber-600 border-amber-500/30"
                                : "bg-red-500/10 text-red-600 border-red-500/30"
                            }
                          >
                            {row.rag}
                          </Badge>
                        </TableCell>
                        <TableCell>
                          <Badge variant="outline" className="text-[10px] font-normal">
                            {row.stage}
                          </Badge>
                        </TableCell>
                        <TableCell className="tabular-nums">{row.floor}</TableCell>
                        <TableCell>{row.cadence}</TableCell>
                        <TableCell className="text-muted-foreground">{row.auth}</TableCell>
                        <TableCell className="max-w-xs truncate text-muted-foreground" title={row.action}>
                          {row.action}
                        </TableCell>
                      </TableRow>
                    ))}
                  </TableBody>
                </Table>
              </div>
            </CardContent>
          </Card>

          {/* 19 RBI Early Warning Signals */}
          <Card className="bg-surface">
            <CardHeader className="pb-3">
              <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-2">
                <div>
                  <CardTitle className="text-base">19 RBI Early Warning Signals (EWS Catalog)</CardTitle>
                  <CardDescription className="text-xs">
                    Deterministic compliance rules aligned with RBI Master Directions on Stressed Asset Management.
                  </CardDescription>
                </div>
                <div className="relative w-full sm:w-64">
                  <Search className="pointer-events-none absolute left-2.5 top-1/2 h-3.5 w-3.5 -translate-y-1/2 text-muted-foreground" />
                  <Input
                    value={searchFilter}
                    onChange={(e) => setSearchFilter(e.target.value)}
                    placeholder="Search EWS rules..."
                    className="h-8 pl-8 text-xs"
                  />
                </div>
              </div>
            </CardHeader>
            <CardContent className="p-0">
              <div className="max-h-96 overflow-y-auto">
                <Table>
                  <TableHeader className="sticky top-0 bg-surface z-10">
                    <TableRow>
                      <TableHead className="text-xs">Code</TableHead>
                      <TableHead className="text-xs">Rule Name</TableHead>
                      <TableHead className="text-xs">RBI Master Direction Trigger</TableHead>
                      <TableHead className="text-xs">Severity</TableHead>
                      <TableHead className="text-xs">Prescribed Remedial Action</TableHead>
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {[
                      { code: "EWS18", name: "Drawing Power Erosion", trigger: "Drawing power gap vs sanctioned limit ≥ 25.0%", sev: "High", action: "Demand stock statement audit and 15% collateral replenishment" },
                      { code: "EWS19", name: "Collection Shortfall", trigger: "Demanded vs collected debt service ratio < 0.80", sev: "High", action: "Escalate to SMA-1; debit balance sweep and borrower interview" },
                      { code: "EWS01", name: "Continuous DPD Delinquency", trigger: "Days Past Due (DPD) > 30 consecutive days", sev: "High", action: "Issue formal Section 13(2) notice and freeze limit enhancements" },
                      { code: "EWS02", name: "Frequent Cheque / NACH Bounces", trigger: "≥ 3 inward returns or EMI bounces within 90 days", sev: "High", action: "Cancel NACH mandate; demand upfront RTGS remittance" },
                      { code: "EWS03", name: "GST Filing Non-Compliance", trigger: "GSTR-3B return delay > 30 days or persistent default", sev: "Medium", action: "Verify GST portal; reconcile turnover vs core banking credits" },
                      { code: "EWS04", name: "Input Tax Credit (ITC) Mismatch", trigger: "GSTR-2B vs 3B discrepancy > 15% (circular trading suspicion)", sev: "Medium", action: "Conduct physical verification of debtor invoices and stock register" },
                      { code: "EWS05", name: "Statutory Lien Encumbrance", trigger: "Tax attachment, EPF lien, or court garnishee order active", sev: "High", action: "Freeze drawing power immediately; alert bank legal cell" },
                      { code: "EWS06", name: "Restructuring Pre-Default", trigger: "Account flagged under RBI Prudential Framework for resolution", sev: "High", action: "Assign to Special Stressed Asset Cell; quarterly review" },
                      { code: "EWS07", name: "Turnover Divergence", trigger: "Banking credits diverge by > 30% from declared GST sales", sev: "Medium", action: "Demand explanation for outside banking turnover / route diversion" },
                      { code: "EWS08", name: "Sudden DP Spikes", trigger: "Drawing power enhanced by > 40% without proportional sales growth", sev: "Low", action: "Verify credentials of valuation surveyor and stock auditor" },
                      { code: "EWS09", name: "Rapid Bureau Downgrade", trigger: "Commercial CIBIL score drop > 50 points within two quarters", sev: "Medium", action: "Review external lender consortium exposure via CRILC" },
                      { code: "EWS10", name: "High DP Utilization Stress", trigger: "Continuous 95%+ utilization of cash credit limit for 60 days", sev: "Low", action: "Inspect inventory turnover velocity; check for dead stock" },
                      { code: "EWS11", name: "Adverse Inspector FinBERT Sentiment", trigger: "Site inspection note carries negative sentiment score < -0.40", sev: "Medium", action: "Conduct independent branch manager surprise factory visit" },
                      { code: "EWS12", name: "Auditor Resignation / Qualification", trigger: "Statutory auditor disclaimer or mid-term resignation", sev: "High", action: "Commission forensic accounting review of debtor books" },
                      { code: "EWS13", name: "Frequent Management Turnover", trigger: "Resignation of Key Managerial Personnel (CFO/MD) within 6 months", sev: "Low", action: "Examine promoter integrity and corporate governance track" },
                      { code: "EWS14", name: "Related-Party Loan Divergence", trigger: "Advances to sister concerns exceed 20% of net worth", sev: "High", action: "Enforce restrictive loan covenant barring unapproved inter-corporate loans" },
                      { code: "EWS15", name: "Delay in Financial Submission", trigger: "Annual audited accounts submission delayed > 180 days from FY close", sev: "Medium", action: "Apply 2% penal interest until audited balance sheet is lodged" },
                      { code: "EWS16", name: "Pledge of Promoter Shares", trigger: "Promoter share pledge exceeds 50% of holding in listed parent", sev: "High", action: "Monitor margin call volatility and demand personal guarantee top-up" },
                      { code: "EWS17", name: "Supplier Network Contagion Exposure", trigger: "Key buyer / anchor OEM enters NCLT or defaults on trade receivables", sev: "High", action: "Perform supply-chain stress test; evaluate trade bill discounting lines" },
                    ]
                      .filter(
                        (r) =>
                          !searchFilter.trim() ||
                          r.code.toLowerCase().includes(searchFilter.toLowerCase()) ||
                          r.name.toLowerCase().includes(searchFilter.toLowerCase()) ||
                          r.trigger.toLowerCase().includes(searchFilter.toLowerCase())
                      )
                      .map((r) => (
                        <TableRow key={r.code} className="text-xs">
                          <TableCell className="font-semibold text-foreground">{r.code}</TableCell>
                          <TableCell className="font-medium">{r.name}</TableCell>
                          <TableCell className="text-muted-foreground">{r.trigger}</TableCell>
                          <TableCell>
                            <Badge
                              variant="outline"
                              className={
                                r.sev === "High"
                                  ? "bg-red-500/10 text-red-600 border-red-500/30 font-medium"
                                  : r.sev === "Medium"
                                  ? "bg-amber-500/10 text-amber-600 border-amber-500/30 font-normal"
                                  : "bg-blue-500/10 text-blue-600 border-blue-500/30 font-normal"
                              }
                            >
                              {r.sev}
                            </Badge>
                          </TableCell>
                          <TableCell className="max-w-xs text-muted-foreground">{r.action}</TableCell>
                        </TableRow>
                      ))}
                  </TableBody>
                </Table>
              </div>
            </CardContent>
          </Card>
        </TabsContent>

        {/* TAB 4: DESK FAQ & TROUBLESHOOTING */}
        <TabsContent value="faq" className="space-y-6">
          <Card className="bg-surface">
            <CardHeader className="pb-3">
              <CardTitle className="text-base">Desk FAQ & Operational Troubleshooting</CardTitle>
              <CardDescription className="text-xs">
                Answers to common operational questions encountered by branch managers, credit analysts, and controlling officers.
              </CardDescription>
            </CardHeader>
            <CardContent>
              <Accordion type="single" collapsible className="w-full space-y-2">
                <AccordionItem value="item-1" className="border border-border/60 rounded-md px-4 py-1 bg-card/40">
                  <AccordionTrigger className="text-xs font-semibold hover:no-underline">
                    Why did DRISHTI assign an RG7 (Red) rating when the borrower has a CIBIL score of 760?
                  </AccordionTrigger>
                  <AccordionContent className="text-xs text-muted-foreground leading-relaxed pt-2">
                    Bureau scores like CIBIL are inherently backward-looking (often lagging by 60 to 90 days due to monthly reporting cycles). DRISHTI integrates real-time Finacle banking signals:
                    <ul className="list-disc pl-5 mt-2 space-y-1">
                      <li><strong>Drawing Power Erosion:</strong> The borrower's DP may have eroded significantly due to unpaid stocks or aging debtors, indicating immediate liquidity depletion.</li>
                      <li><strong>Demanded vs. Collected Ratio:</strong> The borrower may have collected less than 80% of scheduled debt service over the last 90 days.</li>
                      <li><strong>Recent NACH / Cheque Bounces:</strong> Multiple inward returns within the last 30 days trigger high-severity RBI EWS signals that have not yet appeared in bureau records.</li>
                    </ul>
                  </AccordionContent>
                </AccordionItem>

                <AccordionItem value="item-2" className="border border-border/60 rounded-md px-4 py-1 bg-card/40">
                  <AccordionTrigger className="text-xs font-semibold hover:no-underline">
                    How does the 1-Click Finacle Core Banking Quick-Fetch work?
                  </AccordionTrigger>
                  <AccordionContent className="text-xs text-muted-foreground leading-relaxed pt-2">
                    In the <Link to="/underwrite" className="text-primary underline">Loan Appraisal</Link> module, entering a Finacle Loan ID (e.g. <code className="bg-muted px-1 py-0.5 rounded">IDBI_LN_100361</code>) or clicking any quick sample chip queries the live borrower database.
                    It auto-populates all 14 facility parameters (Sanction Limit, Drawing Power, CIBIL, Demand-Collection Ratio, DPD, Bounces, Lien Flag, GST Delays) instantly from Finacle APIs 402, 404, 391, and 441, saving credit officers 15 minutes of manual data entry per proposal.
                  </AccordionContent>
                </AccordionItem>

                <AccordionItem value="item-3" className="border border-border/60 rounded-md px-4 py-1 bg-card/40">
                  <AccordionTrigger className="text-xs font-semibold hover:no-underline">
                    When is an account classified under Ind AS 109 Stage 2 vs Stage 1?
                  </AccordionTrigger>
                  <AccordionContent className="text-xs text-muted-foreground leading-relaxed pt-2">
                    Under Ind AS 109, classification into <strong>Stage 2 (Significant Increase in Credit Risk - SICR)</strong> occurs when:
                    <ul className="list-disc pl-5 mt-2 space-y-1">
                      <li>The loan's calibrated 12-month PD rises into Risk Grades RG5 to RG8 (PD &ge; 4.0%).</li>
                      <li>Days Past Due (DPD) exceeds 30 days (SMA-1 threshold).</li>
                      <li>The borrower suffers an internal credit rating downgrade of 2 or more notches since origination.</li>
                    </ul>
                    Stage 2 accounts require full <em>Lifetime Expected Credit Loss</em> provisioning rather than 12-month ECL.
                  </AccordionContent>
                </AccordionItem>

                <AccordionItem value="item-4" className="border border-border/60 rounded-md px-4 py-1 bg-card/40">
                  <AccordionTrigger className="text-xs font-semibold hover:no-underline">
                    Can a Branch Manager override an AI-suggested risk grade?
                  </AccordionTrigger>
                  <AccordionContent className="text-xs text-muted-foreground leading-relaxed pt-2">
                    Yes, DRISHTI incorporates a strict Human-In-The-Loop (HITL) governance framework. A credit officer or committee member can select <strong>Override Grade</strong> in the decision dialog.
                    However, banking policy requires:
                    <ul className="list-disc pl-5 mt-2 space-y-1">
                      <li>A mandatory written rationale explaining the mitigating factors (e.g. unencumbered immovable property pledge, escrow account creation).</li>
                      <li>The officer's employee code is permanently tied to the decision in the database audit log (<code className="bg-muted px-1 py-0.5 rounded">DecisionRecord</code>).</li>
                      <li>Upward overrides of more than 2 grades require countersignature by the Zonal Credit Committee.</li>
                    </ul>
                  </AccordionContent>
                </AccordionItem>

                <AccordionItem value="item-5" className="border border-border/60 rounded-md px-4 py-1 bg-card/40">
                  <AccordionTrigger className="text-xs font-semibold hover:no-underline">
                    What does a Population Stability Index (PSI) alert mean in Model Governance?
                  </AccordionTrigger>
                  <AccordionContent className="text-xs text-muted-foreground leading-relaxed pt-2">
                    PSI measures whether the distribution of new loan applications is shifting away from the model's training baseline:
                    <ul className="list-disc pl-5 mt-2 space-y-1">
                      <li><strong>PSI &lt; 0.10 (Green):</strong> Model is stable; feature distributions match expectations.</li>
                      <li><strong>0.10 &le; PSI &lt; 0.25 (Amber):</strong> Moderate population shift. Increase monitoring cadence and inspect which features (e.g. interest rates or GST delays) are drifting.</li>
                      <li><strong>PSI &ge; 0.25 (Red):</strong> Significant population drift. Triggers an automated champion-challenger retraining pipeline in SageMaker to adapt to the new economic regime.</li>
                    </ul>
                  </AccordionContent>
                </AccordionItem>

                <AccordionItem value="item-6" className="border border-border/60 rounded-md px-4 py-1 bg-card/40">
                  <AccordionTrigger className="text-xs font-semibold hover:no-underline">
                    How should branch managers handle the Action Queue each morning?
                  </AccordionTrigger>
                  <AccordionContent className="text-xs text-muted-foreground leading-relaxed pt-2">
                    The <strong>Action Queue</strong> on the <Link to="/" className="text-primary underline">Portfolio Console</Link> automatically categorizes all accounts into 3 operational buckets:
                    <ol className="list-decimal pl-5 mt-2 space-y-1">
                      <li><strong>🔴 Critical Action (Act within 24h):</strong> Accounts requiring immediate intervention — contact promoter, demand drawing power regularisation, or issue recall notice.</li>
                      <li><strong>🟡 Covenant Watchlist (Weekly Review):</strong> Accounts requiring compliance follow-up — obtain updated GSTR-3B filings or stock statements.</li>
                      <li><strong>🟢 Fast-Track Renewals (Clean Book):</strong> Prime accounts eligible for 1-click annual facility limit renewal and proactive cross-selling.</li>
                    </ol>
                  </AccordionContent>
                </AccordionItem>
              </Accordion>
            </CardContent>
          </Card>
        </TabsContent>
      </Tabs>
    </div>
  );
}

