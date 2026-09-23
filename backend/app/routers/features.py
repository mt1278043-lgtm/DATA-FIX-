from fastapi import APIRouter, Depends, HTTPException
from sqlalchemy.orm import Session

from ..database import get_db
from .. import models, schemas
from ..deps import get_owned_dataset, log_activity, require_feature
from ..services.feature_engine import apply_feature, FeatureError, FEATURE_OPERATIONS
from ..services import storage
from .datasets import get_current_version, _serialize_version

router = APIRouter(prefix="/api/datasets/{dataset_id}/features", tags=["features"])


@router.get("/operations")
def list_operations():
    return {"operations": FEATURE_OPERATIONS}


@router.post("")
def apply_feature_op(body: schemas.FeatureOpRequest, dataset: models.Dataset = Depends(get_owned_dataset), db: Session = Depends(get_db), _entitled: models.User = Depends(require_feature("feature_engineering"))):
    current = get_current_version(dataset, db)
    df = storage.load_dataframe(current.storage_path)
    try:
        new_df, summary = apply_feature(df, body.operation, body.params)
    except FeatureError as e:
        raise HTTPException(400, str(e))

    next_version_number = current.version_number + 1
    path = storage.new_storage_path(dataset.id, next_version_number)
    path = storage.save_dataframe(new_df, path)

    version = models.DatasetVersion(
        dataset_id=dataset.id, version_number=next_version_number, parent_version_id=current.id,
        storage_path=path, n_rows=new_df.shape[0], n_columns=new_df.shape[1],
        operation=f"feature:{body.operation}", operation_params=body.params,
    )
    db.add(version)
    db.commit()
    db.refresh(version)
    dataset.current_version_id = version.id
    db.commit()

    log_activity(db, dataset.project_id, "feature_created", {"dataset_id": dataset.id, **summary})
    return {"version": _serialize_version(version), "summary": summary}
