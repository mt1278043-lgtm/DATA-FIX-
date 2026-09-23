import re
import duckdb
import pandas as pd

FORBIDDEN = re.compile(r"\b(insert|update|delete|drop|alter|attach|copy|pragma|create|call|export|import)\b", re.IGNORECASE)


class SqlError(Exception):
    pass


def run_query(df: pd.DataFrame, sql_text: str, table_name: str = "dataset", limit: int = 1000) -> dict:
    if not sql_text or not sql_text.strip():
        raise SqlError("Empty query.")
    if FORBIDDEN.search(sql_text):
        raise SqlError("Only read-only SELECT queries are allowed in SQL Studio.")
    if not re.match(r"^\s*(select|with)\b", sql_text.strip(), re.IGNORECASE):
        raise SqlError("Query must start with SELECT or WITH.")

    con = duckdb.connect(database=":memory:")
    try:
        con.register(table_name, df)
        try:
            result = con.execute(sql_text).fetchdf()
        except Exception as e:
            raise SqlError(f"SQL error: {e}")
    finally:
        con.close()

    truncated = len(result) > limit
    if truncated:
        result = result.head(limit)
    return {
        "columns": list(result.columns.astype(str)),
        "rows": result.astype(object).where(pd.notnull(result), None).values.tolist(),
        "row_count": int(len(result)),
        "truncated": truncated,
    }


def schema_of(df: pd.DataFrame, table_name: str = "dataset") -> dict:
    return {
        "table": table_name,
        "columns": [{"name": c, "type": str(df[c].dtype)} for c in df.columns],
    }
