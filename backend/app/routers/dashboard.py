from fastapi import APIRouter, Depends
from sqlalchemy.orm import Session

from ..database import get_db
from .. import models
from ..deps import get_current_user, get_owned_project

router = APIRouter(prefix="/api", tags=["dashboard"])


@router.get("/dashboard/overview")
def global_overview(db: Session = Depends(get_db), user: models.User = Depends(get_current_user)):
    projects = db.query(models.Project).filter(models.Project.owner_id == user.id).all()
    project_ids = [p.id for p in projects]

    n_datasets = db.query(models.Dataset).filter(models.Dataset.project_id.in_(project_ids)).count() if project_ids else 0
    n_models = db.query(models.MLModel).filter(models.MLModel.project_id.in_(project_ids)).count() if project_ids else 0
    n_experiments = db.query(models.Experiment).filter(models.Experiment.project_id.in_(project_ids)).count() if project_ids else 0
    failed_experiments = db.query(models.Experiment).filter(models.Experiment.project_id.in_(project_ids), models.Experiment.status == "failed").count() if project_ids else 0
    n_predictions = db.query(models.PredictionRecord).filter(models.PredictionRecord.project_id.in_(project_ids)).count() if project_ids else 0

    recent_activity = (
        db.query(models.ActivityLog)
        .filter(models.ActivityLog.project_id.in_(project_ids))
        .order_by(models.ActivityLog.created_at.desc())
        .limit(15)
        .all()
        if project_ids else []
    )

    # real average data quality across the latest version of every dataset that has one
    quality_scores = []
    for p in projects:
        for d in p.datasets:
            v = next((v for v in d.versions if v.id == d.current_version_id), None)
            if v and v.quality_json:
                quality_scores.append(v.quality_json.get("overall_score"))
    avg_quality = round(sum(quality_scores) / len(quality_scores), 1) if quality_scores else None

    return {
        "projects": len(projects),
        "datasets": n_datasets,
        "models": n_models,
        "experiments": n_experiments,
        "failed_experiments": failed_experiments,
        "predictions": n_predictions,
        "avg_data_quality": avg_quality,
        "recent_activity": [{"action": a.action, "details": a.details, "created_at": a.created_at.isoformat(), "project_id": a.project_id} for a in recent_activity],
    }


@router.get("/projects/{project_id}/overview")
def project_overview(project: models.Project = Depends(get_owned_project), db: Session = Depends(get_db)):
    datasets = project.datasets
    models_ = project.models
    experiments = project.experiments

    recommendations = []
    if not datasets:
        recommendations.append({"action": "upload_dataset", "message": "No datasets yet — upload one to get started."})
    for d in datasets:
        v = next((v for v in d.versions if v.id == d.current_version_id), None)
        if v and v.quality_json and v.quality_json.get("overall_score", 100) < 70:
            recommendations.append({"action": "clean_dataset", "message": f"'{d.name}' has a data quality score of {v.quality_json['overall_score']} — consider cleaning it before modeling.", "dataset_id": d.id})
        if d.target_column and not any(e.dataset_version_id == d.current_version_id for e in experiments):
            recommendations.append({"action": "train_model", "message": f"'{d.name}' has a target column ('{d.target_column}') set but no model trained yet on its current version.", "dataset_id": d.id})
    if models_ and not any(m for m in models_):
        pass
    if models_ and db.query(models.PredictionRecord).filter(models.PredictionRecord.project_id == project.id).count() == 0:
        recommendations.append({"action": "make_prediction", "message": "You have a trained model but haven't generated any predictions with it yet."})

    recent_activity = (
        db.query(models.ActivityLog)
        .filter(models.ActivityLog.project_id == project.id)
        .order_by(models.ActivityLog.created_at.desc())
        .limit(20)
        .all()
    )

    return {
        "project": {"id": project.id, "name": project.name, "description": project.description},
        "n_datasets": len(datasets),
        "n_models": len(models_),
        "n_experiments": len(experiments),
        "recommendations": recommendations,
        "recent_activity": [{"action": a.action, "details": a.details, "created_at": a.created_at.isoformat()} for a in recent_activity],
    }
