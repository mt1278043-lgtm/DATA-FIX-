from fastapi import APIRouter, Depends
from sqlalchemy.orm import Session

from ..database import get_db
from .. import models
from ..deps import get_owned_project

router = APIRouter(prefix="/api/projects/{project_id}/activity", tags=["activity"])


@router.get("")
def list_activity(project: models.Project = Depends(get_owned_project), db: Session = Depends(get_db), limit: int = 100):
    entries = (
        db.query(models.ActivityLog)
        .filter(models.ActivityLog.project_id == project.id)
        .order_by(models.ActivityLog.created_at.desc())
        .limit(limit)
        .all()
    )
    return [{"id": e.id, "action": e.action, "details": e.details, "created_at": e.created_at.isoformat()} for e in entries]
