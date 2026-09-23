requireAuth();

const qs = new URLSearchParams(location.search);
const state = {
  projectId: parseInt(qs.get('project'), 10),
  project: null,
  datasets: [],
  datasetId: null,
  profile: null,
  quality: null,
};

const el = (sel) => document.querySelector(sel);
const views = ['overview', 'datasets', 'quality', 'cleaning', 'eda', 'sql', 'features', 'automl', 'activity'];
const titles = {
  overview: ['Overview', 'Real, computed data — nothing on this page is fabricated.'],
  datasets: ['Datasets', 'Upload, preview and manage the datasets in this project.'],
  quality: ['Data Quality Center', 'A transparent, formula-based quality score plus custom rules.'],
  cleaning: ['Cleaning Studio', 'Every operation runs on your actual data and creates a new version.'],
  eda: ['EDA & Visualization', 'Charts generated from real column statistics.'],
  sql: ['SQL Studio', 'Real SQL, executed by DuckDB directly against your dataset.'],
  features: ['Feature Engineering', 'Derived columns computed from your real data, versioned like any other change.'],
  automl: ['AutoML & Prediction Lab', 'Train real scikit-learn models with a genuine train/test split and cross-validation.'],
  activity: ['Activity Log', 'Every action taken in this project, in order.'],
};

function escapeHtml(s) {
  const d = document.createElement('div');
  d.textContent = s == null ? '' : String(s);
  return d.innerHTML;
}
function fmt(n) { return (n === null || n === undefined) ? '—' : (typeof n === 'number' ? Math.round(n * 1000) / 1000 : n); }

async function init() {
  if (!state.projectId) { location.href = 'projects.html'; return; }
  try {
    state.project = await DataFixAPI.getProject(state.projectId);
  } catch (e) { toast(e.message, 'error'); location.href = 'projects.html'; return; }
  el('#projectNameSidebar').textContent = state.project.name;

  document.querySelectorAll('.sidebar-link').forEach(link => {
    link.addEventListener('click', (e) => {
      e.preventDefault();
      switchView(link.dataset.view);
    });
  });
  el('#sidebarOpenBtn').onclick = () => el('#appSidebar').classList.add('open');
  el('#sidebarCloseBtn').onclick = () => el('#appSidebar').classList.remove('open');

  await loadDatasets();
  switchView('overview');
}

async function loadDatasets() {
  state.datasets = await DataFixAPI.listDatasets(state.projectId);
  const sw = el('#datasetSwitcher');
  sw.innerHTML = '<option value="">— select dataset —</option>' + state.datasets.map(d => `<option value="${d.id}">${escapeHtml(d.name)}</option>`).join('');
  if (state.datasets.length) {
    const keep = state.datasetId && state.datasets.some(d => d.id === state.datasetId);
    state.datasetId = keep ? state.datasetId : state.datasets[0].id;
    sw.value = state.datasetId;
    el('#datasetMetaSidebar').textContent = state.datasets.find(d => d.id === state.datasetId)?.name || '—';
  } else {
    state.datasetId = null;
    el('#datasetMetaSidebar').textContent = 'No dataset yet';
  }
  sw.onchange = async () => {
    state.datasetId = parseInt(sw.value, 10) || null;
    el('#datasetMetaSidebar').textContent = state.datasets.find(d => d.id === state.datasetId)?.name || '—';
    await refreshCurrentView();
  };
}

let currentView = 'overview';
async function switchView(view) {
  currentView = view;
  document.querySelectorAll('.sidebar-link').forEach(l => l.classList.toggle('active', l.dataset.view === view));
  document.querySelectorAll('.view').forEach(v => v.classList.toggle('active', v.id === `view-${view}`));
  el('#topbarTitle').textContent = titles[view][0];
  el('#topbarSub').textContent = titles[view][1];
  el('#appSidebar').classList.remove('open');
  await refreshCurrentView();
}
async function refreshCurrentView() {
  const renderers = { overview: renderOverview, datasets: renderDatasets, quality: renderQuality, cleaning: renderCleaning, eda: renderEda, sql: renderSql, features: renderFeatures, automl: renderAutoml, activity: renderActivity };
  await renderers[currentView]();
}

function needsDataset(container) {
  if (!state.datasetId) {
    container.innerHTML = `<div class="empty-state glass"><h3>No dataset selected</h3><p>Upload or pick a dataset from the sidebar (or the Datasets tab) first.</p></div>`;
    return true;
  }
  return false;
}

// ===================== OVERVIEW =====================
async function renderOverview() {
  const c = el('#view-overview');
  c.innerHTML = `<div class="spinner"></div>`;
  const ov = await DataFixAPI.projectOverview(state.projectId);
  let qualityCard = '';
  if (state.datasetId) {
    try {
      state.quality = await DataFixAPI.quality(state.datasetId);
    } catch { state.quality = null; }
  }
  c.innerHTML = `
    <div class="stat-grid">
      <div class="stat-card glass"><div class="stat-label">Datasets</div><div class="stat-value">${ov.n_datasets}</div></div>
      <div class="stat-card glass"><div class="stat-label">Models Trained</div><div class="stat-value">${ov.n_models}</div></div>
      <div class="stat-card glass"><div class="stat-label">Experiments</div><div class="stat-value">${ov.n_experiments}</div></div>
      <div class="stat-card glass"><div class="stat-label">Data Quality (current dataset)</div><div class="stat-value">${state.quality ? fmt(state.quality.overall_score) : '—'}</div></div>
    </div>
    <div class="panel glass">
      <div class="panel-head"><h3>What should I do next?</h3></div>
      ${ov.recommendations.length ? `<div class="issues-grid">${ov.recommendations.map(r => `
        <div class="issue-card glass"><div class="issue-card-head"><span class="issue-title">${escapeHtml(r.message)}</span></div></div>`).join('')}</div>`
      : '<p style="opacity:.7;">Nothing urgent — state looks healthy based on what has run so far.</p>'}
    </div>
    <div class="panel glass">
      <div class="panel-head"><h3>Recent activity</h3></div>
      ${renderActivityTable(ov.recent_activity)}
    </div>`;
}

// ===================== DATASETS =====================
async function renderDatasets() {
  const c = el('#view-datasets');
  c.innerHTML = `
    <div class="panel glass">
      <div class="panel-head"><h3>Upload a dataset</h3></div>
      <p style="opacity:.7;margin-bottom:10px;">Supported formats: CSV, XLSX, JSON, Parquet. Files are validated and profiled with pandas — empty files, bad encodings, corrupt data and duplicate columns are all rejected with a clear reason.</p>
      <input type="file" id="uploadInput" accept=".csv,.xlsx,.xls,.json,.parquet" />
      <div id="uploadStatus" style="margin-top:10px;"></div>
    </div>
    <div class="panel glass">
      <div class="panel-head"><h3>Datasets in this project</h3></div>
      <div id="datasetList"></div>
    </div>
    <div class="panel glass" id="previewPanel" style="display:none;">
      <div class="panel-head"><h3>Preview</h3></div>
      <div id="previewTable"></div>
    </div>`;

  el('#uploadInput').addEventListener('change', async (e) => {
    const file = e.target.files[0];
    if (!file) return;
    el('#uploadStatus').innerHTML = `<div class="spinner"></div> Uploading and profiling "${escapeHtml(file.name)}"…`;
    try {
      const result = await DataFixAPI.uploadDataset(state.projectId, file);
      const msg = `Done — ${result.profile.n_rows} rows × ${result.profile.n_columns} columns. Quality score: ${result.quality.overall_score}/100.`;
      toast(msg);
      await loadDatasets();
      state.datasetId = result.dataset.id;
      el('#datasetSwitcher').value = state.datasetId;
      await renderDatasets();
      el('#uploadStatus').innerHTML = `<span class="badge-live">Done</span> ${escapeHtml(msg)}`;
    } catch (err) {
      el('#uploadStatus').innerHTML = `<p class="upload-error">${escapeHtml(err.message)}</p>`;
    }
  });

  const list = el('#datasetList');
  if (!state.datasets.length) {
    list.innerHTML = '<p style="opacity:.7;">No datasets uploaded yet.</p>';
    return;
  }
  list.innerHTML = state.datasets.map(d => `
    <div class="clean-action-card glass" style="margin-bottom:10px;">
      <div style="display:flex;justify-content:space-between;align-items:center;flex-wrap:wrap;gap:8px;">
        <div>
          <strong>${escapeHtml(d.name)}</strong>
          <div class="mono" style="font-size:12px;opacity:.65;">${d.file_format} · v${d.n_versions} version${d.n_versions===1?'':'s'} · target: ${d.target_column ? escapeHtml(d.target_column) : 'not set'}</div>
        </div>
        <div style="display:flex;gap:8px;">
          <button class="btn btn-sm btn-secondary" data-act="select" data-id="${d.id}">Select</button>
          <button class="btn btn-sm btn-ghost" data-act="preview" data-id="${d.id}">Preview</button>
          <button class="btn btn-sm btn-danger" data-act="delete" data-id="${d.id}">Delete</button>
        </div>
      </div>
    </div>`).join('');

  list.querySelectorAll('button').forEach(btn => {
    btn.onclick = async () => {
      const id = parseInt(btn.dataset.id, 10);
      if (btn.dataset.act === 'select') {
        state.datasetId = id;
        el('#datasetSwitcher').value = id;
        el('#datasetMetaSidebar').textContent = state.datasets.find(d => d.id === id)?.name || '—';
        toast('Dataset selected');
      } else if (btn.dataset.act === 'delete') {
        if (!confirm('Delete this dataset and all its versions?')) return;
        await DataFixAPI.deleteDataset(id);
        await loadDatasets();
        await renderDatasets();
      } else if (btn.dataset.act === 'preview') {
        const prev = await DataFixAPI.preview(id, 25);
        el('#previewPanel').style.display = '';
        el('#previewTable').innerHTML = renderTable(prev.columns, prev.rows) + `<div class="table-foot mono">Showing 25 of ${prev.total_rows} rows</div>`;
      }
    };
  });
}

function renderTable(columns, rows) {
  return `<div class="table-scroll"><table class="data-table"><thead><tr>${columns.map(c => `<th>${escapeHtml(c)}</th>`).join('')}</tr></thead>
    <tbody>${rows.map(r => `<tr>${r.map(v => `<td>${escapeHtml(v)}</td>`).join('')}</tr>`).join('')}</tbody></table></div>`;
}

// ===================== QUALITY =====================
async function renderQuality() {
  const c = el('#view-quality');
  if (needsDataset(c)) return;
  c.innerHTML = `<div class="spinner"></div>`;
  const q = await DataFixAPI.quality(state.datasetId);
  const profile = await DataFixAPI.profile(state.datasetId);
  state.quality = q; state.profile = profile;

  c.innerHTML = `
    <div class="health-panel glass">
      <div class="score-ring-wrap">
        <svg viewBox="0 0 168 168"><circle class="score-ring-bg" cx="84" cy="84" r="74"></circle>
        <circle class="score-ring-fill" style="stroke-dashoffset:${465 - (465 * q.overall_score / 100)}" cx="84" cy="84" r="74"></circle></svg>
        <div class="score-ring-label"><span class="num">${q.overall_score}</span><span class="of">out of 100</span></div>
      </div>
      <div class="health-copy">
        <h3>Data Quality Score</h3>
        <p>Weighted from completeness, uniqueness, consistency and validity — all computed from your current dataset version.</p>
        <div class="health-breakdown">
          ${Object.entries(q.components).map(([k, v]) => `<div class="hb-item"><div class="hb-label">${k}</div><div class="hb-value">${v}</div></div>`).join('')}
        </div>
      </div>
    </div>
    <div class="panel glass">
      <div class="panel-head"><h3>Issues detected (${q.issues.length})</h3></div>
      ${q.issues.length ? `<div class="issues-grid">${q.issues.map(i => `
        <div class="issue-card glass"><div class="issue-card-head"><span class="severity-tag ${i.severity}">${i.severity}</span><span class="issue-title">${escapeHtml(i.message)}</span></div></div>`).join('')}</div>`
      : '<p class="issues-empty">No issues detected.</p>'}
    </div>
    <div class="panel glass">
      <div class="panel-head"><h3>Custom quality rules</h3></div>
      <form id="ruleForm" style="display:flex;gap:8px;flex-wrap:wrap;align-items:flex-end;margin-bottom:14px;">
        <div><label class="mono" style="font-size:12px;">Name</label><input class="search-input" id="ruleName" required /></div>
        <div><label class="mono" style="font-size:12px;">Column</label>
          <select class="select-control" id="ruleColumn"><option value="">(none)</option>${profile.columns.map(col => `<option value="${escapeHtml(col.name)}">${escapeHtml(col.name)}</option>`).join('')}</select>
        </div>
        <div><label class="mono" style="font-size:12px;">Rule type</label>
          <select class="select-control" id="ruleType">
            <option value="not_null">Not null</option>
            <option value="non_negative">Non-negative</option>
            <option value="range">Range (min/max)</option>
            <option value="unique">Unique</option>
            <option value="regex">Regex match</option>
            <option value="allowed_values">Allowed values (comma-separated)</option>
          </select>
        </div>
        <div><label class="mono" style="font-size:12px;">Params (e.g. min=0,max=120 or pattern=... or values=a,b,c)</label><input class="search-input" id="ruleParams" placeholder="min=0,max=120" /></div>
        <button class="btn btn-primary btn-sm" type="submit">Add rule</button>
      </form>
      <div id="rulesList"></div>
    </div>`;

  async function refreshRules() {
    const rules = await DataFixAPI.listRules(state.datasetId);
    el('#rulesList').innerHTML = rules.length ? rules.map(r => `
      <div class="clean-action-card glass" style="margin-bottom:8px;display:flex;justify-content:space-between;align-items:center;">
        <div><strong>${escapeHtml(r.name)}</strong> <span class="mono" style="opacity:.7;">${r.column ? escapeHtml(r.column) + ' · ' : ''}${r.rule_type}</span></div>
        <div>${r.passed ? '<span class="badge-live">Passed</span>' : `<span class="issue-count">${r.violations} violation(s)</span>`}</div>
      </div>`).join('') : '<p style="opacity:.7;">No rules defined yet.</p>';
  }
  await refreshRules();

  el('#ruleForm').addEventListener('submit', async (e) => {
    e.preventDefault();
    const paramsStr = el('#ruleParams').value.trim();
    let params = {};
    if (paramsStr) {
      if (paramsStr.includes('=')) {
        for (const part of paramsStr.split(',')) {
          const [k, v] = part.split('=').map(s => s.trim());
          if (k === 'min' || k === 'max') params[k] = parseFloat(v);
          else if (k === 'pattern') params.pattern = v;
          else if (k === 'values') params.values = v.split('|').map(s => s.trim());
        }
      }
    }
    try {
      await DataFixAPI.createRule(state.datasetId, { name: el('#ruleName').value, column: el('#ruleColumn').value || null, rule_type: el('#ruleType').value, params });
      el('#ruleForm').reset();
      await refreshRules();
    } catch (err) { toast(err.message, 'error'); }
  });
}

// ===================== CLEANING =====================
const CLEAN_OPS = [
  { id: 'remove_duplicates', label: 'Remove duplicate rows', fields: [] },
  { id: 'drop_missing', label: 'Drop rows with missing values', fields: [] },
  { id: 'fill_missing', label: 'Fill missing values', fields: ['column', 'strategy(mean|median|mode|zero|custom)', 'value(if custom)'] },
  { id: 'outlier_treatment', label: 'Treat outliers (IQR)', fields: ['column', 'method(clip|remove)'] },
  { id: 'convert_type', label: 'Convert column type', fields: ['column', 'target_type(numeric|string|datetime|boolean)'] },
  { id: 'rename_column', label: 'Rename column', fields: ['column', 'new_name'] },
  { id: 'drop_columns', label: 'Drop column(s) (comma-separated)', fields: ['columns'] },
  { id: 'encode_categorical', label: 'Encode categorical column', fields: ['column', 'method(onehot|label|frequency)'] },
  { id: 'scale_normalize', label: 'Scale / normalize column', fields: ['column', 'method(minmax|zscore)'] },
  { id: 'clean_strings', label: 'Clean text column', fields: ['column', 'ops(trim,lower,upper,remove_special,collapse_whitespace)'] },
  { id: 'parse_dates', label: 'Parse column as dates', fields: ['column'] },
  { id: 'replace_value', label: 'Find & replace value', fields: ['column', 'find', 'replace'] },
];

async function renderCleaning() {
  const c = el('#view-cleaning');
  if (needsDataset(c)) return;
  c.innerHTML = `
    <div class="panel glass">
      <div class="panel-head"><h3>Apply a transformation</h3></div>
      <div class="clean-grid">
        ${CLEAN_OPS.map(op => `<div class="clean-action-card glass" data-op="${op.id}"><strong>${op.label}</strong></div>`).join('')}
      </div>
      <div id="opForm" style="margin-top:16px;"></div>
    </div>
    <div class="panel glass">
      <div class="panel-head"><h3>Version history</h3></div>
      <div id="historyList"></div>
    </div>
    <div class="panel glass" id="beforeAfterPanel" style="display:none;">
      <div class="panel-head"><h3>Before / after</h3></div>
      <div class="before-after" id="beforeAfterContent"></div>
    </div>`;

  c.querySelectorAll('[data-op]').forEach(card => {
    card.onclick = () => {
      c.querySelectorAll('[data-op]').forEach(x => x.classList.remove('active'));
      card.classList.add('active');
      const op = CLEAN_OPS.find(o => o.id === card.dataset.op);
      el('#opForm').innerHTML = `
        <div class="panel glass" style="padding:16px;">
          <strong>${op.label}</strong>
          <div style="display:flex;gap:8px;flex-wrap:wrap;margin:10px 0;">
            ${op.fields.map(f => `<input class="search-input" placeholder="${f}" data-field="${f.split('(')[0]}" style="min-width:160px;" />`).join('')}
          </div>
          <button class="btn btn-primary btn-sm" id="applyOpBtn">Apply</button>
        </div>`;
      el('#applyOpBtn').onclick = async () => {
        const params = {};
        el('#opForm').querySelectorAll('[data-field]').forEach(inp => {
          if (!inp.value) return;
          const key = inp.dataset.field;
          if (key === 'columns') params.columns = inp.value.split(',').map(s => s.trim());
          else if (key === 'ops') params.ops = inp.value.split(',').map(s => s.trim());
          else params[key] = inp.value;
        });
        try {
          const result = await DataFixAPI.applyCleaning(state.datasetId, op.id, params);
          toast(result.summary.description);
          await renderCleaning();
          el('#beforeAfterPanel').style.display = '';
          el('#beforeAfterContent').innerHTML = `
            <div class="compare-side"><div class="compare-label">Before</div>${renderTable(result.before_sample.columns, result.before_sample.rows)}</div>
            <div class="compare-side"><div class="compare-label">After</div>${renderTable(result.after_sample.columns, result.after_sample.rows)}</div>`;
        } catch (err) { toast(err.message, 'error'); }
      };
    };
  });

  const history = await DataFixAPI.cleaningHistory(state.datasetId);
  el('#historyList').innerHTML = `
    <div class="table-scroll"><table class="data-table"><thead><tr><th>Version</th><th>Operation</th><th>Rows</th><th>Columns</th><th>When</th></tr></thead>
    <tbody>${history.map(v => `<tr><td>v${v.version_number}</td><td>${escapeHtml(v.operation)}</td><td>${v.n_rows}</td><td>${v.n_columns}</td><td class="mono">${new Date(v.created_at).toLocaleString()}</td></tr>`).join('')}</tbody></table></div>
    <button class="btn btn-ghost btn-sm" id="undoBtn" style="margin-top:10px;">Undo last operation</button>`;
  el('#undoBtn').onclick = async () => {
    try { await DataFixAPI.undoCleaning(state.datasetId); toast('Reverted to previous version'); await renderCleaning(); }
    catch (err) { toast(err.message, 'error'); }
  };
}

// ===================== EDA =====================
let chartRefs = {};
function destroyCharts() { Object.values(chartRefs).forEach(ch => ch && ch.destroy()); chartRefs = {}; }

async function renderEda() {
  const c = el('#view-eda');
  if (needsDataset(c)) return;
  destroyCharts();
  const profile = await DataFixAPI.profile(state.datasetId);
  state.profile = profile;
  const numericCols = profile.columns.filter(x => x.inferred_type === 'numeric').map(x => x.name);
  const catCols = profile.columns.filter(x => x.inferred_type === 'categorical').map(x => x.name);
  const dateCols = profile.date_columns;

  c.innerHTML = `
    <div class="chart-grid">
      <div class="chart-card glass">
        <div class="panel-head"><h3>Distribution</h3></div>
        <select class="select-control" id="distCol">${profile.columns.map(x => `<option value="${escapeHtml(x.name)}">${escapeHtml(x.name)}</option>`).join('')}</select>
        <div class="chart-canvas-wrap"><canvas id="distChart"></canvas></div>
      </div>
      <div class="chart-card glass">
        <div class="panel-head"><h3>Missingness by column</h3></div>
        <div class="chart-canvas-wrap"><canvas id="missChart"></canvas></div>
      </div>
      <div class="chart-card glass" style="grid-column:1/-1;">
        <div class="panel-head"><h3>Correlation (numeric columns)</h3></div>
        <div id="corrTable"></div>
      </div>
      ${catCols.length && numericCols.length ? `
      <div class="chart-card glass">
        <div class="panel-head"><h3>Group analysis</h3></div>
        <div style="display:flex;gap:8px;margin-bottom:8px;">
          <select class="select-control" id="groupCol">${catCols.map(x => `<option>${escapeHtml(x)}</option>`).join('')}</select>
          <select class="select-control" id="valueCol">${numericCols.map(x => `<option>${escapeHtml(x)}</option>`).join('')}</select>
        </div>
        <div class="chart-canvas-wrap"><canvas id="groupChart"></canvas></div>
      </div>` : ''}
      ${dateCols.length && numericCols.length ? `
      <div class="chart-card glass">
        <div class="panel-head"><h3>Trend over time</h3></div>
        <div style="display:flex;gap:8px;margin-bottom:8px;">
          <select class="select-control" id="trendDate">${dateCols.map(x => `<option>${escapeHtml(x)}</option>`).join('')}</select>
          <select class="select-control" id="trendValue">${numericCols.map(x => `<option>${escapeHtml(x)}</option>`).join('')}</select>
        </div>
        <div class="chart-canvas-wrap"><canvas id="trendChart"></canvas></div>
      </div>` : ''}
    </div>`;

  async function drawDist() {
    const col = el('#distCol').value;
    const d = await DataFixAPI.distribution(state.datasetId, col);
    const ctx = el('#distChart').getContext('2d');
    if (chartRefs.dist) chartRefs.dist.destroy();
    if (d.type === 'numeric') {
      chartRefs.dist = new Chart(ctx, { type: 'bar', data: { labels: d.bins.map(b => `${b.range[0]}–${b.range[1]}`), datasets: [{ label: col, data: d.bins.map(b => b.count), backgroundColor: '#38bdf8' }] }, options: { plugins: { legend: { display: false } } } });
    } else {
      chartRefs.dist = new Chart(ctx, { type: 'bar', data: { labels: d.categories.map(x => x.value), datasets: [{ label: col, data: d.categories.map(x => x.count), backgroundColor: '#22d3ee' }] }, options: { plugins: { legend: { display: false } } } });
    }
  }
  el('#distCol').onchange = drawDist;
  await drawDist();

  const miss = await DataFixAPI.missingness(state.datasetId);
  chartRefs.miss = new Chart(el('#missChart').getContext('2d'), { type: 'bar', data: { labels: miss.per_column.map(x => x.column), datasets: [{ label: '% missing', data: miss.per_column.map(x => x.missing_pct), backgroundColor: '#f87171' }] }, options: { indexAxis: 'y' } });

  const corr = await DataFixAPI.correlation(state.datasetId);
  if (corr.matrix.length) {
    el('#corrTable').innerHTML = `<div class="table-scroll"><table class="data-table"><thead><tr><th></th>${corr.columns.map(c2 => `<th>${escapeHtml(c2)}</th>`).join('')}</tr></thead>
      <tbody>${corr.columns.map((r, i) => `<tr><th>${escapeHtml(r)}</th>${corr.matrix[i].map(v => `<td>${v === null ? '—' : v.toFixed(2)}</td>`).join('')}</tr>`).join('')}</tbody></table></div>`;
  } else {
    el('#corrTable').innerHTML = `<p style="opacity:.7;">${corr.note || 'Not enough numeric columns.'}</p>`;
  }

  if (el('#groupChart')) {
    async function drawGroup() {
      const g = await DataFixAPI.groupAnalysis(state.datasetId, el('#groupCol').value, el('#valueCol').value);
      if (chartRefs.group) chartRefs.group.destroy();
      chartRefs.group = new Chart(el('#groupChart').getContext('2d'), { type: 'bar', data: { labels: g.data.map(x => x.group), datasets: [{ label: `${g.aggregation}(${g.value_column})`, data: g.data.map(x => x.value), backgroundColor: '#a78bfa' }] }, options: { plugins: { legend: { display: false } } } });
    }
    el('#groupCol').onchange = drawGroup; el('#valueCol').onchange = drawGroup;
    await drawGroup();
  }
  if (el('#trendChart')) {
    async function drawTrend() {
      const t = await DataFixAPI.trend(state.datasetId, el('#trendDate').value, el('#trendValue').value);
      if (chartRefs.trend) chartRefs.trend.destroy();
      chartRefs.trend = new Chart(el('#trendChart').getContext('2d'), { type: 'line', data: { labels: t.points.map(p => p.period), datasets: [{ label: t.value_column, data: t.points.map(p => p.value), borderColor: '#38bdf8', tension: .3 }] } });
    }
    el('#trendDate').onchange = drawTrend; el('#trendValue').onchange = drawTrend;
    await drawTrend();
  }
}

// ===================== SQL =====================
async function renderSql() {
  const c = el('#view-sql');
  if (needsDataset(c)) return;
  const schema = await DataFixAPI.sqlSchema(state.datasetId);
  const saved = await DataFixAPI.savedQueries(state.datasetId);
  c.innerHTML = `
    <div class="panel glass">
      <div class="panel-head"><h3>Schema — table "dataset"</h3></div>
      <div class="table-scroll"><table class="data-table"><thead><tr><th>Column</th><th>Type</th></tr></thead>
      <tbody>${schema.columns.map(col => `<tr><td>${escapeHtml(col.name)}</td><td class="mono">${col.type}</td></tr>`).join('')}</tbody></table></div>
    </div>
    <div class="panel glass">
      <div class="panel-head"><h3>Ask a question (rule-based, no LLM configured)</h3></div>
      <div style="display:flex;gap:8px;">
        <input class="search-input" id="nlQuestion" placeholder="e.g. top 10 by monthly_charges" style="flex:1;" />
        <button class="btn btn-secondary btn-sm" id="nlGenBtn">Generate SQL</button>
      </div>
      <p class="mono" id="nlExplain" style="font-size:12px;opacity:.7;margin-top:8px;"></p>
    </div>
    <div class="panel glass">
      <div class="panel-head"><h3>Query editor</h3></div>
      <textarea id="sqlInput" class="search-input" style="width:100%;min-height:100px;font-family:'JetBrains Mono',monospace;" placeholder="SELECT * FROM dataset LIMIT 10;">SELECT * FROM dataset LIMIT 10;</textarea>
      <div style="display:flex;gap:8px;margin-top:8px;">
        <button class="btn btn-primary btn-sm" id="runSqlBtn">Run query</button>
        <input class="search-input" id="saveAsInput" placeholder="Save as (optional name)" />
      </div>
      <div id="sqlResult" style="margin-top:14px;"></div>
    </div>
    <div class="panel glass">
      <div class="panel-head"><h3>Saved queries</h3></div>
      <div>${saved.length ? saved.map(q => `<div class="clean-action-card glass" style="margin-bottom:8px;cursor:pointer;" data-sql="${escapeHtml(q.sql)}"><strong>${escapeHtml(q.name)}</strong><div class="mono" style="font-size:12px;opacity:.7;">${escapeHtml(q.sql)}</div></div>`).join('') : '<p style="opacity:.7;">None yet.</p>'}</div>
    </div>`;

  c.querySelectorAll('[data-sql]').forEach(card => card.onclick = () => { el('#sqlInput').value = card.dataset.sql; });

  el('#nlGenBtn').onclick = async () => {
    const q = el('#nlQuestion').value.trim();
    if (!q) return;
    const res = await DataFixAPI.generateSql(state.datasetId, q);
    el('#sqlInput').value = res.sql;
    el('#nlExplain').textContent = res.explanation;
  };

  el('#runSqlBtn').onclick = async () => {
    try {
      const res = await DataFixAPI.runSql(state.datasetId, el('#sqlInput').value, el('#saveAsInput').value || undefined);
      el('#sqlResult').innerHTML = renderTable(res.columns, res.rows) + `<div class="table-foot mono">${res.row_count} row(s)${res.truncated ? ' (truncated)' : ''}</div>`;
    } catch (err) { el('#sqlResult').innerHTML = `<p class="upload-error">${escapeHtml(err.message)}</p>`; }
  };
}

// ===================== FEATURES =====================
const FEATURE_OPS = [
  { id: 'log_transform', label: 'Log transform', fields: ['column', 'new_column(optional)'] },
  { id: 'binning', label: 'Binning', fields: ['column', 'bins(number)', 'new_column(optional)'] },
  { id: 'date_features', label: 'Date features (year/month/day/dow/weekend)', fields: ['column', 'prefix(optional)'] },
  { id: 'interaction', label: 'Interaction of two columns', fields: ['column_a', 'column_b', 'method(multiply|add|subtract|ratio)'] },
  { id: 'aggregation', label: 'Group aggregation', fields: ['group_column', 'value_column', 'agg(mean|sum|count|median|min|max)'] },
  { id: 'frequency_encoding', label: 'Frequency encoding', fields: ['column'] },
  { id: 'text_length', label: 'Text length', fields: ['column'] },
];
async function renderFeatures() {
  const c = el('#view-features');
  if (needsDataset(c)) return;
  c.innerHTML = `<div class="panel glass"><div class="panel-head"><h3>Create a feature</h3></div>
    <div class="feature-grid">${FEATURE_OPS.map(op => `<div class="feature-card glass" data-op="${op.id}"><h3>${op.label}</h3></div>`).join('')}</div>
    <div id="featForm" style="margin-top:16px;"></div></div>`;

  c.querySelectorAll('[data-op]').forEach(card => {
    card.onclick = () => {
      const op = FEATURE_OPS.find(o => o.id === card.dataset.op);
      el('#featForm').innerHTML = `<div class="panel glass" style="padding:16px;"><strong>${op.label}</strong>
        <div style="display:flex;gap:8px;flex-wrap:wrap;margin:10px 0;">${op.fields.map(f => `<input class="search-input" placeholder="${f}" data-field="${f.split('(')[0]}" style="min-width:160px;" />`).join('')}</div>
        <button class="btn btn-primary btn-sm" id="applyFeatBtn">Create feature</button></div>`;
      el('#applyFeatBtn').onclick = async () => {
        const params = {};
        el('#featForm').querySelectorAll('[data-field]').forEach(inp => { if (inp.value) params[inp.dataset.field] = isNaN(inp.value) ? inp.value : Number(inp.value); });
        try { const r = await DataFixAPI.applyFeature(state.datasetId, op.id, params); toast(r.summary.description); }
        catch (err) { toast(err.message, 'error'); }
      };
    };
  });
}

// ===================== AUTOML =====================
async function renderAutoml() {
  const c = el('#view-automl');
  if (needsDataset(c)) return;
  const profile = await DataFixAPI.profile(state.datasetId);
  const ds = state.datasets.find(d => d.id === state.datasetId);
  c.innerHTML = `
    <div class="panel glass">
      <div class="panel-head"><h3>Train a model</h3></div>
      <div style="display:flex;gap:8px;flex-wrap:wrap;">
        <select class="select-control" id="targetSelect">${profile.columns.map(x => `<option ${x.name === ds.target_column ? 'selected' : ''}>${escapeHtml(x.name)}</option>`).join('')}</select>
        <select class="select-control" id="taskTypeSelect"><option value="">auto-detect</option><option value="classification">classification</option><option value="regression">regression</option></select>
        <select class="select-control" id="algoSelect"></select>
        <input class="search-input" id="testSizeInput" value="0.2" style="width:80px;" title="test size" />
        <button class="btn btn-primary btn-sm" id="trainBtn">Train</button>
      </div>
      <p style="opacity:.7;font-size:13px;margin-top:8px;">Features = every other column. Set the target above; algorithms update to match classification/regression once you pick a task type.</p>
      <div id="trainResult" style="margin-top:14px;"></div>
    </div>
    <div class="panel glass"><div class="panel-head"><h3>Experiments</h3></div><div id="expList"></div></div>
    <div class="panel glass"><div class="panel-head"><h3>Models & Prediction</h3></div><div id="modelList"></div></div>`;

  async function refreshAlgos() {
    const tt = el('#taskTypeSelect').value || 'classification';
    const res = await DataFixAPI.algorithms(state.datasetId, tt);
    el('#algoSelect').innerHTML = res.algorithms.map(a => `<option value="${a}">${a}</option>`).join('');
  }
  el('#taskTypeSelect').onchange = refreshAlgos;
  await refreshAlgos();

  el('#trainBtn').onclick = async () => {
    el('#trainResult').innerHTML = '<div class="spinner"></div> Training…';
    try {
      const body = { target: el('#targetSelect').value, algorithm: el('#algoSelect').value, task_type: el('#taskTypeSelect').value || null, test_size: parseFloat(el('#testSizeInput').value) || 0.2, cv_folds: 5 };
      const res = await DataFixAPI.train(state.datasetId, body);
      el('#trainResult').innerHTML = `<pre class="mono" style="white-space:pre-wrap;font-size:12px;">${escapeHtml(JSON.stringify(res.model.metrics, null, 2))}</pre>`;
      await loadExperimentsAndModels();
    } catch (err) { el('#trainResult').innerHTML = `<p class="upload-error">${escapeHtml(err.message)}</p>`; }
  };

  await loadExperimentsAndModels();

  async function loadExperimentsAndModels() {
    const exps = await DataFixAPI.experiments(state.datasetId);
    el('#expList').innerHTML = exps.length ? `<div class="table-scroll"><table class="data-table"><thead><tr><th>Algorithm</th><th>Target</th><th>Status</th><th>Key metric</th><th>When</th></tr></thead>
      <tbody>${exps.map(e => `<tr><td>${e.algorithm}</td><td>${escapeHtml(e.target_column)}</td><td>${e.status}${e.error ? ` — ${escapeHtml(e.error)}` : ''}</td><td class="mono">${e.metrics ? (e.metrics.accuracy ?? e.metrics.r2 ?? '—') : '—'}</td><td class="mono">${new Date(e.created_at).toLocaleString()}</td></tr>`).join('')}</tbody></table></div>` : '<p style="opacity:.7;">No experiments yet.</p>';

    const models = await DataFixAPI.projectModels(state.projectId);
    el('#modelList').innerHTML = models.length ? models.map(m => `
      <div class="clean-action-card glass" style="margin-bottom:12px;">
        <div style="display:flex;justify-content:space-between;flex-wrap:wrap;gap:8px;">
          <div><strong>${escapeHtml(m.name)}</strong><div class="mono" style="font-size:12px;opacity:.7;">${m.task_type} · target ${escapeHtml(m.target_column)}</div></div>
          <button class="btn btn-sm btn-secondary" data-predict="${m.id}">Predict</button>
        </div>
        <div class="explain-bar-row" style="margin-top:10px;">
          ${(m.feature_importance || []).slice(0, 6).map(f => `<div class="explain-name">${escapeHtml(f.feature)}</div><div class="explain-bar-track"><div class="explain-bar-fill" style="width:${Math.min(100, Math.abs(f.importance) * 300)}%"></div></div>`).join('')}
        </div>
        <div id="predictBox-${m.id}"></div>
      </div>`).join('') : '<p style="opacity:.7;">No trained models yet.</p>';

    document.querySelectorAll('[data-predict]').forEach(btn => {
      btn.onclick = async () => {
        const mid = btn.dataset.predict;
        const model = models.find(m => String(m.id) === mid);
        const box = el(`#predictBox-${mid}`);
        box.innerHTML = `<div style="display:flex;gap:8px;flex-wrap:wrap;margin-top:10px;">
          ${model.feature_columns.map(f => `<input class="search-input" placeholder="${escapeHtml(f)}" data-pf="${escapeHtml(f)}" style="width:130px;" />`).join('')}
          <button class="btn btn-sm btn-primary" id="doPredictBtn-${mid}">Predict</button></div><div id="predictOut-${mid}"></div>`;
        el(`#doPredictBtn-${mid}`).onclick = async () => {
          const row = {};
          box.querySelectorAll('[data-pf]').forEach(inp => { row[inp.dataset.pf] = inp.value; });
          try {
            const res = await DataFixAPI.predict(mid, [row]);
            el(`#predictOut-${mid}`).innerHTML = `<p style="margin-top:8px;"><strong>Prediction:</strong> ${escapeHtml(res.results[0].prediction)}${res.results[0].probabilities ? ` (p=${res.results[0].probabilities.map(p=>p.toFixed(2)).join(', ')})` : ''}<br><span class="mono" style="font-size:12px;opacity:.7;">${res.disclaimer}</span></p>`;
          } catch (err) { el(`#predictOut-${mid}`).innerHTML = `<p class="upload-error">${escapeHtml(err.message)}</p>`; }
        };
      };
    });
  }
}

// ===================== ACTIVITY =====================
function renderActivityTable(entries) {
  if (!entries.length) return '<p style="opacity:.7;">No activity yet.</p>';
  return `<div class="table-scroll"><table class="data-table"><thead><tr><th>Action</th><th>Details</th><th>When</th></tr></thead>
    <tbody>${entries.map(a => `<tr><td>${escapeHtml(a.action)}</td><td class="mono" style="font-size:12px;">${escapeHtml(JSON.stringify(a.details).slice(0, 140))}</td><td class="mono">${new Date(a.created_at).toLocaleString()}</td></tr>`).join('')}</tbody></table></div>`;
}
async function renderActivity() {
  const c = el('#view-activity');
  const entries = await DataFixAPI.activity(state.projectId);
  c.innerHTML = `<div class="panel glass"><div class="panel-head"><h3>All activity</h3></div>${renderActivityTable(entries)}</div>`;
}

init();
