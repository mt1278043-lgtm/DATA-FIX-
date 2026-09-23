/**
 * app.js
 * -----------------------------------------------------------------------
 * Shared across every page: the storage bridge that stands in for a
 * backend, small UI helpers (toast, loading overlay), the demo dataset
 * generator, and the upload page's full flow (drag/drop, parsing,
 * preview, and the "analyzing" processing checklist before handing off
 * to dashboard.js). Dashboard-specific rendering lives in dashboard.js.
 * -----------------------------------------------------------------------
 */

/* ==========================================================================
   Storage bridge (stands in for a backend call)
   ========================================================================== */

const DataFixAPI = (() => {
  const STORAGE_KEY = "datafix_ai_dataset_v2";

  function saveDataset(dataset) {
    try {
      localStorage.setItem(STORAGE_KEY, JSON.stringify(dataset));
      return true;
    } catch (e) {
      console.error("Could not save dataset to storage", e);
      return false;
    }
  }

  function loadDataset() {
    try {
      const raw = localStorage.getItem(STORAGE_KEY);
      return raw ? JSON.parse(raw) : null;
    } catch (e) {
      console.error("Could not read dataset from storage", e);
      return null;
    }
  }

  function clearDataset() {
    localStorage.removeItem(STORAGE_KEY);
  }

  return { saveDataset, loadDataset, clearDataset };
})();

/* ==========================================================================
   Small UI helpers (toast, loading overlay) shared across pages
   ========================================================================== */

const UI = (() => {
  function ensureToastStack() {
    let stack = document.getElementById("toastStack");
    if (!stack) {
      stack = document.createElement("div");
      stack.id = "toastStack";
      stack.className = "toast-stack";
      document.body.appendChild(stack);
    }
    return stack;
  }

  function toast(message, type = "info") {
    const stack = ensureToastStack();
    const el = document.createElement("div");
    el.className = "toast" + (type === "error" ? " error" : "");
    el.textContent = message;
    stack.appendChild(el);
    setTimeout(() => {
      el.style.opacity = "0";
      el.style.transition = "opacity 0.25s ease";
      setTimeout(() => el.remove(), 260);
    }, 3200);
  }

  function ensureLoadingOverlay() {
    let overlay = document.getElementById("loadingOverlay");
    if (!overlay) {
      overlay = document.createElement("div");
      overlay.id = "loadingOverlay";
      overlay.className = "loading-overlay";
      overlay.innerHTML = `<div class="spinner"></div><div class="loading-text" id="loadingText">Working…</div>`;
      document.body.appendChild(overlay);
    }
    return overlay;
  }

  function showLoading(text) {
    const overlay = ensureLoadingOverlay();
    document.getElementById("loadingText").textContent = text || "Working…";
    overlay.classList.add("visible");
  }

  function hideLoading() {
    const overlay = document.getElementById("loadingOverlay");
    if (overlay) overlay.classList.remove("visible");
  }

  function escapeHTML(str) {
    return String(str)
      .replace(/&/g, "&amp;")
      .replace(/</g, "&lt;")
      .replace(/>/g, "&gt;")
      .replace(/"/g, "&quot;");
  }

  return { toast, showLoading, hideLoading, escapeHTML };
})();

/* ==========================================================================
   Navbar mobile toggle (all pages)
   ========================================================================== */

document.addEventListener("DOMContentLoaded", () => {
  const navToggle = document.getElementById("navToggle");
  const navLinks = document.getElementById("navLinks");
  if (navToggle && navLinks) {
    navToggle.addEventListener("click", () => {
      navLinks.classList.toggle("mobile-open");
      navLinks.style.display = navLinks.classList.contains("mobile-open") ? "flex" : "";
    });
  }
});

/* ==========================================================================
   Demo dataset generator — a realistic, intentionally messy sales dataset
   ========================================================================== */

const DemoData = (() => {
  function generate() {
    const regions = ["North America", "north america", "N. America", "Europe", "europe", "Asia Pacific", "APAC", "Latin America"];
    const categories = ["Electronics", "Home & Garden", "Apparel", "Sporting Goods", "Office Supplies"];
    const products = {
      Electronics: ["Wireless Mouse", "USB-C Hub", "Noise Cancelling Headphones", "4K Monitor", "Mechanical Keyboard"],
      "Home & Garden": ["Ceramic Planter", "LED Desk Lamp", "Throw Blanket", "Garden Shears", "Wall Clock"],
      Apparel: ["Cotton T-Shirt", "Running Shoes", "Denim Jacket", "Wool Sweater", "Rain Jacket"],
      "Sporting Goods": ["Yoga Mat", "Resistance Bands", "Water Bottle", "Cycling Gloves", "Camping Tent"],
      "Office Supplies": ["Notebook Set", "Desk Organizer", "Stapler", "Whiteboard", "Pen Pack"],
    };
    const firstNames = ["Maria", "James", "Aiko", "Liam", "Fatima", "Noah", "Sofia", "Chen", "Omar", "Elena", "Lucas", "Priya"];
    const lastNames = ["Garcia", "Smith", "Tanaka", "Murphy", "Khan", "Rossi", "Silva", "Wang", "Haddad", "Novak", "Costa", "Patel"];

    const rows = [];
    const totalRows = 220;

    for (let i = 0; i < totalRows; i++) {
      const category = categories[Math.floor(Math.random() * categories.length)];
      const product = products[category][Math.floor(Math.random() * products[category].length)];
      const quantity = 1 + Math.floor(Math.random() * 12);
      let unitPrice = (5 + Math.random() * 180).toFixed(2);
      const region = regions[Math.floor(Math.random() * regions.length)];
      const name = `${firstNames[Math.floor(Math.random() * firstNames.length)]} ${
        lastNames[Math.floor(Math.random() * lastNames.length)]
      }`;

      const day = 1 + Math.floor(Math.random() * 27);
      const month = 1 + Math.floor(Math.random() * 12);
      const orderDate = `2025-${String(month).padStart(2, "0")}-${String(day).padStart(2, "0")}`;
      const returned = Math.random() < 0.12 ? "Yes" : "No";

      rows.push({
        "Order ID": `ORD-${10000 + i}`,
        "Customer Name": name,
        Region: region,
        Category: category,
        Product: product,
        Quantity: String(quantity),
        "Unit Price": unitPrice,
        "Order Date": orderDate,
        Returned: returned,
      });
    }

    const missingTargetCols = ["Customer Name", "Region", "Unit Price"];
    rows.forEach((row) => {
      missingTargetCols.forEach((col) => {
        if (Math.random() < 0.05) row[col] = "";
      });
    });

    for (let i = 0; i < 14; i++) {
      const idx = Math.floor(Math.random() * rows.length);
      rows[idx]["Unit Price"] = (1800 + Math.random() * 4000).toFixed(2);
    }
    for (let i = 0; i < 8; i++) {
      const idx = Math.floor(Math.random() * rows.length);
      rows[idx]["Quantity"] = String(400 + Math.floor(Math.random() * 600));
    }
    for (let i = 0; i < 6; i++) {
      const idx = Math.floor(Math.random() * rows.length);
      rows[idx]["Quantity"] = "N/A";
    }
    for (let i = 0; i < 5; i++) {
      const idx = Math.floor(Math.random() * rows.length);
      rows[idx]["Order Date"] = "not a date";
    }
    for (let i = 0; i < 18; i++) {
      const idx = Math.floor(Math.random() * rows.length);
      rows.push({ ...rows[idx] });
    }
    for (let i = rows.length - 1; i > 0; i--) {
      const j = Math.floor(Math.random() * (i + 1));
      [rows[i], rows[j]] = [rows[j], rows[i]];
    }

    const columns = ["Order ID", "Customer Name", "Region", "Category", "Product", "Quantity", "Unit Price", "Order Date", "Returned"];

    return {
      fileName: "demo-sales-dataset.csv",
      fileSize: new Blob([JSON.stringify(rows)]).size,
      importedAt: new Date().toISOString(),
      columns,
      rows,
    };
  }

  return { generate };
})();

/* ==========================================================================
   UPLOAD PAGE
   ========================================================================== */

(function initUploadPage() {
  const dropzone = document.getElementById("dropzone");
  if (!dropzone) return; // not the upload page

  const fileInput = document.getElementById("fileInput");
  const browseBtn = document.getElementById("browseBtn");
  const tryDemoBtn = document.getElementById("tryDemoBtn");
  const progressCard = document.getElementById("fileProgressCard");
  const fileNameEl = document.getElementById("fileNameEl");
  const fileSizeEl = document.getElementById("fileSizeEl");
  const progressFill = document.getElementById("progressFill");
  const fileStatusEl = document.getElementById("fileStatusEl");
  const errorBox = document.getElementById("uploadErrorBox");
  const previewCard = document.getElementById("uploadPreviewCard");
  const previewMeta = document.getElementById("previewMeta");
  const previewTableWrap = document.getElementById("previewTableWrap");
  const analyzeBtn = document.getElementById("analyzeBtn");
  const cancelUploadBtn = document.getElementById("cancelUploadBtn");
  const processingCard = document.getElementById("processingCard");
  const processingComplete = document.getElementById("processingComplete");

  let pendingDataset = null;

  function resetError() {
    errorBox.classList.remove("visible");
    errorBox.textContent = "";
  }

  function showError(message) {
    errorBox.textContent = message;
    errorBox.classList.add("visible");
    progressCard.classList.remove("visible");
    previewCard.classList.remove("visible");
  }

  function showPreview(dataset) {
    pendingDataset = dataset;
    const cols = dataset.columns;
    const sampleRows = dataset.rows.slice(0, 6);

    previewMeta.textContent = `${dataset.rows.length.toLocaleString()} rows · ${cols.length} columns · ${CSVParser.formatFileSize(
      dataset.fileSize
    )}`;

    let html = '<div class="table-scroll"><table class="data-table"><thead><tr>';
    cols.forEach((c) => (html += `<th>${UI.escapeHTML(c)}</th>`));
    html += "</tr></thead><tbody>";
    sampleRows.forEach((row) => {
      html += "<tr>";
      cols.forEach((c) => (html += `<td>${UI.escapeHTML(row[c] === "" ? "—" : row[c])}</td>`));
      html += "</tr>";
    });
    html += "</tbody></table></div>";
    previewTableWrap.innerHTML = html;
    previewCard.classList.add("visible");
  }

  function simulateProgress(fileName, fileSize, onDone) {
    progressCard.classList.add("visible");
    fileNameEl.textContent = fileName;
    fileSizeEl.textContent = CSVParser.formatFileSize(fileSize);
    progressFill.style.width = "0%";
    fileStatusEl.textContent = "Reading file…";

    let pct = 0;
    const interval = setInterval(() => {
      pct += 8 + Math.random() * 14;
      if (pct >= 100) {
        pct = 100;
        progressFill.style.width = "100%";
        fileStatusEl.innerHTML = '<span class="checkmark">✓</span> Dataset uploaded successfully';
        clearInterval(interval);
        setTimeout(onDone, 350);
      } else {
        progressFill.style.width = pct + "%";
        fileStatusEl.textContent = pct < 55 ? "Reading file…" : "Parsing rows…";
      }
    }, 90);
  }

  function handleFile(file) {
    resetError();
    previewCard.classList.remove("visible");

    if (!file) return;

    const validExt = /\.(csv|xlsx|xls)$/i.test(file.name);
    if (!validExt) {
      showError("Unsupported file type. Please upload a .csv, .xlsx, or .xls file.");
      return;
    }

    const isExcel = /\.(xlsx|xls)$/i.test(file.name);
    if (isExcel) {
      showError(
        "This preview build parses CSV in-browser. Please export your Excel file as .csv, or connect SheetJS in csv-parser.js to add native .xlsx support."
      );
      return;
    }

    if (file.size > 15 * 1024 * 1024) {
      showError("File is too large. Please upload a file under 15 MB.");
      return;
    }

    const reader = new FileReader();
    reader.onload = (e) => {
      simulateProgress(file.name, file.size, () => {
        try {
          const dataset = CSVParser.buildDataset(e.target.result, file.name, file.size);
          if (dataset.rows.length === 0) {
            showError("No data rows found after the header row.");
            return;
          }
          showPreview(dataset);
        } catch (err) {
          showError(err.message || "Couldn't parse this file.");
        }
      });
    };
    reader.onerror = () => showError("Couldn't read this file. Please try again.");
    reader.readAsText(file);
  }

  browseBtn.addEventListener("click", () => fileInput.click());
  dropzone.addEventListener("click", (e) => {
    if (e.target === browseBtn) return;
    fileInput.click();
  });
  fileInput.addEventListener("change", (e) => {
    if (e.target.files[0]) handleFile(e.target.files[0]);
  });

  const dzTitle = dropzone.querySelector("h3");
  const dzTitleOriginal = dzTitle ? dzTitle.textContent : "";
  ["dragenter", "dragover"].forEach((evt) =>
    dropzone.addEventListener(evt, (e) => {
      e.preventDefault();
      dropzone.classList.add("dragover");
      if (dzTitle) dzTitle.textContent = "Drop your dataset here";
    })
  );
  ["dragleave", "drop"].forEach((evt) =>
    dropzone.addEventListener(evt, (e) => {
      e.preventDefault();
      dropzone.classList.remove("dragover");
      if (dzTitle) dzTitle.textContent = dzTitleOriginal;
    })
  );
  dropzone.addEventListener("drop", (e) => {
    const file = e.dataTransfer.files[0];
    if (file) handleFile(file);
  });

  tryDemoBtn.addEventListener("click", () => {
    resetError();
    UI.showLoading("Generating demo sales dataset…");
    setTimeout(() => {
      const dataset = DemoData.generate();
      UI.hideLoading();
      showPreview(dataset);
      previewCard.scrollIntoView({ behavior: "smooth", block: "center" });
    }, 500);
  });

  cancelUploadBtn.addEventListener("click", () => {
    pendingDataset = null;
    previewCard.classList.remove("visible");
    progressCard.classList.remove("visible");
    fileInput.value = "";
  });

  /** Sequential "Analyzing Dataset" checklist animation before handoff. */
  function runProcessingSequence(onComplete) {
    previewCard.classList.remove("visible");
    processingCard.classList.add("visible");
    processingComplete.classList.remove("visible");
    const steps = processingCard.querySelectorAll(".processing-step");
    steps.forEach((s) => s.classList.remove("active", "done"));

    let i = 0;
    function next() {
      if (i > 0) steps[i - 1].classList.remove("active");
      if (i > 0) steps[i - 1].classList.add("done");
      if (i >= steps.length) {
        processingComplete.classList.add("visible");
        setTimeout(onComplete, 450);
        return;
      }
      steps[i].classList.add("active");
      i++;
      setTimeout(next, 320 + Math.random() * 180);
    }
    next();
  }

  analyzeBtn.addEventListener("click", () => {
    if (!pendingDataset) return;
    runProcessingSequence(() => {
      DataFixAPI.saveDataset(pendingDataset);
      window.location.href = "dashboard.html";
    });
  });
})();
