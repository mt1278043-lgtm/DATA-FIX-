import numpy as np
from sklearn.inspection import permutation_importance


def permutation_importances(model, X_test, y_test, feature_columns, scoring=None, n_repeats=10):
    result = permutation_importance(model, X_test, y_test, n_repeats=n_repeats, random_state=42, scoring=scoring)
    pairs = sorted(zip(feature_columns, result.importances_mean, result.importances_std),
                   key=lambda p: p[1], reverse=True)
    return [{"feature": f, "importance_mean": round(float(m), 6), "importance_std": round(float(s), 6)} for f, m, s in pairs]


def explain_single_prediction(model, feature_importance: list[dict], input_row: dict, prediction) -> dict:
    """Best-effort, honest local explanation: for tree/linear models with global
    feature_importances_/coef_, show which of *this row's* features carry the most
    weight (importance x standardized deviation isn't computed here to avoid implying
    SHAP-level precision) — we surface global importances applied to this instance's
    values so users see which inputs mattered most for models like these, without
    overclaiming a formal Shapley decomposition.
    """
    top = feature_importance[:5]
    contributing = [{"feature": f["feature"], "value": input_row.get(f["feature"]), "global_importance": f["importance"]} for f in top]
    return {
        "prediction": prediction,
        "top_contributing_features": contributing,
        "note": "Feature importances are global (from model training), applied to this instance's input values — not a per-instance Shapley decomposition.",
    }
