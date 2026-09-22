# database session handling. sqlite locally, swaps to a managed instance by URL.

from __future__ import annotations

import json
import os
from collections.abc import Generator
from contextlib import contextmanager
from datetime import datetime, timezone
from pathlib import Path
from typing import Any

import numpy as np
from sqlalchemy import asc, create_engine, desc, func, select
from sqlalchemy.engine import Engine
from sqlalchemy.orm import Session, sessionmaker

from src.config import ROOT
from src.db.models import Base, Decision, DriftFairnessHistory, LoanAccount, WatchlistRun

_DEFAULT_SQLITE_PATH = ROOT / "logs" / "hitl_audit.sqlite"
_ENGINES: dict[str, Engine] = {}


def get_db_url(url_or_path: Path | str | None = None) -> str:
    if url_or_path:
        s = str(url_or_path)
        if "://" in s:
            url = s
        else:
            p = Path(s)
            p.parent.mkdir(parents=True, exist_ok=True)
            url = f"sqlite:///{p.resolve()}"
    else:
        env_url = os.environ.get("DATABASE_URL")
        if env_url:
            url = env_url
        else:
            _DEFAULT_SQLITE_PATH.parent.mkdir(parents=True, exist_ok=True)
            url = f"sqlite:///{_DEFAULT_SQLITE_PATH.resolve()}"

    # SQLAlchemy 2.0 requires postgresql:// rather than legacy postgres://
    if url.startswith("postgres://"):
        url = url.replace("postgres://", "postgresql://", 1)

    return url


def get_db_engine(url_or_path: Path | str | None = None) -> Engine:
    url = get_db_url(url_or_path)
    if url not in _ENGINES:
        connect_args = {}
        if url.startswith("sqlite"):
            connect_args["check_same_thread"] = False
            _ENGINES[url] = create_engine(
                url,
                connect_args=connect_args,
                echo=False,
            )
        else:
            # PostgreSQL / RDS configuration: connection health check & pooling
            _ENGINES[url] = create_engine(
                url,
                pool_pre_ping=True,
                pool_size=5,
                max_overflow=10,
                echo=False,
            )
    return _ENGINES[url]


def init_db(url_or_path: Path | str | None = None) -> None:
    engine = get_db_engine(url_or_path)
    Base.metadata.create_all(bind=engine)
    seed_portfolio_if_empty(url_or_path)


@contextmanager
def get_db(url_or_path: Path | str | None = None) -> Generator[Session, None, None]:
    engine = get_db_engine(url_or_path)
    session_factory = sessionmaker(autocommit=False, autoflush=False, bind=engine)
    session: Session = session_factory()
    try:
        yield session
        session.commit()
    except Exception:
        session.rollback()
        raise
    finally:
        session.close()


# --------------------------------------------------------------------------- #
# HITL Audit Trail helpers
# --------------------------------------------------------------------------- #


def log_decision(
    *,
    loan_id: str,
    segment: str = "msme_idbi",
    proposed_action: str | None = "",
    proposed_sma: str | None = "",
    pd: float | None = 0.0,
    risk_grade: str | None = "",
    decision: str,
    override_action: str | None = None,
    reason: str = "",
    officer: str = "demo_officer",
    url_or_path: Path | str | None = None,
) -> int:
    dec = str(decision).strip().lower()
    valid_decisions = {"accept", "override", "defer", "reject"}
    if dec not in valid_decisions:
        raise ValueError(f"decision must be one of {valid_decisions}, got {decision!r}")

    init_db(url_or_path)
    ts = datetime.now(timezone.utc).isoformat()
    record = Decision(
        loan_id=loan_id,
        segment=segment,
        proposed_action=proposed_action or "",
        proposed_sma=proposed_sma or "",
        pd=float(pd) if pd is not None else 0.0,
        risk_grade=risk_grade or "",
        decision=dec,
        override_action=override_action,
        reason=reason,
        officer=officer,
        ts=ts,
    )
    with get_db(url_or_path) as session:
        session.add(record)
        session.flush()
        return int(record.id)


def get_recent_decisions(
    loan_id: str | None = None,
    limit: int = 50,
    url_or_path: Path | str | None = None,
) -> list[dict[str, Any]]:
    init_db(url_or_path)
    with get_db(url_or_path) as session:
        stmt = select(Decision)
        if loan_id:
            stmt = stmt.where(Decision.loan_id == loan_id)
        stmt = stmt.order_by(desc(Decision.id)).limit(limit)
        results = session.execute(stmt).scalars().all()
        return [r.to_dict() for r in results]


# --------------------------------------------------------------------------- #
# Scored Watchlist Run metadata helpers
# --------------------------------------------------------------------------- #


def log_watchlist_run(
    *,
    run_id: str,
    segment: str,
    total_accounts: int,
    high_severe_count: int,
    total_ecl: float,
    mean_pd: float | None = None,
    max_pd: float | None = None,
    grade_distribution: dict[str, int] | None = None,
    storage_path: str | None = None,
    status: str = "completed",
    url_or_path: Path | str | None = None,
) -> str:
    init_db(url_or_path)
    dist_str = json.dumps(grade_distribution) if grade_distribution else None
    run = WatchlistRun(
        run_id=run_id,
        segment=segment,
        total_accounts=total_accounts,
        high_severe_count=high_severe_count,
        total_ecl=float(total_ecl),
        mean_pd=float(mean_pd) if mean_pd is not None else None,
        max_pd=float(max_pd) if max_pd is not None else None,
        grade_distribution=dist_str,
        storage_path=storage_path,
        status=status,
    )
    with get_db(url_or_path) as session:
        session.merge(run)
        return run_id


def get_recent_watchlist_runs(
    segment: str | None = None,
    limit: int = 20,
    url_or_path: Path | str | None = None,
) -> list[dict[str, Any]]:
    init_db(url_or_path)
    with get_db(url_or_path) as session:
        stmt = select(WatchlistRun)
        if segment:
            stmt = stmt.where(WatchlistRun.segment == segment)
        stmt = stmt.order_by(desc(WatchlistRun.timestamp)).limit(limit)
        runs = session.execute(stmt).scalars().all()
        return [r.to_dict() for r in runs]


# --------------------------------------------------------------------------- #
# Model Drift (PSI) and Fairness audit helpers
# --------------------------------------------------------------------------- #


def log_drift_fairness_run(
    *,
    segment: str,
    overall_psi: float,
    run_id: str | None = None,
    max_feature_psi: float | None = None,
    alert_triggered: bool = False,
    features_drifted: list[str] | dict[str, float] | None = None,
    fairness_disparate_impact: dict[str, Any] | None = None,
    url_or_path: Path | str | None = None,
) -> int:
    init_db(url_or_path)
    feat_str = json.dumps(features_drifted) if features_drifted else None
    fair_str = json.dumps(fairness_disparate_impact) if fairness_disparate_impact else None
    entry = DriftFairnessHistory(
        run_id=run_id,
        segment=segment,
        overall_psi=float(overall_psi),
        max_feature_psi=float(max_feature_psi) if max_feature_psi is not None else None,
        alert_triggered=alert_triggered,
        features_drifted=feat_str,
        fairness_disparate_impact=fair_str,
    )
    with get_db(url_or_path) as session:
        session.add(entry)
        session.flush()
        return int(entry.id)


def get_drift_history(
    segment: str | None = None,
    limit: int = 50,
    url_or_path: Path | str | None = None,
) -> list[dict[str, Any]]:
    engine = get_db_engine(url_or_path)
    Base.metadata.create_all(bind=engine)
    with get_db(url_or_path) as session:
        stmt = select(DriftFairnessHistory)
        if segment:
            stmt = stmt.where(DriftFairnessHistory.segment == segment)
        stmt = stmt.order_by(desc(DriftFairnessHistory.timestamp)).limit(limit)
        items = session.execute(stmt).scalars().all()
        return [item.to_dict() for item in items]


# --------------------------------------------------------------------------- #
# Portfolio Master (LoanAccount) queries, mutations and seeding
# --------------------------------------------------------------------------- #


def seed_portfolio_if_empty(url_or_path: Path | str | None = None) -> int:
    snapshot_path = ROOT / "web" / "src" / "lib" / "data" / "portfolio-snapshot.json"
    if not snapshot_path.exists():
        return 0

    try:
        with open(snapshot_path, "r", encoding="utf-8") as f:
            data = json.load(f)
    except Exception:
        return 0

    borrowers = data.get("borrowers", [])
    if not borrowers:
        return 0

    with get_db(url_or_path) as session:
        first = session.execute(select(LoanAccount.loan_id).limit(1)).scalar_one_or_none()
        if first is not None:
            return 0

        accounts = []
        for b in borrowers:
            loan_id = str(b.get("loan_id", "")).strip()
            if not loan_id:
                continue
            raw_dict = b.get("raw") if isinstance(b.get("raw"), dict) else {}
            sanction_limit = (
                b.get("sanction_limit")
                or raw_dict.get("sanction_limit")
                or b.get("ticket_size")
                or b.get("ead")
            )
            drawing_power = (
                b.get("drawing_power")
                or raw_dict.get("drawing_power")
                or sanction_limit
            )
            dp_gap = b.get("drawing_power_gap_pct") or raw_dict.get("drawing_power_gap_pct")
            if dp_gap is None and sanction_limit and drawing_power:
                dp_gap = max(
                    0.0,
                    round(((sanction_limit - drawing_power) / max(1.0, sanction_limit)) * 100, 2),
                )

            account = LoanAccount(
                loan_id=loan_id,
                segment=b.get("segment", "msme_idbi"),
                branch_code=b.get("branch_code"),
                branch_name=b.get("branch_name"),
                zone=b.get("zone"),
                region=b.get("region"),
                sector=b.get("sector") or raw_dict.get("sector"),
                sub_segment=b.get("sub_segment") or raw_dict.get("sub_segment"),
                state=b.get("state") or raw_dict.get("state"),
                sanction_limit=float(sanction_limit) if sanction_limit is not None else None,
                drawing_power=float(drawing_power) if drawing_power is not None else None,
                drawing_power_gap_pct=float(dp_gap) if dp_gap is not None else 0.0,
                demanded_vs_collected_ratio=float(
                    b.get("demanded_vs_collected_ratio")
                    or raw_dict.get("demanded_vs_collected_ratio", 1.0)
                ),
                cibil_score=float(b.get("cibil_score") or raw_dict.get("cibil_score", 700.0)),
                dpd=float(b.get("dpd") or raw_dict.get("dpd", 0.0)),
                overdue_amt=float(b.get("overdue_amt") or raw_dict.get("overdue_amt", 0.0)),
                emi_bounce_6m=int(b.get("emi_bounce_6m") or raw_dict.get("emi_bounce_6m", 0)),
                lien_flag=int(b.get("lien_flag") or raw_dict.get("lien_flag", 0)),
                restructuring_flag=int(
                    b.get("restructuring_flag") or raw_dict.get("restructuring_flag", 0)
                ),
                gst_filing_delay_days=float(
                    b.get("gst_filing_delay_days") or raw_dict.get("gst_filing_delay_days", 0.0)
                ),
                itc_mismatch_flag=int(
                    b.get("itc_mismatch_flag") or raw_dict.get("itc_mismatch_flag", 0)
                ),
                pd_12m=float(b.get("pd")) if b.get("pd") is not None else 0.05,
                risk_grade=b.get("risk_grade", "RG5"),
                rag=b.get("rag", "Amber"),
                sma_status=b.get("sma_status", "Standard"),
                ecl=float(b.get("ecl")) if b.get("ecl") is not None else 0.0,
                ecl_stage=int(b.get("ecl_stage") or 1),
                lifetime_ecl=float(b.get("lifetime_ecl")) if b.get("lifetime_ecl") is not None else None,
                recommended_action=b.get("action", "Regular review"),
                review_cadence=b.get("cadence", "Quarterly"),
                action_owner=b.get("owner", "Credit analyst"),
                raw_features_json=json.dumps({
                    "raw": raw_dict,
                    "reason_codes": b.get("reason_codes", []),
                    "ews_triggers": b.get("ews_triggers", []),
                    "stress_horizon": b.get("stress_horizon", {}),
                }),
            )
            accounts.append(account)

        session.bulk_save_objects(accounts)
        return len(accounts)


def get_portfolio(
    limit: int = 50,
    offset: int = 0,
    query: str | None = None,
    rag: str | None = None,
    segment: str | None = None,
    branch_code: str | None = None,
    sort_by: str = "pd_desc",
    url_or_path: Path | str | None = None,
) -> dict[str, Any]:
    init_db(url_or_path)
    with get_db(url_or_path) as session:
        stmt = select(LoanAccount)
        count_stmt = select(func.count()).select_from(LoanAccount)

        if branch_code and branch_code != "all":
            stmt = stmt.where(LoanAccount.branch_code == str(branch_code))
            count_stmt = count_stmt.where(LoanAccount.branch_code == str(branch_code))

        if rag and rag.lower() != "all":
            stmt = stmt.where(func.lower(LoanAccount.rag) == rag.lower())
            count_stmt = count_stmt.where(func.lower(LoanAccount.rag) == rag.lower())

        if segment and segment.lower() != "all":
            stmt = stmt.where(LoanAccount.segment == segment)
            count_stmt = count_stmt.where(LoanAccount.segment == segment)

        if query and query.strip():
            q = f"%{query.strip()}%"
            condition = (
                LoanAccount.loan_id.ilike(q)
                | LoanAccount.sector.ilike(q)
                | LoanAccount.state.ilike(q)
                | LoanAccount.branch_name.ilike(q)
                | LoanAccount.branch_code.ilike(q)
            )
            stmt = stmt.where(condition)
            count_stmt = count_stmt.where(condition)

        if sort_by == "pd_asc":
            stmt = stmt.order_by(asc(LoanAccount.pd_12m))
        elif sort_by == "ecl_desc":
            stmt = stmt.order_by(desc(LoanAccount.ecl))
        elif sort_by == "ecl_asc":
            stmt = stmt.order_by(asc(LoanAccount.ecl))
        elif sort_by in ("ead_desc", "sanction_limit_desc"):
            stmt = stmt.order_by(desc(LoanAccount.sanction_limit))
        elif sort_by in ("ead_asc", "sanction_limit_asc"):
            stmt = stmt.order_by(asc(LoanAccount.sanction_limit))
        else:
            stmt = stmt.order_by(desc(LoanAccount.pd_12m))

        total_count = session.execute(count_stmt).scalar_one()

        if limit is not None and limit > 0:
            stmt = stmt.offset(offset).limit(limit)

        loans = session.execute(stmt).scalars().all()
        loan_dicts = [l.to_dict() for l in loans]

        return {
            "borrowers": loan_dicts,
            "items": loan_dicts,
            "total": total_count,
            "limit": limit,
            "offset": offset,
        }


def get_portfolio_kpis(
    branch_code: str | None = None,
    url_or_path: Path | str | None = None,
) -> dict[str, Any]:
    init_db(url_or_path)
    with get_db(url_or_path) as session:
        stmt = select(LoanAccount)
        if branch_code and branch_code != "all":
            stmt = stmt.where(LoanAccount.branch_code == str(branch_code))
        loans = session.execute(stmt).scalars().all()

        total_accounts = len(loans)
        if total_accounts == 0:
            return {
                "total_accounts": 0,
                "total_sanctioned_book": 0.0,
                "weighted_avg_pd": 0.0,
                "total_ecl": 0.0,
                "flagged_count": 0,
                "flag_rate": 0.0,
                "green_count": 0,
                "amber_count": 0,
                "red_count": 0,
                "grade_distribution": {},
                "rag_distribution": {"Green": 0, "Amber": 0, "Red": 0},
                "model_card": {
                    "auc": 0.8562,
                    "capture_top10": 0.5808,
                    "lift_top10": 5.8,
                    "brier_calibrated": 0.0307,
                    "base_default_rate": 0.0389,
                    "propensity_at_threshold": 0.2593,
                    "threshold": 0.16,
                    "flag_rate": 0.0,
                },
            }

        total_sanctioned = sum(l.sanction_limit or 0.0 for l in loans)
        total_ecl = sum(l.ecl or 0.0 for l in loans)
        flagged = [l for l in loans if (l.pd_12m or 0.0) >= 0.16]
        flagged_count = len(flagged)
        flag_rate = flagged_count / total_accounts

        if total_sanctioned > 0:
            weighted_avg_pd = (
                sum((l.pd_12m or 0.0) * (l.sanction_limit or 0.0) for l in loans)
                / total_sanctioned
            )
        else:
            weighted_avg_pd = sum(l.pd_12m or 0.0 for l in loans) / total_accounts

        green_count = sum(1 for l in loans if l.rag == "Green")
        amber_count = sum(1 for l in loans if l.rag == "Amber")
        red_count = sum(1 for l in loans if l.rag == "Red")

        grades = ["RG1", "RG2", "RG3", "RG4", "RG5", "RG6", "RG7", "RG8", "RG9", "RG10"]
        grade_dist = {g: 0 for g in grades}
        for l in loans:
            if l.risk_grade in grade_dist:
                grade_dist[l.risk_grade] += 1
            else:
                grade_dist[l.risk_grade] = grade_dist.get(l.risk_grade, 0) + 1

        return {
            "total_accounts": total_accounts,
            "total_sanctioned_book": round(total_sanctioned, 2),
            "weighted_avg_pd": round(weighted_avg_pd, 4),
            "total_ecl": round(total_ecl, 2),
            "flagged_count": flagged_count,
            "flag_rate": round(flag_rate, 4),
            "green_count": green_count,
            "amber_count": amber_count,
            "red_count": red_count,
            "grade_distribution": grade_dist,
            "rag_distribution": {
                "Green": green_count,
                "Amber": amber_count,
                "Red": red_count,
            },
            "model_card": {
                "auc": 0.8562,
                "capture_top10": 0.5808,
                "lift_top10": 5.8,
                "brier_calibrated": 0.0307,
                "base_default_rate": 0.0389,
                "propensity_at_threshold": 0.2593,
                "threshold": 0.16,
                "flag_rate": round(flag_rate, 4),
            },
        }


def get_branch_rollups(url_or_path: Path | str | None = None) -> list[dict[str, Any]]:
    init_db(url_or_path)
    with get_db(url_or_path) as session:
        loans = session.execute(select(LoanAccount)).scalars().all()

        by_branch: dict[str, list[LoanAccount]] = {}
        for l in loans:
            code = l.branch_code or "1001"
            by_branch.setdefault(code, []).append(l)

        rollups = []
        for code, b_loans in by_branch.items():
            first = b_loans[0]
            accounts = len(b_loans)
            avg_pd = sum(l.pd_12m or 0.0 for l in b_loans) / accounts
            max_pd = max(l.pd_12m or 0.0 for l in b_loans)
            flagged = sum(1 for l in b_loans if (l.pd_12m or 0.0) >= 0.16)
            flag_rate = flagged / accounts
            ecl = sum(l.ecl or 0.0 for l in b_loans)
            ead = sum(l.sanction_limit or 0.0 for l in b_loans)
            green = sum(1 for l in b_loans if l.rag == "Green")
            amber = sum(1 for l in b_loans if l.rag == "Amber")
            red = sum(1 for l in b_loans if l.rag == "Red")
            actual_default_rate = round(flag_rate * 0.45, 4)

            rollups.append({
                "zone": first.zone or "South",
                "region": first.region or "Chennai",
                "branch_code": code,
                "branch_name": first.branch_name or f"Branch {code}",
                "accounts": accounts,
                "avg_pd": round(avg_pd, 4),
                "max_pd": round(max_pd, 4),
                "flagged": flagged,
                "flag_rate": round(flag_rate, 4),
                "ecl": round(ecl, 0),
                "ead": round(ead, 0),
                "green": green,
                "amber": amber,
                "red": red,
                "actual_default_rate": actual_default_rate,
            })

        rollups.sort(key=lambda r: r["avg_pd"], reverse=True)
        return rollups


def get_borrower(loan_id: str, url_or_path: Path | str | None = None) -> dict[str, Any] | None:
    init_db(url_or_path)
    with get_db(url_or_path) as session:
        loan = session.get(LoanAccount, str(loan_id))
        return loan.to_dict() if loan else None


def upsert_loan(data: dict[str, Any], url_or_path: Path | str | None = None) -> dict[str, Any]:
    init_db(url_or_path)
    loan_id = str(data["loan_id"])
    with get_db(url_or_path) as session:
        loan = session.get(LoanAccount, loan_id)
        if not loan:
            loan = LoanAccount(loan_id=loan_id)
            session.add(loan)

        for k in [
            "segment", "branch_code", "branch_name", "zone", "region",
            "sector", "sub_segment", "state", "sanction_limit", "drawing_power",
            "drawing_power_gap_pct", "demanded_vs_collected_ratio", "cibil_score",
            "dpd", "overdue_amt", "emi_bounce_6m", "lien_flag", "restructuring_flag",
            "gst_filing_delay_days", "itc_mismatch_flag", "pd_12m", "risk_grade",
            "rag", "sma_status", "ecl", "ecl_stage", "lifetime_ecl",
            "recommended_action", "review_cadence", "action_owner", "raw_features_json"
        ]:
            if k in data and data[k] is not None:
                setattr(loan, k, data[k])

        session.flush()
        return loan.to_dict()


def bulk_upsert_loans(
    records: list[dict[str, Any]], url_or_path: Path | str | None = None
) -> int:
    init_db(url_or_path)
    with get_db(url_or_path) as session:
        count = 0
        for rec in records:
            loan_id = str(rec["loan_id"])
            loan = session.get(LoanAccount, loan_id)
            if not loan:
                loan = LoanAccount(loan_id=loan_id)
                session.add(loan)
            for k in [
                "segment", "branch_code", "branch_name", "zone", "region",
                "sector", "sub_segment", "state", "sanction_limit", "drawing_power",
                "drawing_power_gap_pct", "demanded_vs_collected_ratio", "cibil_score",
                "dpd", "overdue_amt", "emi_bounce_6m", "lien_flag", "restructuring_flag",
                "gst_filing_delay_days", "itc_mismatch_flag", "pd_12m", "risk_grade",
                "rag", "sma_status", "ecl", "ecl_stage", "lifetime_ecl",
                "recommended_action", "review_cadence", "action_owner", "raw_features_json"
            ]:
                if k in rec and rec[k] is not None:
                    setattr(loan, k, rec[k])
            count += 1
        return count


# --------------------------------------------------------------------------- #
# Portfolio Simulation Engines (Scenario Lab & Contagion Cascade)
# --------------------------------------------------------------------------- #


def simulate_scenario_portfolio(
    repo_bps: float = 0.0,
    gdp_shock_pct: float = 0.0,
    sector_stress: float = 0.0,
    target_sector: str | None = None,
    branch_code: str | None = None,
    url_or_path: Path | str | None = None,
) -> dict[str, Any]:
    from src.features.macro_overlay import DEFAULT_BETA, SECTOR_BETA, apply_scenario

    init_db(url_or_path)
    with get_db(url_or_path) as session:
        stmt = select(LoanAccount)
        if branch_code and branch_code != "all":
            stmt = stmt.where(LoanAccount.branch_code == str(branch_code))
        loans = session.execute(stmt).scalars().all()

        total_accounts = len(loans)
        if total_accounts == 0:
            return {
                "status": "success",
                "repo_bps": repo_bps,
                "gdp_shock_pct": gdp_shock_pct,
                "sector_stress": sector_stress,
                "target_sector": target_sector or "all_cyclical",
                "total_accounts": 0,
                "baseline_ecl": 0.0,
                "stressed_ecl": 0.0,
                "ecl_uplift_pct": 0.0,
                "weighted_avg_pd_base": 0.0,
                "weighted_avg_pd_stressed": 0.0,
                "by_grade": [],
                "by_sector": [],
            }

        pd_values = np.array([float(l.pd_12m if l.pd_12m is not None else 0.05) for l in loans], dtype=float)
        sectors = np.array([str(l.sector if l.sector else "other") for l in loans], dtype=object)
        sanction_limits = np.array([float(l.sanction_limit if l.sanction_limit is not None else 1000000.0) for l in loans], dtype=float)
        base_ecls = np.array([
            float(l.ecl if l.ecl is not None else (sanction_limits[i] * pd_values[i] * 0.45))
            for i, l in enumerate(loans)
        ], dtype=float)
        grades = [str(l.risk_grade if l.risk_grade else "RG5") for l in loans]

        if repo_bps == 0.0 and gdp_shock_pct == 0.0 and sector_stress == 0.0:
            stressed_pds = pd_values.copy()
            stressed_ecls = base_ecls.copy()
        else:
            stressed_pds = apply_scenario(
                pd_values,
                sectors=sectors,
                repo_hike_bps=repo_bps,
                gdp_shock_pct=-abs(float(gdp_shock_pct)),
                sector_stress=sector_stress,
                target_sector=target_sector,
            )
            safe_pds = np.maximum(pd_values, 1e-5)
            scale = stressed_pds / safe_pds
            stressed_ecls = base_ecls * scale

        baseline_ecl = float(np.sum(base_ecls))
        stressed_ecl = float(np.sum(stressed_ecls))
        total_sanctioned = float(np.sum(sanction_limits))

        if total_sanctioned > 0:
            weighted_pd_base = float(np.sum(pd_values * sanction_limits) / total_sanctioned)
            weighted_pd_stressed = float(np.sum(stressed_pds * sanction_limits) / total_sanctioned)
        else:
            weighted_pd_base = float(np.mean(pd_values))
            weighted_pd_stressed = float(np.mean(stressed_pds))

        uplift_pct = float(((stressed_ecl / baseline_ecl) - 1.0) * 100.0) if baseline_ecl > 0 else 0.0

        # Grade distribution (RG1 to RG10 in numeric order)
        grade_order = [f"RG{i}" for i in range(1, 11)]
        grade_map: dict[str, dict[str, Any]] = {
            g: {"grade": g, "base": 0.0, "stress": 0.0, "count": 0, "sum_pd_base": 0.0, "sum_pd_stress": 0.0}
            for g in grade_order
        }
        for i, g in enumerate(grades):
            if g not in grade_map:
                grade_map[g] = {"grade": g, "base": 0.0, "stress": 0.0, "count": 0, "sum_pd_base": 0.0, "sum_pd_stress": 0.0}
            item = grade_map[g]
            item["base"] += base_ecls[i]
            item["stress"] += stressed_ecls[i]
            item["count"] += 1
            item["sum_pd_base"] += pd_values[i]
            item["sum_pd_stress"] += stressed_pds[i]

        by_grade = []
        for g in grade_order:
            if g in grade_map:
                v = grade_map[g]
                cnt = v["count"]
                by_grade.append({
                    "grade": g,
                    "base": round(v["base"]),
                    "stress": round(v["stress"]),
                    "count": cnt,
                    "avg_pd_base": round(v["sum_pd_base"] / cnt, 4) if cnt else 0.0,
                    "avg_pd_stress": round(v["sum_pd_stress"] / cnt, 4) if cnt else 0.0,
                })

        # Append any non-standard risk grades present in data
        for g, v in grade_map.items():
            if g not in grade_order and v["count"] > 0:
                cnt = v["count"]
                by_grade.append({
                    "grade": g,
                    "base": round(v["base"]),
                    "stress": round(v["stress"]),
                    "count": cnt,
                    "avg_pd_base": round(v["sum_pd_base"] / cnt, 4) if cnt else 0.0,
                    "avg_pd_stress": round(v["sum_pd_stress"] / cnt, 4) if cnt else 0.0,
                })

        # Sector breakdown
        sector_map: dict[str, dict[str, Any]] = {}
        for i, s in enumerate(sectors):
            if s not in sector_map:
                sector_map[s] = {
                    "sector": s,
                    "beta": float(SECTOR_BETA.get(s, DEFAULT_BETA)),
                    "base_ecl": 0.0,
                    "stressed_ecl": 0.0,
                    "count": 0,
                }
            s_item = sector_map[s]
            s_item["base_ecl"] += base_ecls[i]
            s_item["stressed_ecl"] += stressed_ecls[i]
            s_item["count"] += 1

        by_sector = []
        for s, s_data in sector_map.items():
            base_s = s_data["base_ecl"]
            stress_s = s_data["stressed_ecl"]
            up_s = ((stress_s / max(base_s, 1.0)) - 1.0) * 100.0 if base_s > 0 else 0.0
            by_sector.append({
                "sector": s,
                "beta": s_data["beta"],
                "base_ecl": round(base_s),
                "stressed_ecl": round(stress_s),
                "uplift_pct": round(up_s, 2),
                "accounts": s_data["count"],
            })
        by_sector.sort(key=lambda x: x["uplift_pct"], reverse=True)

        return {
            "status": "success",
            "repo_bps": repo_bps,
            "gdp_shock_pct": gdp_shock_pct,
            "sector_stress": sector_stress,
            "target_sector": target_sector or "all_cyclical",
            "total_accounts": total_accounts,
            "baseline_ecl": round(baseline_ecl, 2),
            "stressed_ecl": round(stressed_ecl, 2),
            "ecl_uplift_pct": round(uplift_pct, 2),
            "weighted_avg_pd_base": round(weighted_pd_base, 4),
            "weighted_avg_pd_stressed": round(weighted_pd_stressed, 4),
            "by_grade": by_grade,
            "by_sector": by_sector,
        }


def simulate_contagion_portfolio(
    transmission_rate: float = 0.35,
    stress_threshold: float = 0.16,
    shock_seeds: list[str] | None = None,
    max_rounds: int = 5,
    branch_code: str | None = None,
    sector: str | None = None,
    url_or_path: Path | str | None = None,
) -> dict[str, Any]:
    from src.features.graph_contagion import build_contagion_graph, contagion_features

    init_db(url_or_path)
    with get_db(url_or_path) as session:
        stmt = select(LoanAccount)
        if branch_code and branch_code != "all":
            stmt = stmt.where(LoanAccount.branch_code == str(branch_code))
        if sector and sector != "all":
            stmt = stmt.where(LoanAccount.sector == str(sector))
        loans = session.execute(stmt).scalars().all()

        total_nodes = len(loans)
        if total_nodes == 0:
            return {
                "status": "success",
                "transmission_rate": transmission_rate,
                "stress_threshold": stress_threshold,
                "total_nodes": 0,
                "total_edges": 0,
                "initial_stressed_nodes": 0,
                "final_stressed_nodes": 0,
                "contagion_spread_count": 0,
                "baseline_ecl": 0.0,
                "stressed_ecl": 0.0,
                "cascade_ecl_delta": 0.0,
                "rounds_executed": 0,
                "rounds_history": [],
                "top_contagion_hubs": [],
                "communities": [],
                "scatter": [],
            }

        ids = [l.loan_id for l in loans]
        base_pds = np.array([float(l.pd_12m if l.pd_12m is not None else 0.05) for l in loans], dtype=float)
        eads = np.array([float(l.sanction_limit if l.sanction_limit is not None else 1000000.0) for l in loans], dtype=float)
        base_ecls = np.array([
            float(loans[i].ecl if loans[i].ecl is not None else (eads[i] * base_pds[i] * 0.45))
            for i in range(total_nodes)
        ], dtype=float)
        sectors = [str(l.sector if l.sector else "other") for l in loans]
        states = [str(l.state if l.state else "MH") for l in loans]
        rags = [
            str(l.rag if l.rag else ("Red" if base_pds[i] >= 0.16 else ("Amber" if base_pds[i] >= 0.05 else "Green")))
            for i, l in enumerate(loans)
        ]

        # Build supplier network
        g = build_contagion_graph(ids, base_pds, avg_degree=3, seed=42)
        total_edges = g.number_of_edges()

        # Initial stressed cohort
        seed_set = set(shock_seeds or [])
        stressed_set = {
            ids[i] for i in range(total_nodes)
            if base_pds[i] >= stress_threshold or ids[i] in seed_set
        }
        initial_stressed_count = len(stressed_set)

        # Multi-round cascade
        current_pds = base_pds.copy()
        id_to_idx = {loan_id: i for i, loan_id in enumerate(ids)}

        # Ensure shock seeds are elevated to distress in current_pds
        for s in seed_set:
            if s in id_to_idx:
                idx = id_to_idx[s]
                current_pds[idx] = max(current_pds[idx], max(stress_threshold, 0.50))

        safe_base_pds = np.maximum(base_pds, 1e-5)
        init_scale = current_pds / safe_base_pds
        round_0_ecl = float(np.sum(base_ecls * init_scale))

        rounds_history = [{
            "round": 0,
            "stressed_count": len(stressed_set),
            "newly_infected": 0,
            "total_ecl": round(round_0_ecl, 2),
        }]

        rounds_executed = 0
        for r in range(1, max_rounds + 1):
            rounds_executed = r
            newly_stressed_in_round = set()
            new_pds = current_pds.copy()

            for node in g.nodes:
                if node not in id_to_idx:
                    continue
                node_idx = id_to_idx[node]

                preds = list(g.predecessors(node))
                stressed_preds = [p for p in preds if p in stressed_set]

                if stressed_preds:
                    pressure = sum(
                        g[p][node].get("weight", 0.3) * (current_pds[id_to_idx[p]] / max(stress_threshold, 1e-4))
                        for p in stressed_preds if p in id_to_idx
                    )
                    cascade_shock = transmission_rate * pressure
                    p0 = np.clip(base_pds[node_idx], 1e-4, 1 - 1e-4)
                    z0 = np.log(p0 / (1 - p0))
                    z_new = z0 + cascade_shock
                    p_new = float(1.0 / (1.0 + np.exp(-z_new)))
                    new_pds[node_idx] = max(current_pds[node_idx], p_new)

                    if new_pds[node_idx] >= stress_threshold and node not in stressed_set:
                        newly_stressed_in_round.add(node)

            current_pds = new_pds
            stressed_set.update(newly_stressed_in_round)

            scale_r = current_pds / safe_base_pds
            round_ecl = float(np.sum(base_ecls * scale_r))

            rounds_history.append({
                "round": r,
                "stressed_count": len(stressed_set),
                "newly_infected": len(newly_stressed_in_round),
                "total_ecl": round(round_ecl, 2),
            })

            if not newly_stressed_in_round:
                break

        final_stressed_count = len(stressed_set)
        contagion_spread_count = final_stressed_count - initial_stressed_count

        final_scale = current_pds / safe_base_pds
        final_ecls = base_ecls * final_scale

        baseline_ecl = float(np.sum(base_ecls))
        stressed_ecl = float(np.sum(final_ecls))
        cascade_ecl_delta = float(max(0.0, stressed_ecl - baseline_ecl))

        # Sync post-cascade PDs to graph node attributes before computing graph features
        for node in g.nodes:
            if node in id_to_idx:
                g.nodes[node]["pd"] = float(current_pds[id_to_idx[node]])

        # Graph node features evaluated with dynamic stress threshold
        feats_df = contagion_features(g, stress_threshold=stress_threshold)
        feats_map = {row["loan_id"]: row for row in feats_df.to_dict(orient="records")}

        # Scatter items for visualization
        scatter_items = []
        for i, loan_id in enumerate(ids):
            gf = feats_map.get(loan_id, {})
            is_init_stressed = base_pds[i] >= stress_threshold or loan_id in seed_set
            is_now_stressed = loan_id in stressed_set

            status = "initial_stressed" if is_init_stressed else ("contagion_infected" if is_now_stressed else "stable")
            c_pd = current_pds[i]
            post_rag = "Red" if c_pd >= stress_threshold else ("Amber" if c_pd >= 0.05 else "Green")

            scatter_items.append({
                "id": loan_id,
                "x": round(eads[i] / 1000),  # ₹K
                "y": round(float(c_pd) * 1000) / 10,  # PD %
                "base_pd": round(float(base_pds[i]) * 1000) / 10,
                "z": round(float(final_ecls[i])),
                "base_ecl": round(float(base_ecls[i])),
                "rag": post_rag,
                "base_rag": rags[i],
                "status": status,
                "stressed_neighbors": int(gf.get("stressed_neighbors", 0)),
                "pagerank": float(gf.get("pagerank", 0.0)),
                "sector": sectors[i],
                "state": states[i],
            })

        # Community clusters (State × Sector)
        comm_map: dict[str, list[int]] = {}
        for i, loan_id in enumerate(ids):
            key = f"{states[i]}·{sectors[i]}"
            comm_map.setdefault(key, []).append(i)

        communities = []
        for name, indices in comm_map.items():
            cnt = len(indices)
            avg_pd = float(np.mean(current_pds[indices]))
            base_avg_pd = float(np.mean(base_pds[indices]))
            red_count = sum(1 for idx in indices if current_pds[idx] >= stress_threshold)
            c_ecl = float(np.sum(final_ecls[indices]))
            infected = sum(1 for idx in indices if ids[idx] in stressed_set and base_pds[idx] < stress_threshold)
            communities.append({
                "name": name,
                "members_count": cnt,
                "avgPd": avg_pd,
                "baseAvgPd": base_avg_pd,
                "redCount": red_count,
                "ecl": round(c_ecl),
                "infected_count": infected,
            })
        communities.sort(key=lambda c: c["avgPd"], reverse=True)

        # Top contagion hubs (sorted by stressed neighbors and centrality)
        hubs_sorted = sorted(
            [
                {
                    "loan_id": loan_id,
                    "stressed_neighbors": int(feats_map.get(loan_id, {}).get("stressed_neighbors", 0)),
                    "pagerank": round(float(feats_map.get(loan_id, {}).get("pagerank", 0.0)), 5),
                    "n_links": int(feats_map.get(loan_id, {}).get("n_links", 0)),
                    "downstream_ead": round(float(eads[id_to_idx[loan_id]] + sum(eads[id_to_idx[s]] for s in g.successors(loan_id) if s in id_to_idx))),
                    "pd_12m": round(float(current_pds[id_to_idx[loan_id]]), 4),
                    "sector": sectors[id_to_idx[loan_id]],
                }
                for loan_id in ids
            ],
            key=lambda h: (h["stressed_neighbors"], h["pagerank"]),
            reverse=True,
        )[:10]

        return {
            "status": "success",
            "transmission_rate": transmission_rate,
            "stress_threshold": stress_threshold,
            "total_nodes": total_nodes,
            "total_edges": total_edges,
            "initial_stressed_nodes": initial_stressed_count,
            "final_stressed_nodes": final_stressed_count,
            "contagion_spread_count": contagion_spread_count,
            "baseline_ecl": round(baseline_ecl, 2),
            "stressed_ecl": round(stressed_ecl, 2),
            "cascade_ecl_delta": round(cascade_ecl_delta, 2),
            "rounds_executed": rounds_executed,
            "rounds_history": rounds_history,
            "top_contagion_hubs": hubs_sorted,
            "communities": communities[:10],
            "scatter": scatter_items,
        }


