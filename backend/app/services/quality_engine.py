import re
import pandas as pd

from .profiler import profile_dataset


def compute_quality_score(df: pd.DataFrame) -> dict:
    """A transparent, formula-based data quality score (0-100) built from
    real component measurements — not a fabricated number."""
    profile = profile_dataset(df)
    n_rows, n_cols = df.shape

    completeness = 100 - profile["missing_cell_pct"]
    uniqueness = 100 - profile["duplicate_pct"]

    n_constant = len(profile["constant_columns"])
    n_high_card = len(profile["high_cardinality_columns"])
    structural_issues = n_constant + n_high_card
    consistency = max(0.0, 100 - (structural_issues / max(n_cols, 1)) * 100)

    # validity: fraction of numeric columns with no extreme outlier burden
    numeric_cols = profile["numeric_summary"]
    if numeric_cols:
        outlier_ratios = [
            v["outlier_count"] / n_rows if n_rows else 0 for v in numeric_cols.values()
        ]
        avg_outlier_ratio = sum(outlier_ratios) / len(outlier_ratios)
        validity = max(0.0, 100 - avg_outlier_ratio * 200)
    else:
        validity = 100.0

    weights = {"completeness": 0.35, "uniqueness": 0.2, "consistency": 0.2, "validity": 0.25}
    components = {
        "completeness": round(completeness, 1),
        "uniqueness": round(uniqueness, 1),
        "consistency": round(consistency, 1),
        "validity": round(validity, 1),
    }
    overall = round(sum(components[k] * w for k, w in weights.items()), 1)

    issues = []
    if profile["missing_cell_pct"] > 0:
        issues.append({
            "severity": "high" if profile["missing_cell_pct"] > 15 else "medium",
            "type": "missing_values",
            "message": f"{profile['missing_cell_pct']}% of all cells are missing.",
        })
    if profile["duplicate_pct"] > 0:
        issues.append({
            "severity": "medium",
            "type": "duplicate_rows",
            "message": f"{profile['n_duplicate_rows']} duplicate rows ({profile['duplicate_pct']}%).",
        })
    for c in profile["constant_columns"]:
        issues.append({"severity": "low", "type": "constant_column", "message": f"Column '{c}' has only one distinct value.", "column": c})
    for c in profile["high_cardinality_columns"]:
        issues.append({"severity": "low", "type": "high_cardinality", "message": f"Column '{c}' has very high cardinality for a categorical column.", "column": c})
    for col, stats in numeric_cols.items():
        if n_rows and stats["outlier_count"] / n_rows > 0.05:
            issues.append({
                "severity": "medium", "type": "outliers", "column": col,
                "message": f"Column '{col}' has {stats['outlier_count']} likely outliers ({round(100*stats['outlier_count']/n_rows,1)}%).",
            })

    return {
        "overall_score": overall,
        "components": components,
        "weights": weights,
        "issues": issues,
        "profile": profile,
    }


RULE_TYPES = ["range", "not_null", "non_negative", "regex", "unique", "allowed_values"]


def evaluate_rule(df: pd.DataFrame, rule) -> dict:
    col = rule.column
    if col is not None and col not in df.columns:
        return {"rule_id": rule.id, "name": rule.name, "error": f"Column '{col}' not found", "violations": 0}

    s = df[col] if col else None
    violations = 0
    params = rule.params or {}

    if rule.rule_type == "not_null":
        violations = int(s.isna().sum())
    elif rule.rule_type == "non_negative":
        violations = int((pd.to_numeric(s, errors="coerce") < 0).sum())
    elif rule.rule_type == "range":
        lo, hi = params.get("min"), params.get("max")
        numeric = pd.to_numeric(s, errors="coerce")
        mask = pd.Series(False, index=s.index)
        if lo is not None:
            mask = mask | (numeric < lo)
        if hi is not None:
            mask = mask | (numeric > hi)
        violations = int(mask.sum())
    elif rule.rule_type == "regex":
        pattern = params.get("pattern", "")
        try:
            compiled = re.compile(pattern)
            violations = int(s.dropna().astype(str).apply(lambda v: not bool(compiled.match(v))).sum())
        except re.error as e:
            return {"rule_id": rule.id, "name": rule.name, "error": f"Bad regex: {e}", "violations": 0}
    elif rule.rule_type == "unique":
        violations = int(s.duplicated().sum())
    elif rule.rule_type == "allowed_values":
        allowed = set(params.get("values", []))
        violations = int(s.dropna().apply(lambda v: v not in allowed).sum())
    else:
        return {"rule_id": rule.id, "name": rule.name, "error": f"Unknown rule type '{rule.rule_type}'", "violations": 0}

    return {
        "rule_id": rule.id,
        "name": rule.name,
        "column": col,
        "rule_type": rule.rule_type,
        "violations": violations,
        "violation_pct": round(100 * violations / len(df), 2) if len(df) else 0.0,
        "passed": violations == 0,
    }
