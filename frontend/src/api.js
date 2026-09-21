/* One place that talks to the middleware. Everything else imports this. */
const BASE =
  (import.meta.env.BASE_URL || "/").replace(/\/$/, "") + "/api";

let token = localStorage.getItem("token") || "";

export const setToken = (t) => {
  token = t || "";
  if (token) {
    localStorage.setItem("token", token);
  } else {
    localStorage.removeItem("token");
  }
};

export const hasToken = () => !!token;

async function call(path, options = {}) {
  const { body, ...rest } = options;

  const res = await fetch(BASE + path, {
    ...rest,
    headers: {
      ...(token ? { Authorization: `Bearer ${token}` } : {}),
      ...(body !== undefined
        ? { "Content-Type": "application/json" }
        : {}),
      ...(rest.headers || {}),
    },
    body: body === undefined ? undefined : JSON.stringify(body),
  });

  const text = await res.text();
  const data = text ? JSON.parse(text) : {};

  if (!res.ok) {
    throw new Error(
      data.error || `${res.status} ${res.statusText}`
    );
  }

  return data;
}

/* Downloads (PDF/PPTX/XLSX/Table exports) */
async function download(path, filename) {
  const res = await fetch(BASE + path, {
    headers: token
      ? { Authorization: `Bearer ${token}` }
      : {},
  });

  if (!res.ok) {
    let msg = `${res.status} ${res.statusText}`;

    try {
      const j = await res.json();
      if (j.error) msg = j.error;
    } catch {
      /* Response was not JSON */
    }

    throw new Error(msg);
  }

  const blob = await res.blob();
  const url = URL.createObjectURL(blob);

  const a = document.createElement("a");
  a.href = url;
  a.download = filename;

  document.body.appendChild(a);
  a.click();
  a.remove();

  URL.revokeObjectURL(url);
}


const api = {
  login: (username, password) =>
    call("/auth/login", { method: "POST", body: { username, password } }),

  connections: () => call("/connections"),
  createConnection: (c) => call("/connections", { method: "POST", body: c }),
  updateConnection: (id, c) => call(`/connections/${id}`, { method: "PUT", body: c }),
  deleteConnection: (id) => call(`/connections/${id}`, { method: "DELETE" }),
  testConnection: (id) => call(`/connections/${id}/test`, { method: "POST" }),

  catalog: (connectionId) =>
    call(`/catalog${connectionId ? `?connection_id=${connectionId}` : ""}`),

  processes: () => call("/processes"),
  process: (key) => call(`/processes/${key}`),
  createProcess: (definition, connectionId) =>
    call("/processes", { method: "POST", body: { definition, connection_id: connectionId } }),
  saveProcess: (key, definition, connectionId) =>
    call(`/processes/${key}`, { method: "PUT", body: { definition, connection_id: connectionId } }),
  deleteProcess: (key) => call(`/processes/${key}`, { method: "DELETE" }),
  aiGenerateReport: (prompt, connectionId) =>
    call("/processes/ai-generate", { method: "POST", body: { prompt, connection_id: connectionId } }),
  aiEditReport: (prompt, definition, connectionId, images = []) =>
    call("/processes/ai-edit", {
      method: "POST",
      body: {
        prompt,
        definition,
        connection_id: connectionId,
        images,
      },
    }),

  executeAll: (key, definition, filters, signal) =>
    call(`/processes/${key}/execute-all`, {
      method: "POST", body: { definition, filters }, signal,
    }),
  getPrItems: (key, prNumber, signal) =>
  call(
    `/processes/${key}/pr/${encodeURIComponent(prNumber)}/items`,
    { signal }
  ),
  getDetailRows: (
  key,
  parentTable,
  lookupColumn,
  value,
  detailColumns = [],
  limit = 20,
  signal
) =>
  call(
    `/processes/${key}/detail?parentTable=${encodeURIComponent(parentTable)}&lookupColumn=${encodeURIComponent(lookupColumn)}&value=${encodeURIComponent(value)}&detailColumns=${encodeURIComponent(detailColumns.join(","))}&limit=${limit}`,
    { signal }
  ),
  previewSql: (key, box, definition, filters) =>
    call(`/processes/${key}/preview-sql`, {
      method: "POST", body: { box, definition, filters },
    }),
  filterOptions: (key, clientId) =>
    call(`/processes/${key}/filters/${clientId}/options`),

  prItems: (key, prNumber) =>
    call(`/processes/${key}/pr/${encodeURIComponent(prNumber)}/items`),

  publish: (key, roles) => call(`/processes/${key}/publish`, { method: "POST", body: { roles } }),
  unpublish: (key) => call(`/processes/${key}/unpublish`, { method: "POST" }),
  

  publicDefinition: (slug, signal) => call(`/r/${slug}`, { signal }),
  
  publicExecute: (slug, filters, signal) =>
    call(`/r/${slug}/execute`, { method: "POST", body: { filters }, signal }),

publicPrItems: (slug, prNumber) =>
  call(`/r/${slug}/pr/${encodeURIComponent(prNumber)}/items`),

  exportReport: (key, fmt, filters, filename) =>
    download(`/processes/${key}/export/${fmt}?filters=${encodeURIComponent(JSON.stringify(filters || {}))}`,
      filename),

  publicExport: (slug, fmt, filters, filename) =>
    download(`/r/${slug}/export/${fmt}?filters=${encodeURIComponent(JSON.stringify(filters || {}))}`,
      filename),
};
export default api;
