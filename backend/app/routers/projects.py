from fastapi import APIRouter, Depends
from sqlalchemy.orm import Session

from ..database import get_db
from .. import models, schemas
from ..deps import get_current_user, get_owned_project, log_activity

router = APIRouter(prefix="/api/projects", tags=["projects"])


def _serialize(p: models.Project) -> dict:
    return {
        "id": p.id, "name": p.name, "description": p.description,
        "created_at": p.created_at.isoformat(), "updated_at": p.updated_at.isoformat(),
        "n_datasets": len(p.datasets), "n_models": len(p.models), "n_experiments": len(p.experiments),
    }


@router.get("")
def list_projects(db: Session = Depends(get_db), user: models.User = Depends(get_current_user)):
    projects = db.query(models.Project).filter(models.Project.owner_id == user.id).order_by(models.Project.updated_at.desc()).all()
    return [_serialize(p) for p in projects]


@router.post("")
def create_project(body: schemas.ProjectCreate, db: Session = Depends(get_db), user: models.User = Depends(get_current_user)):
    project = models.Project(owner_id=user.id, name=body.name, description=body.description)
    db.add(project)
    db.commit()
    db.refresh(project)
    log_activity(db, project.id, "project_created", {"name": project.name})
    return _serialize(project)


@router.get("/{project_id}")
def get_project(project: models.Project = Depends(get_owned_project)):
    return _serialize(project)


@router.patch("/{project_id}")
def update_project(body: schemas.ProjectUpdate, project: models.Project = Depends(get_owned_project), db: Session = Depends(get_db)):
    if body.name is not None:
        project.name = body.name
    if body.description is not None:
        project.description = body.description
    db.commit()
    return _serialize(project)


@router.delete("/{project_id}")
def delete_project(project: models.Project = Depends(get_owned_project), db: Session = Depends(get_db)):
    db.delete(project)
    db.commit()
    return {"deleted": True}
