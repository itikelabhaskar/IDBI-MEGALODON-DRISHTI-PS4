# Narmada walkthrough — 90 seconds

**Borrower:** Narmada Precision Components (`NARMADA-001`) · India MSME · auto components · Gujarat

## Path

1. **Portfolio** — confirm segment `MSME — India`; note RAG mix and ECL.
2. **Borrower** — select `NARMADA-001` (or sidebar **Load Narmada walkthrough** if not in sample).
3. **Hero** — PD, RG, SMA, stress horizon; read estimated vs hazard caption if shown.
4. **Model ‖ Policy** — taxonomy reason codes (GST, repayment, notes); EWS triggers vs green PD if policy fires.
5. **Contagion evidence** — one-line upstream stress if material.
6. **Stress lab** — slide GST delay / bounces; watch PD, grade, ECL re-score live.
7. **Cure path** — primary lever with PD and ECL delta.
8. **HITL** — **Accept** proposed playbook (or Override with reason); open audit trail expander.
9. **Governance** — recent HITL decisions table.

## Story

Structured profile looks moderate (CMR 4, decent vintage). GST delay + bounces + officer note flip the model and policy panels — the case shows **governance ≠ raw PD** and the full RG → SMA → playbook chain.

## Commands

```bash
cd web && npm run dev
uv run python -m src.pipelines.make_bench_card   # opens docs/bench_card.html
uv run pytest tests/test_p1_*.py -q
```
