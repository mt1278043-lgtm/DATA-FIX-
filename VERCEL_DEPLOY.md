# Deploying DataFix AI to Vercel

This documents exactly what was changed to make the app deployable on Vercel,
what I actually verified, what I created for real in your Vercel account,
and — stated plainly — the one real risk I could not resolve for you and
the two things still needed from you before this goes live.

## What changed in the code (and how I verified each one)

**Database: SQLite → Postgres, selectable via one env var.**
The app already read `DATAFIX_DATABASE_URL` through SQLAlchemy, so no model
code needed to change. I added `psycopg2-binary` to requirements.txt and
proved the switch actually works: I started a local Postgres server in my
sandbox, pointed the backend at it with `DATAFIX_DATABASE_URL=postgresql://...`,
and ran a real registration → login → project-creation → dataset-upload
flow through the live API. I then queried Postgres directly and confirmed
the `users`, `plans`, and `dataset_versions` tables held the real rows —
this was not a dry code read, it ran against a real Postgres database.

**File storage: local disk → Vercel Blob (with a local-disk fallback).**
Vercel's serverless functions have a read-only filesystem (aside from an
unreliable `/tmp`), so dataset parquet snapshots, trained model bundles, and
payment-confirmation screenshots — all previously written to disk — would
not have survived between requests in production. I added
`backend/app/services/blob_storage.py`, a small abstraction with
`put_bytes` / `get_bytes` / `delete`, and rewired all three call sites
(`services/storage.py`, `services/model_registry.py`, and the screenshot
upload endpoint in `routers/subscription.py`) through it. When
`BLOB_READ_WRITE_TOKEN` is set it calls Vercel Blob's REST API; when it
isn't, it falls back to local disk exactly like before, so nothing changes
for local development. I exercised the local-disk branch directly through
the same Postgres-backed flow above (the dataset upload really wrote and
read back a parquet file through this new code path). **Honesty note:** I
could not exercise the live Vercel Blob branch — there was no Blob token
available in my sandbox to test against. It's implemented against Vercel's
documented REST API, but treat it as unverified until you upload one real
file after deploying.

**Filesystem safety for read-only deployment.**
`backend/app/config.py` created its data directories unconditionally at
import time, which would crash on Vercel's read-only bundle filesystem. I
made that defensive (wrapped in try/except, and defaults to `/tmp` when
Vercel's own `VERCEL` environment variable is present) so a cold start
can't fail just from this.

**Frontend API base URL.**
`frontend/js/api.js` hardcoded `http://127.0.0.1:8010`. On Vercel the
frontend and `/api/*` are served from the same origin, so I changed the
default to an empty (same-origin, relative) base — while keeping the old
`127.0.0.1:8010` default for the specific case of the local two-terminal
dev setup (frontend on port 8020, backend on port 8010), so `RUN.md`'s
existing local workflow is unaffected.

**Vercel project files (new).**
- `vercel.json` — declares `backend/app/main.py` as the one serverless
  function (Vercel's Python runtime traces its imports to bundle
  everything it needs), rewrites `/api/*` to it, and rewrites everything
  else to the static `frontend/` folder.
- `requirements.txt` at the repo root (mirrors `backend/requirements.txt`
  — Vercel's Python builder looks for it there).
- `.vercelignore` — excludes test files, local SQLite data, and `.env`.

## What I actually did in your Vercel account (real, not simulated)

- Confirmed your Vercel account is connected (team: **mohamed tarek**).
- Created a real project: **datafix-ai**
  (`prj_TzSILLdMdq3NyDBXUjzF3ej6eYEO`) — visible now in your Vercel
  dashboard.
- Generated a strong random JWT signing secret and set it as the project's
  `DATAFIX_SECRET_KEY` environment variable (production, preview, and
  development) — this is a real secret already sitting in your project,
  not a placeholder for you to fill in.
- Tried to create a Vercel Blob store for you (`datafix-ai-storage`) —
  **this failed with a 403 "you don't have permission to create the
  blob"**. I don't know why (could be a plan restriction, a missing
  payment method on the team, or an account-level policy), and I'm not
  going to guess or work around it. See "What you need to do" below —
  it's one click for you in the dashboard, where the same error (if any)
  will at least come with a clearer reason.

## The one risk I want to be upfront about: bundle size

I measured the actual installed size of this app's heaviest dependencies
in my sandbox:

| package | installed size |
|---|---|
| pyarrow | 161.3 MB |
| pandas | 71.3 MB |
| scikit-learn | 46.6 MB |
| numpy | 42.7 MB |
| duckdb | 1.0 MB |
| fastapi | 1.4 MB |

That's already **~325 MB** before scipy (a scikit-learn dependency, often
40–80 MB on its own), psycopg2's bundled libpq, cryptography/bcrypt,
google-auth, and everything else. Vercel's Python serverless functions have
historically been capped around 250 MB unzipped, and I could not test an
actual deployment from this sandbox to see whether the real number clears
or exceeds today's limit (see below for why). I'm not going to tell you
this "should be fine" — the honest status is: **this may be too large to
deploy as a single Vercel function, and the only way to know for certain is
to try the deploy and read the actual build error if it fails.** If it does
fail on size, the fix is to split AutoML/SQL Studio (the parts that need
scikit-learn/duckdb/pyarrow) into their own, separate Vercel function from
the lighter auth/projects/subscription API — a real but bounded follow-up
job I have not done, so I'm not claiming it's done.

## What you need to do to actually go live

1. **Get the code onto Vercel.** I could not push this to your
   `mt1278043-lgtm/DATA-FIX-` GitHub repo (the sandbox's git proxy refused
   it — it only allows pushes to repos you've explicitly authorized for
   this session) and there's no Vercel CLI token available in this sandbox
   to deploy directly. The fastest path: on your own machine, run
   `vercel link` inside this project folder (it will find the **datafix-ai**
   project by name), then `vercel --prod`. Or: authorize the GitHub repo
   for this session and tell me, and I'll push the code and connect it from
   here.
2. **Create a Postgres database** — easiest is the Storage tab in your new
   `datafix-ai` project on vercel.com (Neon-backed Postgres integration,
   free tier available), or your own Neon/Supabase project. Either way,
   set the resulting connection string as `DATAFIX_DATABASE_URL` on the
   project (Vercel usually does this automatically when you add its own
   Postgres integration).
3. **Create the Blob store** — same Storage tab, "Create Database" →
   Blob. Attach it to the `datafix-ai` project and Vercel will
   automatically add `BLOB_READ_WRITE_TOKEN` for you — no manual copy/paste
   needed.
4. Optionally set `DATAFIX_GOOGLE_CLIENT_ID` (real Google Sign-In) and
   `DATAFIX_ADMIN_EMAILS` (who gets admin rights) the same way.
5. Deploy, then test the size risk above by actually watching whether the
   build/deploy succeeds. If it fails on function size, tell me and I'll
   split AutoML/SQL Studio into a second function.

Nothing above claims to be done when it isn't — the Postgres switch and the
local-storage path are genuinely tested; the live Blob path, the actual
Vercel build, and the function-size question are explicitly still open.
