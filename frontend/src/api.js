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

/* A vendor portal opens published links with ?vt=<signed viewer token>.
   It rides along on every request so the backend can scope data to that
   vendor. Absent on designer pages and on non-vendor links. */
export function getClientVendorName() {
  if (typeof window === "undefined") return "";
  try {
    const urlParams = new URLSearchParams(window.location.search);
    const fromUrl = urlParams.get("vendor_name") || urlParams.get("vendor");
    if (fromUrl && fromUrl.trim() && !/^\d+$/.test(fromUrl.trim())) return fromUrl.trim();

    // 1. Check parent window document if same origin (e.g. nexdsupportal.in navbar)
    if (window.parent && window.parent !== window) {
      try {
        const parentText = window.parent.document.body.innerText || "";
        // Match "<BP_NO> - <VENDOR_NAME>" (e.g. 2100431 - GENUINE HYDRAULICS or 2100354 - PUSH-UP TOOLS UDYOG PVT LTD)
        const m = parentText.match(/\b\d{5,12}\s*[-–]\s*([A-Za-z0-9\s.,&'()\/-]+)/);
        if (m && m[1]) {
          const cand = m[1].split("\n")[0].trim();
          if (cand && cand.length >= 2 && cand.length < 90 && !/^\d+$/.test(cand)) {
            return cand;
          }
        }
      } catch (e) {}
    }

    // 2. Check localStorage / sessionStorage
    for (const storage of [window.localStorage, window.sessionStorage]) {
      if (!storage) continue;
      for (const k of ["vendor_name", "vendorName", "vendor", "legal_name", "company_name", "user", "profile", "auth", "account"]) {
        const val = storage.getItem(k);
        if (!val) continue;
        try {
          const obj = JSON.parse(val);
          const name = obj?.vendor_name || obj?.vendorName || obj?.legal_name || obj?.company_name || obj?.name || (typeof obj?.vendor === "string" ? obj.vendor : obj?.vendor?.name);
          if (name && typeof name === "string" && name.trim() && !/^\d+$/.test(name.trim())) {
            return name.trim();
          }
        } catch {
          if (typeof val === "string" && val.trim().length >= 2 && val.trim().length < 90 && !/^\d+$/.test(val.trim())) {
            return val.trim();
          }
        }
      }
    }
  } catch (e) {}
  return "";
}

const _urlParams = typeof window !== "undefined" ? new URLSearchParams(window.location.search) : new URLSearchParams();
const viewerToken = _urlParams.get("vt") || "";

function getViewerHeaders() {
  const vName = getClientVendorName();
  return {
    ...(viewerToken ? { "X-Viewer-Token": viewerToken } : {}),
    ...(vName ? { "X-Vendor-Name": vName } : {}),
  };
}

function withViewerToken(path) {
  let res = path;
  if (viewerToken && !res.includes("vt=")) {
    res += (res.includes("?") ? "&" : "?") + `vt=${encodeURIComponent(viewerToken)}`;
  }
  const vName = getClientVendorName();
  if (vName && !res.includes("vendor_name=")) {
    res += (res.includes("?") ? "&" : "?") + `vendor_name=${encodeURIComponent(vName)}`;
  }
  return res;
}

async function call(path, options = {}) {
  const { body, ...rest } = options;

  const res = await fetch(BASE + withViewerToken(path), {
    ...rest,
    headers: {
      ...(token ? { Authorization: `Bearer ${token}` } : {}),
      ...getViewerHeaders(),
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
  const res = await fetch(BASE + withViewerToken(path), {
    headers: {
      ...(token ? { Authorization: `Bearer ${token}` } : {}),
      ...viewerHeaders,
    },
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


  getReportViewRelatedRows: (
    key,
    boxId,
    sectionId,
    record,
    filters = {},
    limit = 20,
    signal
  ) =>
    call(`/processes/${key}/report-view-related`, {
      method: "POST",
      body: {
        boxId,
        sectionId,
        record,
        filters,
        limit,
      },
      signal,
    }),


  previewSql: (key, box, definition, filters) =>
    call(`/processes/${key}/preview-sql`, {
      method: "POST", body: { box, definition, filters },
    }),
  filterOptions: (key, clientId, table, column) =>
    call(`/processes/${key}/filters/${clientId}/options`
      + (table && column
        ? `?table=${encodeURIComponent(table)}&column=${encodeURIComponent(column)}`
        : "")),

  prItems: (key, prNumber) =>
    call(`/processes/${key}/pr/${encodeURIComponent(prNumber)}/items`),

  publish: (key, roles) => call(`/processes/${key}/publish`, { method: "POST", body: { roles } }),
  unpublish: (key) => call(`/processes/${key}/unpublish`, { method: "POST" }),
  

  publicDefinition: (slug, signal) => call(`/r/${slug}`, { signal }),
  
  publicFilterOptions: (slug, clientId) =>
    call(`/r/${slug}/filters/${clientId}/options`),

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
