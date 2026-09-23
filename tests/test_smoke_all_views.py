import time
from playwright.sync_api import sync_playwright

BASE = "http://127.0.0.1:8020"
errors = []

with sync_playwright() as p:
    browser = p.chromium.launch(executable_path="/opt/pw-browsers/chromium")
    page = browser.new_page()
    page.on("console", lambda msg: errors.append(msg.text) if msg.type == "error" else None)
    page.on("pageerror", lambda exc: errors.append(f"pageerror: {exc}"))

    print("-> login page")
    page.goto(f"{BASE}/login.html")
    page.click("#tabRegister")
    email = f"e2e_{int(time.time())}@test.com"
    page.fill("#regEmail", email)
    page.fill("#regPassword", "password123")
    page.fill("#regName", "E2E Tester")
    page.click("#registerForm button[type=submit]")
    page.wait_for_url("**/projects.html", timeout=8000)
    print("   registered + redirected to projects.html OK")

    print("-> create project")
    page.fill("#npName", "E2E Project")
    page.fill("#npDesc", "created by playwright test")
    page.click("#newProjectForm button[type=submit]")
    page.wait_for_url("**/workspace.html*", timeout=8000)
    print("   project created + redirected to workspace OK")

    print("-> upload dataset")
    page.click("[data-view='datasets']")
    page.wait_for_selector("#uploadInput", timeout=5000)
    page.set_input_files("#uploadInput", "fixtures/churn_demo.csv")
    page.wait_for_selector("text=Quality score", timeout=15000)
    print("   uploadStatus:", page.inner_text("#uploadStatus"))

    for view in ["overview", "quality", "cleaning", "eda", "sql", "features", "automl", "activity"]:
        print(f"-> view: {view}")
        page.click(f"[data-view='{view}']")
        page.wait_for_timeout(1500)
        content = page.inner_text(f"#view-{view}")
        assert len(content.strip()) > 0, f"view {view} rendered empty"
        print(f"   {view} rendered, {len(content)} chars")

    browser.close()

print("\n=== CONSOLE/PAGE ERRORS ===")
for e in errors:
    print(" -", e)
print(f"\nTotal errors: {len(errors)}")
