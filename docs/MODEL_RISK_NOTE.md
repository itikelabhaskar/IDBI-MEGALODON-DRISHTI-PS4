# Model-Risk Note — DRISHTI 12-Month Loan Stress Engine (PS4 prototype)

*Prototype for IDBI Innovate 26. Public + synthetic data now; IDBI sandbox data
plugs into the same canonical schema. This note follows the spirit of RBI/Basel
model-risk management and the RBI FREE-AI committee report (Aug 2025).*

## 1. Purpose & scope
Estimate the probability that a loan enters stress within a 12-month horizon
(PD), at account level, across loan types, to drive early-warning, provisioning
(ECL) and collections prioritisation. Output is decision-support, not automated
adverse action. A companion **discrete-time hazard model** produces a PD term
structure ("expected stress month"), not just a 12-month point estimate.

## 2. Data & labels (four segments)
- **India MSME (hero demo)**: SYNTHETIC, generated feature-first (attributes →
  latent risk → label) and calibrated to SIDBI–TransUnion CIBIL MSME Pulse
  priors (micro ≈ 4.5%, small ≈ 3%, medium ≈ 2% 12m stress). Carries the full
  India taxonomy: GST returns, Account-Aggregator bank-statement signals,
  CMR-style bureau rank, loan-officer notes, supplier-network features. The
  point proven is *pipeline lift*, not real-world PD levels.
- **MSME — SBA 7(a)** (~897K US loans): `default_12m` = `MIS_Status = CHGOFF`.
  Documented caveat: lifetime charge-off used as the stress label; the survival
  model corrects this by evaluating against a true 12-month event label built
  from charge-off dates (label construction only — dates are never features).
- **Retail — Home Credit** (307K applications + bureau tradeline aggregates).
- **Retail unsecured — Give Me Some Credit** (150K).
- **Leakage control**: post-outcome fields dropped in adapters; a leakage-token
  assertion guards every feature matrix.

## 3. Methodology
- Segment-specific feature engineering; origination-year macro features for SBA
  (unemployment/GDP at approval — known at origination, leakage-safe).
- **LightGBM** (Optuna-tuned, class weights; SMOTE compared and logged) blended
  with **CatBoost** (ordered target statistics = leakage-safe target encoding);
  blend weight selected on validation AUC so the blend never underperforms its
  stronger component. **Isotonic calibration** on the validation slice.
- **Reporting discipline**: discrimination (AUC/Gini/KS/capture) is reported on
  RAW scores — isotonic calibration introduces ties that understate ranking —
  while calibration quality (Brier, reliability plots) is reported on
  calibrated PDs.
- **Monotone constraints** enforced where credit intuition is unambiguous
  (GMSC delinquency/utilisation; all India cash-flow, note and graph features):
  more bounces can never lower PD, better balance trend can never raise it.
- **Time-based splits** where an origination clock exists (SBA fiscal year;
  India vintage year); stratified splits otherwise (documented per segment).
- **Survival model**: person-period (quarterly) LightGBM hazard → cumulative
  PD curve over 20 quarters; PD@12m evaluated against the true 12-month label.
- **Hybrid routing**: TabPFN v2 foundation model for small/new segments (wins
  by +4–10 AUC points below ~1K rows), calibrated GBM blend at scale, plus a
  distillation path (TabPFN teacher → LightGBM student at production latency).

## 4. Performance
See `docs/RESULTS.md` (auto-generated from artifacts) for the current holdout
numbers per segment, the India ablation staircase (structured → +GST/AA →
+notes → +graph), routing and distillation evidence.

## 5. Calibration & stability
Isotonic calibration aligns predicted PD buckets with observed frequencies
(reliability plots per segment). Every training run writes a **PSI table**
(train → test cohorts) into `metrics.json` as a drift receipt; monitoring plan:
PSI on features and score each cycle, capture-rate and calibration
back-testing, recalibration trigger at PSI > 0.25.

## 5b. Operating points & output vocabulary
- **Accuracy requirement**: the problem statement sets a >90% accuracy target.
  Each segment ships an operating-point table (accuracy, precision,
  recall/capture, F1, flag rate at named thresholds) in
  `models_store/<segment>/operating_points.json`, including the accuracy-
  optimal point and the top-10%-review-capacity point.
- **RAG buckets**: every score maps RG1–4 → Green, RG5–7 → Amber, RG8–10 → Red
  (the colour-coded high/medium/low output the business unit asked for),
  alongside the SMA watch bucket.
- **Data scopes**: features are tagged to the bank's three named scopes —
  borrower behaviour, internal systems, public domain (GST portal-verifiable
  signals, e-invoice/MCA links) — see `DATA_SCOPE` in
  `src/features/india_features.py`.

## 6. Explainability
- Global drivers + per-account **SHAP reason codes** (on the LightGBM component
  of the blend).
- **RBI EWS rule engine** (official-style early-warning signals) beside the ML
  PD, supporting a Red-Flagged-Account workflow (30-day flag / 180-day review).
- **Counterfactual recourse** and a **narrative credit memo** (deterministic
  template today; `LLMClient` interface ready for a provider swap).
- **Unstructured layer**: loan-officer notes → extracted risk signals feeding
  the India model as features. Event flags are keyword-based (auditable);
  sentiment uses a **self-hosted FinBERT** — chosen because IDBI runs no LLMs
  in production: no data leaves the bank, no API dependency. The
  `LLMClient` interface remains the richer future tier.

## 7. Fairness (RBI FREE-AI)
Disparate-impact audit (80% rule) with per-group AUC / flag-rate, surfaced in
the console's Governance view per segment (gender for Home Credit, state for the
India segment, urban/rural for SBA, age band for GMSC). The seven FREE-AI
sutras are mapped to shipped evidence in the same tab.

## 8. Limitations
- India segment is synthetic: it demonstrates *capability and lift mechanics*,
  not production PD levels; real GST/AA/bureau feeds replace the generator at
  sandbox stage without schema changes.
- SBA binary label is lifetime charge-off (mitigated by the survival model's
  true-12m evaluation); recent-cohort censoring may understate test defaults.
- Public retail datasets are not Indian portfolios; currency units are labelled
  honestly per segment (USD / CU / INR).

## 9. Governance & deployment
Independent validation, back-testing, risk-committee sign-off and periodic
recalibration required before production, per RBI/Basel. Served via versioned
model bundles behind a REST API (batch + single-record, with minimum-input
validation and a `fields_defaulted` transparency counter) and a batch job; PD
feeds ECL / IRAC provisioning and collections. Human-in-the-loop for adverse
decisions.
