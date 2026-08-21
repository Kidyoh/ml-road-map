"""
Node 2.3 - the leaky pipeline.

This script reports a cross-validated ROC AUC that looks excellent. It is wrong
in three separate places. Your job is to find all three, fix them, and watch the
score get WORSE.

Every line below is something a competent person has actually shipped. None of
it raises a warning.

Do not read the answer key before you have a number you believe.

    pip install pandas scikit-learn
    python leaky_pipeline.py
"""

import pandas as pd
from sklearn.linear_model import LogisticRegression
from sklearn.metrics import roc_auc_score
from sklearn.model_selection import cross_val_score, train_test_split
from sklearn.preprocessing import StandardScaler

df = pd.read_csv("leaky-churn.csv")

y = df["churned"]
X = df.drop(columns=["churned", "customer_id"])

# --- encode the promo code ----------------------------------------------
# 1,500 distinct codes, so one-hot would be unwieldy. Replace each code with
# the average churn rate of customers who used it.
promo_means = df.groupby("promo_code")["churned"].mean()
X["promo_code"] = X["promo_code"].map(promo_means)

X = pd.get_dummies(X, columns=["plan", "signup_cohort"], drop_first=True)

# --- scale ---------------------------------------------------------------
# Logistic regression wants comparable scales, and these columns are months,
# dollars, counts and percentages.
scaler = StandardScaler()
X_scaled = scaler.fit_transform(X)

# --- evaluate ------------------------------------------------------------
model = LogisticRegression(max_iter=2000)
cv = cross_val_score(model, X_scaled, y, cv=5, scoring="roc_auc")

X_train, X_test, y_train, y_test = train_test_split(
    X_scaled, y, test_size=0.2, random_state=42, stratify=y
)
model.fit(X_train, y_train)
holdout = roc_auc_score(y_test, model.predict_proba(X_test)[:, 1])

print(f"cross-validated ROC AUC: {cv.mean():.4f}  (+/- {cv.std():.4f})")
print(f"held-out ROC AUC:        {holdout:.4f}")
print(f"gap:                     {abs(cv.mean() - holdout):.4f}")
print()
print("Feeling good about that number is the thing this node is testing.")
