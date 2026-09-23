from fastapi import APIRouter, Depends, HTTPException
from sqlalchemy.orm import Session

from ..database import get_db
from .. import models, schemas
from ..deps import get_owned_dataset, log_activity
from ..services import automl_engine, storage, model_registry
from .datasets import get_current_version

router = APIRouter(prefix="/api/datasets/{dataset_id}", tags=["automl"])


@router.get("/algorithms")
def algorithms(task_type: str = "classification"):
    return {"task_type": task_type, "algorithms": automl_engine.available_algorithms(task_type)}


def _serialize_experiment(e: models.Experiment) -> dict:
    return {
        "id": e.id, "task_type": e.task_type, "target_column": e.target_column,
        "feature_columns": e.feature_columns, "algorithm": e.algorithm, "params": e.params,
        "metrics": e.metrics, "status": e.status, "error": e.error, "notes": e.notes,
        "created_at": e.created_at.isoformat(),
        "model_id": e.model.id if e.model else None,
    }


@router.post("/train")
def train(body: schemas.TrainRequest, dataset: models.Dataset = Depends(get_owned_dataset), db: Session = Depends(get_db)):
    current = get_current_version(dataset, db)
    df = storage.load_dataframe(current.storage_path)

    experiment = models.Experiment(
        project_id=dataset.project_id, dataset_version_id=current.id,
        task_type=body.task_type or "unknown", target_column=body.target, feature_columns=body.feature_columns,
        algorithm=body.algorithm, params={"test_size": body.test_size, "cv_folds": body.cv_folds}, status="running", notes=body.notes,
    )
    db.add(experiment)
    db.commit()
    db.refresh(experiment)

    try:
        result = automl_engine.train_and_evaluate(
            df, body.target, body.feature_columns, body.algorithm,
            test_size=body.test_size, cv_folds=body.cv_folds, task_type=body.task_type,
        )
    except automl_engine.AutoMLError as e:
        experiment.status = "failed"
        experiment.error = str(e)
        db.commit()
        raise HTTPException(400, str(e))
    except Exception as e:
        experiment.status = "failed"
        experiment.error = f"Unexpected error: {e}"
        db.commit()
        raise HTTPException(500, f"Training failed: {e}")

    experiment.task_type = result["task_type"]
    experiment.feature_columns = result["feature_columns"]
    experiment.metrics = result["metrics"]
    experiment.status = "completed"
    db.commit()

    model_path = model_registry.save_model_bundle(result)
    model = models.MLModel(
        project_id=dataset.project_id, experiment_id=experiment.id,
        name=f"{dataset.name} - {body.algorithm}", task_type=result["task_type"],
        algorithm=body.algorithm, storage_path=model_path,
        feature_columns=result["feature_columns"], target_column=body.target,
        metrics=result["metrics"], feature_importance=result["feature_importance"],
    )
    db.add(model)
    db.commit()
    db.refresh(model)

    log_activity(db, dataset.project_id, "model_trained", {
        "dataset_id": dataset.id, "algorithm": body.algorithm, "target": body.target,
        "task_type": result["task_type"], "metrics": result["metrics"],
    })

    return {
        "experiment": _serialize_experiment(experiment),
        "model": {"id": model.id, "name": model.name, "algorithm": model.algorithm, "metrics": model.metrics, "feature_importance": model.feature_importance},
    }


@router.get("/experiments")
def list_experiments(dataset: models.Dataset = Depends(get_owned_dataset), db: Session = Depends(get_db)):
    current = get_current_version(dataset, db)
    exps = db.query(models.Experiment).filter(models.Experiment.project_id == dataset.project_id).order_by(models.Experiment.created_at.desc()).all()
    return [_serialize_experiment(e) for e in exps]
