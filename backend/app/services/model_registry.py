import io
import uuid

import joblib

from . import blob_storage


def save_model_bundle(training_result: dict) -> str:
    bundle = {
        "model": training_result["model"],
        "scaler": training_result["scaler"],
        "encoder": training_result["encoder"],
        "feature_columns": training_result["feature_columns"],
        "preprocessing": training_result["preprocessing"],
        "task_type": training_result["task_type"],
        "target": training_result["target"],
        "class_names": training_result.get("class_names"),
    }
    buf = io.BytesIO()
    joblib.dump(bundle, buf)
    key = f"models/model_{uuid.uuid4().hex}.joblib"
    return blob_storage.put_bytes(key, buf.getvalue(), content_type="application/octet-stream")


def load_model_bundle(path: str) -> dict:
    data = blob_storage.get_bytes(path)
    return joblib.load(io.BytesIO(data))


def predict_with_bundle(bundle: dict, input_rows: list[dict]):
    import pandas as pd
    df = pd.DataFrame(input_rows)
    feature_columns = bundle["feature_columns"]
    for c in feature_columns:
        if c not in df.columns:
            df[c] = None
    df = df[feature_columns]

    numeric_cols = bundle["preprocessing"]["numeric_cols"]
    categorical_cols = bundle["preprocessing"]["categorical_cols"]

    for c in numeric_cols:
        df[c] = pd.to_numeric(df[c], errors="coerce")
        if df[c].isna().any():
            df[c] = df[c].fillna(df[c].median() if df[c].notna().any() else 0)
    for c in categorical_cols:
        df[c] = df[c].astype(str).fillna("missing")

    if categorical_cols and bundle["encoder"] is not None:
        df[categorical_cols] = bundle["encoder"].transform(df[categorical_cols])
    if numeric_cols and bundle["scaler"] is not None:
        df[numeric_cols] = bundle["scaler"].transform(df[numeric_cols])

    model = bundle["model"]
    preds = model.predict(df)
    proba = None
    if hasattr(model, "predict_proba"):
        try:
            proba = model.predict_proba(df).tolist()
        except Exception:
            proba = None

    if bundle["task_type"] == "classification" and bundle.get("class_names"):
        class_names = bundle["class_names"]
        preds_out = [class_names[int(p)] if int(p) < len(class_names) else str(p) for p in preds]
    else:
        preds_out = [float(p) for p in preds]

    return preds_out, proba, df
