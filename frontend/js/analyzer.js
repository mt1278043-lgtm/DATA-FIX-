/**
 * analyzer.js
 * -----------------------------------------------------------------------
 * Turns a raw { columns, rows } dataset into a rich analysis object:
 * column type inference, missing-value counts, duplicate rows, outliers
 * (IQR method), descriptive statistics, category frequencies, a simple
 * correlation matrix for numeric columns, and an overall data-quality
 * score.
 *
 * Every function here is a pure function of its inputs so the same logic
 * could later be mirrored in a Python/FastAPI backend without rewriting
 * the app's control flow.
 * -----------------------------------------------------------------------
 */

const Analyzer = (() => {
  const MISSING_TOKENS = new Set(["", "na", "n/a", "null", "none", "nan", "-", "?"]);

  function isMissing(value) {
    if (value === null || value === undefined) return true;
    const s = String(value).trim().toLowerCase();
    return MISSING_TOKENS.has(s);
  }

  const BOOLEAN_TOKENS = new Set(["true", "false", "yes", "no", "y", "n", "0", "1"]);

  function looksBoolean(value) {
    return BOOLEAN_TOKENS.has(String(value).trim().toLowerCase());
  }

  function looksNumber(value) {
    const s = String(value).trim().replace(/,/g, "");
    if (s === "") return false;
    return !isNaN(s) && isFinite(s);
  }

  const DATE_RE =
    /^\d{4}-\d{2}-\d{2}([ T]\d{2}:\d{2}(:\d{2})?)?$|^\d{1,2}\/\d{1,2}\/\d{2,4}$|^\d{1,2}-\d{1,2}-\d{2,4}$/;

  function looksDate(value) {
    const s = String(value).trim();
    if (!DATE_RE.test(s)) return false;
    return !isNaN(Date.parse(s));
  }

  /**
   * Infer a single column's dominant type by sampling non-missing values.
   * Returns one of: "number" | "date" | "boolean" | "string"
   */
  function inferColumnType(values) {
    const present = values.filter((v) => !isMissing(v));
    if (present.length === 0) return "string";

    const sample = present.slice(0, Math.min(present.length, 500));
    const counts = { number: 0, date: 0, boolean: 0, string: 0 };

    sample.forEach((v) => {
      if (looksBoolean(v)) counts.boolean++;
      else if (looksNumber(v)) counts.number++;
      else if (looksDate(v)) counts.date++;
      else counts.string++;
    });

    const total = sample.length;
    const threshold = 0.85;
    if (counts.boolean / total >= threshold) return "boolean";
    if (counts.number / total >= threshold) return "number";
    if (counts.date / total >= threshold) return "date";
    return "string";
  }

  function toNumber(v) {
    return parseFloat(String(v).trim().replace(/,/g, ""));
  }

  /** Quantile via linear interpolation on a sorted numeric array. */
  function quantile(sortedArr, q) {
    if (sortedArr.length === 0) return NaN;
    const pos = (sortedArr.length - 1) * q;
    const base = Math.floor(pos);
    const rest = pos - base;
    if (sortedArr[base + 1] !== undefined) {
      return sortedArr[base] + rest * (sortedArr[base + 1] - sortedArr[base]);
    }
    return sortedArr[base];
  }

  function mean(arr) {
    return arr.reduce((a, b) => a + b, 0) / arr.length;
  }

  function stdDev(arr, avg) {
    if (arr.length < 2) return 0;
    const m = avg !== undefined ? avg : mean(arr);
    const variance = arr.reduce((sum, v) => sum + (v - m) ** 2, 0) / (arr.length - 1);
    return Math.sqrt(variance);
  }

  /**
   * IQR-based outlier detection for a numeric column.
   * Returns { lowerBound, upperBound, q1, q3, outlierRowIndexes: Set }
   */
  function detectOutliersIQR(numericValuesWithIndex) {
    const sorted = [...numericValuesWithIndex].sort((a, b) => a.value - b.value);
    const nums = sorted.map((d) => d.value);
    const q1 = quantile(nums, 0.25);
    const q3 = quantile(nums, 0.75);
    const iqr = q3 - q1;
    const lowerBound = q1 - 1.5 * iqr;
    const upperBound = q3 + 1.5 * iqr;

    const outlierRowIndexes = new Set();
    numericValuesWithIndex.forEach(({ value, rowIndex }) => {
      if (value < lowerBound || value > upperBound) {
        outlierRowIndexes.add(rowIndex);
      }
    });

    return { lowerBound, upperBound, q1, q3, outlierRowIndexes };
  }

  /** Build a stable signature for duplicate-row detection. */
  function rowSignature(row, columns) {
    return columns.map((c) => String(row[c]).trim().toLowerCase()).join("␟");
  }

  function findDuplicateRowIndexes(rows, columns) {
    const seen = new Map();
    const duplicateIndexes = new Set();
    rows.forEach((row, idx) => {
      const sig = rowSignature(row, columns);
      if (seen.has(sig)) {
        duplicateIndexes.add(idx);
        duplicateIndexes.add(seen.get(sig));
      } else {
        seen.set(sig, idx);
      }
    });
    return duplicateIndexes;
  }

  /**
   * Detect inconsistent category spellings within a string column by
   * grouping values whose lowercase/trimmed form collides, but whose
   * original casing/spacing differs (e.g. "USA", "usa", "U.S.A").
   */
  function detectInconsistentCategories(values) {
    const groups = new Map(); // normalized -> Set(original variants)
    values.forEach((v) => {
      if (isMissing(v)) return;
      const norm = String(v).trim().toLowerCase().replace(/[.\s]+/g, "");
      if (!groups.has(norm)) groups.set(norm, new Set());
      groups.get(norm).add(String(v).trim());
    });
    let inconsistentVariants = 0;
    groups.forEach((variants) => {
      if (variants.size > 1) inconsistentVariants += variants.size;
    });
    return inconsistentVariants;
  }

  /**
   * Full dataset analysis. This is the main entry point used by the app.
   * @param {{columns: string[], rows: Object[]}} dataset
   */
  function analyze(dataset) {
    const { columns, rows } = dataset;
    const totalRows = rows.length;
    const totalColumns = columns.length;

    const columnAnalysis = {};
    let totalMissing = 0;
    let numericColumns = [];
    let categoricalColumns = [];
    let dateColumns = [];
    let booleanColumns = [];

    columns.forEach((col) => {
      const rawValues = rows.map((r) => r[col]);
      const type = inferColumnType(rawValues);
      const missingIdx = [];
      rawValues.forEach((v, i) => {
        if (isMissing(v)) missingIdx.push(i);
      });
      const missingCount = missingIdx.length;
      totalMissing += missingCount;

      const info = {
        name: col,
        type,
        missingCount,
        missingIndexes: new Set(missingIdx),
        uniqueCount: new Set(
          rawValues.filter((v) => !isMissing(v)).map((v) => String(v).trim().toLowerCase())
        ).size,
      };

      if (type === "number") {
        const numeric = [];
        rawValues.forEach((v, i) => {
          if (!isMissing(v) && looksNumber(v)) {
            numeric.push({ value: toNumber(v), rowIndex: i });
          }
        });
        const nums = numeric.map((d) => d.value);
        const sorted = [...nums].sort((a, b) => a - b);
        const avg = nums.length ? mean(nums) : 0;
        const outliers = numeric.length ? detectOutliersIQR(numeric) : { outlierRowIndexes: new Set() };

        info.stats = {
          count: nums.length,
          mean: avg,
          median: quantile(sorted, 0.5),
          min: sorted.length ? sorted[0] : 0,
          max: sorted.length ? sorted[sorted.length - 1] : 0,
          stdDev: stdDev(nums, avg),
          q1: quantile(sorted, 0.25),
          q3: quantile(sorted, 0.75),
        };
        info.outlierRowIndexes = outliers.outlierRowIndexes;
        info.bounds = { lower: outliers.lowerBound, upper: outliers.upperBound };
        numericColumns.push(col);
      } else if (type === "date") {
        dateColumns.push(col);
      } else if (type === "boolean") {
        booleanColumns.push(col);
        categoricalColumns.push(col);
      } else {
        categoricalColumns.push(col);
        info.inconsistentVariants = detectInconsistentCategories(rawValues);

        // Category frequency (top 12)
        const freq = new Map();
        rawValues.forEach((v) => {
          if (isMissing(v)) return;
          const key = String(v).trim();
          freq.set(key, (freq.get(key) || 0) + 1);
        });
        info.categoryFrequency = [...freq.entries()]
          .sort((a, b) => b[1] - a[1])
          .slice(0, 12);
      }

      columnAnalysis[col] = info;
    });

    const duplicateRowIndexes = findDuplicateRowIndexes(rows, columns);

    let totalOutliers = 0;
    const outlierRowIndexSet = new Set();
    numericColumns.forEach((col) => {
      columnAnalysis[col].outlierRowIndexes.forEach((idx) => {
        outlierRowIndexSet.add(idx);
      });
      totalOutliers += columnAnalysis[col].outlierRowIndexes.size;
    });

    const inconsistentCategoryColumns = categoricalColumns.filter(
      (c) => columnAnalysis[c].inconsistentVariants > 0
    );

    // "Invalid data types" heuristic: columns where a minority (5-40%) of
    // values don't match the column's inferred type — likely dirty entries.
    const invalidTypeColumns = columns.filter((col) => {
      const info = columnAnalysis[col];
      if (info.type === "string") return false;
      const rawValues = rows.map((r) => r[col]).filter((v) => !isMissing(v));
      if (rawValues.length === 0) return false;
      let mismatches = 0;
      rawValues.forEach((v) => {
        if (info.type === "number" && !looksNumber(v)) mismatches++;
        if (info.type === "date" && !looksDate(v)) mismatches++;
        if (info.type === "boolean" && !looksBoolean(v)) mismatches++;
      });
      const ratio = mismatches / rawValues.length;
      return ratio > 0 && ratio < 0.4;
    });

    const cellCount = totalRows * totalColumns || 1;
    const missingPenalty = Math.min(40, (totalMissing / cellCount) * 100 * 1.4);
    const dupPenalty = Math.min(25, (duplicateRowIndexes.size / (totalRows || 1)) * 100 * 0.9);
    const outlierPenalty = Math.min(15, (totalOutliers / (totalRows || 1)) * 100 * 0.6);
    const categoryPenalty = Math.min(10, inconsistentCategoryColumns.length * 3);
    const typePenalty = Math.min(10, invalidTypeColumns.length * 4);

    const qualityScore = Math.max(
      0,
      Math.round(100 - missingPenalty - dupPenalty - outlierPenalty - categoryPenalty - typePenalty)
    );

    return {
      totalRows,
      totalColumns,
      totalMissing,
      duplicateRowIndexes,
      duplicateCount: duplicateRowIndexes.size,
      totalOutliers,
      outlierRowIndexSet,
      numericColumns,
      categoricalColumns,
      dateColumns,
      booleanColumns,
      inconsistentCategoryColumns,
      invalidTypeColumns,
      columnAnalysis,
      qualityScore,
      scoreBreakdown: {
        missingPenalty: Math.round(missingPenalty),
        dupPenalty: Math.round(dupPenalty),
        outlierPenalty: Math.round(outlierPenalty),
        categoryPenalty: Math.round(categoryPenalty),
        typePenalty: Math.round(typePenalty),
      },
    };
  }

  /**
   * Pearson correlation coefficient between two numeric arrays of equal length
   * (missing/NaN pairs excluded).
   */
  function correlation(a, b) {
    const pairs = [];
    for (let i = 0; i < a.length; i++) {
      if (!isNaN(a[i]) && !isNaN(b[i])) pairs.push([a[i], b[i]]);
    }
    if (pairs.length < 2) return 0;
    const xs = pairs.map((p) => p[0]);
    const ys = pairs.map((p) => p[1]);
    const mx = mean(xs);
    const my = mean(ys);
    let num = 0;
    let dx = 0;
    let dy = 0;
    for (let i = 0; i < pairs.length; i++) {
      num += (xs[i] - mx) * (ys[i] - my);
      dx += (xs[i] - mx) ** 2;
      dy += (ys[i] - my) ** 2;
    }
    const denom = Math.sqrt(dx * dy);
    return denom === 0 ? 0 : num / denom;
  }

  /** Build a correlation matrix for the given numeric columns. */
  function correlationMatrix(dataset, numericColumns) {
    const { rows } = dataset;
    const colValues = {};
    numericColumns.forEach((col) => {
      colValues[col] = rows.map((r) => (isMissing(r[col]) ? NaN : toNumber(r[col])));
    });
    const matrix = [];
    numericColumns.forEach((colA) => {
      const row = [];
      numericColumns.forEach((colB) => {
        row.push(correlation(colValues[colA], colValues[colB]));
      });
      matrix.push(row);
    });
    return matrix;
  }

  return {
    isMissing,
    looksNumber,
    looksDate,
    looksBoolean,
    inferColumnType,
    toNumber,
    analyze,
    correlationMatrix,
    quantile,
    mean,
    stdDev,
  };
})();
