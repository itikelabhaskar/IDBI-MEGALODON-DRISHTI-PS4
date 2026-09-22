# supplier network features that actually feed the model. each node aggregates its
# neighbours' OBSERVABLE stress (bounces, filing delay, turnover), never their labels,
# so everything here is known at scoring time.

from __future__ import annotations

import networkx as nx
import numpy as np
import pandas as pd

from src.config import SEED

# Model features: only the neighbour-stress aggregates carry signal.
# n_links / dependence_concentration stay as DISPLAY columns (kept on the
# canonical frame) but are excluded from the model to avoid noise features.
GRAPH_FEATURES: list[str] = [
    "nbr_stress_score",
    "nbr_bounce_share",
]


def _observable_stress(df: pd.DataFrame) -> np.ndarray:
    z = lambda s: (s - s.mean()) / (s.std() + 1e-9)  # noqa: E731
    return (
        z(df["emi_bounce_6m"]) + z(df["gst_filing_delay_days"]) - z(df["gst_turnover_trend_pct"])
    ).to_numpy() / 3.0


def build_supplier_graph(df: pd.DataFrame, seed: int = SEED, avg_degree: int = 6) -> nx.Graph:
    rng = np.random.default_rng(seed + 2)
    n = len(df)
    ids = df["loan_id"].to_numpy()
    comm = df["community_id"].to_numpy()

    g = nx.Graph()
    g.add_nodes_from(ids)

    by_comm: dict[int, np.ndarray] = {
        c: np.flatnonzero(comm == c) for c in np.unique(comm)
    }
    for i in range(n):
        k = rng.poisson(avg_degree / 2)  # undirected: each endpoint draws half
        for _ in range(k):
            if rng.random() < 0.85 and len(by_comm[comm[i]]) > 1:
                j = int(rng.choice(by_comm[comm[i]]))
            else:
                j = int(rng.integers(0, n))
            if j != i:
                g.add_edge(ids[i], ids[j], weight=float(rng.uniform(0.1, 1.0)))
    return g


def attach_graph_features(df: pd.DataFrame, seed: int = SEED) -> pd.DataFrame:
    g = build_supplier_graph(df, seed=seed)
    stress = _observable_stress(df)
    bounce2 = (df["emi_bounce_6m"].to_numpy() >= 2).astype(float)
    idx_of = {lid: i for i, lid in enumerate(df["loan_id"].to_numpy())}

    n_links, nbr_stress, nbr_bounce, dep_conc = [], [], [], []
    for lid in df["loan_id"]:
        nbrs = list(g.neighbors(lid))
        n_links.append(len(nbrs))
        if nbrs:
            pos = [idx_of[m] for m in nbrs]
            nbr_stress.append(float(np.mean(stress[pos])))
            nbr_bounce.append(float(np.mean(bounce2[pos])))
            w = np.array([g[lid][m]["weight"] for m in nbrs])
            dep_conc.append(float(w.max() / w.sum()))
        else:
            nbr_stress.append(0.0)
            nbr_bounce.append(0.0)
            dep_conc.append(0.0)

    out = df.copy()
    out["n_links"] = n_links
    out["nbr_stress_score"] = np.round(nbr_stress, 4)
    out["nbr_bounce_share"] = np.round(nbr_bounce, 4)
    out["dependence_concentration"] = np.round(dep_conc, 4)
    return out
