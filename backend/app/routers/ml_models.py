from fastapi import APIRouter, Depends, HTTPException
from sqlalchemy.orm import Session

from ..database import get_db
from .. import models
from ..deps import get_owned_project

router = APIRouter(prefix="/api/projects/{project_id}/models", tags=["models"])


def _serialize(m: models.MLModel) -> dict:
    return {
        "id": m.id, "name": m.name, "task_type": m.task_type, "algorithm": m.algorithm,
        "feature_columns": m.feature_columns, "target_column": m.target_column,
        "metrics": m.metrics, "feature_importance": m.feature_importance,
        "created_at": m.created_at.isoformat(), "experiment_id": m.experiment_id,
    }


@router.get("")
def list_models(project: models.Project = Depends(get_owned_project)):
    return [_serialize(m) for m in project.models]


@router.get("/{model_id}")
def get_model(model_id: int, project: models.Project = Depends(get_owned_project), db: Session = Depends(get_db)):
    model = db.query(models.MLModel).filter(models.MLModel.id == model_id, models.MLModel.project_id == project.id).first()
    if not model:
        raise HTTPException(404, "Model not found")
    return _serialize(model)


@router.get("/compare")
def compare_models(ids: str, project: models.Project = Depends(get_owned_project), db: Session = Depends(get_db)):
    id_list = [int(i) for i in ids.split(",") if i.strip().isdigit()]
    found = db.query(models.MLModel).filter(models.MLModel.id.in_(id_list), models.MLModel.project_id == project.id).all()
    return [_serialize(m) for m in found]
