from fastapi import APIRouter, Depends, HTTPException, Query
from sqlalchemy.orm import Session

from ..database import get_db
from .. import models
from ..deps import get_owned_dataset
from ..services import eda_engine, storage
from .datasets import get_current_version

router = APIRouter(prefix="/api/datasets/{dataset_id}/eda", tags=["eda"])


def _df(dataset, db):
    version = get_current_version(dataset, db)
    return storage.load_dataframe(version.storage_path)


@router.get("/distribution")
def distribution(column: str, bins: int = 20, dataset: models.Dataset = Depends(get_owned_dataset), db: Session = Depends(get_db)):
    df = _df(dataset, db)
    if column not in df.columns:
        raise HTTPException(400, f"Column '{column}' not found")
    return eda_engine.distribution(df, column, bins)


@router.get("/correlation")
def correlation(method: str = "pearson", dataset: models.Dataset = Depends(get_owned_dataset), db: Session = Depends(get_db)):
    return eda_engine.correlation_matrix(_df(dataset, db), method)


@router.get("/missingness")
def missingness(dataset: models.Dataset = Depends(get_owned_dataset), db: Session = Depends(get_db)):
    return eda_engine.missingness_report(_df(dataset, db))


@router.get("/target")
def target_analysis(column: str, dataset: models.Dataset = Depends(get_owned_dataset), db: Session = Depends(get_db)):
    df = _df(dataset, db)
    if column not in df.columns:
        raise HTTPException(400, f"Column '{column}' not found")
    return eda_engine.target_analysis(df, column)


@router.get("/group")
def group_analysis(group_column: str, value_column: str, agg: str = "mean", dataset: models.Dataset = Depends(get_owned_dataset), db: Session = Depends(get_db)):
    df = _df(dataset, db)
    for c in (group_column, value_column):
        if c not in df.columns:
            raise HTTPException(400, f"Column '{c}' not found")
    return eda_engine.group_analysis(df, group_column, value_column, agg)


@router.get("/trend")
def time_trend(date_column: str, value_column: str, freq: str = "M", agg: str = "sum", dataset: models.Dataset = Depends(get_owned_dataset), db: Session = Depends(get_db)):
    df = _df(dataset, db)
    for c in (date_column, value_column):
        if c not in df.columns:
            raise HTTPException(400, f"Column '{c}' not found")
    return eda_engine.time_trend(df, date_column, value_column, freq, agg)
