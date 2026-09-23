import numpy as np
import pandas as pd

from .profiler import infer_column_type


def _safe(v):
    try:
        f = float(v)
        return None if (np.isnan(f) or np.isinf(f)) else round(f, 6)
    except (TypeError, ValueError):
        return None


def distribution(df: pd.DataFrame, column: str, bins: int = 20) -> dict:
    s = df[column]
    col_type = infer_column_type(s)
    if col_type in ("numeric",):
        numeric = pd.to_numeric(s, errors="coerce").dropna()
        counts, edges = np.histogram(numeric, bins=bins) if len(numeric) else ([], [])
        return {
            "column": column, "type": "numeric",
            "bins": [{"range": [round(float(edges[i]), 4), round(float(edges[i+1]), 4)], "count": int(counts[i])} for i in range(len(counts))],
            "n": int(len(numeric)),
        }
    vc = s.value_counts(dropna=True).head(30)
    return {
        "column": column, "type": "categorical",
        "categories": [{"value": str(k), "count": int(v)} for k, v in vc.items()],
        "n": int(s.notna().sum()),
    }


def correlation_matrix(df: pd.DataFrame, method: str = "pearson") -> dict:
    numeric_df = df.select_dtypes(include=[np.number])
    if numeric_df.shape[1] < 2:
        return {"columns": list(numeric_df.columns), "matrix": [], "note": "Fewer than 2 numeric columns."}
    corr = numeric_df.corr(method=method)
    cols = list(corr.columns)
    matrix = [[_safe(corr.iloc[i, j]) for j in range(len(cols))] for i in range(len(cols))]
    # strongest pairs, excluding diagonal
    pairs = []
    for i in range(len(cols)):
        for j in range(i + 1, len(cols)):
            v = corr.iloc[i, j]
            if pd.notna(v):
                pairs.append({"a": cols[i], "b": cols[j], "correlation": _safe(v)})
    pairs.sort(key=lambda p: abs(p["correlation"] or 0), reverse=True)
    return {"columns": cols, "matrix": matrix, "top_pairs": pairs[:15]}


def missingness_report(df: pd.DataFrame) -> dict:
    n = len(df)
    per_col = []
    for col in df.columns:
        missing = int(df[col].isna().sum())
        per_col.append({"column": col, "missing": missing, "missing_pct": round(100 * missing / n, 2) if n else 0.0})
    per_col.sort(key=lambda x: x["missing"], reverse=True)
    # rows with any missing
    rows_with_missing = int(df.isna().any(axis=1).sum())
    return {"per_column": per_col, "rows_with_any_missing": rows_with_missing, "rows_with_any_missing_pct": round(100 * rows_with_missing / n, 2) if n else 0.0}


def target_analysis(df: pd.DataFrame, target: str) -> dict:
    s = df[target]
    col_type = infer_column_type(s)
    # A numeric column with few distinct values (e.g. a 0/1 churn flag) behaves
    # like a classification target, not a continuous one — treat it as categorical here.
    if col_type == "numeric" and s.nunique(dropna=True) <= 10:
        col_type = "categorical"
    result = {"target": target, "type": col_type}
    if col_type == "numeric":
        numeric = pd.to_numeric(s, errors="coerce").dropna()
        result["stats"] = {
            "mean": _safe(numeric.mean()), "std": _safe(numeric.std()),
            "min": _safe(numeric.min()), "max": _safe(numeric.max()), "median": _safe(numeric.median()),
        }
        result["distribution"] = distribution(df, target)
        # correlation of target with other numeric columns
        numeric_df = df.select_dtypes(include=[np.number])
        if target in numeric_df.columns and numeric_df.shape[1] > 1:
            corr = numeric_df.corr()[target].drop(target, errors="ignore")
            ranked = sorted(
                ({"column": c, "correlation": _safe(v)} for c, v in corr.items() if pd.notna(v)),
                key=lambda x: abs(x["correlation"] or 0), reverse=True,
            )
            result["correlated_features"] = ranked[:10]
    else:
        vc = s.value_counts(dropna=True)
        result["class_counts"] = [{"value": str(k), "count": int(v), "pct": round(100 * v / len(s), 2)} for k, v in vc.items()]
        result["is_balanced"] = bool(vc.min() / vc.max() > 0.5) if len(vc) > 1 else True
    return result


def group_analysis(df: pd.DataFrame, group_col: str, value_col: str, agg: str = "mean") -> dict:
    if agg not in ("mean", "sum", "count", "median", "min", "max"):
        agg = "mean"
    grouped = df.groupby(group_col)[value_col]
    result = getattr(grouped, agg)()
    result = result.sort_values(ascending=False).head(50)
    return {
        "group_column": group_col, "value_column": value_col, "aggregation": agg,
        "data": [{"group": str(k), "value": _safe(v)} for k, v in result.items()],
    }


def time_trend(df: pd.DataFrame, date_col: str, value_col: str, freq: str = "M", agg: str = "sum") -> dict:
    work = df[[date_col, value_col]].copy()
    work[date_col] = pd.to_datetime(work[date_col], errors="coerce", format="mixed")
    work = work.dropna(subset=[date_col])
    work[value_col] = pd.to_numeric(work[value_col], errors="coerce")
    work = work.dropna(subset=[value_col])
    if work.empty:
        return {"date_column": date_col, "value_column": value_col, "points": [], "note": "No valid date/numeric pairs."}
    series = work.set_index(date_col)[value_col].resample(freq)
    result = getattr(series, agg)() if agg != "sum" else series.sum()
    points = [{"period": str(k.date()) if hasattr(k, "date") else str(k), "value": _safe(v)} for k, v in result.items()]
    return {"date_column": date_col, "value_column": value_col, "frequency": freq, "aggregation": agg, "points": points}
