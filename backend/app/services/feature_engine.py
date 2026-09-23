import numpy as np
import pandas as pd


class FeatureError(Exception):
    pass


def apply_feature(df: pd.DataFrame, operation: str, params: dict) -> tuple[pd.DataFrame, dict]:
    out = df.copy()
    params = params or {}
    new_columns = []

    if operation == "log_transform":
        col = params["column"]
        _require(out, col)
        new_col = params.get("new_column", f"{col}_log")
        numeric = pd.to_numeric(out[col], errors="coerce")
        out[new_col] = np.log1p(numeric.clip(lower=0))
        new_columns = [new_col]
        desc = f"Created '{new_col}' = log1p({col})"

    elif operation == "binning":
        col = params["column"]
        _require(out, col)
        bins = int(params.get("bins", 5))
        new_col = params.get("new_column", f"{col}_bin")
        out[new_col] = pd.cut(pd.to_numeric(out[col], errors="coerce"), bins=bins, labels=False)
        new_columns = [new_col]
        desc = f"Created '{new_col}' by binning '{col}' into {bins} bins"

    elif operation == "date_features":
        col = params["column"]
        _require(out, col)
        dt = pd.to_datetime(out[col], errors="coerce", format="mixed")
        prefix = params.get("prefix", col)
        out[f"{prefix}_year"] = dt.dt.year
        out[f"{prefix}_month"] = dt.dt.month
        out[f"{prefix}_day"] = dt.dt.day
        out[f"{prefix}_dow"] = dt.dt.dayofweek
        out[f"{prefix}_is_weekend"] = dt.dt.dayofweek.isin([5, 6]).astype(int)
        new_columns = [f"{prefix}_year", f"{prefix}_month", f"{prefix}_day", f"{prefix}_dow", f"{prefix}_is_weekend"]
        desc = f"Extracted {len(new_columns)} date features from '{col}'"

    elif operation == "interaction":
        col_a, col_b = params["column_a"], params["column_b"]
        _require(out, col_a); _require(out, col_b)
        method = params.get("method", "multiply")
        new_col = params.get("new_column", f"{col_a}_{method}_{col_b}")
        a = pd.to_numeric(out[col_a], errors="coerce")
        b = pd.to_numeric(out[col_b], errors="coerce")
        if method == "multiply":
            out[new_col] = a * b
        elif method == "add":
            out[new_col] = a + b
        elif method == "subtract":
            out[new_col] = a - b
        elif method == "ratio":
            out[new_col] = a / b.replace(0, np.nan)
        else:
            raise FeatureError(f"Unknown interaction method '{method}'")
        new_columns = [new_col]
        desc = f"Created interaction feature '{new_col}' ({method} of {col_a}, {col_b})"

    elif operation == "aggregation":
        group_col, value_col = params["group_column"], params["value_column"]
        _require(out, group_col); _require(out, value_col)
        agg = params.get("agg", "mean")
        new_col = params.get("new_column", f"{value_col}_{agg}_by_{group_col}")
        out[new_col] = out.groupby(group_col)[value_col].transform(agg)
        new_columns = [new_col]
        desc = f"Created group aggregation '{new_col}' ({agg} of {value_col} by {group_col})"

    elif operation == "frequency_encoding":
        col = params["column"]
        _require(out, col)
        new_col = params.get("new_column", f"{col}_freq")
        freq = out[col].value_counts(normalize=True)
        out[new_col] = out[col].map(freq)
        new_columns = [new_col]
        desc = f"Created frequency encoding '{new_col}' for '{col}'"

    elif operation == "text_length":
        col = params["column"]
        _require(out, col)
        new_col = params.get("new_column", f"{col}_length")
        out[new_col] = out[col].astype(str).str.len()
        new_columns = [new_col]
        desc = f"Created '{new_col}' = character length of '{col}'"

    else:
        raise FeatureError(f"Unknown feature operation '{operation}'")

    summary = {"operation": operation, "params": params, "new_columns": new_columns, "description": desc}
    return out, summary


def _require(df: pd.DataFrame, col: str):
    if col not in df.columns:
        raise FeatureError(f"Column '{col}' does not exist")


FEATURE_OPERATIONS = [
    "log_transform", "binning", "date_features", "interaction", "aggregation",
    "frequency_encoding", "text_length",
]
