# account aggregator payloads parse into the cash-flow features the model expects.

import pytest
from src.ingestion.aa_parser import parse_aa_statement, extract_transactions


def test_empty_statement_fallback():
    res = parse_aa_statement({})
    assert "emi_bounce_6m" in res
    assert res["emi_bounce_6m"] == 0.0
    assert res["cashflow_volatility"] == 0.25
    assert res["circular_tx_flag"] == 0


def test_sahamati_onemoney_schema_with_bounces():
    payload = {
        "Account": {
            "Transactions": {
                "Transaction": [
                    {
                        "transactionTimestamp": "2025-01-05T10:00:00Z",
                        "amount": "150000",
                        "currentBalance": "350000",
                        "type": "CREDIT",
                        "narration": "UPI / Vendor Payment received",
                    },
                    {
                        "transactionTimestamp": "2025-01-15T14:30:00Z",
                        "amount": "45000",
                        "currentBalance": "305000",
                        "type": "DEBIT",
                        "narration": "NACH RET / INSUFFICIENT FUNDS",
                    },
                    {
                        "transactionTimestamp": "2025-02-05T10:00:00Z",
                        "amount": "140000",
                        "currentBalance": "445000",
                        "type": "CREDIT",
                        "narration": "Customer settlement",
                    },
                    {
                        "transactionTimestamp": "2025-02-15T14:30:00Z",
                        "amount": "45000",
                        "currentBalance": "400000",
                        "type": "DEBIT",
                        "narration": "ECS RETURN CHG",
                    },
                ]
            }
        }
    }
    res = parse_aa_statement(payload)
    assert res["emi_bounce_6m"] >= 2.0
    assert res["amb_l3m"] > 0
    assert res["inflow_outflow_ratio"] > 1.0


def test_finacle_393_schema():
    payload = {
        "result": {
            "statementRecords": [
                {
                    "txnDate": "2025-01-01",
                    "txnAmount": 200000,
                    "acctBal": 500000,
                    "drCrIndicator": "CR",
                    "txnDesc": "NEFT Inward remittance",
                },
                {
                    "txnDate": "2025-01-10",
                    "txnAmount": 100000,
                    "acctBal": 400000,
                    "drCrIndicator": "DR",
                    "txnDesc": "Operational vendor payout",
                },
            ]
        }
    }
    txs = extract_transactions(payload)
    assert len(txs) == 2
    res = parse_aa_statement(payload)
    assert res["amb_l3m"] > 0
    assert res["emi_bounce_6m"] == 0.0

