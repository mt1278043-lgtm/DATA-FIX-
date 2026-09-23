from typing import Optional, Any
from pydantic import BaseModel, EmailStr


class RegisterRequest(BaseModel):
    email: EmailStr
    password: str
    name: str = ""


class LoginRequest(BaseModel):
    email: EmailStr
    password: str


class ProjectCreate(BaseModel):
    name: str
    description: str = ""


class ProjectUpdate(BaseModel):
    name: Optional[str] = None
    description: Optional[str] = None


class CleaningOpRequest(BaseModel):
    operation: str
    params: dict = {}


class FeatureOpRequest(BaseModel):
    operation: str
    params: dict = {}


class RuleCreate(BaseModel):
    name: str
    column: Optional[str] = None
    rule_type: str
    params: dict = {}


class SqlQueryRequest(BaseModel):
    sql: str
    save_as: Optional[str] = None


class TrainRequest(BaseModel):
    target: str
    feature_columns: Optional[list[str]] = None
    algorithm: str
    task_type: Optional[str] = None
    test_size: float = 0.2
    cv_folds: int = 5
    notes: str = ""


class PredictRequest(BaseModel):
    rows: list[dict[str, Any]]


class SetTargetRequest(BaseModel):
    target_column: str
