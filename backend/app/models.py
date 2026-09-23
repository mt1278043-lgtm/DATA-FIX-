import datetime as dt

from sqlalchemy import (
    Column, Integer, String, Float, Boolean, DateTime, ForeignKey, Text, JSON
)
from sqlalchemy.orm import relationship

from .database import Base


def now():
    return dt.datetime.utcnow()


class User(Base):
    __tablename__ = "users"
    id = Column(Integer, primary_key=True)
    email = Column(String, unique=True, index=True, nullable=False)
    hashed_password = Column(String, nullable=False)
    name = Column(String, default="")
    created_at = Column(DateTime, default=now)

    projects = relationship("Project", back_populates="owner", cascade="all, delete-orphan")


class Project(Base):
    __tablename__ = "projects"
    id = Column(Integer, primary_key=True)
    owner_id = Column(Integer, ForeignKey("users.id"), nullable=False)
    name = Column(String, nullable=False)
    description = Column(String, default="")
    created_at = Column(DateTime, default=now)
    updated_at = Column(DateTime, default=now, onupdate=now)

    owner = relationship("User", back_populates="projects")
    datasets = relationship("Dataset", back_populates="project", cascade="all, delete-orphan")
    experiments = relationship("Experiment", back_populates="project", cascade="all, delete-orphan")
    models = relationship("MLModel", back_populates="project", cascade="all, delete-orphan")
    activity = relationship("ActivityLog", back_populates="project", cascade="all, delete-orphan")
    queries = relationship("SavedQuery", back_populates="project", cascade="all, delete-orphan")
    rules = relationship("QualityRule", back_populates="project", cascade="all, delete-orphan")


class Dataset(Base):
    __tablename__ = "datasets"
    id = Column(Integer, primary_key=True)
    project_id = Column(Integer, ForeignKey("projects.id"), nullable=False)
    name = Column(String, nullable=False)
    original_filename = Column(String, default="")
    file_format = Column(String, default="")
    current_version_id = Column(Integer, ForeignKey("dataset_versions.id"), nullable=True)
    target_column = Column(String, nullable=True)
    created_at = Column(DateTime, default=now)

    project = relationship("Project", back_populates="datasets")
    versions = relationship(
        "DatasetVersion", back_populates="dataset", cascade="all, delete-orphan",
        foreign_keys="DatasetVersion.dataset_id",
    )


class DatasetVersion(Base):
    __tablename__ = "dataset_versions"
    id = Column(Integer, primary_key=True)
    dataset_id = Column(Integer, ForeignKey("datasets.id"), nullable=False)
    version_number = Column(Integer, nullable=False)
    parent_version_id = Column(Integer, ForeignKey("dataset_versions.id"), nullable=True)
    storage_path = Column(String, nullable=False)  # parquet file on disk
    n_rows = Column(Integer, default=0)
    n_columns = Column(Integer, default=0)
    profile_json = Column(JSON, nullable=True)  # cached profiler output
    quality_json = Column(JSON, nullable=True)  # cached quality report
    operation = Column(String, default="upload")  # what created this version
    operation_params = Column(JSON, nullable=True)
    created_at = Column(DateTime, default=now)

    dataset = relationship("Dataset", back_populates="versions", foreign_keys=[dataset_id])


class QualityRule(Base):
    __tablename__ = "quality_rules"
    id = Column(Integer, primary_key=True)
    project_id = Column(Integer, ForeignKey("projects.id"), nullable=False)
    dataset_id = Column(Integer, ForeignKey("datasets.id"), nullable=False)
    name = Column(String, nullable=False)
    column = Column(String, nullable=True)
    rule_type = Column(String, nullable=False)  # range, not_null, non_negative, regex, unique
    params = Column(JSON, nullable=True)
    created_at = Column(DateTime, default=now)

    project = relationship("Project", back_populates="rules")


class SavedQuery(Base):
    __tablename__ = "saved_queries"
    id = Column(Integer, primary_key=True)
    project_id = Column(Integer, ForeignKey("projects.id"), nullable=False)
    dataset_id = Column(Integer, ForeignKey("datasets.id"), nullable=False)
    name = Column(String, default="")
    sql_text = Column(Text, nullable=False)
    created_at = Column(DateTime, default=now)

    project = relationship("Project", back_populates="queries")


class Experiment(Base):
    __tablename__ = "experiments"
    id = Column(Integer, primary_key=True)
    project_id = Column(Integer, ForeignKey("projects.id"), nullable=False)
    dataset_version_id = Column(Integer, ForeignKey("dataset_versions.id"), nullable=False)
    task_type = Column(String, nullable=False)  # classification | regression
    target_column = Column(String, nullable=False)
    feature_columns = Column(JSON, nullable=True)
    algorithm = Column(String, nullable=False)
    params = Column(JSON, nullable=True)
    metrics = Column(JSON, nullable=True)
    status = Column(String, default="completed")  # running|completed|failed
    error = Column(Text, nullable=True)
    notes = Column(Text, default="")
    created_at = Column(DateTime, default=now)

    project = relationship("Project", back_populates="experiments")
    model = relationship("MLModel", back_populates="experiment", uselist=False)


class MLModel(Base):
    __tablename__ = "ml_models"
    id = Column(Integer, primary_key=True)
    project_id = Column(Integer, ForeignKey("projects.id"), nullable=False)
    experiment_id = Column(Integer, ForeignKey("experiments.id"), nullable=False)
    name = Column(String, nullable=False)
    task_type = Column(String, nullable=False)
    algorithm = Column(String, nullable=False)
    storage_path = Column(String, nullable=False)  # joblib file
    feature_columns = Column(JSON, nullable=True)
    target_column = Column(String, nullable=False)
    metrics = Column(JSON, nullable=True)
    feature_importance = Column(JSON, nullable=True)
    created_at = Column(DateTime, default=now)

    project = relationship("Project", back_populates="models")
    experiment = relationship("Experiment", back_populates="model")
    predictions = relationship("PredictionRecord", back_populates="model", cascade="all, delete-orphan")


class PredictionRecord(Base):
    __tablename__ = "predictions"
    id = Column(Integer, primary_key=True)
    model_id = Column(Integer, ForeignKey("ml_models.id"), nullable=False)
    project_id = Column(Integer, ForeignKey("projects.id"), nullable=False)
    input_json = Column(JSON, nullable=True)
    output_json = Column(JSON, nullable=True)
    created_at = Column(DateTime, default=now)

    model = relationship("MLModel", back_populates="predictions")


class ActivityLog(Base):
    __tablename__ = "activity_log"
    id = Column(Integer, primary_key=True)
    project_id = Column(Integer, ForeignKey("projects.id"), nullable=False)
    action = Column(String, nullable=False)
    details = Column(JSON, nullable=True)
    created_at = Column(DateTime, default=now)

    project = relationship("Project", back_populates="activity")
