"""Best-effort, fully transparent natural-language -> SQL helper.

No LLM is called here (no AI provider key is configured for this project).
This is a rule-based mapper over the dataset's real schema, always shown to
the user for review/edit before running — never presented as a black box.
If DATAFIX_ANTHROPIC_API_KEY is set in the environment later, wire a real
call to the Claude API in generate_sql() below instead of the heuristic.
"""
import os
import re


def generate_sql(question: str, columns: list[str], table: str = "dataset") -> dict:
    api_key = os.environ.get("DATAFIX_ANTHROPIC_API_KEY") or os.environ.get("ANTHROPIC_API_KEY")
    if api_key:
        # Placeholder seam for a real LLM call — intentionally not implemented
        # without a verified working key/network path in this deployment.
        pass

    q = question.lower().strip()
    col_map = {c.lower(): c for c in columns}

    def find_col(*hints):
        for h in hints:
            for lc, orig in col_map.items():
                if h in lc:
                    return orig
        return None

    # "top N <col> by <col2>" / "highest <col>"
    m = re.search(r"top (\d+)", q)
    limit = int(m.group(1)) if m else 10

    numeric_hint = find_col("amount", "revenue", "price", "sales", "total", "value", "score", "count")
    group_hint = None
    for word in q.split():
        if word in col_map:
            group_hint = col_map[word]
            break

    if "average" in q or "avg" in q or "mean" in q:
        target = numeric_hint or (columns[0] if columns else None)
        sql = f"SELECT AVG({target}) AS average_{target} FROM {table};" if target else f"SELECT * FROM {table} LIMIT {limit};"
        return {"sql": sql, "method": "heuristic", "explanation": f"Computes the average of '{target}'." if target else "Could not identify a numeric column; showing a preview instead."}

    if "duplicate" in q:
        cols_csv = ", ".join(columns)
        sql = f"SELECT {cols_csv}, COUNT(*) AS n FROM {table} GROUP BY {cols_csv} HAVING COUNT(*) > 1;"
        return {"sql": sql, "method": "heuristic", "explanation": "Groups by every column to find fully duplicated rows."}

    if "top" in q or "highest" in q or "most" in q:
        target = numeric_hint or (columns[-1] if columns else None)
        if target:
            sql = f"SELECT * FROM {table} ORDER BY {target} DESC LIMIT {limit};"
            return {"sql": sql, "method": "heuristic", "explanation": f"Rows sorted by '{target}' descending, top {limit}."}

    if "count" in q or "how many" in q:
        if group_hint:
            sql = f"SELECT {group_hint}, COUNT(*) AS n FROM {table} GROUP BY {group_hint} ORDER BY n DESC;"
            return {"sql": sql, "method": "heuristic", "explanation": f"Counts rows grouped by '{group_hint}'."}
        sql = f"SELECT COUNT(*) AS n FROM {table};"
        return {"sql": sql, "method": "heuristic", "explanation": "Total row count."}

    # fallback: preview
    sql = f"SELECT * FROM {table} LIMIT {limit};"
    return {
        "sql": sql, "method": "heuristic",
        "explanation": "Could not confidently map this question to SQL with the rule-based generator (no LLM is configured) — showing a preview so you can adjust manually.",
    }
