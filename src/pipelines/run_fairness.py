# runs the group-fairness audit on each trained segment's held-out slice and writes
# the disparate-impact table the model risk committee asks for. the served console
# reads this file, so the fairness panel shows a measured number rather than a
# constant.

from __future__ import annotations

import json

import joblib

from src.explain.fairness import group_fairness
from src.pipelines.run_operating_points import _segment_test

# attributes worth auditing across, in the order a credit committee would ask.
# borrower size first, since that is the MSME cut the RBI framework cares about.
CANDIDATE_ATTRS = ("sub_segment", "sector", "state", "loan_type")


def run() -> None:
    from src.serving.segments import SEGMENT_SPECS

    for segment, spec in SEGMENT_SPECS.items():
        model_path = spec.model_dir / "model.pkl"
        if not model_path.exists():
            print(f"[fair] {segment}: not trained, skipped")
            continue

        bundle = joblib.load(model_path)
        try:
            canonical_te, y_te = _segment_test(segment)
        except Exception as exc:
            # segments whose held-out slice needs a download we cannot reach, or
            # that have no split helper, are reported rather than crashing the run.
            print(f"[fair] {segment}: no held-out slice available ({exc}), skipped")
            continue
        scored = canonical_te.copy()
        scored["pd"] = bundle.predict_pd(spec.engineer(canonical_te))
        scored["default_12m"] = y_te

        audits = {}
        for attr in CANDIDATE_ATTRS:
            if attr not in scored.columns or scored[attr].nunique() < 2:
                continue
            result = group_fairness(scored, attr)
            if result["disparate_impact_ratio"] is None:
                continue
            audits[attr] = result

        if not audits:
            print(f"[fair] {segment}: no auditable attribute on the canonical frame")
            continue

        # the headline the console shows is borrower size when it is available,
        # because that is the cut a credit committee asks about first. the worst
        # attribute is carried alongside it so a passing headline can never hide a
        # failing cut, and all_pass is what the console badge should key off.
        if "sub_segment" in audits:
            headline_attr = "sub_segment"
        else:
            headline_attr = min(audits, key=lambda a: audits[a]["disparate_impact_ratio"])
        worst_attr = min(audits, key=lambda a: audits[a]["disparate_impact_ratio"])

        payload = {
            "segment": segment,
            "headline_attribute": headline_attr,
            "disparate_impact_ratio": audits[headline_attr]["disparate_impact_ratio"],
            "passes_80pct_rule": audits[headline_attr]["passes_80pct_rule"],
            "worst_attribute": worst_attr,
            "worst_disparate_impact_ratio": audits[worst_attr]["disparate_impact_ratio"],
            "all_attributes_pass": all(a["passes_80pct_rule"] for a in audits.values()),
            "failing_attributes": [a for a, v in audits.items() if not v["passes_80pct_rule"]],
            "audits": audits,
            "note": (
                "Disparate impact ratio is min/max selection rate across groups; the 80% "
                "rule treats >=0.80 as passing. These are the attributes carried on the "
                "canonical frame, not legally protected characteristics, which the bank "
                "holds and we do not. Branch and region are excluded from the model by a "
                "regression test and appear here only as routing metadata."
            ),
        }
        out = spec.model_dir / "fairness.json"
        out.write_text(json.dumps(payload, indent=2))
        verdict = "passes" if payload["passes_80pct_rule"] else "FAILS"
        print(
            f"[fair] {segment}: {headline_attr} DI={payload['disparate_impact_ratio']:.3f} "
            f"({verdict} 80% rule), {len(audits)} attributes audited -> {out}"
        )
        if payload["failing_attributes"]:
            print(
                f"[fair] {segment}: below the 80% rule on "
                f"{', '.join(payload['failing_attributes'])} "
                f"(worst {worst_attr} {payload['worst_disparate_impact_ratio']:.3f})"
            )


if __name__ == "__main__":
    run()
