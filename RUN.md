# DataFix AI — running the real backend + frontend

This adds a genuine FastAPI + SQLite backend under `backend/` and a new
frontend flow (`login.html` -> `projects.html` -> `workspace.html`) that
replaces the old localStorage-only `upload.html`/`dashboard.html` pair. The
old `dashboard.html`/`upload.html`/`js/dashboard.js`/`js/prediction.js`/
`js/ml.js` files are still on disk but are no longer linked from the new
flow — keep them only if you want to compare, otherwise delete them.

## 1. Backend (Python 3.11+)

```bash
cd backend
python3 -m venv .venv
# Windows:  .venv\Scripts\activate
# macOS/Linux: source .venv/bin/activate
pip install -r requirements.txt
uvicorn app.main:app --host 127.0.0.1 --port 8010
```

This creates `backend/data/datafix.db` (SQLite) on first run, plus
`backend/data/datasets/` and `backend/data/models/` for uploaded data and
trained models. Nothing here needs Docker, Postgres, or any cloud service —
it's a single local process.

Copy `.env.example` to `.env` (or just export the variables) if you want to
change the secret key, upload size limit, or later point `DATAFIX_DATABASE_URL`
at a real Postgres instance instead of SQLite.

## 2. Frontend

The frontend is still static HTML/CSS/JS — no build step. Serve it with any
static file server, e.g.:

```bash
cd ..   # project root
python3 -m http.server 8020
```

Then open `http://127.0.0.1:8020/index.html` (or `login.html` directly).

By default the frontend talks to the backend at `http://127.0.0.1:8010`. If
you run the backend elsewhere, click "change" under the sign-in form to point
it at a different URL (stored in the browser's localStorage as `df_api_base`).

## 3. Using it

1. Register an account on the sign-in page.
2. Create a project.
3. Upload a CSV/XLSX/JSON/Parquet file — it's validated and profiled with
   pandas immediately (real row/column counts, missing values, quality score).
4. Data Quality tab — see the real quality score breakdown and add custom
   rules (range checks, not-null, regex, etc).
5. Cleaning Studio — apply real transformations (dedupe, fill/drop missing,
   outlier treatment, encoding, scaling, string cleanup, etc.); every
   operation creates a new dataset version you can undo.
6. EDA & Visualization — real distribution/correlation/missingness/group/
   trend charts computed from your current dataset version.
7. SQL Studio — real SQL executed by DuckDB directly against your dataset
   (read-only SELECT/WITH only).
8. Feature Engineering — derived columns (log transform, binning, date
   features, interactions, aggregations, frequency encoding).
9. AutoML & Prediction — pick a target and algorithm (logistic/linear
   regression, decision tree, random forest, gradient boosting, KNN, naive
   Bayes, SVM), train with a real train/test split + cross-validation, see
   real accuracy/precision/recall/F1/ROC-AUC (or MAE/RMSE/R²) and feature
   importance, then generate predictions from the trained model.
10. Activity tab — a full audit trail of everything above.

## What this build does NOT include (honestly, per the original request)

Pipeline builder/visual DAG, dataset diffing beyond version history, model
drift/monitoring dashboards, PDF/HTML report generation, a documentation
generator, a data simulator, "challenge mode", multi-user roles/permissions,
and a real LLM-backed AI copilot/NL-to-SQL (the SQL generator is a
transparent rule-based heuristic — see `backend/app/services/nl_to_sql.py`
for the seam to plug in a real Claude API call once you have a key). These
were out of scope for this pass; the full 60-subsystem spec is realistically
months of additional work.
