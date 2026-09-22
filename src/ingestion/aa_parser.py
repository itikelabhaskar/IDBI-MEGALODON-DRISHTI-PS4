# parses account aggregator bank statement payloads into the cash-flow features
# the model expects. runs on real AA json as-is once the feed is live.

from __future__ import annotations

from datetime import datetime
from typing import Any, Mapping, Sequence
import numpy as np
import pandas as pd


# Bounce keywords typical in Indian banking statement narrations
_BOUNCE_KEYWORDS = (
    "RETURN",
    "BOUNCE",
    "ECS RET",
    "NACH RET",
    "INSUFFICIENT",
    "CHQ RET",
    "UNPAID",
    "ECS REJECT",
)


def _safe_float(val: Any, default: float = 0.0) -> float:
    try:
        if val is None or str(val).strip() == "":
            return default
        return float(val)
    except (ValueError, TypeError):
        return default


def _parse_timestamp(val: Any) -> pd.Timestamp:
    if isinstance(val, (datetime, pd.Timestamp)):
        return pd.to_datetime(val)
    if isinstance(val, (int, float)):
        # Millisecond timestamp
        return pd.to_datetime(val, unit="ms" if val > 1e11 else "s")
    try:
        return pd.to_datetime(str(val))
    except Exception:
        return pd.Timestamp.now()


def extract_transactions(payload: Mapping[str, Any] | Sequence[Any]) -> list[dict[str, Any]]:
    if isinstance(payload, list):
        return [r for r in payload if isinstance(r, dict)]

    if not isinstance(payload, dict):
        return []

    # 1. Sahamati AA structure
    account = payload.get("Account") or payload.get("account")
    if isinstance(account, dict):
        tx_node = account.get("Transactions") or account.get("transactions")
        if isinstance(tx_node, dict):
            tx_list = tx_node.get("Transaction") or tx_node.get("transaction")
            if isinstance(tx_list, list):
                return tx_list

    # 2. Finacle API 393 structure
    result = payload.get("result") if isinstance(payload.get("result"), dict) else payload
    for key in ("statementRecords", "statementDetails", "transactions", "acctStmtList", "records"):
        candidate = result.get(key)
        if isinstance(candidate, list):
            return candidate

    return []


def parse_aa_statement(payload: Mapping[str, Any] | Sequence[Any]) -> dict[str, float]:
    raw_txs = extract_transactions(payload)
    if not raw_txs:
        return {
            "emi_bounce_6m": 0.0,
            "cashflow_volatility": 0.25,
            "balance_trend_pct": 0.0,
            "upi_inflow_stability": 0.70,
            "amb_l3m": 0.0,
            "mmb_l3m": 0.0,
            "inflow_outflow_ratio": 1.0,
            "circular_tx_flag": 0,
        }

    records = []
    for tx in raw_txs:
        # Extract fields tolerant to AA vs Finacle key conventions
        dt_val = tx.get("transactionTimestamp") or tx.get("date") or tx.get("txnDate") or tx.get("valueDate")
        amt_val = _safe_float(tx.get("amount") or tx.get("txnAmount") or tx.get("amountValue"))
        bal_val = _safe_float(tx.get("currentBalance") or tx.get("balance") or tx.get("acctBal"))
        
        # Narration
        narration = str(tx.get("narration") or tx.get("txnDesc") or tx.get("description") or "").upper()
        
        # Type: Credit vs Debit
        tx_type = str(tx.get("type") or tx.get("txnType") or tx.get("drCrIndicator") or "").strip().upper()
        is_credit = tx_type in ("CREDIT", "CR", "C") or "CREDIT" in narration
        is_debit = tx_type in ("DEBIT", "DR", "D") or not is_credit

        records.append({
            "date": _parse_timestamp(dt_val),
            "amount": amt_val,
            "balance": bal_val,
            "narration": narration,
            "type": "credit" if is_credit else "debit",
        })

    df = pd.DataFrame(records).sort_values("date").reset_index(drop=True)

    # 1. Bounces & Returns
    bounce_mask = df["narration"].apply(lambda n: any(k in n for k in _BOUNCE_KEYWORDS))
    bounces_observed = int(bounce_mask.sum())
    # Annualize/scale to 6-month expected bounces (assuming ~90d payload)
    total_days = max(1, (df["date"].max() - df["date"].min()).days)
    emi_bounce_6m = round(float(bounces_observed * (180.0 / max(total_days, 30.0))), 1)

    # 2. Daily balance interpolation for AMB / MMB and trend
    daily_balance = df.set_index("date").resample("D")["balance"].last().ffill()
    if daily_balance.isna().all() or len(daily_balance) == 0:
        # Reconstruct balance from amounts if currentBalance was missing
        signed_amt = np.where(df["type"] == "credit", df["amount"], -df["amount"])
        df["balance"] = np.cumsum(signed_amt)
        daily_balance = df.set_index("date").resample("D")["balance"].last().ffill()

    amb_l3m = float(daily_balance.mean()) if len(daily_balance) > 0 else 0.0
    mmb_l3m = float(daily_balance.min()) if len(daily_balance) > 0 else 0.0

    # 3. Balance trend % (first 1/3 vs last 1/3)
    n_days = len(daily_balance)
    third = max(n_days // 3, 1)
    first_avg = float(daily_balance.iloc[:third].mean())
    last_avg = float(daily_balance.iloc[-third:].mean())
    denom = max(abs(first_avg), 1000.0)
    balance_trend_pct = round(float((last_avg - first_avg) / denom * 100.0), 1)

    # 4. Inflow & Outflow aggregation
    credits = df[df["type"] == "credit"]
    debits = df[df["type"] == "debit"]
    tot_credits = float(credits["amount"].sum())
    tot_debits = float(debits["amount"].sum())
    inflow_outflow_ratio = round(tot_credits / max(tot_debits, 1.0), 3)

    # 5. Cashflow volatility (CV of monthly credits)
    monthly_credits = credits.set_index("date").resample("30D")["amount"].sum()
    if len(monthly_credits) > 1 and monthly_credits.mean() > 0:
        cashflow_volatility = round(float(monthly_credits.std() / monthly_credits.mean()), 3)
    else:
        cashflow_volatility = 0.20

    # 6. UPI Inflow Stability (arrival interval consistency)
    if len(credits) > 2:
        gaps = credits["date"].diff().dt.total_seconds() / 86400.0
        gaps = gaps.dropna()
        if len(gaps) > 1 and gaps.mean() > 0:
            upi_stability = round(float(1.0 / (1.0 + gaps.std() / max(gaps.mean(), 0.5))), 3)
        else:
            upi_stability = 0.70
    else:
        upi_stability = 0.50

    # 7. Circular transaction / round-trip detection
    # Flag if same amount debit and credit occur within same calendar day
    circular_flag = 0
    if len(credits) > 0 and len(debits) > 0:
        same_day_rounds = 0
        credits_by_day = credits.groupby(credits["date"].dt.date)["amount"].apply(set)
        debits_by_day = debits.groupby(debits["date"].dt.date)["amount"].apply(set)
        common_days = set(credits_by_day.index).intersection(set(debits_by_day.index))
        for day in common_days:
            match = credits_by_day[day].intersection(debits_by_day[day])
            if match and max(match) > 50_000:
                same_day_rounds += 1
        if same_day_rounds >= 2:
            circular_flag = 1

    return {
        "emi_bounce_6m": emi_bounce_6m,
        "cashflow_volatility": min(max(cashflow_volatility, 0.05), 1.5),
        "balance_trend_pct": min(max(balance_trend_pct, -100.0), 200.0),
        "upi_inflow_stability": min(max(upi_stability, 0.1), 1.0),
        "amb_l3m": max(amb_l3m, 0.0),
        "mmb_l3m": max(mmb_l3m, 0.0),
        "inflow_outflow_ratio": inflow_outflow_ratio,
        "circular_tx_flag": circular_flag,
    }

