import io
import uuid

import pandas as pd

from . import blob_storage


def new_storage_path(dataset_id: int, version_number: int) -> str:
    """Returns a storage *key* (not a filesystem path, despite the name kept
    for compatibility with existing callers/DB rows) that save_dataframe will
    turn into a real locator when it writes the data."""
    return f"datasets/ds{dataset_id}_v{version_number}_{uuid.uuid4().hex[:8]}.parquet"


def save_dataframe(df: pd.DataFrame, path: str) -> str:
    """Serializes `df` to parquet and stores it under `path` (a key from
    new_storage_path). Returns the actual locator to persist in the DB's
    storage_path column — on Vercel Blob this is a URL, not `path` itself, so
    callers must save the RETURN VALUE, not the input `path`, as storage_path."""
    buf = io.BytesIO()
    df.to_parquet(buf, index=False)
    return blob_storage.put_bytes(path, buf.getvalue(), content_type="application/octet-stream")


def load_dataframe(path: str) -> pd.DataFrame:
    data = blob_storage.get_bytes(path)
    return pd.read_parquet(io.BytesIO(data))
