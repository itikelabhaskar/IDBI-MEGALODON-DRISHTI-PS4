# zone -> region -> branch overlay for the india book, so the controlling office can
# drill the way it actually works: find the branch, then open its accounts.
#
# display only, never a model feature. branch proxies geography that state already
# carries, and conditioning credit on it is the disparate impact problem the fairness
# audit exists to catch. tests/test_org_hierarchy.py pins that.

from __future__ import annotations

import zlib

import pandas as pd

# Zone → state → regions. States are the twelve the generator emits; regions and
# branch localities are real industrial/MSME clusters in those cities, which is
# what makes a branch table read as plausible to a banker.
ZONE_STRUCTURE: dict[str, dict[str, list[str]]] = {
    "West": {"MH": ["Mumbai", "Pune"], "GJ": ["Ahmedabad"], "MP": ["Indore"]},
    "South": {
        "TN": ["Chennai", "Coimbatore"],
        "KA": ["Bengaluru"],
        "TG": ["Hyderabad"],
        "KL": ["Kochi"],
    },
    "North": {
        "DL": ["New Delhi"],
        "UP": ["Lucknow", "Kanpur"],
        "RJ": ["Jaipur"],
        "PB": ["Ludhiana"],
    },
    "East": {"WB": ["Kolkata"]},
}

# Three branches per region, named for genuine MSME clusters.
REGION_BRANCHES: dict[str, list[str]] = {
    "Mumbai": ["Fort", "Andheri MIDC", "Bhiwandi"],
    "Pune": ["Hadapsar", "Pimpri", "Chakan"],
    "Ahmedabad": ["Naroda", "Vatva", "Odhav"],
    "Indore": ["Pithampur", "Sanwer Road", "Dewas Naka"],
    "Chennai": ["Ambattur", "Guindy", "Sriperumbudur"],
    "Coimbatore": ["Peelamedu", "Tirupur", "SIDCO"],
    "Bengaluru": ["Peenya", "Bommasandra", "Jigani"],
    "Hyderabad": ["Balanagar", "Jeedimetla", "Patancheru"],
    "Kochi": ["Kalamassery", "Aluva", "Angamaly"],
    "New Delhi": ["Okhla", "Bawana", "Narela"],
    "Lucknow": ["Amausi", "Chinhat", "Talkatora"],
    "Kanpur": ["Panki", "Dada Nagar", "Fazalganj"],
    "Jaipur": ["Sitapura", "Vishwakarma", "Bagru"],
    "Ludhiana": ["Focal Point", "Dhandari", "Sahnewal"],
    "Kolkata": ["Howrah", "Dankuni", "Kalyani"],
}

ORG_COLUMNS: list[str] = ["zone", "region", "branch_code", "branch_name"]


def _build_registry() -> list[dict[str, str]]:
    rows: list[dict[str, str]] = []
    code = 1001
    for zone in sorted(ZONE_STRUCTURE):
        for state in sorted(ZONE_STRUCTURE[zone]):
            for region in ZONE_STRUCTURE[zone][state]:
                for locality in REGION_BRANCHES[region]:
                    rows.append(
                        {
                            "zone": zone,
                            "state": state,
                            "region": region,
                            "branch_code": str(code),
                            "branch_name": f"{region} — {locality}",
                        }
                    )
                    code += 1
    return rows


BRANCH_REGISTRY: list[dict[str, str]] = _build_registry()

# state -> that state's branches, for in-state assignment.
_BY_STATE: dict[str, list[dict[str, str]]] = {}
for _b in BRANCH_REGISTRY:
    _BY_STATE.setdefault(_b["state"], []).append(_b)

_FALLBACK = {
    "zone": "Unassigned",
    "state": "unknown",
    "region": "Unassigned",
    "branch_code": "0000",
    "branch_name": "Unassigned",
}


def _stable_index(key: str, n: int) -> int:
    return zlib.crc32(str(key).encode("utf-8")) % max(n, 1)


def branch_for(loan_id: str, state: str) -> dict[str, str]:
    branches = _BY_STATE.get(str(state))
    if not branches:
        return dict(_FALLBACK)
    return dict(branches[_stable_index(loan_id, len(branches))])


def attach_org(df: pd.DataFrame, loan_id_col: str = "loan_id",
               state_col: str = "state") -> pd.DataFrame:
    out = df.copy()
    if loan_id_col not in out.columns or state_col not in out.columns:
        for col, val in (("zone", _FALLBACK["zone"]), ("region", _FALLBACK["region"]),
                         ("branch_code", _FALLBACK["branch_code"]),
                         ("branch_name", _FALLBACK["branch_name"])):
            out[col] = val
        return out

    assigned = [
        branch_for(lid, st)
        for lid, st in zip(out[loan_id_col].astype(str), out[state_col].astype(str))
    ]
    for col in ORG_COLUMNS:
        out[col] = [a[col] for a in assigned]
    return out


def branch_rollup(
    scored: pd.DataFrame,
    pd_col: str = "pd",
    ecl_col: str = "ecl",
    ead_col: str = "ticket_size",
    rag_col: str = "rag",
    label_col: str = "default_12m",
    flag_threshold: float = 0.16,
) -> pd.DataFrame:
    required = {"zone", "region", "branch_code", "branch_name", pd_col}
    missing = required - set(scored.columns)
    if missing:
        raise ValueError(f"branch_rollup missing columns: {sorted(missing)}")

    df = scored.copy()
    df["_flagged"] = (df[pd_col] >= flag_threshold).astype(int)
    if rag_col in df.columns:
        for bucket in ("Green", "Amber", "Red"):
            df[f"_rag_{bucket.lower()}"] = (df[rag_col] == bucket).astype(int)

    agg: dict[str, tuple[str, str]] = {
        "accounts": (pd_col, "size"),
        "avg_pd": (pd_col, "mean"),
        "max_pd": (pd_col, "max"),
        "flagged": ("_flagged", "sum"),
    }
    if ecl_col in df.columns:
        agg["ecl"] = (ecl_col, "sum")
    if ead_col in df.columns:
        agg["ead"] = (ead_col, "sum")
    for bucket in ("green", "amber", "red"):
        if f"_rag_{bucket}" in df.columns:
            agg[bucket] = (f"_rag_{bucket}", "sum")
    if label_col in df.columns:
        agg["actual_default_rate"] = (label_col, "mean")

    rolled = (
        df.groupby(["zone", "region", "branch_code", "branch_name"], observed=True)
        .agg(**agg)
        .reset_index()
    )
    rolled["flag_rate"] = rolled["flagged"] / rolled["accounts"].clip(lower=1)
    return rolled.sort_values("avg_pd", ascending=False).reset_index(drop=True)
