import numpy as np
import pandas as pd
from sklearn.model_selection import train_test_split, cross_val_score
from sklearn.preprocessing import StandardScaler, OrdinalEncoder
from sklearn.linear_model import LogisticRegression, LinearRegression
from sklearn.tree import DecisionTreeClassifier, DecisionTreeRegressor
from sklearn.ensemble import RandomForestClassifier, RandomForestRegressor, GradientBoostingClassifier, GradientBoostingRegressor
from sklearn.neighbors import KNeighborsClassifier, KNeighborsRegressor
from sklearn.naive_bayes import GaussianNB
from sklearn.svm import SVC, SVR
from sklearn.metrics import (
    accuracy_score, precision_score, recall_score, f1_score, roc_auc_score, confusion_matrix,
    mean_absolute_error, mean_squared_error, r2_score,
)

CLASSIFIERS = {
    "logistic_regression": lambda: LogisticRegression(max_iter=1000),
    "decision_tree": lambda: DecisionTreeClassifier(max_depth=8, random_state=42),
    "random_forest": lambda: RandomForestClassifier(n_estimators=200, max_depth=12, random_state=42),
    "gradient_boosting": lambda: GradientBoostingClassifier(random_state=42),
    "knn": lambda: KNeighborsClassifier(n_neighbors=7),
    "naive_bayes": lambda: GaussianNB(),
    "svm": lambda: SVC(probability=True, random_state=42),
}

REGRESSORS = {
    "linear_regression": lambda: LinearRegression(),
    "decision_tree": lambda: DecisionTreeRegressor(max_depth=8, random_state=42),
    "random_forest": lambda: RandomForestRegressor(n_estimators=200, max_depth=12, random_state=42),
    "gradient_boosting": lambda: GradientBoostingRegressor(random_state=42),
    "knn": lambda: KNeighborsRegressor(n_neighbors=7),
    "svm": lambda: SVR(),
}


class AutoMLError(Exception):
    pass


def detect_task_type(y: pd.Series) -> str:
    if pd.api.types.is_numeric_dtype(y):
        nunique = y.nunique(dropna=True)
        if nunique <= max(10, int(0.05 * len(y))) and nunique >= 2:
            return "classification"
        return "regression"
    return "classification"


def prepare_features(df: pd.DataFrame, feature_columns: list[str], target: str):
    X = df[feature_columns].copy()
    y = df[target].copy()

    # drop rows with missing target
    valid = y.notna()
    X, y = X[valid], y[valid]

    # simple, transparent preprocessing: numeric median-fill + scale,
    # categorical mode-fill + ordinal encode. Documented, not hidden.
    numeric_cols = X.select_dtypes(include=[np.number]).columns.tolist()
    categorical_cols = [c for c in X.columns if c not in numeric_cols]

    for c in numeric_cols:
        X[c] = X[c].fillna(X[c].median())
    for c in categorical_cols:
        mode = X[c].mode(dropna=True)
        X[c] = X[c].fillna(mode.iloc[0] if len(mode) else "missing").astype(str)

    encoder = None
    if categorical_cols:
        encoder = OrdinalEncoder(handle_unknown="use_encoded_value", unknown_value=-1)
        X[categorical_cols] = encoder.fit_transform(X[categorical_cols])

    scaler = StandardScaler()
    if numeric_cols:
        X[numeric_cols] = scaler.fit_transform(X[numeric_cols])

    return X, y, {"numeric_cols": numeric_cols, "categorical_cols": categorical_cols, "scaler": scaler, "encoder": encoder}


def train_and_evaluate(df: pd.DataFrame, target: str, feature_columns: list[str] | None, algorithm: str,
                        test_size: float = 0.2, cv_folds: int = 5, task_type: str | None = None):
    if target not in df.columns:
        raise AutoMLError(f"Target column '{target}' not found.")
    if not feature_columns:
        feature_columns = [c for c in df.columns if c != target]
    feature_columns = [c for c in feature_columns if c != target and c in df.columns]
    if not feature_columns:
        raise AutoMLError("No feature columns available after excluding the target.")

    task_type = task_type or detect_task_type(df[target])
    X, y, meta = prepare_features(df, feature_columns, target)
    if len(X) < 10:
        raise AutoMLError(f"Only {len(X)} usable rows after dropping missing targets — need at least 10 to train.")

    registry = CLASSIFIERS if task_type == "classification" else REGRESSORS
    if algorithm not in registry:
        raise AutoMLError(f"Algorithm '{algorithm}' not available for {task_type}. Options: {list(registry)}")

    if task_type == "classification":
        y_encoded, class_names = pd.factorize(y)
        y = pd.Series(y_encoded, index=y.index)
    else:
        class_names = None

    stratify = y if (task_type == "classification" and y.value_counts().min() >= 2) else None
    X_train, X_test, y_train, y_test = train_test_split(
        X, y, test_size=test_size, random_state=42, stratify=stratify
    )

    model = registry[algorithm]()

    cv_scores = None
    try:
        n_splits = min(cv_folds, y_train.value_counts().min()) if task_type == "classification" else cv_folds
        n_splits = max(2, min(n_splits, 10))
        scoring = "accuracy" if task_type == "classification" else "r2"
        cv_scores = cross_val_score(registry[algorithm](), X_train, y_train, cv=n_splits, scoring=scoring)
    except Exception:
        cv_scores = None

    model.fit(X_train, y_train)
    y_pred = model.predict(X_test)

    metrics = {}
    if task_type == "classification":
        metrics["accuracy"] = round(float(accuracy_score(y_test, y_pred)), 4)
        metrics["precision"] = round(float(precision_score(y_test, y_pred, average="weighted", zero_division=0)), 4)
        metrics["recall"] = round(float(recall_score(y_test, y_pred, average="weighted", zero_division=0)), 4)
        metrics["f1"] = round(float(f1_score(y_test, y_pred, average="weighted", zero_division=0)), 4)
        if len(set(y_test)) == 2 and hasattr(model, "predict_proba"):
            try:
                proba = model.predict_proba(X_test)[:, 1]
                metrics["roc_auc"] = round(float(roc_auc_score(y_test, proba)), 4)
            except Exception:
                pass
        cm = confusion_matrix(y_test, y_pred)
        metrics["confusion_matrix"] = cm.tolist()
        metrics["class_names"] = [str(c) for c in class_names] if class_names is not None else None
    else:
        metrics["mae"] = round(float(mean_absolute_error(y_test, y_pred)), 4)
        mse = float(mean_squared_error(y_test, y_pred))
        metrics["mse"] = round(mse, 4)
        metrics["rmse"] = round(mse ** 0.5, 4)
        metrics["r2"] = round(float(r2_score(y_test, y_pred)), 4)

    if cv_scores is not None:
        metrics["cv_mean"] = round(float(np.mean(cv_scores)), 4)
        metrics["cv_std"] = round(float(np.std(cv_scores)), 4)
        metrics["cv_scores"] = [round(float(s), 4) for s in cv_scores]

    metrics["n_train"] = int(len(X_train))
    metrics["n_test"] = int(len(X_test))

    feature_importance = extract_feature_importance(model, feature_columns)

    return {
        "model": model,
        "task_type": task_type,
        "algorithm": algorithm,
        "feature_columns": feature_columns,
        "target": target,
        "metrics": metrics,
        "feature_importance": feature_importance,
        "preprocessing": {"numeric_cols": meta["numeric_cols"], "categorical_cols": meta["categorical_cols"]},
        "scaler": meta["scaler"],
        "encoder": meta["encoder"],
        "class_names": [str(c) for c in class_names] if class_names is not None else None,
    }


def extract_feature_importance(model, feature_columns: list[str]) -> list[dict]:
    if hasattr(model, "feature_importances_"):
        importances = model.feature_importances_
    elif hasattr(model, "coef_"):
        coef = model.coef_
        importances = np.abs(coef).mean(axis=0) if coef.ndim > 1 else np.abs(coef)
    else:
        return []
    pairs = sorted(zip(feature_columns, importances), key=lambda p: abs(p[1]), reverse=True)
    return [{"feature": f, "importance": round(float(v), 6)} for f, v in pairs]


def available_algorithms(task_type: str) -> list[str]:
    return list((CLASSIFIERS if task_type == "classification" else REGRESSORS).keys())
