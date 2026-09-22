# the supplier network view used by the console. separate from graph_signals.py on
# purpose: this one is display only and never reaches the model.

from __future__ import annotations

import networkx as nx
import numpy as np
import pandas as pd

STRESS_PD_THRESHOLD = 0.16  # neighbour counts "stressed" above this PD


def build_contagion_graph(
    ids: list[str],
    pd_values: np.ndarray,
    avg_degree: int = 3,
    seed: int = 42,
) -> nx.DiGraph:
    rng = np.random.default_rng(seed)
    n = len(ids)
    pd_values = np.asarray(pd_values, dtype=float)
    g = nx.DiGraph()
    for i, node in enumerate(ids):
        g.add_node(node, pd=float(pd_values[i]))

    # Preferential linking: probability a node is chosen as a counterparty rises
    # with its PD (stress concentrates), giving realistic contagion clusters.
    weights = 0.2 + pd_values
    weights = weights / weights.sum()
    for i, node in enumerate(ids):
        k = rng.poisson(avg_degree)
        if k <= 0:
            continue
        partners = rng.choice(n, size=min(k, n - 1), replace=False, p=weights)
        for j in partners:
            if ids[j] == node:
                continue
            share = float(rng.uniform(0.1, 1.0))  # dependence share of that link
            g.add_edge(node, ids[j], weight=share)
    return g


def contagion_features(
    g: nx.DiGraph,
    stress_threshold: float = STRESS_PD_THRESHOLD,
) -> pd.DataFrame:
    deg_cent = nx.degree_centrality(g)
    pagerank = nx.pagerank(g, weight="weight") if g.number_of_edges() else {n: 0.0 for n in g}
    rows = []
    for node in g.nodes:
        succ = list(g.successors(node))
        pred = list(g.predecessors(node))
        stressed = sum(
            1 for m in set(succ) | set(pred) if g.nodes[m].get("pd", 0.0) >= stress_threshold
        )
        in_weights = [g[p][node].get("weight", 0.0) for p in pred]
        dependence = float(max(in_weights) / sum(in_weights)) if in_weights else 0.0
        rows.append(
            {
                "loan_id": node,
                "degree_centrality": round(deg_cent.get(node, 0.0), 5),
                "pagerank": round(pagerank.get(node, 0.0), 6),
                "stressed_neighbors": int(stressed),
                "dependence_concentration": round(dependence, 3),
                "n_links": g.degree(node),
            }
        )
    return pd.DataFrame(rows)


def summarize(g: nx.DiGraph, feats: pd.DataFrame) -> dict:
    stressed_hubs = feats.sort_values(
        ["stressed_neighbors", "pagerank"], ascending=False
    ).head(10)
    return {
        "nodes": g.number_of_nodes(),
        "edges": g.number_of_edges(),
        "avg_stressed_neighbors": round(float(feats["stressed_neighbors"].mean()), 3),
        "top_contagion_hubs": stressed_hubs[
            ["loan_id", "stressed_neighbors", "pagerank", "n_links"]
        ].to_dict(orient="records"),
    }
