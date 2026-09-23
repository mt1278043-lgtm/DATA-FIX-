from fastapi import APIRouter, Depends, HTTPException
from sqlalchemy.orm import Session

from ..database import get_db
from .. import models, schemas
from ..deps import get_owned_dataset, log_activity
from ..services.cleaning_engine import apply_operation, CleaningError, OPERATIONS
from ..services import storage
from .datasets import get_current_version, _serialize_version

router = APIRouter(prefix="/api/datasets/{dataset_id}/clean", tags=["cleaning"])


@router.get("/operations")
def list_operations():
    return {"operations": OPERATIONS}


@router.post("")
def apply_cleaning(
    body: schemas.CleaningOpRequest,
    dataset: models.Dataset = Depends(get_owned_dataset),
    db: Session = Depends(get_db),
):
    current = get_current_version(dataset, db)
    df = storage.load_dataframe(current.storage_path)

    before_sample = df.head(5).astype(object).where(df.head(5).notna(), None).values.tolist()
    try:
        new_df, summary = apply_operation(df, body.operation, body.params)
    except CleaningError as e:
        raise HTTPException(400, str(e))
    after_sample = new_df.head(5).astype(object).where(new_df.head(5).notna(), None).values.tolist()

    next_version_number = current.version_number + 1
    path = storage.new_storage_path(dataset.id, next_version_number)
    path = storage.save_dataframe(new_df, path)

    version = models.DatasetVersion(
        dataset_id=dataset.id, version_number=next_version_number, parent_version_id=current.id,
        storage_path=path, n_rows=new_df.shape[0], n_columns=new_df.shape[1],
        operation=body.operation, operation_params=body.params,
    )
    db.add(version)
    db.commit()
    db.refresh(version)
    dataset.current_version_id = version.id
    db.commit()

    log_activity(db, dataset.project_id, "cleaning_applied", {"dataset_id": dataset.id, "operation": body.operation, **summary})

    return {
        "version": _serialize_version(version),
        "summary": summary,
        "before_sample": {"columns": list(df.columns.astype(str)), "rows": before_sample},
        "after_sample": {"columns": list(new_df.columns.astype(str)), "rows": after_sample},
    }


@router.post("/undo")
def undo(dataset: models.Dataset = Depends(get_owned_dataset), db: Session = Depends(get_db)):
    current = get_current_version(dataset, db)
    if not current.parent_version_id:
        raise HTTPException(400, "Already at the earliest version — nothing to undo.")
    parent = db.query(models.DatasetVersion).filter(models.DatasetVersion.id == current.parent_version_id).first()
    dataset.current_version_id = parent.id
    db.commit()
    log_activity(db, dataset.project_id, "cleaning_undo", {"dataset_id": dataset.id, "reverted_to_version": parent.version_number})
    return _serialize_version(parent)


@router.get("/history")
def history(dataset: models.Dataset = Depends(get_owned_dataset)):
    versions = sorted(dataset.versions, key=lambda v: v.version_number)
    return [_serialize_version(v) for v in versions]
