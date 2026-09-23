import datetime as dt
import uuid
from pathlib import Path

from fastapi import APIRouter, Depends, HTTPException, UploadFile, File
from sqlalchemy.orm import Session

from ..database import get_db
from .. import models, schemas
from ..deps import get_current_user, require_admin
from ..services.permissions import effective_status, get_plan
from ..services import blob_storage
from ..config import ALLOWED_SCREENSHOT_EXTENSIONS, MAX_SCREENSHOT_MB

router = APIRouter(prefix="/api", tags=["subscription"])


# ===================== Plans (public read, admin write) =====================

def _serialize_plan(p: models.Plan) -> dict:
    return {
        "code": p.code, "name": p.name, "price": p.price, "currency": p.currency,
        "billing_period": p.billing_period, "features": p.features or [],
        "feature_keys": p.feature_keys or [], "limits": p.limits or {},
        "duration_days": p.duration_days, "is_active": p.is_active,
    }


@router.get("/plans")
def list_plans(db: Session = Depends(get_db)):
    plans = db.query(models.Plan).filter(models.Plan.is_active == True).order_by(models.Plan.sort_order).all()  # noqa: E712
    return [_serialize_plan(p) for p in plans]


@router.patch("/admin/plans/{code}")
def update_plan(code: str, body: schemas.PlanUpdate, db: Session = Depends(get_db), _admin: models.User = Depends(require_admin)):
    plan = db.query(models.Plan).filter(models.Plan.code == code).first()
    if not plan:
        raise HTTPException(404, "Plan not found")
    for field, value in body.model_dump(exclude_unset=True).items():
        setattr(plan, field, value)
    db.commit()
    return _serialize_plan(plan)


# ===================== Admin contact / payment settings =====================

def _get_settings(db: Session) -> models.AdminSetting:
    s = db.query(models.AdminSetting).first()
    if not s:
        s = models.AdminSetting()
        db.add(s)
        db.commit()
        db.refresh(s)
    return s


@router.get("/admin-settings/public")
def public_admin_settings(db: Session = Depends(get_db)):
    """Only exposes the intentionally-public contact fields — nothing else
    about the admin account is ever returned here."""
    s = _get_settings(db)
    whatsapp_link = None
    if s.admin_whatsapp:
        digits = "".join(c for c in s.admin_whatsapp if c.isdigit())
        whatsapp_link = f"https://wa.me/{digits}" if digits else None
    return {
        "admin_phone": s.admin_phone,
        "admin_whatsapp": s.admin_whatsapp,
        "whatsapp_link": whatsapp_link,
        "call_link": f"tel:{s.admin_phone}" if s.admin_phone else None,
        "payment_instructions": s.payment_instructions,
        "contact_configured": bool(s.admin_phone or s.admin_whatsapp),
    }


@router.patch("/admin/settings")
def update_admin_settings(body: schemas.AdminSettingsUpdate, db: Session = Depends(get_db), _admin: models.User = Depends(require_admin)):
    s = _get_settings(db)
    for field, value in body.model_dump(exclude_unset=True).items():
        setattr(s, field, value)
    db.commit()
    return public_admin_settings(db)


# ===================== My subscription =====================

@router.get("/subscription/me")
def my_subscription(db: Session = Depends(get_db), user: models.User = Depends(get_current_user)):
    status = effective_status(db, user)
    plan = get_plan(db, user.subscription_plan or "free")
    pending = (
        db.query(models.SubscriptionRequest)
        .filter(models.SubscriptionRequest.user_id == user.id, models.SubscriptionRequest.status == "PENDING")
        .order_by(models.SubscriptionRequest.request_date.desc())
        .all()
    )
    history = (
        db.query(models.SubscriptionRequest)
        .filter(models.SubscriptionRequest.user_id == user.id)
        .order_by(models.SubscriptionRequest.request_date.desc())
        .limit(20)
        .all()
    )
    return {
        "status": status,
        "plan": user.subscription_plan or "free",
        "plan_name": plan.name if plan else "Free",
        "start": user.subscription_start.isoformat() if user.subscription_start else None,
        "expiration": user.subscription_expiration.isoformat() if user.subscription_expiration else None,
        "features": plan.features if plan and status in ("PRO", "BUSINESS") else (get_plan(db, "free").features if get_plan(db, "free") else []),
        "pending_requests": [_serialize_request(r) for r in pending],
        "history": [_serialize_request(r) for r in history],
    }


def _serialize_request(r: models.SubscriptionRequest) -> dict:
    return {
        "id": r.id, "user_id": r.user_id, "user_email": r.user_email,
        "requested_plan": r.requested_plan, "current_plan": r.current_plan,
        "request_date": r.request_date.isoformat(), "status": r.status,
        "admin_notes": r.admin_notes, "expiration_date": r.expiration_date.isoformat() if r.expiration_date else None,
        "payment_reference": r.payment_reference, "transaction_id": r.transaction_id,
        "has_screenshot": bool(r.screenshot_path),
        "decided_at": r.decided_at.isoformat() if r.decided_at else None,
    }


@router.post("/subscription/request")
def create_request(body: schemas.SubscriptionRequestCreate, db: Session = Depends(get_db), user: models.User = Depends(get_current_user)):
    plan = get_plan(db, body.requested_plan)
    if not plan or not plan.is_active:
        raise HTTPException(400, f"Unknown or inactive plan '{body.requested_plan}'")
    if plan.code == "free":
        raise HTTPException(400, "The Free plan doesn't require a request.")

    existing_pending = db.query(models.SubscriptionRequest).filter(
        models.SubscriptionRequest.user_id == user.id, models.SubscriptionRequest.status == "PENDING"
    ).first()
    if existing_pending:
        raise HTTPException(400, "You already have a pending subscription request.")

    req = models.SubscriptionRequest(
        user_id=user.id, user_email=user.email, requested_plan=plan.code,
        current_plan=user.subscription_plan or "free", status="PENDING",
        payment_reference=body.payment_reference, transaction_id=body.transaction_id,
    )
    db.add(req)
    if user.subscription_status == "FREE":
        user.subscription_status = "PENDING"
    db.commit()
    db.refresh(req)
    return _serialize_request(req)


@router.post("/subscription/requests/{request_id}/screenshot")
async def upload_screenshot(request_id: int, db: Session = Depends(get_db), user: models.User = Depends(get_current_user), file: UploadFile = File(...)):
    req = db.query(models.SubscriptionRequest).filter(models.SubscriptionRequest.id == request_id).first()
    if not req or req.user_id != user.id:
        raise HTTPException(404, "Request not found")

    ext = Path(file.filename or "").suffix.lower()
    if ext not in ALLOWED_SCREENSHOT_EXTENSIONS:
        raise HTTPException(400, f"Unsupported file type '{ext}'. Allowed: {', '.join(sorted(ALLOWED_SCREENSHOT_EXTENSIONS))}")
    content = await file.read()
    if len(content) / (1024 * 1024) > MAX_SCREENSHOT_MB:
        raise HTTPException(400, f"File exceeds the {MAX_SCREENSHOT_MB} MB limit.")

    key = f"payment_screenshots/req{request_id}_{uuid.uuid4().hex[:8]}{ext}"
    locator = blob_storage.put_bytes(key, content, content_type=file.content_type or "application/octet-stream")
    req.screenshot_path = locator
    db.commit()
    return {"uploaded": True}


# ===================== Admin subscription panel =====================

@router.get("/admin/subscription-requests")
def list_requests(status: str | None = None, db: Session = Depends(get_db), _admin: models.User = Depends(require_admin)):
    q = db.query(models.SubscriptionRequest)
    if status:
        q = q.filter(models.SubscriptionRequest.status == status.upper())
    requests = q.order_by(models.SubscriptionRequest.request_date.desc()).all()
    return [_serialize_request(r) for r in requests]


@router.post("/admin/subscription-requests/{request_id}/decide")
def decide_request(request_id: int, body: schemas.AdminDecisionRequest, db: Session = Depends(get_db), admin: models.User = Depends(require_admin)):
    req = db.query(models.SubscriptionRequest).filter(models.SubscriptionRequest.id == request_id).first()
    if not req:
        raise HTTPException(404, "Request not found")
    user = db.query(models.User).filter(models.User.id == req.user_id).first()

    if body.admin_notes is not None:
        req.admin_notes = body.admin_notes

    if body.action == "approve":
        plan_code = body.plan or req.requested_plan
        plan = get_plan(db, plan_code)
        if not plan:
            raise HTTPException(400, f"Unknown plan '{plan_code}'")
        duration = body.duration_days if body.duration_days is not None else plan.duration_days
        req.status = "APPROVED"
        req.decided_at = dt.datetime.utcnow()
        req.decided_by = admin.id
        user.subscription_plan = plan.code
        user.subscription_status = plan.code.upper() if plan.code != "free" else "FREE"
        user.subscription_start = dt.datetime.utcnow()
        user.subscription_expiration = (dt.datetime.utcnow() + dt.timedelta(days=duration)) if duration else None
        req.expiration_date = user.subscription_expiration

    elif body.action == "reject":
        req.status = "REJECTED"
        req.decided_at = dt.datetime.utcnow()
        req.decided_by = admin.id
        if user.subscription_status == "PENDING":
            user.subscription_status = "FREE"

    elif body.action == "suspend":
        user.subscription_status = "SUSPENDED"

    elif body.action == "reactivate":
        if user.subscription_plan and user.subscription_plan != "free":
            user.subscription_status = user.subscription_plan.upper()
        else:
            user.subscription_status = "FREE"

    else:
        raise HTTPException(400, f"Unknown action '{body.action}'. Use approve|reject|suspend|reactivate.")

    db.commit()
    return {"request": _serialize_request(req), "user_status": user.subscription_status, "user_plan": user.subscription_plan}
