# Architecture — DRISHTI (IDBI PS4 Loan Stress Engine)

## System flow

```mermaid
flowchart LR
    subgraph Ingest
        K[Kaggle SBA / Home Credit / GMSC<br/>synthetic India MSME / IDBI export] --> AD[Segment adapter]
        NT[Loan-officer notes] --> NX[Note-signal extractor<br/>keyword now, LLM-pluggable]
        GST[GST / AA feeds<br/>supplier graph] --> AD
        NX --> AD
        AD --> C[(Canonical schema<br/>loan_id, segment,<br/>origination_date, default_12m, features)]
    end
    subgraph Model
        C --> FE[Feature engineering<br/>macro + notes + graph]
        FE --> RT{Segment size?}
        RT -->|large| GB[LightGBM + CatBoost blend<br/>Optuna, monotone, isotonic]
        RT -->|small / new| TP[TabPFN router<br/>+ distilled student]
        GB --> PD[Calibrated PD]
        TP --> PD
        FE --> HZ[Discrete-time hazard<br/>PD term structure]
    end
    subgraph Interpretation
        PD --> GR[Risk grade RG1–RG10]
        GR --> SMA[SMA watch bucket]
        SMA --> ACT[Action playbook]
        PD --> ECL[Expected credit loss]
    end
    subgraph Explain
        GB --> SHAP[SHAP reason codes]
        FE --> EWS[RBI EWS rules]
        PD --> REC[Counterfactual recourse]
        GB --> FAIR[Fairness audit]
        SHAP --> MEMO[LLM / template credit memo]
    end
    ACT --> API[[FastAPI /score]]
    ECL --> API
    MEMO --> API
    EWS --> API
    API --> LOS[LOS / EWS / collections]
    ACT --> COCK[Controlling-office console]
```

## The canonical schema is the IDBI-swappable seam

Every dataset (SBA / Home Credit / GMSC / synthetic India today, IDBI sandbox
tomorrow) is mapped by a thin **adapter** into one contract: `loan_id, segment,
origination_date, default_12m` + features. Everything downstream — features,
models, framework, serving — is unchanged when IDBI data replaces the public
data. New segments register in `src/config.py` + `src/serving/segments.py`.

## India MSME data plane (synthetic now, AA/GST live later)

```mermaid
flowchart LR
    G[GST returns<br/>filing delay, turnover trend, ITC] --> F[India feature groups]
    B[Bank statements via AA<br/>bounces, volatility, balance trend] --> F
    CB[Bureau<br/>CMR, enquiries, vintage] --> F
    N[Officer notes] -->|keyword / LLM extraction| F
    SG[Supplier graph<br/>GST e-invoice + MCA directors] -->|neighbour stress aggregates| F
    F --> M[Monotone LightGBM]
    M --> AB[Ablation staircase:<br/>structured → +cash-flow → +notes → +graph]
```

## Model routing

```mermaid
flowchart TD
    S[Segment to score] --> Q{Training rows available}
    Q -->|>= ~300| L[Calibrated LightGBM<br/>workhorse for large books]
    Q -->|< ~300 / new product| T[TabPFN foundation model<br/>strong in low-data regime]
    L --> O[Unified calibrated PD]
    T --> O
```

## Deployment topology

```mermaid
flowchart LR
    Client[Core banking / LOS / EWS] -->|REST JSON| API[FastAPI container :8000]
    API --> M[(model.pkl bundle<br/>preprocessor + LightGBM + isotonic)]
    Batch[Nightly batch job] --> SB[score_batch] --> DW[(Scored portfolio parquet)]
    Analyst[Risk analyst] --> Console[Web console :8080]
    Console --> M
```

- **Real-time**: `POST /score` for underwriting / monitoring hooks.
- **Batch**: `score_batch` for nightly portfolio re-scoring → watchlists + ECL.
- **Human**: the console for drill-down, scenarios and model health.

## AWS Production Solution Architecture

The system is optimized for IDBI Bank's AWS sandbox environment (`ap-south-1`) across compute, storage, security, and observability tiers:

```mermaid
flowchart TB
    subgraph EXT["External Systems & Consumers"]
        direction LR
        LOS["Core Banking / LOS / Collections\n(Real-time scoring hook)"]
        RISK["Controlling Office / Risk Managers
(Web console :8080)"]
        PORTAL["Bank sandbox portal"]
    end

    subgraph AWS["IDBI AWS Cloud Environment (Region: ap-south-1)"]
        direction TB

        subgraph EDGE["Perimeter & Ingress"]
            WAF["AWS WAF + Shield\n(Allowlist: team egress CIDR)"]
            ALB["Application Load Balancer (ALB)\n(TLS termination, path-based routing)"]
            WAF --> ALB
        end

        subgraph ECS_CLUSTER["Container Serving Layer (ECS Fargate)"]
            direction LR
            API["FastAPI Scorer Service\n1–2 vCPU / 4–8 GB\n(:8000 · autoscale 2–4 tasks)"]
            CONSOLE["Controlling-office web console
1-2 vCPU / 4-8 GB
(:8080)"]
            BATCH["Nightly score_batch Task\n2 vCPU / 8 GB (Fargate)\n(1–2 hrs nightly execution)"]
        end

        subgraph SM["Optional SageMaker Real-Time Endpoint"]
            SM_EP["SageMaker Endpoint\n(ml.m5.large · msme_india segment)"]
        end

        subgraph COMPUTE_EC2["Model Training & Refinement Layer (EC2)"]
            EC2_TR["EC2 Training Worker\n1× m5.2xlarge / c5.2xlarge\n8 vCPU / 16–32 GB RAM\n(Optuna, TabPFN, survival, ablations)"]
            EC2_GPU["Optional 1× g4dn.xlarge\n(FinBERT note-sentiment fine-tuning)"]
        end

        subgraph STORAGE["Persistence & Data Lake Layer"]
            direction LR
            RDS[("Amazon RDS PostgreSQL\n(db.t3.micro → db.t3.small)\nHITL decisions, watchlist metadata,\nPSI drift & fairness audit history")]
            S3[("Amazon S3 Bucket (100–200 GB)\nraw sandbox extracts, processed parquet,\nmodel bundles (1–2 GB), scored portfolios")]
            ECR[("Amazon ECR (10–20 GB)\nidbi-ps4-risk-engine container images")]
        end

        subgraph MGMT["Observability & Automation"]
            direction LR
            CW["CloudWatch Logs & Metrics\n(PSI > 0.25 drift alarm)"]
            EB["EventBridge Scheduler\n(Nightly 01:00 cron trigger)"]
            SMGR["AWS Secrets Manager\n(Database credentials & API keys)"]
        end
    end

    LOS -->|HTTPS REST| WAF
    RISK -->|HTTPS| WAF
    ALB -->|/score · /health| API
    ALB -->|/console| CONSOLE
    EB -->|Trigger nightly run| BATCH

    ECR -.->|Pull images| ECS_CLUSTER
    SMGR -.->|Inject secrets| ECS_CLUSTER
    SMGR -.->|Inject secrets| COMPUTE_EC2

    PORTAL -.->|Extract Finacle JSONs| BATCH
    PORTAL -.->|Extract Finacle JSONs| EC2_TR

    API -->|Read model bundle| S3
    CONSOLE -->|Read scored portfolios| S3
    BATCH -->|Load canonical parquet| S3
    BATCH -->|Write scored portfolios| S3
    EC2_TR -->|Read parquet / write model.pkl| S3

    API -->|Log HITL decisions| RDS
    CONSOLE -->|Read/write HITL audit trail| RDS
    BATCH -->|Record execution stats & PSI| RDS

    API -.->|Emit metrics| CW
    BATCH -.->|Emit PSI & ECL metrics| CW
    CW -.->|Drift alert trigger| RISK

    LOS -.->|Direct inference| SM_EP
    SM_EP -->|Read model.pkl| S3
```

---

## End-to-End Data Flow Architecture

The data pipeline enforces the canonical schema seam with strict zero-leakage guards from Finacle sandbox APIs through to controlling office decisioning:

```mermaid
flowchart TB
    subgraph S1["1. Raw Data Extraction & Multi-Source Ingestion"]
        direction TB
        F_402["API 402 getLoanOverdueDetails\n(NPA status, DPD, overdue amount)"]
        F_404["API 404 getLoanOverduePosition\n(Demanded vs collected principal/interest)"]
        F_391["API 391 getLoanAccountDetails\n(Origination date, ticket, restructuring flag)"]
        F_441["API 441 fetchLoanAccountLimits\n(Drawing power, sanction limit gap)"]
        F_362["API 362 accountLienEnquiry\n(Lien flag, encumbrances)"]
        F_408["API 408 fetchCibilScore\n(CIBIL score, credit history)"]
        ALT_DATA["GST Returns + Account Aggregator\n(filing delay, turnover trend, cash flow volatility)"]
        UNSTR["Loan Officer Free-Text Notes\n(disputes, promises, disruption keywords)"]
    end

    subgraph S2["2. Canonical Schema Seam & Zero-Leakage Guard"]
        direction TB
        ADAPTER["src/ingestion/idbi_adapter.py\n(Raw Finacle JSON → Canonical Frame)"]
        SCHEMA["Canonical Contract Validation\nloan_id · segment · origination_date · default_12m"]
        LEAK_GUARD["assert_no_leakage()\n(Excludes charge-off dates & outcome tokens)"]
        ADAPTER --> SCHEMA --> LEAK_GUARD
    end

    subgraph S3["3. Feature Engineering & Multi-Source Synthesis"]
        direction TB
        FE_BASE["Base Bureau & Profile Features\n(ticket_size, tenure, CMR, vintage, spread)"]
        FE_CASH["Cashflow & Liquidity Signals\n(GST delay, turnover trend, bounce count, DP gap)"]
        FE_NLP["Unstructured Note NLP Signals\n(promise broken, litigation, business disruption)"]
        FE_GRAPH["Supplier-Network Contagion Signals\n(neighbour stress score, supplier bounce share)"]
        FE_MATRIX["Model-Ready Feature Frame (27 Features)\nsrc/features/india_features.py"]
        FE_BASE --> FE_MATRIX
        FE_CASH --> FE_MATRIX
        FE_NLP --> FE_MATRIX
        FE_GRAPH --> FE_MATRIX
    end

    subgraph S4["4. Predictive ML Risk Engine & Model Routing"]
        direction TB
        ROUTER{"Portfolio Segment & Sample Size?"}
        LGBM["Monotone LightGBM Classifier\n(Encodes credit logic: bounces↑ → PD↑)"]
        TABPFN["TabPFN Router + Distilled Student\n(Low-data / new MSME products < 300 rows)"]
        ISO_CAL["Isotonic Calibrator (sklearn)\n(Calibrated 12-Month Probability of Default)"]
        HAZARD["Discrete-Time Survival Hazard Model\n(Onset month & term structure curve)"]
        ROUTER -->|Primary Segments| LGBM --> ISO_CAL
        ROUTER -->|Low-Data Regimes| TABPFN --> ISO_CAL
        ISO_CAL --> HAZARD
    end

    subgraph S5["5. Common Interpretation Framework & Explainability"]
        direction TB
        GRADE["10-Grade Scale (RG1 to RG10)\nRG1–4: Green · RG5–7: Amber · RG8–10: Red"]
        SMA["RBI SMA Watch Classification\nStandard · SMA-0 · SMA-1 · SMA-2"]
        PLAYBOOK["Prescriptive Action Playbook\n(Immediate inspection, review cadence, owner)"]
        ECL["Expected Credit Loss (ECL)\nECL = PD × EAD × LGD (INR ₹)"]
        SHAP["SHAP Attribution Reason Codes\n(Top-6 drivers with human-readable domain tags)"]
        EWS["17 RBI Early Warning Signals (EWS)\n(Statutory delays, liens, bounces, restructuring)"]
        POLICY["Policy vs Model Cross-Check\n(Highlights model vs rule-based conflicts)"]
    end

    subgraph S6["6. Storage, Serving & Decision Operations"]
        direction TB
        RDS_STORE[("Amazon RDS PostgreSQL\n(HITL decisions, watchlist metadata, PSI drift)")]
        S3_STORE[("Amazon S3 Bucket\n(Nightly scored portfolios, model bundles)")]
        REST_API["FastAPI Real-Time Service (:8000)\nPOST /score · POST /score/msme_idbi"]
        UI_CONSOLE["Controlling-office web console
(Portfolio watchlist, branch rollups, what-if)"]
        CORE_LOS["Core Banking / LOS / Collections\n(Automated credit memo & loan monitoring)"]
    end

    F_402 --> ADAPTER
    F_404 --> ADAPTER
    F_391 --> ADAPTER
    F_441 --> ADAPTER
    F_362 --> ADAPTER
    F_408 --> ADAPTER
    ALT_DATA --> ADAPTER
    UNSTR --> ADAPTER

    LEAK_GUARD --> FE_BASE
    LEAK_GUARD --> FE_CASH
    LEAK_GUARD --> FE_NLP
    LEAK_GUARD --> FE_GRAPH

    FE_MATRIX --> ROUTER

    ISO_CAL --> GRADE
    GRADE --> SMA --> PLAYBOOK
    ISO_CAL --> ECL
    LGBM --> SHAP
    FE_MATRIX --> EWS
    GRADE --> POLICY
    EWS --> POLICY

    PLAYBOOK --> REST_API
    ECL --> REST_API
    SHAP --> REST_API
    EWS --> REST_API
    POLICY --> REST_API

    REST_API --> CORE_LOS
    REST_API --> UI_CONSOLE
    REST_API --> RDS_STORE

    ISO_CAL --> S3_STORE
    S3_STORE --> UI_CONSOLE
    RDS_STORE --> UI_CONSOLE
```

---

## Compute & Storage Sizing / Cost Breakdown

| Component | AWS Resource | Sizing & Configuration | Role & Usage Pattern | Estimated Monthly Cost |
|---|---|---|---|---|
| **Training & Refinement** | EC2 `m5.2xlarge` / `c5.2xlarge` | 8 vCPU, 16–32 GB RAM (Spot / On-Demand) | Optuna retrain, feature ablation, TabPFN distillation, sandbox adapter (~40–80 hrs/mo) | ~$15 – $35 / month |
| **GPU Refinement (Opt)** | EC2 `g4dn.xlarge` | 4 vCPU, 16 GB RAM, 1× NVIDIA T4 (16 GB) | FinBERT officer note sentiment fine-tuning (~10–20 hrs/mo) | ~$5 – $12 / month |
| **Real-Time API Serving** | ECS Fargate | 1–2 vCPU, 4–8 GB (autoscale 1–4 tasks) | Core banking LOS/EWS real-time scoring (`POST /score`), p95 < 25ms | ~$25 – $50 / month |
| **Console serving** | ECS Fargate | 1-2 vCPU, 4-8 GB (1 task) | Controlling-office React console (:8080) | ~$25 - $50 / month |
| **Nightly Batch Task** | ECS Fargate (Task) | 2 vCPU, 8 GB | EventBridge-triggered portfolio batch scoring (`score_batch`, ~1–2 hrs/night) | ~$5 – $10 / month |
| **SageMaker Endpoint (Opt)** | SageMaker `ml.m5.large` | 2 vCPU, 8 GB | Dedicated real-time endpoint for India MSME segment demo | ~$85 / month (or spin-down) |
| **Relational Database** | Amazon RDS PostgreSQL | `db.t3.micro` → `db.t3.small` (20–50 GB gp3) | HITL audit trail, scored watchlist metadata, PSI/fairness run history | ~$15 – $30 / month |
| **Object Storage** | Amazon S3 Standard | 100–200 GB | Raw sandbox extracts, Parquet feature store, model bundles (~1–2 GB), scored portfolios | ~$3 – $5 / month |
| **Container Registry** | Amazon ECR | 10-20 GB | Immutable versioned container images for the API and batch tasks | ~$1 - $2 / month |
| **Observability** | Amazon CloudWatch | Standard logs & metric alarms | Application logs, API latency, PSI drift alarms (trigger at PSI > 0.25) | ~$5 / month |
| **Total Deployment Cost** | — | — | **Fully managed, auto-scaling, production bank grade** | **~$95 – $190 / month** |

---

## Governance & Compliance Hooks

- **Isotonic Calibration**: Monotone reliability mapping ensures reported PD matches empirical default frequency.
- **SHAP Reason Codes + RBI EWS Triggers**: Every account delivers auditable top-6 drivers plus 17 RBI Fraud Risk Master Direction indicators.
- **Fairness Audit**: 4/5ths disparate-impact rule verification per protected demographic attribute.
- **Monotone Constraints**: Credit domain monotonicity enforced at training (higher bounces or higher DP erosion strictly increases default probability).
- **Automated Drift (PSI) Monitoring**: CloudWatch & RDS alert automatically triggers recalibration when PSI > 0.25.

