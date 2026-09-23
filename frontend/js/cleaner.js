/**
 * cleaner.js
 * -----------------------------------------------------------------------
 * Simulated data-cleaning operations. Each function accepts the current
 * dataset ({columns, rows}) plus its Analyzer output, applies one cleaning
 * action, and returns:
 *
 *   { dataset: <new dataset>, before: <number>, after: <number>, detail: <string> }
 *
 * Operations never mutate the input dataset in place — they return a new
 * one — so the app can keep an undo-friendly history. Written as isolated,
 * synchronous, side-effect-free functions so the same logic could later be
 * moved server-side (e.g. a FastAPI /clean endpoint) with minimal changes.
 * -----------------------------------------------------------------------
 */

const Cleaner = (() => {
  function cloneDataset(dataset) {
    return {
      columns: [...dataset.columns],
      rows: dataset.rows.map((r) => ({ ...r })),
    };
  }

  /** Remove exact duplicate rows (keeps the first occurrence). */
  function removeDuplicates(dataset, analysis) {
    const before = analysis.duplicateCount;
    const seen = new Set();
    const newRows = [];
    dataset.rows.forEach((row) => {
      const sig = dataset.columns.map((c) => String(row[c]).trim().toLowerCase()).join("␟");
      if (!seen.has(sig)) {
        seen.add(sig);
        newRows.push({ ...row });
      }
    });
    return {
      dataset: { columns: [...dataset.columns], rows: newRows },
      before,
      after: 0,
      detail: `Removed ${before} duplicate row${before === 1 ? "" : "s"}.`,
    };
  }

  /**
   * Fill missing values in a column using a strategy.
   * @param {"mean"|"median"|"mode"|"zero"|"custom"} strategy
   * @param {string} customValue used when strategy === "custom"
   */
  function fillMissing(dataset, analysis, column, strategy, customValue) {
    const info = analysis.columnAnalysis[column];
    const before = info.missingCount;
    let fillValue;

    if (strategy === "mean" && info.type === "number") {
      fillValue = info.stats.mean.toFixed(2);
    } else if (strategy === "median" && info.type === "number") {
      fillValue = String(info.stats.median);
    } else if (strategy === "mode") {
      const freq = new Map();
      dataset.rows.forEach((r) => {
        if (!Analyzer.isMissing(r[column])) {
          const v = String(r[column]);
          freq.set(v, (freq.get(v) || 0) + 1);
        }
      });
      let best = "";
      let bestCount = -1;
      freq.forEach((count, val) => {
        if (count > bestCount) {
          bestCount = count;
          best = val;
        }
      });
      fillValue = best;
    } else if (strategy === "zero") {
      fillValue = "0";
    } else {
      fillValue = customValue !== undefined ? customValue : "";
    }

    const newRows = dataset.rows.map((r) => {
      if (Analyzer.isMissing(r[column])) {
        return { ...r, [column]: fillValue };
      }
      return { ...r };
    });

    return {
      dataset: { columns: [...dataset.columns], rows: newRows },
      before,
      after: 0,
      detail: `Filled ${before} missing value${before === 1 ? "" : "s"} in "${column}" with ${
        strategy === "custom" ? `"${fillValue}"` : strategy
      }.`,
    };
  }

  /** Remove every row that has at least one missing value. */
  function removeRowsWithMissing(dataset, analysis) {
    let before = 0;
    const newRows = [];
    dataset.rows.forEach((row) => {
      const hasMissing = dataset.columns.some((c) => Analyzer.isMissing(row[c]));
      if (hasMissing) {
        before++;
      } else {
        newRows.push({ ...row });
      }
    });
    return {
      dataset: { columns: [...dataset.columns], rows: newRows },
      before,
      after: 0,
      detail: `Removed ${before} row${before === 1 ? "" : "s"} containing missing values.`,
    };
  }

  /** Find & replace a value across one column (or all columns). */
  function replaceValues(dataset, column, findValue, replaceValue) {
    let count = 0;
    const targetCols = column === "__all__" ? dataset.columns : [column];
    const newRows = dataset.rows.map((row) => {
      const newRow = { ...row };
      targetCols.forEach((c) => {
        if (String(newRow[c]).trim() === String(findValue).trim()) {
          newRow[c] = replaceValue;
          count++;
        }
      });
      return newRow;
    });
    return {
      dataset: { columns: [...dataset.columns], rows: newRows },
      before: count,
      after: 0,
      detail: `Replaced ${count} occurrence${count === 1 ? "" : "s"} of "${findValue}" with "${replaceValue}".`,
    };
  }

  /**
   * Standardize inconsistent category spellings in a column: every value
   * that normalizes to the same key (lowercase, punctuation/space-stripped)
   * is rewritten to the most frequent original variant.
   */
  function standardizeCategories(dataset, analysis, column) {
    const groups = new Map(); // normKey -> Map(variant -> count)
    dataset.rows.forEach((row) => {
      const v = row[column];
      if (Analyzer.isMissing(v)) return;
      const original = String(v).trim();
      const norm = original.toLowerCase().replace(/[.\s]+/g, "");
      if (!groups.has(norm)) groups.set(norm, new Map());
      const variants = groups.get(norm);
      variants.set(original, (variants.get(original) || 0) + 1);
    });

    const canonical = new Map(); // norm -> canonical original string
    let changed = 0;
    groups.forEach((variants, norm) => {
      let best = "";
      let bestCount = -1;
      variants.forEach((count, val) => {
        if (count > bestCount) {
          bestCount = count;
          best = val;
        }
      });
      canonical.set(norm, best);
    });

    const newRows = dataset.rows.map((row) => {
      const v = row[column];
      if (Analyzer.isMissing(v)) return { ...row };
      const original = String(v).trim();
      const norm = original.toLowerCase().replace(/[.\s]+/g, "");
      const target = canonical.get(norm);
      if (target !== original) {
        changed++;
        return { ...row, [column]: target };
      }
      return { ...row };
    });

    const before = analysis.columnAnalysis[column].inconsistentVariants || 0;

    return {
      dataset: { columns: [...dataset.columns], rows: newRows },
      before,
      after: 0,
      detail: `Standardized ${changed} value${changed === 1 ? "" : "s"} in "${column}" to a consistent spelling.`,
    };
  }

  /** Coerce every value in a column toward a target type (best-effort). */
  function convertType(dataset, analysis, column, targetType) {
    let converted = 0;
    let failed = 0;
    const newRows = dataset.rows.map((row) => {
      const v = row[column];
      if (Analyzer.isMissing(v)) return { ...row };
      let newVal = v;
      if (targetType === "number") {
        const n = Analyzer.toNumber(v);
        if (!isNaN(n)) {
          newVal = String(n);
          converted++;
        } else {
          failed++;
        }
      } else if (targetType === "string") {
        newVal = String(v).trim();
        converted++;
      } else if (targetType === "boolean") {
        const s = String(v).trim().toLowerCase();
        if (["true", "yes", "y", "1"].includes(s)) {
          newVal = "true";
          converted++;
        } else if (["false", "no", "n", "0"].includes(s)) {
          newVal = "false";
          converted++;
        } else {
          failed++;
        }
      } else if (targetType === "date") {
        const parsed = new Date(v);
        if (!isNaN(parsed.getTime())) {
          newVal = parsed.toISOString().slice(0, 10);
          converted++;
        } else {
          failed++;
        }
      }
      return { ...row, [column]: newVal };
    });

    return {
      dataset: { columns: [...dataset.columns], rows: newRows },
      before: converted + failed,
      after: failed,
      detail: `Converted ${converted} value${converted === 1 ? "" : "s"} in "${column}" to ${targetType}${
        failed ? ` (${failed} could not be converted)` : ""
      }.`,
    };
  }

  /** Remove rows flagged as IQR outliers for a specific numeric column. */
  function removeOutliers(dataset, analysis, column) {
    const info = analysis.columnAnalysis[column];
    const before = info.outlierRowIndexes ? info.outlierRowIndexes.size : 0;
    const outlierSet = info.outlierRowIndexes || new Set();
    const newRows = dataset.rows.filter((_, idx) => !outlierSet.has(idx));
    return {
      dataset: { columns: [...dataset.columns], rows: newRows },
      before,
      after: 0,
      detail: `Removed ${before} outlier row${before === 1 ? "" : "s"} from "${column}".`,
    };
  }

  return {
    cloneDataset,
    removeDuplicates,
    fillMissing,
    removeRowsWithMissing,
    replaceValues,
    standardizeCategories,
    convertType,
    removeOutliers,
  };
})();
