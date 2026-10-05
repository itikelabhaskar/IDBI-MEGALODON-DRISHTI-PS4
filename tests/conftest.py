"""Keep the test suite out of the demo database.

`src.db.session` falls back to `logs/hitl_audit.sqlite`, the same file the local
API and console read, so every test that scored, appraised or uploaded an
account used to leave it in the live portfolio (IDBI_RESTRUCTURE_TEST_99,
UW_TEST_2026_01, BATCH_ACC_0x ...). Point every test at a throwaway SQLite file.
"""
from __future__ import annotations

import os

import pytest


@pytest.fixture(scope="session", autouse=True)
def _isolated_database(tmp_path_factory: pytest.TempPathFactory):
    db = tmp_path_factory.mktemp("db") / "test_audit.sqlite"
    previous = os.environ.get("DATABASE_URL")
    os.environ["DATABASE_URL"] = f"sqlite:///{db}"
    yield
    if previous is None:
        os.environ.pop("DATABASE_URL", None)
    else:
        os.environ["DATABASE_URL"] = previous
