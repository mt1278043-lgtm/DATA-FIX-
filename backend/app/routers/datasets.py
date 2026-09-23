from fastapi import APIRouter, Depends, HTTPException, UploadFile, File, Query
from sqlalchemy.orm import Session

from ..database import get_db
from .. import models, schemas
from ..deps import get_current_user, get_owned_project, get_owned_dataset, log_activity
from ..services.file_parser import parse_upload, DatasetValidationError
from ..services.profiler import profile_dataset
from ..services.quality_engine import compute_quality_score, evaluate_rule
from ..services import storage

router = APIRouter(prefix="/api", tags=["datasets"])


def _version_df(version: models.DatasetVersion):
    return storage.load_dataframe(version.storage_path)


def get_current_version(dataset: models.Dataset, db: Session) -> models.DatasetVersion:
    version = db.query(models.DatasetVersion).filter(models.DatasetVersion.id == dataset.current_version_id).first()
    if not version:
        raise HTTPException(404, "Dataset has no versions yet.")
    return version


def _serialize_dataset(d: models.Dataset) -> dict:
    return {
        "id": d.id, "name": d.name, "original_filename": d.original_filename,
        "file_format": d.file_format, "target_column": d.target_column,
        "current_version_id": d.current_version_id, "n_versions": len(d.versions),
        "created_at": d.created_at.isoformat(),
    }


def _serialize_version(v: models.DatasetVersion) -> dict:
    return {
        "id": v.id, "version_number": v.version_number, "parent_version_id": v.parent_version_id,
        "n_rows": v.n_rows, "n_columns": v.n_columns, "operation": v.operation,
        "operation_params": v.operation_params, "created_at": v.created_at.isoformat(),
    }


@router.get("/projects/{project_id}/datasets")
def list_datasets(project: models.Project = Depends(get_owned_project)):
    return [_serialize_dataset(d) for d in project.datasets]


@router.post("/projects/{project_id}/datasets/upload")
async def upload_dataset(
    project: models.Project = Depends(get_owned_project),
    file: UploadFile = File(...),
    db: Session = Depends(get_db),
):
    content = await file.read()
    try:
        df = parse_upload(file.filename, content)
    except DatasetValidationError as e:
        raise HTTPException(400, str(e))

    ext = "." + file.filename.rsplit(".", 1)[-1].lower()
    dataset = models.Dataset(
        project_id=project.id, name=file.filename, original_filename=file.filename, file_format=ext,
    )
    db.add(dataset)
    db.commit()
    db.refresh(dataset)

    profile = profile_dataset(df)
    quality = compute_quality_score(df)
    path = storage.new_storage_path(dataset.id, 1)
    path = storage.save_dataframe(df, path)

    version = models.DatasetVersion(
        dataset_id=dataset.id, version_number=1, storage_path=path,
        n_rows=df.shape[0], n_columns=df.shape[1],
        profile_json=profile, quality_json=quality, operation="upload",
    )
    db.add(version)
    db.commit()
    db.refresh(version)

    dataset.current_version_id = version.id
    if profile["potential_target_columns"]:
        dataset.target_column = profile["potential_target_columns"][0]
    db.commit()

    log_activity(db, project.id, "dataset_uploaded", {"dataset_id": dataset.id, "filename": file.filename, "rows": df.shape[0], "columns": df.shape[1]})

    return {"dataset": _serialize_dataset(dataset), "version": _serialize_version(version), "profile": profile, "quality": quality}


@router.get("/datasets/{dataset_id}")
def get_dataset(dataset: models.Dataset = Depends(get_owned_dataset)):
    return _serialize_dataset(dataset)


@router.delete("/datasets/{dataset_id}")
def delete_dataset(dataset: models.Dataset = Depends(get_owned_dataset), db: Session = Depends(get_db)):
    db.delete(dataset)
    db.commit()
    return {"deleted": True}


@router.get("/datasets/{dataset_id}/versions")
def list_versions(dataset: models.Dataset = Depends(get_owned_dataset)):
    return [_serialize_version(v) for v in sorted(dataset.versions, key=lambda v: v.version_number)]


@router.post("/datasets/{dataset_id}/versions/{version_id}/restore")
def restore_version(version_id: int, dataset: models.Dataset = Depends(get_owned_dataset), db: Session = Depends(get_db)):
    version = db.query(models.DatasetVersion).filter(models.DatasetVersion.id == version_id, models.DatasetVersion.dataset_id == dataset.id).first()
    if not version:
        raise HTTPException(404, "Version not found")
    dataset.current_version_id = version.id
    db.commit()
    log_activity(db, dataset.project_id, "version_restored", {"dataset_id": dataset.id, "version_id": version.id})
    return _serialize_version(version)


@router.get("/datasets/{dataset_id}/preview")
def preview_dataset(dataset: models.Dataset = Depends(get_owned_dataset), db: Session = Depends(get_db), limit: int = Query(50, le=500)):
    version = get_current_version(dataset, db)
    df = _version_df(version)
    head = df.head(limit)
    return {
        "columns": list(head.columns.astype(str)),
        "rows": head.astype(object).where(head.notna(), None).values.tolist(),
        "total_rows": int(len(df)),
    }


@router.get("/datasets/{dataset_id}/profile")
def get_profile(dataset: models.Dataset = Depends(get_owned_dataset), db: Session = Depends(get_db)):
    version = get_current_version(dataset, db)
    if version.profile_json:
        return version.profile_json
    df = _version_df(version)
    profile = profile_dataset(df)
    version.profile_json = profile
    db.commit()
    return profile


@router.get("/datasets/{dataset_id}/quality")
def get_quality(dataset: models.Dataset = Depends(get_owned_dataset), db: Session = Depends(get_db)):
    version = get_current_version(dataset, db)
    if version.quality_json:
        base = version.quality_json
    else:
        df = _version_df(version)
        base = compute_quality_score(df)
        version.quality_json = base
        db.commit()

    rules = db.query(models.QualityRule).filter(models.QualityRule.dataset_id == dataset.id).all()
    if rules:
        df = _version_df(version)
        rule_results = [evaluate_rule(df, r) for r in rules]
    else:
        rule_results = []
    return {**base, "rules": rule_results}


@router.post("/datasets/{dataset_id}/rules")
def create_rule(body: schemas.RuleCreate, dataset: models.Dataset = Depends(get_owned_dataset), db: Session = Depends(get_db)):
    rule = models.QualityRule(
        project_id=dataset.project_id, dataset_id=dataset.id, name=body.name,
        column=body.column, rule_type=body.rule_type, params=body.params,
    )
    db.add(rule)
    db.commit()
    db.refresh(rule)
    version = get_current_version(dataset, db)
    df = _version_df(version)
    result = evaluate_rule(df, rule)
    log_activity(db, dataset.project_id, "quality_rule_created", {"dataset_id": dataset.id, "rule": body.name})
    return result


@router.get("/datasets/{dataset_id}/rules")
def list_rules(dataset: models.Dataset = Depends(get_owned_dataset), db: Session = Depends(get_db)):
    rules = db.query(models.QualityRule).filter(models.QualityRule.dataset_id == dataset.id).all()
    version = get_current_version(dataset, db)
    df = _version_df(version)
    return [evaluate_rule(df, r) for r in rules]


@router.delete("/rules/{rule_id}")
def delete_rule(rule_id: int, db: Session = Depends(get_db), user: models.User = Depends(get_current_user)):
    rule = db.query(models.QualityRule).filter(models.QualityRule.id == rule_id).first()
    if not rule or rule.project.owner_id != user.id:
        raise HTTPException(404, "Rule not found")
    db.delete(rule)
    db.commit()
    return {"deleted": True}


@router.put("/datasets/{dataset_id}/target")
def set_target(body: schemas.SetTargetRequest, dataset: models.Dataset = Depends(get_owned_dataset), db: Session = Depends(get_db)):
    version = get_current_version(dataset, db)
    df = _version_df(version)
    if body.target_column not in df.columns:
        raise HTTPException(400, f"Column '{body.target_column}' not found in dataset")
    dataset.target_column = body.target_column
    db.commit()
    return _serialize_dataset(dataset)
