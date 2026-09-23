import time
from playwright.sync_api import sync_playwright

BASE = "http://127.0.0.1:8020"
errors = []

with sync_playwright() as p:
    browser = p.chromium.launch(executable_path="/opt/pw-browsers/chromium")
    page = browser.new_page()
    page.on("console", lambda msg: errors.append(msg.text) if msg.type == "error" and "cloudflare" not in msg.text else None)
    page.on("pageerror", lambda exc: errors.append(f"pageerror: {exc}"))

    page.goto(f"{BASE}/login.html")
    page.click("#tabRegister")
    email = f"e2e2_{int(time.time())}@test.com"
    page.fill("#regEmail", email); page.fill("#regPassword", "password123"); page.fill("#regName", "Tester2")
    page.click("#registerForm button[type=submit]")
    page.wait_for_url("**/projects.html", timeout=8000)

    page.fill("#npName", "Interactive Test")
    page.click("#newProjectForm button[type=submit]")
    page.wait_for_url("**/workspace.html*", timeout=8000)

    page.click("[data-view='datasets']")
    page.wait_for_selector("#uploadInput")
    page.set_input_files("#uploadInput", "fixtures/churn_demo.csv")
    page.wait_for_selector("text=Quality score", timeout=15000)

    print("-> cleaning: remove_duplicates")
    page.click("[data-view='cleaning']")
    page.wait_for_selector("[data-op='remove_duplicates']")
    page.click("[data-op='remove_duplicates']")
    page.click("#applyOpBtn")
    page.wait_for_timeout(1500)
    hist = page.inner_text("#historyList")
    assert "remove_duplicates" in hist, "history missing remove_duplicates"
    print("   OK — history:", hist.replace("\n", " | ")[:200])

    print("-> sql: run a real query")
    page.click("[data-view='sql']")
    page.wait_for_selector("#sqlInput")
    page.fill("#sqlInput", "SELECT contract_type, COUNT(*) n FROM dataset GROUP BY contract_type ORDER BY n DESC")
    page.click("#runSqlBtn")
    page.wait_for_timeout(1500)
    result = page.inner_text("#sqlResult")
    assert "Month-to-month" in result, f"sql result unexpected: {result}"
    print("   OK — result:", result.replace("\n", " | ")[:200])

    print("-> automl: train + predict")
    page.click("[data-view='automl']")
    page.wait_for_selector("#targetSelect")
    page.select_option("#targetSelect", "churn")
    page.select_option("#taskTypeSelect", "classification")
    page.wait_for_timeout(500)
    page.select_option("#algoSelect", "logistic_regression")
    page.click("#trainBtn")
    page.wait_for_selector("text=accuracy", timeout=20000)
    metrics_text = page.inner_text("#trainResult")
    print("   OK — metrics:", metrics_text.replace("\n", " ")[:200])

    page.wait_for_selector("[data-predict]", timeout=5000)
    page.click("[data-predict]")
    page.wait_for_timeout(500)
    inputs = page.query_selector_all("[data-pf]")
    sample_values = {"age": "40", "monthly_charges": "90", "tenure_months": "2", "contract_type": "Month-to-month"}
    for inp in inputs:
        name = inp.get_attribute("data-pf")
        inp.fill(sample_values.get(name, "1"))
    page.click("button[id^='doPredictBtn-']")
    page.wait_for_timeout(1500)
    pred_text = page.inner_text("[id^='predictOut-']")
    print("   predict output:", pred_text.replace("\n", " "))
    assert "Prediction" in pred_text, f"predict failed: {pred_text}"

    browser.close()

print("\n=== ERRORS ===")
for e in errors:
    print(" -", e)
print(f"Total (excluding font-awesome CDN): {len(errors)}")
