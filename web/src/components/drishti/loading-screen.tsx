import { useState, useEffect } from "react";
import { BrandMark } from "./brand";
import { Progress } from "@/components/ui/progress";
import { Button } from "@/components/ui/button";
import { ShieldCheck, Database, Cpu, CheckCircle2, ArrowRight } from "lucide-react";

interface LoadingStep {
  text: string;
  subtext: string;
  icon: typeof Database;
}

const BOOT_STEPS: LoadingStep[] = [
  {
    text: "Loading the demo portfolio",
    subtext: "Synthetic MSME book built from the bank's data definitions",
    icon: Database,
  },
  {
    text: "Loading Monotone LightGBM & Beta Calibrator Models",
    subtext: "Calibrated 12-month PD term structure · Monotone bounce & DP constraints",
    icon: Cpu,
  },
  {
    text: "Preparing staged ECL and 19 early-warning rules",
    subtext: "Indicative 3-stage ECL (Ind AS 109-style) · EWS rules modelled on RBI red-flag indicators",
    icon: ShieldCheck,
  },
  {
    text: "Preparing branch and zone rollups",
    subtext: "45-branch hierarchy · synthetic supplier graph",
    icon: CheckCircle2,
  },
];

interface LoadingScreenProps {
  message?: string;
  onComplete?: () => void;
  minDurationMs?: number;
}

export function LoadingScreen({
  message,
  onComplete,
  minDurationMs = 1200,
}: LoadingScreenProps) {
  const [progress, setProgress] = useState(15);
  const [stepIndex, setStepIndex] = useState(0);
  const onCompleteRef = useState({ current: onComplete })[0];
  onCompleteRef.current = onComplete;

  useEffect(() => {
    const startTime = Date.now();
    const interval = setInterval(() => {
      const elapsed = Date.now() - startTime;
      const pct = Math.min(100, Math.round((elapsed / minDurationMs) * 100));
      setProgress(pct);

      if (pct < 25) {
        setStepIndex(0);
      } else if (pct < 55) {
        setStepIndex(1);
      } else if (pct < 85) {
        setStepIndex(2);
      } else {
        setStepIndex(3);
      }

      if (elapsed >= minDurationMs) {
        clearInterval(interval);
        setTimeout(() => {
          onCompleteRef.current?.();
        }, 100);
      }
    }, 40);

    return () => clearInterval(interval);
  }, [minDurationMs]);

  const currentStep = BOOT_STEPS[stepIndex] || BOOT_STEPS[BOOT_STEPS.length - 1];
  const StepIcon = currentStep.icon;

  return (
    <div className="relative grid min-h-screen w-full place-items-center bg-background px-4 overflow-hidden select-none">
      {/* Background ambient lighting */}
      <div className="pointer-events-none absolute -top-40 -left-40 h-96 w-96 rounded-full bg-primary/10 blur-3xl" />
      <div className="pointer-events-none absolute -bottom-40 -right-40 h-96 w-96 rounded-full bg-accent/10 blur-3xl" />

      {/* Top right quick skip button for presenters */}
      <div className="absolute top-4 right-4 z-10">
        <Button
          variant="ghost"
          size="sm"
          onClick={() => onComplete?.()}
          className="text-xs text-muted-foreground hover:text-foreground gap-1"
        >
          Skip animation
          <ArrowRight className="h-3.5 w-3.5" />
        </Button>
      </div>

      <div className="w-full max-w-md relative z-10 flex flex-col items-center text-center">
        {/* Animated Brand Emblem */}
        <div className="relative mb-6">
          <div className="absolute -inset-2 rounded-2xl bg-primary/20 blur-md animate-pulse" />
          <BrandMark className="relative h-16 w-16 shadow-lg shadow-primary/20 ring-1 ring-primary/30" />
        </div>

        {/* System Title */}
        <div className="space-y-1 mb-6">
          <div className="inline-flex items-center gap-1.5 rounded-full border border-primary/20 bg-primary/5 px-2.5 py-0.5 text-[11px] font-medium text-primary tracking-wide uppercase">
            IDBI Innovate 2026 · Problem Statement 4
          </div>
          <h1 className="text-2xl font-bold tracking-tight text-foreground">
            DRISHTI <span className="text-primary font-semibold">Risk Engine</span>
          </h1>
          <p className="text-xs text-muted-foreground font-mono">
            Default Risk Intelligence &amp; Stress-Horizon Tracking Initiative
          </p>
        </div>

        {/* Progress Card */}
        <div className="w-full rounded-xl border border-border bg-surface/80 backdrop-blur p-5 shadow-sm space-y-4">
          <div className="flex items-center justify-between text-xs font-medium">
            <span className="text-foreground flex items-center gap-1.5">
              <StepIcon className="h-4 w-4 text-primary animate-spin-slow" />
              {message || currentStep.text}
            </span>
            <span className="font-mono text-primary font-semibold">{progress}%</span>
          </div>

          <Progress value={progress} className="h-2 bg-muted" />

          <p className="text-[11px] text-muted-foreground text-left leading-relaxed">
            {currentStep.subtext}
          </p>

          <div className="pt-2 border-t border-border/60 flex items-center justify-between text-[11px] text-muted-foreground font-mono">
            <span>Prototype · synthetic data</span>
            <span>IDBI Innovate 2026 · PS-4</span>
          </div>
        </div>

        {/* Footer Security Stamp */}
        <div className="mt-8 text-center text-[11px] text-muted-foreground leading-relaxed">
          <p className="flex items-center justify-center gap-1 font-medium text-foreground/80">
            <ShieldCheck className="h-3.5 w-3.5 text-accent" />
            DRISHTI prototype for IDBI Innovate 2026 (PS-4)
          </p>
          <p className="mt-1 opacity-70">
            Not a bank system · runs on synthetic data built from the bank&apos;s data definitions
          </p>
        </div>
      </div>
    </div>
  );
}
