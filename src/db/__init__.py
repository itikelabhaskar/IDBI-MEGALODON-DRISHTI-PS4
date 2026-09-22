# re-exports so callers can do `from src.db import log_decision` instead of
# reaching into models and session separately.

from __future__ import annotations

from src.db.models import Base, Decision, DriftFairnessHistory, WatchlistRun
from src.db.session import (
    get_db,
    get_db_engine,
    get_drift_history,
    get_recent_decisions,
    get_recent_watchlist_runs,
    init_db,
    log_decision,
    log_drift_fairness_run,
    log_watchlist_run,
)

__all__ = [
    "Base",
    "Decision",
    "WatchlistRun",
    "DriftFairnessHistory",
    "get_db",
    "get_db_engine",
    "init_db",
    "log_decision",
    "get_recent_decisions",
    "log_watchlist_run",
    "get_recent_watchlist_runs",
    "log_drift_fairness_run",
    "get_drift_history",
]
