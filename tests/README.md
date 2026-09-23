# End-to-end tests

These are real Playwright browser tests that exercise the actual product —
they were used to verify this build (upload, cleaning, SQL, AutoML training
and prediction all really happen; no step is mocked).

## Setup

```bash
pip install playwright
playwright install chromium
```

## Run

With the backend running on `http://127.0.0.1:8010` and the frontend served
(from the `frontend/` directory) on `http://127.0.0.1:8020`:

```bash
cd tests
python3 test_smoke_all_views.py       # registers a user, uploads a dataset, visits every tab
python3 test_interactive_flow.py      # cleans data, runs a SQL query, trains a model, predicts
```

Each script prints what it verified and lists any browser console errors it
saw (Font Awesome's CDN being unreachable in a sandboxed/offline environment
is the one expected, cosmetic exception — it only affects icon glyphs).
