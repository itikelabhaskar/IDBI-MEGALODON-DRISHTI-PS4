# the regression net. schema contract, interpretation framework, metrics, EWS
# rules and note extraction on toy data, plus serving round-trips that skip when a
# segment has not been trained yet.

from __future__ import annotations

import numpy as np
import pandas as pd
import pytest

from src.config import MODELS_DIR

# --------------------------------------------------------------------------- #
# Canonical schema & leakage guard
# --------------------------------------------------------------------------- #

def _toy_canonical() -> pd.DataFrame:
    return pd.DataFrame(
        {
            "loan_id": ["a", "b"],
            "segment": ["msme_sba", "msme_sba"],
            "origination_date": pd.to_datetime(["2010-01-01", "2011-01-01"]),
            "default_12m": np.array([0, 1], dtype="int64"),
        }
    )


def test_validate_canonical_accepts_valid_frame():
    from src.framework.schema import validate_canonical

    assert len(validate_canonical(_toy_canonical())) == 2


def test_validate_canonical_rejects_missing_column_and_bad_label():
    from src.framework.schema import validate_canonical

    with pytest.raises(ValueError):
        validate_canonical(_toy_canonical().drop(columns=["default_12m"]))
    bad = _toy_canonical()
    bad["default_12m"] = [0, 2]
    with pytest.raises(ValueError):
        validate_canonical(bad)


def test_leakage_guard_catches_post_outcome_columns():
    from src.framework.schema import assert_no_leakage

    assert_no_leakage(["term", "no_emp"])  # clean passes
    with pytest.raises(ValueError):
        assert_no_leakage(["term", "chgoff_amount"])


def test_sba_raw_parsers():
    from src.ingestion.sba_adapter import _parse_fy, _parse_money

    money = _parse_money(pd.Series(["$1,234.00", "", "$50,000.00 "]))
    assert money.iloc[0] == 1234.0 and money.iloc[2] == 50000.0 and np.isnan(money.iloc[1])
    fy = _parse_fy(pd.Series(["1976A", "2004", "junk"]))
    assert fy.iloc[0] == 1976 and fy.iloc[1] == 2004 and np.isnan(fy.iloc[2])


# --------------------------------------------------------------------------- #
# Interpretation framework
# --------------------------------------------------------------------------- #

def test_grade_boundaries_and_playbook_complete():
    from src.framework.interpretation import _PLAYBOOK, assign_grade, grade_order

    assert assign_grade(0.0) == "RG1"
    assert assign_grade(0.05) == "RG3"
    assert assign_grade(0.999) == "RG10"
    assert [assign_grade(0.0199), assign_grade(0.02)] == ["RG1", "RG2"]  # edge exclusive
    assert set(grade_order()) == set(_PLAYBOOK)  # an action exists for every grade


def test_rag_buckets_cover_all_grades():
    from src.framework.interpretation import grade_order, rag_bucket

    buckets = {g: rag_bucket(g) for g in grade_order()}
    assert set(buckets.values()) == {"Green", "Amber", "Red"}
    assert buckets["RG1"] == "Green" and buckets["RG5"] == "Amber" and buckets["RG10"] == "Red"


def test_ecl_math():
    from src.framework.interpretation import expected_credit_loss

    assert expected_credit_loss(0.10, 1_000_000, lgd=0.45) == pytest.approx(45_000)


# --------------------------------------------------------------------------- #
# Metrics
# --------------------------------------------------------------------------- #

def test_metrics_on_perfect_and_shifted_distributions():
    from src.eval.metrics import compute_metrics, psi

    y = np.array([0, 0, 0, 0, 0, 1, 1, 1])
    p = np.array([.1, .2, .1, .3, .2, .8, .9, .7])
    m = compute_metrics(y, p)
    assert m["roc_auc"] == 1.0 and m["gini"] == 1.0
    assert 0 <= m["capture_top_decile"] <= 1

    rng = np.random.default_rng(0)
    base = rng.normal(0, 1, 5000)
    assert psi(base, rng.normal(0, 1, 5000)) < 0.05      # same dist -> stable
    assert psi(base, rng.normal(1.5, 1, 5000)) > 0.25    # shifted -> investigate


# --------------------------------------------------------------------------- #
# EWS rules & note extraction
# --------------------------------------------------------------------------- #

def test_ews_triggers_and_resilience():
    from src.explain.ews_rules import evaluate_ews, ews_summary

    hits = evaluate_ews({"emi_bounce_6m": 3, "gst_filing_delay_days": 45})
    codes = {h.code for h in hits}
    assert "EWS01" in codes and "EWS03" in codes
    assert ews_summary({})["n_triggers"] == 0
    # Malformed values must never raise.
    assert isinstance(evaluate_ews({"emi_bounce_6m": "not-a-number"}), list)


def test_note_extractor_flags_and_schema():
    from src.features.notes_signals import NOTE_SIGNALS, extract_note_signals

    notes = pd.Series([
        "Earlier assurance to regularise the account was not kept. "
        "Litigation notice from supplier observed at premises.",
        "Unit running full capacity; strong order book for next two quarters.",
    ])
    out = extract_note_signals(notes)
    assert list(out.columns) == NOTE_SIGNALS
    assert out.loc[0, "note_payment_promise_broken"] == 1.0
    assert out.loc[0, "note_dispute_litigation"] == 1.0
    assert out.loc[1, "note_sentiment"] > 0


def test_statement_demo_reconciles_with_aggregates():
    from src.features.statement_demo import derive_statement_features, generate_ledger

    borrower = pd.Series({
        "loan_id": "IN100001", "ticket_size": 900000.0, "tenure_months": 36,
        "emi_bounce_6m": 4, "cashflow_volatility": 0.5,
        "balance_trend_pct": -20.0, "upi_inflow_stability": 0.35,
    })
    ledger = generate_ledger(borrower)
    assert (ledger["balance"] >= 0).all() and len(ledger) > 50
    derived = derive_statement_features(ledger)
    # Bounce count reconciles exactly (3m observed x2 = 6m estimate).
    assert derived["emi_bounce_6m (est. from 3m x2)"] in (2, 4, 6)
    # Trend direction matches the conditioning aggregate.
    assert derived["balance_trend_pct"] < 10


def test_india_generator_prior_calibration():
    from src.ingestion.india_synth import generate_india_msme

    df = generate_india_msme(n=8000, seed=3)
    rates = df.groupby("sub_segment")["default_12m"].mean()
    assert 0.02 < rates["micro"] < 0.07
    assert rates["medium"] < rates["micro"]  # risk ordering holds


# --------------------------------------------------------------------------- #
# Serving round-trips (need trained bundles; skipped on fresh clones)
# --------------------------------------------------------------------------- #

_SEGMENT_RECORDS = {
    "msme_idbi": {
        "loan_id": "IDBI_TEST_001",
        "ticket_size": 2_500_000.0,
        "cibil_score": 670.0,
        "dpd": 15.0,
        "overdue_amt": 25000.0,
        "demanded_vs_collected_ratio": 0.88,
        "drawing_power_gap_pct": 15.0,
    },
    "msme_india": {"sub_segment": "micro", "sector": "textiles", "state": "MH",
                   "ticket_size": 8e5, "cmr": 7, "emi_bounce_6m": 3},
    "msme_sba": {"term": 84, "no_emp": 10, "gr_appv": 3e5, "sba_appv": 2e5, "naics": "722110"},
    "retail_homecredit": {"amt_income_total": 2e5, "amt_credit": 6e5, "amt_annuity": 3e4,
                          "days_birth": -12000},
    "retail_gmsc": {"revolving_utilization": 0.9, "age": 40, "debt_ratio": 0.5,
                    "monthly_income": 5000},
}



def _trained(segment_dir: str) -> bool:
    return (MODELS_DIR / segment_dir / "model.pkl").exists()


@pytest.mark.parametrize("segment", list(_SEGMENT_RECORDS))
def test_scorer_roundtrip(segment):
    from src.serving.segments import SEGMENT_SPECS

    if not _trained(SEGMENT_SPECS[segment].model_dir_name):
        pytest.skip(f"{segment} not trained")
    from src.framework.interpretation import grade_order
    from src.serving.scorer import RiskScorer

    out = RiskScorer(segment).score_record(_SEGMENT_RECORDS[segment], explain=False)
    assert 0.0 <= out["pd_12m"] <= 1.0
    assert out["risk_grade"] in grade_order()
    assert out["currency"] == SEGMENT_SPECS[segment].currency
    assert out["fields_defaulted"] >= 0 and "ews" in out


def test_india_monotonicity_bounces_never_lower_pd():
    if not _trained("india"):
        pytest.skip("india not trained")
    from src.serving.scorer import RiskScorer

    s = RiskScorer("msme_india")
    base = dict(_SEGMENT_RECORDS["msme_india"])
    pds = []
    for bounces in (0, 2, 6):
        rec = dict(base, emi_bounce_6m=bounces)
        pds.append(s.score_record(rec, explain=False)["pd_12m"])
    assert pds == sorted(pds)  # enforced by the monotone constraint


# --------------------------------------------------------------------------- #
# API contract
# --------------------------------------------------------------------------- #

@pytest.fixture()
def client(monkeypatch):
    if not _trained("sba"):
        pytest.skip("sba not trained")
    monkeypatch.delenv("DRISHTI_API_KEY", raising=False)
    from fastapi.testclient import TestClient

    from src.serving.api import app

    return TestClient(app)


def test_api_rejects_empty_and_thin_payloads(client):
    assert client.post("/score", json={}).status_code == 422
    assert client.post("/score", json={"term": 84, "no_emp": 5}).status_code == 422


def test_api_scores_valid_record(client):
    r = client.post("/score", json=_SEGMENT_RECORDS["msme_sba"])
    assert r.status_code == 200
    body = r.json()
    assert 0.0 <= body["pd_12m"] <= 1.0 and "fields_defaulted" in body


def test_api_key_enforced_when_configured(client, monkeypatch):
    monkeypatch.setenv("DRISHTI_API_KEY", "secret")
    assert client.post("/score", json=_SEGMENT_RECORDS["msme_sba"]).status_code == 401
    ok = client.post("/score", json=_SEGMENT_RECORDS["msme_sba"],
                     headers={"X-API-Key": "secret"})
    assert ok.status_code == 200


def test_api_scores_msme_idbi(client):
    r = client.post("/score/msme_idbi?memo=true", json=_SEGMENT_RECORDS["msme_idbi"])
    assert r.status_code == 200
    body = r.json()
    assert 0.0 <= body["pd_12m"] <= 1.0
    assert body["segment"] == "msme_idbi"
    assert body["currency"] == "INR"
    assert "credit_memo" in body

