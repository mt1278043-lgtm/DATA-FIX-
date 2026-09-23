import re
import numpy as np
import pandas as pd


class CleaningError(Exception):
    pass


def apply_operation(df: pd.DataFrame, operation: str, params: dict) -> tuple[pd.DataFrame, dict]:
    """Apply one real cleaning transformation to df, returning (new_df, summary).
    summary always includes before/after row & column counts and a description.
    """
    before_rows, before_cols = df.shape
    out = df.copy()
    params = params or {}
    desc = ""

    if operation == "remove_duplicates":
        subset = params.get("columns") or None
        n_before = len(out)
        out = out.drop_duplicates(subset=subset)
        desc = f"Removed {n_before - len(out)} duplicate rows"

    elif operation == "drop_missing":
        subset = params.get("columns") or None
        how = params.get("how", "any")
        n_before = len(out)
        out = out.dropna(subset=subset, how=how)
        desc = f"Dropped {n_before - len(out)} rows with missing values"

    elif operation == "fill_missing":
        col = params["column"]
        _require_column(out, col)
        strategy = params.get("strategy", "mean")
        if strategy == "mean":
            value = out[col].mean()
        elif strategy == "median":
            value = out[col].median()
        elif strategy == "mode":
            m = out[col].mode(dropna=True)
            value = m.iloc[0] if len(m) else None
        elif strategy == "custom":
            value = params.get("value")
        elif strategy == "zero":
            value = 0
        else:
            raise CleaningError(f"Unknown fill strategy '{strategy}'")
        n_missing = int(out[col].isna().sum())
        out[col] = out[col].fillna(value)
        desc = f"Filled {n_missing} missing values in '{col}' with {strategy} ({value!r})"

    elif operation == "outlier_treatment":
        col = params["column"]
        _require_column(out, col)
        method = params.get("method", "clip")
        numeric = pd.to_numeric(out[col], errors="coerce")
        q1, q3 = numeric.quantile(0.25), numeric.quantile(0.75)
        iqr = q3 - q1
        lower, upper = q1 - 1.5 * iqr, q3 + 1.5 * iqr
        mask = (numeric < lower) | (numeric > upper)
        n_affected = int(mask.sum())
        if method == "clip":
            out[col] = numeric.clip(lower, upper)
        elif method == "remove":
            out = out.loc[~mask]
        else:
            raise CleaningError(f"Unknown outlier method '{method}'")
        desc = f"{method.title()}ped {n_affected} outliers in '{col}' (IQR bounds {lower:.3g}..{upper:.3g})"

    elif operation == "convert_type":
        col = params["column"]
        _require_column(out, col)
        target = params["target_type"]
        try:
            if target == "numeric":
                out[col] = pd.to_numeric(out[col], errors="coerce")
            elif target == "string":
                out[col] = out[col].astype(str)
            elif target == "datetime":
                out[col] = pd.to_datetime(out[col], errors="coerce", format="mixed")
            elif target == "boolean":
                out[col] = out[col].astype(bool)
            else:
                raise CleaningError(f"Unknown target type '{target}'")
        except Exception as e:
            raise CleaningError(f"Type conversion failed: {e}")
        desc = f"Converted '{col}' to {target}"

    elif operation == "rename_column":
        old, new = params["column"], params["new_name"]
        _require_column(out, old)
        out = out.rename(columns={old: new})
        desc = f"Renamed '{old}' -> '{new}'"

    elif operation == "drop_columns":
        cols = params["columns"]
        for c in cols:
            _require_column(out, c)
        out = out.drop(columns=cols)
        desc = f"Dropped columns: {', '.join(cols)}"

    elif operation == "encode_categorical":
        col = params["column"]
        _require_column(out, col)
        method = params.get("method", "onehot")
        if method == "onehot":
            dummies = pd.get_dummies(out[col], prefix=col)
            out = pd.concat([out.drop(columns=[col]), dummies], axis=1)
            desc = f"One-hot encoded '{col}' into {dummies.shape[1]} columns"
        elif method == "label":
            categories = sorted(out[col].dropna().unique().tolist(), key=str)
            mapping = {c: i for i, c in enumerate(categories)}
            out[col] = out[col].map(mapping)
            desc = f"Label-encoded '{col}' ({len(mapping)} categories)"
        elif method == "frequency":
            freq = out[col].value_counts(normalize=True)
            out[col] = out[col].map(freq)
            desc = f"Frequency-encoded '{col}'"
        else:
            raise CleaningError(f"Unknown encoding method '{method}'")

    elif operation == "scale_normalize":
        col = params["column"]
        _require_column(out, col)
        method = params.get("method", "minmax")
        numeric = pd.to_numeric(out[col], errors="coerce")
        if method == "minmax":
            mn, mx = numeric.min(), numeric.max()
            out[col] = (numeric - mn) / (mx - mn) if mx != mn else 0.0
        elif method == "zscore":
            mean, std = numeric.mean(), numeric.std()
            out[col] = (numeric - mean) / std if std else 0.0
        else:
            raise CleaningError(f"Unknown scaling method '{method}'")
        desc = f"{method} scaled '{col}'"

    elif operation == "clean_strings":
        col = params["column"]
        _require_column(out, col)
        ops = params.get("ops", ["trim", "lower"])
        s = out[col].astype(str)
        if "trim" in ops:
            s = s.str.strip()
        if "lower" in ops:
            s = s.str.lower()
        if "upper" in ops:
            s = s.str.upper()
        if "remove_special" in ops:
            s = s.apply(lambda v: re.sub(r"[^a-zA-Z0-9\s]", "", v))
        if "collapse_whitespace" in ops:
            s = s.apply(lambda v: re.sub(r"\s+", " ", v))
        out[col] = s
        desc = f"Cleaned strings in '{col}' ({', '.join(ops)})"

    elif operation == "parse_dates":
        col = params["column"]
        _require_column(out, col)
        out[col] = pd.to_datetime(out[col], errors="coerce", format="mixed")
        n_failed = int(out[col].isna().sum())
        desc = f"Parsed '{col}' as dates ({n_failed} values could not be parsed)"

    elif operation == "consolidate_categories":
        col = params["column"]
        _require_column(out, col)
        mapping = params.get("mapping", {})
        out[col] = out[col].replace(mapping)
        desc = f"Consolidated categories in '{col}' ({len(mapping)} mappings applied)"

    elif operation == "replace_value":
        col = params["column"]
        _require_column(out, col)
        find, replace = params.get("find"), params.get("replace")
        n_before = int((out[col] == find).sum())
        out[col] = out[col].replace(find, replace)
        desc = f"Replaced {n_before} occurrences of {find!r} with {replace!r} in '{col}'"

    else:
        raise CleaningError(f"Unknown operation '{operation}'")

    after_rows, after_cols = out.shape
    summary = {
        "operation": operation,
        "params": params,
        "description": desc,
        "before": {"rows": before_rows, "columns": before_cols},
        "after": {"rows": after_rows, "columns": after_cols},
        "rows_delta": after_rows - before_rows,
        "columns_delta": after_cols - before_cols,
    }
    return out, summary


def _require_column(df: pd.DataFrame, col: str):
    if col not in df.columns:
        raise CleaningError(f"Column '{col}' does not exist in the dataset")


OPERATIONS = [
    "remove_duplicates", "drop_missing", "fill_missing", "outlier_treatment",
    "convert_type", "rename_column", "drop_columns", "encode_categorical",
    "scale_normalize", "clean_strings", "parse_dates", "consolidate_categories",
    "replace_value",
]
