# DRISHTI — 12-month loan stress prediction

**D**efault **R**isk **I**ntelligence & **S**tress-**H**orizon **T**racking **I**nitiative

Predicts the probability that a loan slips into stress within the next 12 months, then
turns that probability into something a credit officer can act on — a risk grade, a
watch bucket, a prescribed action with an owner, and an expected loss in rupees.

Built for **IDBI Innovate 2026, Problem Statement 4** (MSME credit · predictive AI ·
risk management).

---

## The problem

The problem statement describes the current capability plainly:

> "limited by low prediction accuracy in the range of **16–22%**, dependent solely on
> **structured data** and **fragmented methodologies** across loan types and borrower
> segments."

and asks for stress identified **12 months in advance**, using **structured and
unstructured** data, across **different loan types**, under a **common interpretation
framework**.

### Why plain accuracy is the wrong target

About 4% of loans in the India book go bad. A model that answers "everything is fine"
for every loan scores **96.1% accuracy** and has never once identified a bad loan.

So this project reports the metrics that actually contain the problem: how many of next
year's defaulters land in the slice you review, how well the score separates good from
bad, and whether the predicted probabilities match observed frequencies.

---

## Results

Held-out cohorts. Full tables in [`docs/RESULTS.md`](docs/RESULTS.md), regenerated
directly from the trained artifacts.

| Loan book | AUC | Capture @ top 10% | Lift | Brier |
|---|---|---|---|---|
| India MSME (synthetic) | 0.864 | **57%** | 5.7× | 0.031 |
| MSME — SBA 7(a) (899K loans) | **0.945** | 38% | 3.8× | 0.080 |
| Retail — Home Credit (307K) | 0.776 | 35% | 3.5× | 0.067 |
| Retail unsecured — GMSC (150K) | 0.862 | 55% | 5.5× | 0.049 |

**Capture @ top 10%** is the number that matters: review the riskiest tenth of the book
and you find that share of everything that defaults within a year — against a 16–22%
status quo.

### What each data layer is actually worth

The same model, the same loans, adding one layer at a time. Mean over three seeds:

| Layer | AUC | Capture @ 10% |
|---|---|---|
| Structured only — what a bank scores on today | 0.610 | 17% |
| + GST filings and bank-statement cash flow | 0.852 | 54% |
| + loan-officer notes | **0.862** | **58%** |
| + supplier network | 0.845 | 52% |

Two things worth reading carefully:

- The structured-only row reproduces the 16–22% problem the bank described. The lift
  comes from **data**, not from a cleverer algorithm.
- The supplier-network row is **negative**, inside seed noise. It ships, labelled as
  no-gain, and the chart hatches that bar rather than drawing it as an improvement.
  It is kept for validation against a real e-invoice graph.

### On the "90%" requirement

Read as classification accuracy, every segment clears it (India 96.3%, GMSC 93.8%,
Home Credit 91.9%; SBA reaches 89.3% against a 25% base rate, where a do-nothing model
scores 75%). Per-segment threshold tables are written to
`models_store/<segment>/operating_points.json`.

Read as *precision among flagged accounts* — "if we flag it, how often does it really
default" — it is a different and much harder question, and it trades directly against
coverage:

| Flag rate | Precision | Coverage |
|---|---|---|
| Top 10% | 19.7% | 60.7% |
| Top 1% | 60.1% | 17.0% |
| Top 0.1% | 94.1% | 3.3% |

90%+ precision is reachable, but only on a handful of accounts, catching ~3% of
failures. The console shows the whole frontier so the operating point is a choice rather
than a claim.

---

## How it works

```
raw source ──adapter──► canonical frame ──features──► model ──► calibrated PD
                                                                    │
                   risk grade → RAG colour → SMA watch → action → ECL
                                                                    │
                        reason codes · early-warning rules · cure path
```

### The canonical frame

Every source — a US government loan file, a synthetic Indian book, a bank sandbox feed —
is mapped by a small adapter into one shape:

```
loan_id · segment · origination_date · default_12m  (+ features)
```

Nothing downstream knows where the rows came from. Swapping the data source is an
adapter, not a rewrite. [`src/framework/schema.py`](src/framework/schema.py) enforces the
contract and fails loudly on violation, including a guard against any feature whose name
suggests it already knows the outcome.

### The interpretation framework

One probability becomes six things every book shares
([`src/framework/interpretation.py`](src/framework/interpretation.py)):

| Output | Example |
|---|---|
| Risk grade | RG1 (safest) … RG10 |
| RAG bucket | Green / Amber / Red |
| Watch bucket | Standard / SMA-0 / SMA-1 / SMA-2 |
| Action | "Enhanced monitoring; request updated stock and GST statements" |
| Owner + cadence | Credit analyst, monthly |
| Expected credit loss | PD × LGD × exposure |

A factory loan and a personal loan both come out as, say, *RG6 / Amber / SMA-0 watch /
₹1.2L*, so a committee can rank them side by side. That is what "consistent, comparable
and actionable" means in practice.

### Models

- **LightGBM + CatBoost blend**, Optuna-tuned, isotonic-calibrated. The blend weight is
  chosen on validation AUC and never allowed to reach an endpoint, so reason codes stay
  meaningful.
- **Monotone constraints** where credit intuition is unambiguous — more bounced payments
  can never lower the predicted risk.
- **Discrete-time hazard model** for the PD term structure, so the output is an expected
  stress month rather than only a 12-month number.
- **TabPFN** for thin segments, distilled into a LightGBM student that keeps the lift at
  production latency.

### Explainability and governance

Reason codes on a fixed taxonomy, deterministic early-warning rules run beside the model,
counterfactual recourse, a disparate-impact fairness audit, PSI drift receipts on every
training run, and an append-only human-in-the-loop decision trail.

---

## Setup

```bash
uv venv --python 3.12 && uv sync
```

**Two of the five books need nothing else.** `msme_india` and `msme_idbi` are generated
locally and deterministically from a fixed seed, so a fresh clone can train and score
them immediately.

The other three — SBA, Home Credit and Give Me Some Credit — are public Kaggle datasets,
so the first run of those pipelines needs Kaggle credentials at `~/.kaggle/kaggle.json`
(or the `KAGGLE_USERNAME` / `KAGGLE_KEY` environment variables). Without them those three
pipelines will fail on the download step; the rest of the repo is unaffected.

`data/` is not committed. Every pipeline rebuilds what it needs and caches the result as
parquet under `data/processed/`.

## Running

```bash
# train a book
uv run python -m src.pipelines.run_india
uv run python -m src.pipelines.run_sba
uv run python -m src.pipelines.run_homecredit
uv run python -m src.pipelines.run_gmsc

# timing, routing, distillation
uv run python -m src.pipelines.run_survival
uv run python -m src.pipelines.run_routing
uv run python -m src.pipelines.run_distill

# threshold tables and the results page
uv run python -m src.pipelines.run_operating_points
uv run python -m src.pipelines.make_results

# score a portfolio file
uv run python -m src.pipelines.score_batch --input data/processed/msme_india.parquet --segment msme_india

# refresh the data the console reads, after retraining
uv run python -m src.pipelines.make_ui_snapshot
```

Artifacts land under `models_store/<segment>/` — the model bundle, `metrics.json` with
PSI drift receipts, and the calibration, capture and ablation plots.

## Serving

```bash
uv run uvicorn src.serving.api:app --port 8000   # scoring API
cd web && npm install && npm run dev             # controlling-office console
```

The API exposes `GET /health`, `GET /segments`, `POST /score`, `POST /score/{segment}`
and `POST /score/batch`. Responses carry the probability, grade, watch bucket, action,
expected loss, early-warning triggers and reason codes.

The console reads a precomputed snapshot by default, so it runs with nothing else up, and
re-scores live against the API when it is reachable.

## Docker

```bash
docker build -t drishti .
docker run -p 8000:8000 drishti
docker compose up
```

## Tests

```bash
uv run pytest -q
```

---

## Layout

```
src/ingestion     source adapters and the synthetic book generator
src/framework     the canonical contract and the interpretation framework
src/features      per-book feature engineering, note extraction, graph and macro overlays
src/models        trainer, blend, calibration, survival, routing
src/eval          metrics, operating points, drift, reporting
src/explain       reason codes, early-warning rules, recourse, fairness, audit trail
src/serving       segment registry, coverage gate, scorer, API
src/pipelines     one runnable pipeline per book, plus batch scoring and reporting
web/              React console for the controlling office
tests/            regression suite
docs/             results, architecture, model-risk note
```

---

## Honest notes

- The **India book is synthetic**, generated from borrower attributes to a latent risk
  score to a label, calibrated to published MSME stress rates. It demonstrates that the
  pipeline extracts real lift from these data layers; it does not establish real-world
  default levels. The other three books are public datasets with real outcomes.
- The **SBA label is lifetime charge-off**, not a true 12-month event. The survival model
  corrects for this by evaluating against a 12-month label built from charge-off dates —
  dates that are never used as features.
- **Origination-year macro features were tried and reverted.** Under a chronological split
  they are near-constant in the test years and proxy vintage default waves, costing about
  3 AUC points. They remain in the scenario engine, where they belong.
- **Currency units are labelled per book** (USD / CU / INR). Discrimination is reported on
  raw scores and calibration on calibrated probabilities, since isotonic calibration
  introduces ties that understate ranking.
- Independent validation and back-testing would be required before any production use.
