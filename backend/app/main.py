from fastapi import FastAPI
from fastapi.middleware.cors import CORSMiddleware

from .database import Base, engine
from . import models  # noqa: F401  (registers models on Base.metadata)
from .routers import auth, projects, datasets, cleaning, eda, sql, features, automl, ml_models, predictions, activity, dashboard

Base.metadata.create_all(bind=engine)

app = FastAPI(title="DataFix AI API", version="1.0.0")

app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)

app.include_router(auth.router)
app.include_router(projects.router)
app.include_router(datasets.router)
app.include_router(cleaning.router)
app.include_router(eda.router)
app.include_router(sql.router)
app.include_router(features.router)
app.include_router(automl.router)
app.include_router(ml_models.router)
app.include_router(predictions.router)
app.include_router(activity.router)
app.include_router(dashboard.router)


@app.get("/api/health")
def health():
    return {"status": "ok"}
