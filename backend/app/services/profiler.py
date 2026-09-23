import numpy as np
import pandas as pd


def _is_probably_id(series: pd.Series, name: str) -> bool:
    name_l = name.lower()
    unique_ratio = series.nunique(dropna=True) / max(len(series), 1)
    name_hint = any(k in name_l for k in ["id", "uuid", "guid", "key", "_no", "number"]) and name_l not in ("age",)
    return (unique_ratio > 0.95 and name_hint) or unique_ratio == 1.0 and name_hint


def infer_column_type(series: pd.Series) -> str:
    if pd.api.types.is_bool_dtype(series):
        return "boolean"
    if pd.api.types.is_numeric_dtype(series):
        return "numeric"
    if pd.api.types.is_datetime64_any_dtype(series):
        return "datetime"
    # try to parse as date if it looks like one
    non_null = series.dropna()
    if len(non_null) > 0 and series.dtype == object:
        sample = non_null.astype(str).head(50)
        parsed = pd.to_datetime(sample, errors="coerce", format="mixed")
        if parsed.notna().mean() > 0.85:
            return "datetime"
    nunique = series.nunique(dropna=True)
    if nunique <= max(20, int(0.05 * len(series))) and nunique > 0:
        return "categorical"
    return "text"


def profile_dataset(df: pd.DataFrame) -> dict:
    n_rows, n_cols = df.shape
    n_dupes = int(df.duplicated().sum())

    columns = []
    numeric_summary = {}
    categorical_summary = {}
    potential_targets = []
    potential_ids = []
    date_columns = []
    constant_columns = []
    high_cardinality_columns = []

    for col in df.columns:
        s = df[col]
        col_type = infer_column_type(s)
        missing = int(s.isna().sum())
        missing_pct = round(100 * missing / n_rows, 2) if n_rows else 0.0
        nunique = int(s.nunique(dropna=True))

        entry = {
            "name": col,
            "dtype": str(s.dtype),
            "inferred_type": col_type,
            "missing_count": missing,
            "missing_pct": missing_pct,
            "unique_count": nunique,
            "unique_pct": round(100 * nunique / n_rows, 2) if n_rows else 0.0,
        }
        columns.append(entry)

        if nunique <= 1:
            constant_columns.append(col)
        if col_type == "categorical" and nunique > 50:
            high_cardinality_columns.append(col)

        if col_type == "numeric":
            desc = s.describe()
            q1, q3 = s.quantile(0.25), s.quantile(0.75)
            iqr = q3 - q1
            lower, upper = q1 - 1.5 * iqr, q3 + 1.5 * iqr
            outliers = int(((s < lower) | (s > upper)).sum()) if pd.notna(iqr) and iqr > 0 else 0
            numeric_summary[col] = {
                "mean": _safe_float(desc.get("mean")),
                "std": _safe_float(desc.get("std")),
                "min": _safe_float(desc.get("min")),
                "max": _safe_float(desc.get("max")),
                "p25": _safe_float(q1),
                "median": _safe_float(s.median()),
                "p75": _safe_float(q3),
                "outlier_count": outliers,
                "zero_count": int((s == 0).sum()),
                "negative_count": int((s < 0).sum()),
            }
            if nunique <= 20 and set(pd.unique(s.dropna())) <= {0, 1}:
                potential_targets.append(col)
            elif 2 <= nunique <= 10:
                potential_targets.append(col)
        elif col_type == "categorical":
            vc = s.value_counts(dropna=True).head(10)
            categorical_summary[col] = {
                "top_values": [{"value": str(k), "count": int(v)} for k, v in vc.items()],
                "n_categories": nunique,
            }
            if 2 <= nunique <= 10:
                potential_targets.append(col)
        elif col_type == "datetime":
            date_columns.append(col)

        if _is_probably_id(s, col):
            potential_ids.append(col)

    return {
        "n_rows": n_rows,
        "n_columns": n_cols,
        "n_duplicate_rows": n_dupes,
        "duplicate_pct": round(100 * n_dupes / n_rows, 2) if n_rows else 0.0,
        "total_missing_cells": int(df.isna().sum().sum()),
        "missing_cell_pct": round(100 * df.isna().sum().sum() / (n_rows * n_cols), 2) if n_rows and n_cols else 0.0,
        "columns": columns,
        "numeric_summary": numeric_summary,
        "categorical_summary": categorical_summary,
        "date_columns": date_columns,
        "potential_target_columns": list(dict.fromkeys(potential_targets))[:10],
        "potential_id_columns": potential_ids,
        "constant_columns": constant_columns,
        "high_cardinality_columns": high_cardinality_columns,
        "memory_bytes": int(df.memory_usage(deep=True).sum()),
    }


def _safe_float(v):
    try:
        f = float(v)
        if np.isnan(f) or np.isinf(f):
            return None
        return round(f, 6)
    except (TypeError, ValueError):
        return None
