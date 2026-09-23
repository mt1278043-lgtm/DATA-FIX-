from fastapi import APIRouter, Depends, HTTPException
from sqlalchemy.orm import Session

from ..database import get_db
from .. import models, schemas
from ..deps import get_current_user, log_activity
from ..services import model_registry, explain_engine

router = APIRouter(prefix="/api/models/{model_id}", tags=["predictions"])


def get_owned_model(model_id: int, db: Session = Depends(get_db), user: models.User = Depends(get_current_user)) -> models.MLModel:
    model = db.query(models.MLModel).filter(models.MLModel.id == model_id).first()
    if not model:
        raise HTTPException(404, "Model not found")
    if model.project.owner_id != user.id:
        raise HTTPException(403, "Not your model")
    return model


@router.post("/predict")
def predict(body: schemas.PredictRequest, model: models.MLModel = Depends(get_owned_model), db: Session = Depends(get_db)):
    bundle = model_registry.load_model_bundle(model.storage_path)
    try:
        preds, proba, _ = model_registry.predict_with_bundle(bundle, body.rows)
    except Exception as e:
        raise HTTPException(400, f"Prediction failed — check that your input matches the training columns: {e}")

    results = []
    for i, row in enumerate(body.rows):
        entry = {"input": row, "prediction": preds[i]}
        if proba is not None:
            entry["probabilities"] = proba[i]
        results.append(entry)

    record = models.PredictionRecord(
        model_id=model.id, project_id=model.project_id,
        input_json=body.rows, output_json=results,
    )
    db.add(record)
    db.commit()
    log_activity(db, model.project_id, "prediction_made", {"model_id": model.id, "n_rows": len(body.rows)})

    return {"results": results, "disclaimer": "Model estimates, not guarantees — evaluate against the metrics before relying on these."}


@router.get("/predictions")
def prediction_history(model: models.MLModel = Depends(get_owned_model), db: Session = Depends(get_db)):
    records = db.query(models.PredictionRecord).filter(models.PredictionRecord.model_id == model.id).order_by(models.PredictionRecord.created_at.desc()).all()
    return [{"id": r.id, "input": r.input_json, "output": r.output_json, "created_at": r.created_at.isoformat()} for r in records]


@router.get("/explain")
def explain(model: models.MLModel = Depends(get_owned_model)):
    return {
        "feature_importance": model.feature_importance,
        "task_type": model.task_type,
        "note": "Feature importance reflects how much each feature reduced training error / contributed to model coefficients — it shows association, not proven causation.",
    }


@router.post("/explain-instance")
def explain_instance(body: dict, model: models.MLModel = Depends(get_owned_model)):
    bundle = model_registry.load_model_bundle(model.storage_path)
    row = body.get("row", {})
    try:
        preds, _, _ = model_registry.predict_with_bundle(bundle, [row])
    except Exception as e:
        raise HTTPException(400, f"Could not explain — input error: {e}")
    return explain_engine.explain_single_prediction(bundle["model"], model.feature_importance or [], row, preds[0])
