# append-only sqlite trail of officer decisions. the model proposes an action, the
# officer accepts, overrides or defers, and the reason is recorded.

from __future__ import annotations

import sqlite3
from pathlib import Path
from typing import Any

from src.config import ROOT
from src.db.session import (
    get_recent_decisions,
    init_db as db_init,
    log_decision as db_log_decision,
)

_DEFAULT_DB = ROOT / "logs" / "hitl_audit.sqlite"


def _conn(path: Path | str | None = None) -> sqlite3.Connection:
    db = Path(path) if path else _DEFAULT_DB
    db.parent.mkdir(parents=True, exist_ok=True)
    return sqlite3.connect(db)


def init_db(path: Path | str | None = None) -> None:
    db_init(path)


def log_decision(
    *,
    loan_id: str,
    segment: str,
    proposed_action: str,
    proposed_sma: str,
    pd: float,
    risk_grade: str,
    decision: str,
    override_action: str | None = None,
    reason: str = "",
    officer: str = "demo_officer",
    path: Path | str | None = None,
) -> int:
    return db_log_decision(
        loan_id=loan_id,
        segment=segment,
        proposed_action=proposed_action,
        proposed_sma=proposed_sma,
        pd=pd,
        risk_grade=risk_grade,
        decision=decision,
        override_action=override_action,
        reason=reason,
        officer=officer,
        url_or_path=path,
    )


def list_decisions(
    loan_id: str | None = None,
    limit: int = 50,
    path: Path | str | None = None,
) -> list[dict[str, Any]]:
    return get_recent_decisions(
        loan_id=loan_id,
        limit=limit,
        url_or_path=path,
    )
