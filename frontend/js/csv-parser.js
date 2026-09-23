/**
 * csv-parser.js
 * -----------------------------------------------------------------------
 * Pure parsing utilities. Turns raw CSV text (or an array-of-arrays, for
 * future XLSX support via SheetJS) into a normalized dataset object:
 *
 *   {
 *     columns: ["Name", "Age", ...],
 *     rows: [ { Name: "Ana", Age: "34" }, ... ],   // string values, as read
 *   }
 *
 * Kept dependency-free so it can run in-browser without a build step, and
 * structured so a future backend (FastAPI) could expose an equivalent
 * `/parse` endpoint returning the same shape.
 * -----------------------------------------------------------------------
 */

const CSVParser = (() => {
  /**
   * Split a single CSV line into fields, respecting double-quoted values
   * (including escaped "" quotes and embedded commas/newlines are handled
   * upstream by parseCSV's line-joiner).
   */
  function splitCSVLine(line) {
    const fields = [];
    let current = "";
    let inQuotes = false;

    for (let i = 0; i < line.length; i++) {
      const char = line[i];

      if (inQuotes) {
        if (char === '"') {
          if (line[i + 1] === '"') {
            current += '"';
            i++;
          } else {
            inQuotes = false;
          }
        } else {
          current += char;
        }
      } else if (char === '"') {
        inQuotes = true;
      } else if (char === ",") {
        fields.push(current);
        current = "";
      } else {
        current += char;
      }
    }
    fields.push(current);
    return fields;
  }

  /**
   * Re-join raw lines so that newlines embedded inside quoted fields don't
   * break row boundaries. Returns an array of "logical" CSV lines.
   */
  function toLogicalLines(text) {
    const rawLines = text.split(/\r\n|\n|\r/);
    const logical = [];
    let buffer = "";
    let quoteCount = 0;

    for (const line of rawLines) {
      buffer = buffer.length ? buffer + "\n" + line : line;
      quoteCount = (buffer.match(/"/g) || []).length;
      if (quoteCount % 2 === 0) {
        logical.push(buffer);
        buffer = "";
      }
    }
    if (buffer.length) logical.push(buffer);
    return logical;
  }

  /**
   * Detect the delimiter by comparing counts of common delimiters in the
   * header line. Defaults to comma.
   */
  function detectDelimiter(headerLine) {
    const candidates = [",", ";", "\t", "|"];
    let best = ",";
    let bestCount = -1;
    candidates.forEach((d) => {
      const count = headerLine.split(d).length;
      if (count > bestCount) {
        bestCount = count;
        best = d;
      }
    });
    return best;
  }

  /**
   * Parse raw CSV text into { columns, rows }.
   * @param {string} text
   * @returns {{columns: string[], rows: Object[]}}
   */
  function parseCSV(text) {
    if (!text || !text.trim()) {
      throw new Error("The file appears to be empty.");
    }

    const lines = toLogicalLines(text).filter((l) => l.trim().length > 0);
    if (lines.length < 2) {
      throw new Error("Couldn't find a header row and at least one data row.");
    }

    const delimiter = detectDelimiter(lines[0]);
    const splitLine = (line) =>
      delimiter === ","
        ? splitCSVLine(line)
        : line.split(delimiter).map((f) => f.replace(/^"|"$/g, ""));

    const headerFields = splitLine(lines[0]).map((h) => h.trim());
    const columns = headerFields.map((h, i) => h || `Column ${i + 1}`);

    const rows = [];
    for (let i = 1; i < lines.length; i++) {
      const fields = splitLine(lines[i]);
      // Skip fully blank trailing lines
      if (fields.length === 1 && fields[0].trim() === "") continue;

      const row = {};
      columns.forEach((col, idx) => {
        const raw = fields[idx];
        row[col] = raw === undefined ? "" : raw.trim();
      });
      rows.push(row);
    }

    return { columns, rows };
  }

  /**
   * Build a normalized dataset object with metadata used across the app.
   * @param {string} text raw file text
   * @param {string} fileName
   * @param {number} fileSize bytes
   */
  function buildDataset(text, fileName, fileSize) {
    const { columns, rows } = parseCSV(text);
    return {
      fileName: fileName || "dataset.csv",
      fileSize: fileSize || new Blob([text]).size,
      importedAt: new Date().toISOString(),
      columns,
      rows,
    };
  }

  /** Human-readable file size, e.g. "482 KB" */
  function formatFileSize(bytes) {
    if (bytes < 1024) return `${bytes} B`;
    if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
    return `${(bytes / (1024 * 1024)).toFixed(2)} MB`;
  }

  /**
   * Serialize a dataset ({columns, rows}) back into CSV text for export.
   */
  function toCSV(columns, rows) {
    const escape = (val) => {
      const str = val === null || val === undefined ? "" : String(val);
      if (/[",\n]/.test(str)) {
        return `"${str.replace(/"/g, '""')}"`;
      }
      return str;
    };
    const lines = [columns.map(escape).join(",")];
    rows.forEach((row) => {
      lines.push(columns.map((c) => escape(row[c])).join(","));
    });
    return lines.join("\n");
  }

  return { parseCSV, buildDataset, formatFileSize, toCSV };
})();
