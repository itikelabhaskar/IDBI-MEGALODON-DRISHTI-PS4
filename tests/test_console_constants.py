"""The console repeats a few framework constants; these tests stop them drifting."""
from __future__ import annotations

import re
from pathlib import Path

from src.framework.interpretation import _GRADE_EDGES

ROOT = Path(__file__).resolve().parents[1]


def test_console_grade_edges_match_framework():
    src = (ROOT / "web" / "src" / "lib" / "format.ts").read_text(encoding="utf-8")
    block = src[src.index("export const GRADE_EDGES") :].split("];", 1)[0]
    console = [(g, float(v)) for g, v in re.findall(r'\["(RG\d+)",\s*([0-9.]+)\]', block)]
    assert console == [(g, e) for g, e in _GRADE_EDGES if g != "RG10"]
