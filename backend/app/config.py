import os
from pathlib import Path

BASE_DIR = Path(__file__).resolve().parent.parent

# On Vercel the deployment bundle itself is read-only (only /tmp is
# writable, and not guaranteed to persist between invocations), so default
# to /tmp there instead of a folder under the app. This directory is only
# ever used as the *local-disk fallback* for storage/blob_storage.py (when
# BLOB_READ_WRITE_TOKEN isn't set) and for the default SQLite URL below —
# in a real Vercel deployment both Vercel Blob and Postgres are configured
# instead, so nothing durable actually depends on this path there.
_default_data_dir = "/tmp/datafix_data" if os.environ.get("VERCEL") else str(BASE_DIR / "data")
DATA_DIR = Path(os.environ.get("DATAFIX_DATA_DIR", _default_data_dir))
DATASETS_DIR = DATA_DIR / "datasets"
MODELS_DIR = DATA_DIR / "models"
try:
    DATASETS_DIR.mkdir(parents=True, exist_ok=True)
    MODELS_DIR.mkdir(parents=True, exist_ok=True)
except OSError:
    pass  # read-only filesystem; fine as long as Blob storage is configured

# SQLite for local/dev use. Set DATAFIX_DATABASE_URL to a postgres:// URL to
# move to Postgres later without touching any model/service code, since
# everything goes through SQLAlchemy.
DATABASE_URL = os.environ.get(
    "DATAFIX_DATABASE_URL", f"sqlite:///{DATA_DIR / 'datafix.db'}"
)

SECRET_KEY = os.environ.get("DATAFIX_SECRET_KEY", "dev-secret-change-me-in-prod")
ALGORITHM = "HS256"
ACCESS_TOKEN_EXPIRE_MINUTES = 60 * 24 * 7  # 7 days

MAX_UPLOAD_MB = int(os.environ.get("DATAFIX_MAX_UPLOAD_MB", "200"))
ALLOWED_UPLOAD_EXTENSIONS = {".csv", ".xlsx", ".xls", ".json", ".parquet"}

# --- Google Sign-In ---
# Only a Client ID is needed for the "Sign in with Google" button flow (Google
# Identity Services returns a signed ID token straight to the browser; our
# backend verifies its signature against Google's public keys). A Client ID
# is not a secret — Google's own docs say it's safe to embed in frontend code.
# We deliberately do NOT use the server-side authorization-code exchange
# (which would need a Client Secret), since login/identity doesn't require it.
GOOGLE_CLIENT_ID = os.environ.get("DATAFIX_GOOGLE_CLIENT_ID", "")
GOOGLE_SIGNIN_ENABLED = bool(GOOGLE_CLIENT_ID)

# Emails listed here are automatically granted admin rights on first login/
# registration (comma-separated). Also settable per-user directly in the DB.
ADMIN_EMAILS = {
    e.strip().lower() for e in os.environ.get("DATAFIX_ADMIN_EMAILS", "").split(",") if e.strip()
}

# Screenshot upload limits for optional payment confirmation attachments.
# Screenshots themselves are written through services/blob_storage.py (Vercel
# Blob in production, a folder under DATA_DIR as a local-dev fallback) —
# nothing here needs to pre-create a directory.
MAX_SCREENSHOT_MB = 10
ALLOWED_SCREENSHOT_EXTENSIONS = {".png", ".jpg", ".jpeg", ".pdf"}
