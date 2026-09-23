# DataFix AI (v2 — Premium Redesign)

A polished, animated AI-SaaS redesign of DataFix AI: HTML5, CSS3, vanilla
JavaScript, [Chart.js](https://www.chartjs.org/) for data visualizations,
[GSAP](https://gsap.com/) + ScrollTrigger for advanced motion (with a CSS/
IntersectionObserver fallback if the CDN doesn't load), and
[Font Awesome](https://fontawesome.com/) for icons — all via CDN, no build
step, no framework.

## Running it

Open `index.html` directly, or serve the folder:

```bash
npx serve .
# or
python3 -m http.server 8000
```

## What's new in this pass

- **Visual direction** — deep dark background, blue → cyan → teal accent
  gradient, glassmorphism cards (`backdrop-filter: blur`), soft glow
  borders/shadows, larger display type (Space Grotesk + Inter + JetBrains
  Mono for data).
- **Loading screen** on first load (`#loadingScreen`), dismissed
  automatically once the page is ready.
- **Animated hero** — word-by-word headline reveal, delayed fade-up
  subtitle/buttons, a canvas-based floating particle/node background
  (`#heroCanvas`), and an animated dashboard preview with counting numbers
  and a score ring that draws in on scroll.
- **Scroll reveals** everywhere a major section enters the viewport
  (`data-reveal` / `data-reveal-scale` / `data-reveal-group` attributes),
  staggered for card grids — driven by `js/animations.js`.
- **Sticky navbar** that goes from transparent to a blurred glass bar with
  a border/shadow on scroll, animated underline link hovers, and a
  glowing logo on hover.
- **Magnetic buttons** on primary/secondary CTAs, plus a ripple on click.
- **Feature cards** with lift-on-hover, icon rotation, a cursor-following
  radial glow, and brighter borders.
- **Custom cursor** (dot + trailing ring) on desktop only — automatically
  disabled on touch devices, narrow viewports, and
  `prefers-reduced-motion`.
- **Upload flow** — glowing/scaling drop zone, animated progress bar with
  a success checkmark, and a sequential "Analyzing Dataset" checklist
  (reading → detecting types → missing values → duplicates → outliers →
  statistics → Analysis Complete) before handing off to the dashboard.
- **Dashboard** — animated counters on every stat card and the health
  score ring, a dynamic health-score badge/label, six animated Chart.js
  charts in Insights (missing values, column-type doughnut, distribution
  histogram, category frequency, correlation heatmap, trend line), and a
  draggable **Before/After comparison slider** in the Cleaning Center.
- **AI Assistant** — an "AI Assistant Online" status indicator and a real
  typewriter effect for responses (tags are written atomically so HTML
  formatting never breaks mid-type).
- **Report Generator** — a short "Generating Report…" step animation
  before the file downloads.
- **Reduced motion & mobile** — `prefers-reduced-motion` strips nearly all
  motion; screens under ~860px drop the particle canvas and custom cursor
  entirely for performance (`body.no-fancy`, see `css/responsive.css`).

## Project structure

```text
datafix-ai/
│
├── index.html
├── upload.html
├── dashboard.html
│
├── css/
│   ├── style.css         Core design system + every component
│   ├── animations.css    Keyframes, reveal states, reduced-motion overrides
│   └── responsive.css    Breakpoints + mobile performance simplifications
│
├── js/
│   ├── app.js             Storage bridge, UI helpers, demo data, upload flow
│   ├── analyzer.js        Column type inference, stats, quality scoring
│   ├── cleaner.js         Cleaning operations
│   ├── charts.js          Chart.js wrappers (bar/doughnut/bubble/line)
│   ├── animations.js      Loading screen, reveals, cursor, magnetic buttons,
│   │                      counters, particle canvas — "Motion" module
│   ├── csv-parser.js      CSV parsing / serialization
│   └── dashboard.js       Dashboard state + every view's rendering logic
│
├── assets/
│   └── logo.svg
│
└── README.md
```

## Prediction Studio (new)

A genuine, client-side ML workspace added on top of the existing dashboard — nothing here is faked:

- **Real algorithms** (`js/ml.js`): logistic regression (gradient descent, one-vs-rest for multiclass), linear regression, a CART decision tree (classifier + regressor), k-nearest-neighbors, k-means, and a trend-based forecaster with a residual-based confidence band.
- **Real workflow** (`js/prediction.js`): target auto-suggestion → prediction-type detection → model selection → adjustable train/test split → training (on the *same* dataset loaded elsewhere in the app) → real accuracy/precision/recall/F1/confusion matrix (classification) or MAE/MSE/RMSE/R² (regression) computed on a held-out test set → a dynamically generated prediction form → feature-importance explainability → dataset-grounded AI insights → text export.
- **Forecasting**: pick a date + numeric column and a horizon; get a real linear-trend forecast with an 80% confidence band, rendered as a chart with historical vs. forecast series.
- **Honesty built in**: every metric is computed from your actual data on an actual held-out split. Small datasets, weak features, or class imbalance show up as genuinely weak metrics — the UI surfaces that rather than hiding it, and every result carries the "estimates, not guarantees" disclaimer.

### What's next (not yet built)

The full platform vision (SQL Studio, ETL pipelines, data warehouse/lineage, MLOps, model deployment, clustering/anomaly-detection UI, NLP workspace, collaboration, etc.) is a much larger scope than one pass can deliver honestly. Anything requiring a real database, cloud storage, GPU, or deployed API is intentionally **not** faked — it needs a backend integration point before it can be built as more than a UI mockup. Prediction Studio was prioritized first because it was fully buildable client-side and was the most detailed, duplicated spec across both requests.

## Notes on the CDN libraries

- **GSAP + ScrollTrigger** are loaded but the site does not *require* them:
  every scroll reveal is implemented with CSS transitions driven by an
  `IntersectionObserver`, so the page still animates correctly if the CDN
  is blocked. Where GSAP is present, `animations.js` uses it for the
  magnetic-button easing (`elastic.out`) — a nice-to-have, not a
  dependency.
- **Chart.js** is required for the Insights view's six charts (dashboard
  page only).
- **Font Awesome** provides every icon; swap the CDN `<link>` for a
  self-hosted copy if you need to work offline.

## Connecting a real backend later

Same contract as before: `analyzer.js` and `cleaner.js` are pure functions
of `{columns, rows}` that could be mirrored server-side; `DataFixAPI` in
`app.js` is the single seam to swap `localStorage` for real API calls; and
`generateAIResponse(query, analysis)` in `dashboard.js` is a drop-in point
for a real LLM call.
