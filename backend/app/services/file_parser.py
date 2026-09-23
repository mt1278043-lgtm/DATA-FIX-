import io
import json

import pandas as pd

from ..config import ALLOWED_UPLOAD_EXTENSIONS, MAX_UPLOAD_MB


class DatasetValidationError(Exception):
    pass


def parse_upload(filename: str, content: bytes) -> pd.DataFrame:
    """Parse raw upload bytes into a DataFrame, with real validation.

    Raises DatasetValidationError with a human-readable message on any
    problem instead of silently producing a broken/empty dataframe.
    """
    if not filename or "." not in filename:
        raise DatasetValidationError("File has no extension — cannot determine format.")

    ext = "." + filename.rsplit(".", 1)[-1].lower()
    if ext not in ALLOWED_UPLOAD_EXTENSIONS:
        raise DatasetValidationError(
            f"Unsupported format '{ext}'. Supported: {', '.join(sorted(ALLOWED_UPLOAD_EXTENSIONS))}"
        )

    size_mb = len(content) / (1024 * 1024)
    if size_mb == 0:
        raise DatasetValidationError("The uploaded file is empty (0 bytes).")
    if size_mb > MAX_UPLOAD_MB:
        raise DatasetValidationError(
            f"File is {size_mb:.1f} MB, which exceeds the {MAX_UPLOAD_MB} MB limit."
        )

    buf = io.BytesIO(content)
    try:
        if ext == ".csv":
            df = _read_csv_with_encoding_fallback(content)
        elif ext in (".xlsx", ".xls"):
            df = pd.read_excel(buf)
        elif ext == ".json":
            try:
                obj = json.loads(content.decode("utf-8"))
            except UnicodeDecodeError as e:
                raise DatasetValidationError(f"JSON file is not valid UTF-8: {e}")
            except json.JSONDecodeError as e:
                raise DatasetValidationError(f"JSON is malformed: {e}")
            if isinstance(obj, dict):
                # allow {"records": [...]} or a single dict of columns->lists
                if "records" in obj and isinstance(obj["records"], list):
                    obj = obj["records"]
                else:
                    obj = [obj]
            if not isinstance(obj, list):
                raise DatasetValidationError("JSON must be an array of records (or {'records': [...]})")
            df = pd.json_normalize(obj)
        elif ext == ".parquet":
            df = pd.read_parquet(buf)
        else:
            raise DatasetValidationError(f"Unhandled format '{ext}'.")
    except DatasetValidationError:
        raise
    except pd.errors.EmptyDataError:
        raise DatasetValidationError("File parsed but contains no data.")
    except pd.errors.ParserError as e:
        raise DatasetValidationError(f"File is corrupted or malformed: {e}")
    except Exception as e:
        raise DatasetValidationError(f"Could not parse file: {e}")

    if df is None or df.shape[0] == 0:
        raise DatasetValidationError("File parsed but contains zero rows.")
    if df.shape[1] == 0:
        raise DatasetValidationError("File parsed but contains zero columns.")

    # Duplicate column names
    cols = list(df.columns.astype(str))
    seen = set()
    dupes = set()
    for c in cols:
        if c in seen:
            dupes.add(c)
        seen.add(c)
    if dupes:
        raise DatasetValidationError(f"Duplicate column names found: {', '.join(sorted(dupes))}")

    # Normalize column names to strings (json_normalize / excel can produce ints)
    df.columns = [str(c).strip() for c in df.columns]

    return df


def _read_csv_with_encoding_fallback(content: bytes) -> pd.DataFrame:
    encodings = ["utf-8", "utf-8-sig", "latin-1", "cp1252"]
    last_err = None
    for enc in encodings:
        try:
            return pd.read_csv(io.BytesIO(content), encoding=enc)
        except UnicodeDecodeError as e:
            last_err = e
            continue
        except pd.errors.ParserError:
            # try python engine as fallback for odd delimiters/quoting
            try:
                return pd.read_csv(io.BytesIO(content), encoding=enc, engine="python", sep=None)
            except Exception as e2:
                last_err = e2
                continue
    raise DatasetValidationError(
        f"Could not decode CSV with common encodings (utf-8/latin-1/cp1252): {last_err}"
    )
