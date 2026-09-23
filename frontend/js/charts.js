/**
 * charts.js
 * -----------------------------------------------------------------------
 * Thin wrapper around Chart.js (CDN, loaded in dashboard.html) for every
 * chart in the Insights view: missing-values bar chart, a distribution
 * histogram, a doughnut breakdown of column types, category frequency,
 * a correlation heatmap (rendered as a bubble grid), and a row-order
 * trend line. All charts animate in on first render (Chart.js default
 * animation) and are destroyed/recreated by canvas id so switching the
 * selected column never leaks chart instances.
 * -----------------------------------------------------------------------
 */

const Charts = (() => {
  const instances = {};

  const palette = {
    blue: "#3b82f6",
    blueSoft: "rgba(59, 130, 246, 0.22)",
    cyan: "#22d3ee",
    cyanSoft: "rgba(34, 211, 238, 0.22)",
    teal: "#2dd4bf",
    tealSoft: "rgba(45, 212, 191, 0.22)",
    amber: "#fbbf24",
    amberSoft: "rgba(251, 191, 36, 0.2)",
    danger: "#fb7185",
    dangerSoft: "rgba(251, 113, 133, 0.2)",
    grid: "rgba(255,255,255,0.05)",
    text: "#93a2ba",
  };

  const donutPalette = [palette.blue, palette.cyan, palette.teal, palette.amber, palette.danger];

  function destroy(canvasId) {
    if (instances[canvasId]) {
      instances[canvasId].destroy();
      delete instances[canvasId];
    }
  }

  function baseOptions(extra = {}) {
    return Object.assign(
      {
        responsive: true,
        maintainAspectRatio: false,
        animation: { duration: 900, easing: "easeOutCubic" },
        plugins: {
          legend: { display: false, labels: { color: palette.text } },
          tooltip: {
            backgroundColor: "#0f1728",
            borderColor: "rgba(255,255,255,0.08)",
            borderWidth: 1,
            titleColor: "#eef4fb",
            bodyColor: "#93a2ba",
            padding: 10,
            cornerRadius: 8,
          },
        },
        scales: {
          x: { ticks: { color: palette.text, font: { size: 11 } }, grid: { color: palette.grid, display: false } },
          y: { ticks: { color: palette.text, font: { size: 11 } }, grid: { color: palette.grid } },
        },
      },
      extra
    );
  }

  /** Bar chart of missing-value counts per column. */
  function renderMissingValues(canvasId, columnAnalysis, columns) {
    destroy(canvasId);
    const ctx = document.getElementById(canvasId);
    if (!ctx) return;
    const withMissing = columns
      .map((c) => ({ name: c, count: columnAnalysis[c].missingCount }))
      .filter((c) => c.count > 0)
      .sort((a, b) => b.count - a.count)
      .slice(0, 10);

    if (withMissing.length === 0) return;

    instances[canvasId] = new Chart(ctx, {
      type: "bar",
      data: {
        labels: withMissing.map((c) => c.name),
        datasets: [
          {
            label: "Missing",
            data: withMissing.map((c) => c.count),
            backgroundColor: palette.amberSoft,
            borderColor: palette.amber,
            borderWidth: 1.5,
            borderRadius: 5,
          },
        ],
      },
      options: baseOptions({
        indexAxis: "y",
        scales: {
          x: { ticks: { color: palette.text }, grid: { color: palette.grid } },
          y: { ticks: { color: palette.text, font: { size: 11 } }, grid: { display: false } },
        },
      }),
    });
  }

  /** Histogram of numeric values, bucketed into N bins. */
  function renderDistribution(canvasId, values, binCount = 10) {
    destroy(canvasId);
    const ctx = document.getElementById(canvasId);
    if (!ctx || values.length === 0) return;

    const min = Math.min(...values);
    const max = Math.max(...values);
    const range = max - min || 1;
    const binSize = range / binCount;
    const bins = new Array(binCount).fill(0);

    values.forEach((v) => {
      let idx = Math.floor((v - min) / binSize);
      if (idx >= binCount) idx = binCount - 1;
      if (idx < 0) idx = 0;
      bins[idx]++;
    });

    const labels = bins.map((_, i) => {
      const lo = min + i * binSize;
      const hi = lo + binSize;
      return `${lo.toFixed(1)}–${hi.toFixed(1)}`;
    });

    instances[canvasId] = new Chart(ctx, {
      type: "bar",
      data: {
        labels,
        datasets: [
          {
            label: "Count",
            data: bins,
            backgroundColor: palette.cyanSoft,
            borderColor: palette.cyan,
            borderWidth: 1.5,
            borderRadius: 4,
          },
        ],
      },
      options: baseOptions(),
    });
  }

  /** Doughnut breakdown of column types (number / string / date / boolean). */
  function renderTypeDoughnut(canvasId, analysis) {
    destroy(canvasId);
    const ctx = document.getElementById(canvasId);
    if (!ctx) return;

    const counts = { number: 0, string: 0, date: 0, boolean: 0 };
    Object.values(analysis.columnAnalysis).forEach((info) => {
      counts[info.type] = (counts[info.type] || 0) + 1;
    });
    const entries = Object.entries(counts).filter(([, v]) => v > 0);

    instances[canvasId] = new Chart(ctx, {
      type: "doughnut",
      data: {
        labels: entries.map(([k]) => k[0].toUpperCase() + k.slice(1)),
        datasets: [
          {
            data: entries.map(([, v]) => v),
            backgroundColor: donutPalette,
            borderColor: "#070b15",
            borderWidth: 2,
            hoverOffset: 6,
          },
        ],
      },
      options: baseOptions({
        cutout: "68%",
        plugins: {
          legend: { display: true, position: "bottom", labels: { color: palette.text, boxWidth: 10, font: { size: 11.5 }, padding: 14 } },
          tooltip: baseOptions().plugins.tooltip,
        },
        scales: {},
      }),
    });
  }

  /** Bar chart of category -> frequency pairs. */
  function renderCategoryFrequency(canvasId, freqPairs) {
    destroy(canvasId);
    const ctx = document.getElementById(canvasId);
    if (!ctx || freqPairs.length === 0) return;

    instances[canvasId] = new Chart(ctx, {
      type: "bar",
      data: {
        labels: freqPairs.map((p) => p[0]),
        datasets: [
          {
            label: "Count",
            data: freqPairs.map((p) => p[1]),
            backgroundColor: palette.blueSoft,
            borderColor: palette.blue,
            borderWidth: 1.5,
            borderRadius: 4,
          },
        ],
      },
      options: baseOptions({
        indexAxis: "y",
        scales: {
          x: { ticks: { color: palette.text }, grid: { color: palette.grid } },
          y: { ticks: { color: palette.text, font: { size: 11 } }, grid: { display: false } },
        },
      }),
    });
  }

  /**
   * Correlation "heatmap" rendered as a bubble chart on a grid: each cell
   * is a bubble whose radius/opacity reflects |r|, and color encodes sign.
   */
  function renderCorrelation(canvasId, columns, matrix) {
    destroy(canvasId);
    const ctx = document.getElementById(canvasId);
    if (!ctx || columns.length === 0) return;

    const points = [];
    matrix.forEach((row, yi) => {
      row.forEach((r, xi) => {
        points.push({ x: xi, y: yi, v: r, r: 6 + Math.abs(r) * 16 });
      });
    });

    instances[canvasId] = new Chart(ctx, {
      type: "bubble",
      data: {
        datasets: [
          {
            data: points,
            backgroundColor: points.map((p) =>
              p.v >= 0 ? `rgba(45, 212, 191, ${0.25 + Math.abs(p.v) * 0.6})` : `rgba(251, 113, 133, ${0.25 + Math.abs(p.v) * 0.6})`
            ),
            borderWidth: 0,
          },
        ],
      },
      options: baseOptions({
        plugins: {
          legend: { display: false },
          tooltip: {
            backgroundColor: "#0f1728",
            borderColor: "rgba(255,255,255,0.08)",
            borderWidth: 1,
            titleColor: "#eef4fb",
            bodyColor: "#93a2ba",
            callbacks: {
              label: (item) => {
                const p = item.raw;
                return `${columns[p.y]} × ${columns[p.x]}: r = ${p.v.toFixed(2)}`;
              },
            },
          },
        },
        scales: {
          x: {
            min: -0.5,
            max: columns.length - 0.5,
            ticks: { stepSize: 1, color: palette.text, callback: (val) => columns[val] || "", font: { size: 10 }, maxRotation: 40, minRotation: 40 },
            grid: { color: palette.grid },
          },
          y: {
            min: -0.5,
            max: columns.length - 0.5,
            ticks: { stepSize: 1, color: palette.text, callback: (val) => columns[val] || "", font: { size: 10 } },
            grid: { color: palette.grid },
          },
        },
      }),
    });
  }

  /** Simple trend line across row order for a numeric column. */
  function renderTrend(canvasId, labels, values) {
    destroy(canvasId);
    const ctx = document.getElementById(canvasId);
    if (!ctx || values.length === 0) return;

    instances[canvasId] = new Chart(ctx, {
      type: "line",
      data: {
        labels,
        datasets: [
          {
            label: "Value",
            data: values,
            borderColor: palette.teal,
            backgroundColor: palette.tealSoft,
            fill: true,
            pointRadius: 0,
            borderWidth: 2,
            tension: 0.3,
          },
        ],
      },
      options: baseOptions(),
    });
  }

  /**
   * Forecast chart: historical series (solid teal) followed by a forecast
   * mean (dashed amber) with a shaded confidence band (upper/lower).
   */
  function renderForecast(canvasId, historical, forecastPoints) {
    destroy(canvasId);
    const ctx = document.getElementById(canvasId);
    if (!ctx || historical.length === 0) return;

    const histLabels = historical.map((_, i) => `t-${historical.length - i}`);
    const fLabels = forecastPoints.map((p) => `+${p.x}`);
    const labels = [...histLabels, ...fLabels];

    const nullPad = new Array(historical.length - 1).fill(null);
    const historicalData = [...historical, ...new Array(forecastPoints.length).fill(null)];
    const forecastData = [...nullPad, historical[historical.length - 1], ...forecastPoints.map((p) => p.value)];
    const upperData = [...nullPad, historical[historical.length - 1], ...forecastPoints.map((p) => p.upper)];
    const lowerData = [...nullPad, historical[historical.length - 1], ...forecastPoints.map((p) => p.lower)];

    instances[canvasId] = new Chart(ctx, {
      type: "line",
      data: {
        labels,
        datasets: [
          {
            label: "Upper bound",
            data: upperData,
            borderColor: "transparent",
            backgroundColor: "rgba(251, 191, 36, 0.12)",
            pointRadius: 0,
            fill: "+1",
            tension: 0.25,
          },
          {
            label: "Lower bound",
            data: lowerData,
            borderColor: "transparent",
            backgroundColor: "transparent",
            pointRadius: 0,
            fill: false,
            tension: 0.25,
          },
          {
            label: "Forecast",
            data: forecastData,
            borderColor: palette.amber,
            backgroundColor: "transparent",
            borderDash: [5, 4],
            pointRadius: 0,
            borderWidth: 2,
            tension: 0.25,
          },
          {
            label: "Historical",
            data: historicalData,
            borderColor: palette.teal,
            backgroundColor: palette.tealSoft,
            fill: false,
            pointRadius: 0,
            borderWidth: 2,
            tension: 0.25,
          },
        ],
      },
      options: baseOptions({
        plugins: {
          legend: { display: true, position: "bottom", labels: { color: palette.text, boxWidth: 10, font: { size: 11 }, filter: (item) => item.text === "Forecast" || item.text === "Historical" } },
          tooltip: baseOptions().plugins.tooltip,
        },
      }),
    });
  }

  return {
    renderMissingValues,
    renderDistribution,
    renderTypeDoughnut,
    renderCategoryFrequency,
    renderCorrelation,
    renderTrend,
    renderForecast,
    destroy,
  };
})();
