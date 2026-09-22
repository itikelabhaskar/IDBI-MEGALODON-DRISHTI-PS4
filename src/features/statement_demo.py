# renders a 90 day transaction ledger for a borrower and then derives the cash-flow
# aggregates back out of it, so the console can show raw statement -> signal -> model
# input reconciling end to end.
#
# derive_statement_features runs unchanged on real rows. only the generator goes away.

from __future__ import annotations

import numpy as np
import pandas as pd

LEDGER_DAYS = 90


def generate_ledger(borrower: pd.Series, seed: int = 7) -> pd.DataFrame:
    # Stable per-borrower seed (str hash() is process-salted -> nondeterministic).
    loan_key = sum(ord(c) for c in str(borrower.get("loan_id", "x")))
    rng = np.random.default_rng(seed + loan_key)
    ticket = float(borrower.get("ticket_size", 8e5) or 8e5)
    monthly_inflow = max(ticket / 18.0, 25_000.0)
    emi = ticket / max(float(borrower.get("tenure_months", 36) or 36), 6.0)
    bounces_6m = int(borrower.get("emi_bounce_6m", 0) or 0)
    vol = float(borrower.get("cashflow_volatility", 0.25) or 0.25)
    trend = float(borrower.get("balance_trend_pct", 0.0) or 0.0) / 100.0
    upi_stab = float(borrower.get("upi_inflow_stability", 0.7) or 0.7)

    days = pd.date_range(end=pd.Timestamp.today().normalize(), periods=LEDGER_DAYS)
    rows: list[dict] = []

    # Customer receipts: frequency/size regularity driven by UPI stability.
    n_credits_per_month = int(6 + 14 * upi_stab)
    for month_start in (0, 30, 60):
        credit_days = rng.choice(30, size=n_credits_per_month, replace=False)
        base = monthly_inflow / n_credits_per_month
        # Drift inflows so the balance path reflects the reported trend.
        drift = 1.0 + trend * (month_start / 60.0)
        for d in credit_days:
            amt = base * drift * rng.lognormal(0, 0.25 + 0.9 * (1 - upi_stab))
            rows.append({"date": days[month_start + int(d)], "type": "credit",
                         "narration": "UPI receipt / customer payment", "amount": round(amt, 0)})

    # Vendor and operating debits: scale with volatility.
    for month_start in (0, 30, 60):
        for d in rng.choice(30, size=10, replace=False):
            amt = (monthly_inflow * 0.75 / 10) * rng.lognormal(0, 0.2 + 0.8 * vol)
            rows.append({"date": days[month_start + int(d)], "type": "debit",
                         "narration": "Vendor / operating expense", "amount": round(amt, 0)})

    # EMI debits on the 5th of each ledger month; bounce pattern matches the
    # 6-month count (expected bounces in 3 months = bounces_6m / 2).
    n_bounce_3m = int(round(bounces_6m / 2))
    bounce_months = set(rng.choice(3, size=min(n_bounce_3m, 3), replace=False))
    for i, month_start in enumerate((0, 30, 60)):
        if i in bounce_months:
            rows.append({"date": days[month_start + 5], "type": "debit",
                         "narration": "EMI — RETURNED (insufficient funds)", "amount": 0.0})
            rows.append({"date": days[month_start + 5], "type": "fee",
                         "narration": "ECS return charges", "amount": 590.0})
        else:
            rows.append({"date": days[month_start + 5], "type": "debit",
                         "narration": "EMI auto-debit", "amount": round(emi, 0)})

    ledger = pd.DataFrame(rows).sort_values("date").reset_index(drop=True)
    signed = np.where(ledger["type"] == "credit", ledger["amount"], -ledger["amount"])
    opening = monthly_inflow * 0.8
    ledger["balance"] = np.maximum(opening + np.cumsum(signed), 0.0).round(0)
    return ledger


def derive_statement_features(ledger: pd.DataFrame) -> dict[str, float]:
    bounces_3m = int(ledger["narration"].str.contains("RETURNED").sum())

    daily = ledger.set_index("date").resample("D")["balance"].last().ffill()
    monthly_inflow = (
        ledger[ledger["type"] == "credit"].set_index("date")
        .resample("30D")["amount"].sum()
    )
    inflow_cv = float(monthly_inflow.std() / monthly_inflow.mean()) if len(monthly_inflow) > 1 else 0.0

    third = max(len(daily) // 3, 1)
    first_avg, last_avg = daily.iloc[:third].mean(), daily.iloc[-third:].mean()
    balance_trend_pct = float((last_avg - first_avg) / max(first_avg, 1.0) * 100)

    credits = ledger[ledger["type"] == "credit"]
    gaps = credits["date"].diff().dt.days.dropna()
    upi_stability = float(1.0 / (1.0 + gaps.std() / max(gaps.mean(), 0.5))) if len(gaps) > 2 else 0.5

    return {
        "emi_bounce_6m (est. from 3m x2)": bounces_3m * 2,
        "cashflow_volatility": round(inflow_cv, 3),
        "balance_trend_pct": round(balance_trend_pct, 1),
        "upi_inflow_stability": round(upi_stability, 3),
    }
