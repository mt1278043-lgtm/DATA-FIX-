from fastapi import Depends, HTTPException, status
from fastapi.security import OAuth2PasswordBearer
from sqlalchemy.orm import Session

from .database import get_db
from .auth import decode_token
from . import models

oauth2_scheme = OAuth2PasswordBearer(tokenUrl="/api/auth/login")


def get_current_user(token: str = Depends(oauth2_scheme), db: Session = Depends(get_db)) -> models.User:
    email = decode_token(token)
    if not email:
        raise HTTPException(status.HTTP_401_UNAUTHORIZED, "Invalid or expired token")
    user = db.query(models.User).filter(models.User.email == email).first()
    if not user:
        raise HTTPException(status.HTTP_401_UNAUTHORIZED, "User not found")
    return user


def get_owned_project(project_id: int, db: Session = Depends(get_db), user: models.User = Depends(get_current_user)) -> models.Project:
    project = db.query(models.Project).filter(models.Project.id == project_id).first()
    if not project:
        raise HTTPException(404, "Project not found")
    if project.owner_id != user.id:
        raise HTTPException(403, "Not your project")
    return project


def get_owned_dataset(dataset_id: int, db: Session = Depends(get_db), user: models.User = Depends(get_current_user)) -> models.Dataset:
    dataset = db.query(models.Dataset).filter(models.Dataset.id == dataset_id).first()
    if not dataset:
        raise HTTPException(404, "Dataset not found")
    if dataset.project.owner_id != user.id:
        raise HTTPException(403, "Not your dataset")
    return dataset


def log_activity(db: Session, project_id: int, action: str, details: dict | None = None):
    entry = models.ActivityLog(project_id=project_id, action=action, details=details or {})
    db.add(entry)
    db.commit()
