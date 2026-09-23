from fastapi import APIRouter, Depends, HTTPException
from sqlalchemy.orm import Session

from ..database import get_db
from .. import models, schemas
from ..deps import get_owned_dataset, log_activity
from ..services import sql_engine, storage, nl_to_sql
from .datasets import get_current_version

router = APIRouter(prefix="/api/datasets/{dataset_id}/sql", tags=["sql"])


def _df(dataset, db):
    version = get_current_version(dataset, db)
    return storage.load_dataframe(version.storage_path)


@router.get("/schema")
def schema(dataset: models.Dataset = Depends(get_owned_dataset), db: Session = Depends(get_db)):
    return sql_engine.schema_of(_df(dataset, db))


@router.post("/query")
def run_query(body: schemas.SqlQueryRequest, dataset: models.Dataset = Depends(get_owned_dataset), db: Session = Depends(get_db)):
    df = _df(dataset, db)
    try:
        result = sql_engine.run_query(df, body.sql)
    except sql_engine.SqlError as e:
        raise HTTPException(400, str(e))

    if body.save_as:
        saved = models.SavedQuery(project_id=dataset.project_id, dataset_id=dataset.id, name=body.save_as, sql_text=body.sql)
        db.add(saved)
        db.commit()

    log_activity(db, dataset.project_id, "sql_query_run", {"dataset_id": dataset.id, "sql": body.sql, "rows_returned": result["row_count"]})
    return result


@router.get("/queries")
def list_saved_queries(dataset: models.Dataset = Depends(get_owned_dataset), db: Session = Depends(get_db)):
    queries = db.query(models.SavedQuery).filter(models.SavedQuery.dataset_id == dataset.id).order_by(models.SavedQuery.created_at.desc()).all()
    return [{"id": q.id, "name": q.name, "sql": q.sql_text, "created_at": q.created_at.isoformat()} for q in queries]


@router.post("/generate")
def generate_sql(body: dict, dataset: models.Dataset = Depends(get_owned_dataset), db: Session = Depends(get_db)):
    question = body.get("question", "")
    df = _df(dataset, db)
    return nl_to_sql.generate_sql(question, list(df.columns.astype(str)))
