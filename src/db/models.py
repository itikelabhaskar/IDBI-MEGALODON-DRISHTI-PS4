# tables behind the console: scored borrowers, officer decisions, batch runs and
# drift history.

from __future__ import annotations

from datetime import datetime, timezone
import json
from typing import Any
from sqlalchemy import (
    Boolean,
    Column,
    DateTime,
    Float,
    Integer,
    String,
    Text,
)
from sqlalchemy.orm import declarative_base

Base = declarative_base()


def _utc_now() -> datetime:
    return datetime.now(timezone.utc)


class Decision(Base):

    __tablename__ = "decisions"

    id = Column(Integer, primary_key=True, autoincrement=True)
    loan_id = Column(String(64), nullable=False, index=True)
    segment = Column(String(32), nullable=False, index=True)
    proposed_action = Column(String(256), nullable=True)
    proposed_sma = Column(String(32), nullable=True)
    pd = Column(Float, nullable=True)
    risk_grade = Column(String(16), nullable=True)
    decision = Column(String(16), nullable=False)  # accept | override | defer
    override_action = Column(String(256), nullable=True)
    reason = Column(Text, nullable=True, default="")
    officer = Column(String(64), nullable=False, default="demo_officer")
    ts = Column(String(64), nullable=False, default=lambda: _utc_now().isoformat())

    def to_dict(self) -> dict:
        return {
            "id": self.id,
            "loan_id": self.loan_id,
            "segment": self.segment,
            "proposed_action": self.proposed_action,
            "proposed_sma": self.proposed_sma,
            "pd": self.pd,
            "risk_grade": self.risk_grade,
            "decision": self.decision,
            "override_action": self.override_action,
            "reason": self.reason,
            "officer": self.officer,
            "ts": self.ts,
        }


class WatchlistRun(Base):

    __tablename__ = "watchlist_runs"

    run_id = Column(String(64), primary_key=True)
    timestamp = Column(DateTime(timezone=True), nullable=False, default=_utc_now)
    segment = Column(String(32), nullable=False, index=True)
    total_accounts = Column(Integer, nullable=False)
    high_severe_count = Column(Integer, nullable=False)
    total_ecl = Column(Float, nullable=False)
    mean_pd = Column(Float, nullable=True)
    max_pd = Column(Float, nullable=True)
    grade_distribution = Column(Text, nullable=True)  # JSON-encoded grade counts
    storage_path = Column(String(512), nullable=True)  # S3 URI or local path
    status = Column(String(32), nullable=False, default="completed")

    def to_dict(self) -> dict:
        return {
            "run_id": self.run_id,
            "timestamp": self.timestamp.isoformat() if self.timestamp else None,
            "segment": self.segment,
            "total_accounts": self.total_accounts,
            "high_severe_count": self.high_severe_count,
            "total_ecl": self.total_ecl,
            "mean_pd": self.mean_pd,
            "max_pd": self.max_pd,
            "grade_distribution": self.grade_distribution,
            "storage_path": self.storage_path,
            "status": self.status,
        }


class DriftFairnessHistory(Base):

    __tablename__ = "drift_fairness_history"

    id = Column(Integer, primary_key=True, autoincrement=True)
    run_id = Column(String(64), nullable=True, index=True)
    timestamp = Column(DateTime(timezone=True), nullable=False, default=_utc_now)
    segment = Column(String(32), nullable=False, index=True)
    overall_psi = Column(Float, nullable=False)
    max_feature_psi = Column(Float, nullable=True)
    alert_triggered = Column(Boolean, nullable=False, default=False)
    features_drifted = Column(Text, nullable=True)  # JSON-encoded list of drifted features
    fairness_disparate_impact = Column(Text, nullable=True)  # JSON-encoded fairness metrics

    def to_dict(self) -> dict:
        return {
            "id": self.id,
            "run_id": self.run_id,
            "timestamp": self.timestamp.isoformat() if self.timestamp else None,
            "segment": self.segment,
            "overall_psi": self.overall_psi,
            "max_feature_psi": self.max_feature_psi,
            "alert_triggered": self.alert_triggered,
            "features_drifted": self.features_drifted,
            "fairness_disparate_impact": self.fairness_disparate_impact,
        }


class LoanAccount(Base):

    __tablename__ = "loan_accounts"

    loan_id = Column(String(64), primary_key=True)
    segment = Column(String(32), nullable=False, default="msme_idbi", index=True)
    branch_code = Column(String(32), nullable=True, index=True)
    branch_name = Column(String(128), nullable=True)
    zone = Column(String(64), nullable=True)
    region = Column(String(64), nullable=True)
    sector = Column(String(64), nullable=True)
    sub_segment = Column(String(32), nullable=True)
    state = Column(String(32), nullable=True)
    sanction_limit = Column(Float, nullable=True)
    drawing_power = Column(Float, nullable=True)
    drawing_power_gap_pct = Column(Float, nullable=True)
    demanded_vs_collected_ratio = Column(Float, nullable=True)
    cibil_score = Column(Float, nullable=True)
    dpd = Column(Float, nullable=True)
    overdue_amt = Column(Float, nullable=True)
    emi_bounce_6m = Column(Integer, nullable=True)
    lien_flag = Column(Integer, nullable=True)
    restructuring_flag = Column(Integer, nullable=True)
    gst_filing_delay_days = Column(Float, nullable=True)
    itc_mismatch_flag = Column(Integer, nullable=True)
    pd_12m = Column(Float, nullable=True)
    risk_grade = Column(String(16), nullable=True)
    rag = Column(String(16), nullable=True)
    sma_status = Column(String(32), nullable=True)
    ecl = Column(Float, nullable=True)
    ecl_stage = Column(Integer, nullable=True)
    lifetime_ecl = Column(Float, nullable=True)
    recommended_action = Column(String(256), nullable=True)
    review_cadence = Column(String(64), nullable=True)
    action_owner = Column(String(64), nullable=True)
    raw_features_json = Column(Text, nullable=True)
    created_at = Column(DateTime(timezone=True), nullable=False, default=_utc_now)
    updated_at = Column(
        DateTime(timezone=True), nullable=False, default=_utc_now, onupdate=_utc_now
    )

    def to_dict(self) -> dict[str, Any]:
        raw_meta: dict[str, Any] = {}
        if self.raw_features_json:
            try:
                raw_meta = json.loads(self.raw_features_json)
            except Exception:
                raw_meta = {}

        reason_codes = raw_meta.get("reason_codes", [])
        ews_triggers = raw_meta.get("ews_triggers", [])
        stress_horizon = raw_meta.get("stress_horizon", {
            "expected_stress_month": 12,
            "quarter": "",
            "estimated": True,
        })
        raw_inputs = raw_meta.get("raw", raw_meta)
        if not isinstance(raw_inputs, dict):
            raw_inputs = {}

        return {
            "loan_id": self.loan_id,
            "segment": self.segment or "msme_idbi",
            "pd": round(float(self.pd_12m), 4) if self.pd_12m is not None else 0.05,
            "risk_grade": self.risk_grade or "RG5",
            "rag": self.rag or "Amber",
            "sma_status": self.sma_status or "Standard",
            "action": self.recommended_action or "Quarterly review",
            "cadence": self.review_cadence or "Quarterly",
            "owner": self.action_owner or "Relationship manager",
            "ead": round(float(self.sanction_limit or 0.0), 2),
            "ecl": round(float(self.ecl or 0.0), 2),
            "ecl_stage": self.ecl_stage or 1,
            "lifetime_ecl": round(float(self.lifetime_ecl), 2) if self.lifetime_ecl is not None else None,
            "currency": "INR",
            "coverage": "full",
            "fields_defaulted": [],
            "reason_codes": reason_codes,
            "ews_triggers": ews_triggers,
            "stress_horizon": stress_horizon,
            "sector": self.sector,
            "state": self.state,
            "ticket_size": self.sanction_limit,
            "sub_segment": self.sub_segment,
            "zone": self.zone,
            "region": self.region,
            "branch_code": self.branch_code,
            "branch_name": self.branch_name,
            "sanction_limit": self.sanction_limit,
            "drawing_power": self.drawing_power,
            "drawing_power_gap_pct": self.drawing_power_gap_pct,
            "demanded_vs_collected_ratio": self.demanded_vs_collected_ratio,
            "cibil_score": self.cibil_score,
            "dpd": self.dpd,
            "overdue_amt": self.overdue_amt,
            "emi_bounce_6m": self.emi_bounce_6m,
            "lien_flag": self.lien_flag,
            "restructuring_flag": self.restructuring_flag,
            "gst_filing_delay_days": self.gst_filing_delay_days,
            "itc_mismatch_flag": self.itc_mismatch_flag,
            "raw": raw_inputs,
            "created_at": self.created_at.isoformat() if self.created_at else None,
            "updated_at": self.updated_at.isoformat() if self.updated_at else None,
        }

