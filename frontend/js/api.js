/* Thin fetch wrapper for the real DataFix AI backend. No mock data anywhere
 * in this file — every function calls the FastAPI server started with
 * `uvicorn app.main:app`. Configure the base URL via localStorage
 * ('df_api_base') to override.
 *
 * Default resolution:
 *  - On Vercel (or any deployment where the frontend and /api/* share the
 *    same origin), an empty base means every request is a same-origin
 *    relative URL — no configuration needed.
 *  - When served by the local static file server on port 8020 (the
 *    two-terminal RUN.md dev flow, where the frontend and backend are on
 *    different ports), default to the backend's own port, 8010. */
const _isSplitLocalDev = window.location.port === '8020' &&
  (window.location.hostname === '127.0.0.1' || window.location.hostname === 'localhost');
const API_BASE = window.localStorage.getItem('df_api_base') || (_isSplitLocalDev ? 'http://127.0.0.1:8010' : '');

const DataFixAPI = {
  base: API_BASE,

  token() {
    return window.localStorage.getItem('df_token');
  },
  setToken(t) {
    window.localStorage.setItem('df_token', t);
  },
  clearToken() {
    window.localStorage.removeItem('df_token');
  },
  isLoggedIn() {
    return !!this.token();
  },

  async request(path, { method = 'GET', body, form, auth = true, query } = {}) {
    const headers = {};
    if (auth && this.token()) headers['Authorization'] = `Bearer ${this.token()}`;
    let url = this.base + path;
    if (query) {
      const qs = new URLSearchParams(query).toString();
      url += (url.includes('?') ? '&' : '?') + qs;
    }
    let opts = { method, headers };
    if (form) {
      opts.body = form;
    } else if (body !== undefined) {
      headers['Content-Type'] = 'application/json';
      opts.body = JSON.stringify(body);
    }
    let res;
    try {
      res = await fetch(url, opts);
    } catch (e) {
      throw new Error(`Could not reach the DataFix API at ${this.base} — is the backend running? (${e.message})`);
    }
    let data = null;
    const text = await res.text();
    if (text) {
      try { data = JSON.parse(text); } catch { data = text; }
    }
    if (!res.ok) {
      const msg = (data && data.detail) ? (typeof data.detail === 'string' ? data.detail : JSON.stringify(data.detail)) : `Request failed (${res.status})`;
      const err = new Error(msg);
      err.status = res.status;
      throw err;
    }
    return data;
  },

  // ---- auth ----
  register(email, password, name) {
    return this.request('/api/auth/register', { method: 'POST', body: { email, password, name }, auth: false });
  },
  async login(email, password) {
    const form = new URLSearchParams();
    form.set('username', email);
    form.set('password', password);
    const headers = { 'Content-Type': 'application/x-www-form-urlencoded' };
    const res = await fetch(this.base + '/api/auth/login', { method: 'POST', headers, body: form.toString() });
    const data = await res.json();
    if (!res.ok) throw new Error(data.detail || 'Login failed');
    return data;
  },
  me() { return this.request('/api/auth/me'); },
  authConfig() { return this.request('/api/auth/config', { auth: false }); },
  googleLogin(idToken) { return this.request('/api/auth/google', { method: 'POST', body: { id_token: idToken }, auth: false }); },

  // ---- subscription ----
  plans() { return this.request('/api/plans', { auth: false }); },
  mySubscription() { return this.request('/api/subscription/me'); },
  requestSubscription(requested_plan, payment_reference, transaction_id) { return this.request('/api/subscription/request', { method: 'POST', body: { requested_plan, payment_reference, transaction_id } }); },
  uploadPaymentScreenshot(requestId, file) {
    const form = new FormData();
    form.append('file', file);
    return this.request(`/api/subscription/requests/${requestId}/screenshot`, { method: 'POST', form });
  },
  publicAdminSettings() { return this.request('/api/admin-settings/public', { auth: false }); },

  // ---- admin ----
  adminListRequests(status) { return this.request('/api/admin/subscription-requests', { query: status ? { status } : undefined }); },
  adminDecideRequest(requestId, body) { return this.request(`/api/admin/subscription-requests/${requestId}/decide`, { method: 'POST', body }); },
  adminUpdateSettings(body) { return this.request('/api/admin/settings', { method: 'PATCH', body }); },
  adminUpdatePlan(code, body) { return this.request(`/api/admin/plans/${code}`, { method: 'PATCH', body }); },

  // ---- projects ----
  listProjects() { return this.request('/api/projects'); },
  createProject(name, description) { return this.request('/api/projects', { method: 'POST', body: { name, description } }); },
  getProject(id) { return this.request(`/api/projects/${id}`); },
  deleteProject(id) { return this.request(`/api/projects/${id}`, { method: 'DELETE' }); },
  projectOverview(id) { return this.request(`/api/projects/${id}/overview`); },
  globalOverview() { return this.request('/api/dashboard/overview'); },
  activity(projectId) { return this.request(`/api/projects/${projectId}/activity`); },

  // ---- datasets ----
  listDatasets(projectId) { return this.request(`/api/projects/${projectId}/datasets`); },
  uploadDataset(projectId, file) {
    const form = new FormData();
    form.append('file', file);
    return this.request(`/api/projects/${projectId}/datasets/upload`, { method: 'POST', form });
  },
  getDataset(id) { return this.request(`/api/datasets/${id}`); },
  deleteDataset(id) { return this.request(`/api/datasets/${id}`, { method: 'DELETE' }); },
  preview(id, limit = 50) { return this.request(`/api/datasets/${id}/preview`, { query: { limit } }); },
  profile(id) { return this.request(`/api/datasets/${id}/profile`); },
  quality(id) { return this.request(`/api/datasets/${id}/quality`); },
  createRule(id, rule) { return this.request(`/api/datasets/${id}/rules`, { method: 'POST', body: rule }); },
  listRules(id) { return this.request(`/api/datasets/${id}/rules`); },
  deleteRule(ruleId) { return this.request(`/api/rules/${ruleId}`, { method: 'DELETE' }); },
  setTarget(id, target_column) { return this.request(`/api/datasets/${id}/target`, { method: 'PUT', body: { target_column } }); },
  versions(id) { return this.request(`/api/datasets/${id}/versions`); },
  restoreVersion(id, versionId) { return this.request(`/api/datasets/${id}/versions/${versionId}/restore`, { method: 'POST' }); },

  // ---- cleaning ----
  cleaningOperations(id) { return this.request(`/api/datasets/${id}/clean/operations`); },
  applyCleaning(id, operation, params) { return this.request(`/api/datasets/${id}/clean`, { method: 'POST', body: { operation, params } }); },
  cleaningHistory(id) { return this.request(`/api/datasets/${id}/clean/history`); },
  undoCleaning(id) { return this.request(`/api/datasets/${id}/clean/undo`, { method: 'POST' }); },

  // ---- eda ----
  distribution(id, column, bins = 20) { return this.request(`/api/datasets/${id}/eda/distribution`, { query: { column, bins } }); },
  correlation(id, method = 'pearson') { return this.request(`/api/datasets/${id}/eda/correlation`, { query: { method } }); },
  missingness(id) { return this.request(`/api/datasets/${id}/eda/missingness`); },
  targetAnalysis(id, column) { return this.request(`/api/datasets/${id}/eda/target`, { query: { column } }); },
  groupAnalysis(id, group_column, value_column, agg = 'mean') { return this.request(`/api/datasets/${id}/eda/group`, { query: { group_column, value_column, agg } }); },
  trend(id, date_column, value_column, freq = 'M', agg = 'sum') { return this.request(`/api/datasets/${id}/eda/trend`, { query: { date_column, value_column, freq, agg } }); },

  // ---- sql ----
  sqlSchema(id) { return this.request(`/api/datasets/${id}/sql/schema`); },
  runSql(id, sql, save_as) { return this.request(`/api/datasets/${id}/sql/query`, { method: 'POST', body: { sql, save_as } }); },
  savedQueries(id) { return this.request(`/api/datasets/${id}/sql/queries`); },
  generateSql(id, question) { return this.request(`/api/datasets/${id}/sql/generate`, { method: 'POST', body: { question } }); },

  // ---- features ----
  featureOperations(id) { return this.request(`/api/datasets/${id}/features/operations`); },
  applyFeature(id, operation, params) { return this.request(`/api/datasets/${id}/features`, { method: 'POST', body: { operation, params } }); },

  // ---- automl ----
  algorithms(id, task_type) { return this.request(`/api/datasets/${id}/algorithms`, { query: { task_type } }); },
  train(id, body) { return this.request(`/api/datasets/${id}/train`, { method: 'POST', body }); },
  experiments(id) { return this.request(`/api/datasets/${id}/experiments`); },
  projectModels(projectId) { return this.request(`/api/projects/${projectId}/models`); },

  // ---- predictions ----
  predict(modelId, rows) { return this.request(`/api/models/${modelId}/predict`, { method: 'POST', body: { rows } }); },
  predictionHistory(modelId) { return this.request(`/api/models/${modelId}/predictions`); },
  explain(modelId) { return this.request(`/api/models/${modelId}/explain`); },
  explainInstance(modelId, row) { return this.request(`/api/models/${modelId}/explain-instance`, { method: 'POST', body: { row } }); },
};

function requireAuth() {
  if (!DataFixAPI.isLoggedIn()) {
    window.location.href = 'login.html';
  }
}

/* Client-side admin gating is a UX convenience only (redirect away from the
 * page) — every admin action is independently re-checked server-side by
 * require_admin, so hiding the route here is never the real security boundary. */
async function requireAdminPage() {
  requireAuth();
  try {
    const me = await DataFixAPI.me();
    if (!me.is_admin) { window.location.href = 'projects.html'; return null; }
    return me;
  } catch {
    DataFixAPI.clearToken();
    window.location.href = 'login.html';
    return null;
  }
}

/* Renders the shared profile menu (picture, name, email, plan, sign out)
 * into a container element. Call on any authenticated page. */
async function renderProfileMenu(containerSelector) {
  const container = document.querySelector(containerSelector);
  if (!container) return;
  let me;
  try { me = await DataFixAPI.me(); } catch { return; }
  const initials = (me.name || me.email || '?').trim().charAt(0).toUpperCase();
  container.innerHTML = `
    <div class="profile-menu-wrap" style="position:relative;">
      <button class="btn btn-ghost btn-sm" id="profileMenuBtn" style="display:flex;align-items:center;gap:8px;">
        ${me.picture_url ? `<img src="${me.picture_url}" alt="" style="width:24px;height:24px;border-radius:50%;" />` : `<span style="width:24px;height:24px;border-radius:50%;background:#38bdf8;display:inline-flex;align-items:center;justify-content:center;font-size:12px;color:#04121b;">${initials}</span>`}
        <span>${escapeHtmlGlobal(me.name || me.email)}</span>
        <span class="type-badge">${escapeHtmlGlobal(me.subscription.plan_name)}</span>
      </button>
      <div class="panel glass" id="profileMenuDropdown" style="display:none;position:absolute;right:0;top:110%;min-width:220px;padding:12px;z-index:50;">
        <div style="font-size:13px;opacity:.8;margin-bottom:6px;">${escapeHtmlGlobal(me.email)}</div>
        <div style="font-size:12px;opacity:.65;margin-bottom:10px;">Status: ${escapeHtmlGlobal(me.subscription.status)}</div>
        <a href="subscription.html" class="btn btn-ghost btn-sm btn-block" style="margin-bottom:6px;">Subscription</a>
        ${me.is_admin ? '<a href="admin.html" class="btn btn-ghost btn-sm btn-block" style="margin-bottom:6px;">Admin Panel</a>' : ''}
        <button class="btn btn-secondary btn-sm btn-block" id="profileSignOutBtn">Sign Out</button>
      </div>
    </div>`;
  const btn = container.querySelector('#profileMenuBtn');
  const dd = container.querySelector('#profileMenuDropdown');
  btn.onclick = (e) => { e.stopPropagation(); dd.style.display = dd.style.display === 'none' ? '' : 'none'; };
  document.addEventListener('click', () => { dd.style.display = 'none'; });
  container.querySelector('#profileSignOutBtn').onclick = () => { DataFixAPI.clearToken(); window.location.href = 'login.html'; };
  return me;
}

function escapeHtmlGlobal(s) {
  const d = document.createElement('div');
  d.textContent = s == null ? '' : String(s);
  return d.innerHTML;
}

function toast(message, type = 'info') {
  let stack = document.querySelector('.toast-stack');
  if (!stack) {
    stack = document.createElement('div');
    stack.className = 'toast-stack';
    document.body.appendChild(stack);
  }
  const el = document.createElement('div');
  el.className = `toast toast-${type}`;
  el.textContent = message;
  stack.appendChild(el);
  setTimeout(() => el.remove(), 5000);
}
