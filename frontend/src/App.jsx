/* App.jsx — the shell.

   One page. A row of buttons across the top, and a view that swaps beneath
   them: the report list, system settings, or the editor. */

import React from "react";
import api, { hasToken, setToken } from "./api.js";
import { StoreProvider, useStore } from "./store.jsx";
import { blankDoc, migrate } from "./model.js";
import Canvas from "./components/Canvas.jsx";
import { Reports, Settings } from "./components/Views.jsx";
import PublicReport from "./components/PublicReport.jsx";

// Mirrors backend/app.py's PUBLIC_ROLES — kept as a small labeled list here since the picker
// needs display labels, not just the raw role keys the API takes.
const ROLE_OPTIONS = [
  { value: "vendor", label: "Vendor" },
  { value: "admin", label: "Admin" },
  { value: "employee", label: "Employee" },
];

/* Single sign-on from the admin portal: embedded in an iframe, the portal
   mints a short-lived token server-side (it holds the real login, never
   shipped to the browser) and hands it over as ?sso_token=. Consumed once
   on first render, then stripped from the URL so it never lingers in
   history — after that this behaves exactly like a normal signed-in
   session (sessionStorage-backed, same as a manual login). */
function consumeSsoToken() {
  const params = new URLSearchParams(window.location.search);
  const token = params.get("sso_token");
  if (!token) return;
  setToken(token);
  params.delete("sso_token");
  const rest = params.toString();
  window.history.replaceState({}, "", window.location.pathname + (rest ? `?${rest}` : ""));
}

/* Local drafts: a safety net for an accidental refresh or closed tab, not a
   replacement for Save. Keyed per-report, cleared the moment a real Save
   succeeds, so it never lingers and never substitutes for the server copy. */
const DRAFT_PREFIX = "nexd:draft:";
function readDraft(key) {
  try {
    const raw = localStorage.getItem(DRAFT_PREFIX + key);
    return raw ? JSON.parse(raw) : null;
  } catch { return null; }
}
function writeDraft(key, doc) {
  try { localStorage.setItem(DRAFT_PREFIX + key, JSON.stringify({ doc, savedAt: Date.now() })); }
  catch { /* storage full or disabled — autosave just quietly stops */ }
}
function clearDraft(key) {
  try { localStorage.removeItem(DRAFT_PREFIX + key); } catch { /* nothing to clear */ }
}

// This app is served under a base path in production (VITE_BASE_PATH=/analytics/, set by the
// deploy workflow; nginx's `alias` for that location does not strip the prefix from the URL the
// browser sees) but at "/" in dev — Vite exposes whichever is actually in effect as
// import.meta.env.BASE_URL. Checking window.location.pathname against a bare "/r/" prefix
// without accounting for that base ignored every real published link in production and fell
// through to the login shell below instead (the base path is only 1 segment deep in practice,
// so a plain string slice is enough — this doesn't need full path-matching).
function pathRelativeToBase() {
  const base = import.meta.env.BASE_URL || "/";
  const path = window.location.pathname;
  if (base !== "/" && path.startsWith(base)) {
    return "/" + path.slice(base.length);
  }
  return path;
}

// The inverse — backend/app.py's publish() hands back a bare "/r/<key>/<token>" (base-agnostic,
// so it stays reusable by anything else that reads a publication row directly). The browser
// needs it under this app's actual base path to work as a real, clickable/copyable link.
function fullPublicUrl(bareUrl) {
  const base = import.meta.env.BASE_URL || "/";
  const prefix = base.endsWith("/") ? base.slice(0, -1) : base;
  return prefix + bareUrl;
}

export default function App() {
  const pathname = window.location.pathname;

  if (pathname.includes("/r/")) {
    return <PublicReport />;
  }

  return (
    <StoreProvider>
      <Shell />
    </StoreProvider>
  );
}

function Shell() {
  const { state, dispatch } = useStore();
  const [signedIn, setSignedIn] = React.useState(() => {
    consumeSsoToken();
    return hasToken();
  });
  const [saveMsg, setSaveMsg] = React.useState("");
    const [pubRole, setPubRole] = React.useState("vendor");
  const [exporting, setExporting] = React.useState(null);
  const [recoverable, setRecoverable] = React.useState(null); // {doc, savedAt}
  // Which roles the picker has checked — defaults to "everyone" (today's one-click behavior)
  // until synced below to whatever a report already published turns out to actually have live.
  const [selectedRoles, setSelectedRoles] = React.useState(
    () => new Set(ROLE_OPTIONS.map((r) => r.value)));

  React.useEffect(() => {
    if (state.published?.links?.length) {
      setPubRole(state.published.links[0].role);
      setSelectedRoles(new Set(state.published.links.map((l) => l.role)));
    }
  }, [state.published]);

  const toggleRole = (role) => {
    setSelectedRoles((prev) => {
      const next = new Set(prev);
      if (next.has(role)) next.delete(role); else next.add(role);
      return next;
    });
  };

  /* Autosave a draft locally whenever there are unsaved changes. */
  React.useEffect(() => {
    if (!state.processKey || !state.dirty) return undefined;
    const t = setTimeout(() => writeDraft(state.processKey, state.doc), 600);
    return () => clearTimeout(t);
  }, [state.processKey, state.dirty, JSON.stringify(state.doc)]);

  /* Whenever a report is opened, check whether a local draft for it exists
     and differs from what the server just gave us — offer to bring it back. */
  React.useEffect(() => {
    if (!state.processKey) { setRecoverable(null); return; }
    const d = readDraft(state.processKey);
    setRecoverable(d && JSON.stringify(d.doc) !== JSON.stringify(state.doc) ? d : null);
  }, [state.processKey]);

  React.useEffect(() => {
    document.body.className = state.mode === "preview" ? "preview" : "design";
  }, [state.mode]);

  const reloadReports = React.useCallback(async () => {
    try { dispatch({ type: "reports", reports: await api.processes() }); }
    catch (e) { dispatch({ type: "error", error: e.message }); }
  }, [dispatch]);

  const reloadCatalog = React.useCallback(async () => {
    try {
      const r = await api.catalog(state.connectionId);
      dispatch({ type: "catalog", catalog: { tables: r.tables || [] } });
    } catch { dispatch({ type: "catalog", catalog: { tables: [] } }); }
  }, [dispatch, state.connectionId]);

  React.useEffect(() => {
    if (!signedIn) return;
    reloadReports();
    reloadCatalog();
  }, [signedIn, reloadReports, reloadCatalog]);

  /* ---- the execution loop: debounced, and abortable so a fast filter
     change cancels the request it supersedes ---- */
  React.useEffect(() => {
    if (state.view !== "editor" || !state.processKey) return undefined;
    const ctrl = new AbortController();
    const t = setTimeout(async () => {
      dispatch({ type: "busy", busy: true });
      try {
        const r = await api.executeAll(state.processKey, state.doc, state.filterState, ctrl.signal);
        dispatch({ type: "results", results: r.results || {} });
        dispatch({ type: "error", error: null });
      } catch (e) {
        if (e.name !== "AbortError") dispatch({ type: "error", error: e.message });
      } finally {
        dispatch({ type: "busy", busy: false });
      }
    }, 350);
    return () => { clearTimeout(t); ctrl.abort(); };
  }, [state.view, state.processKey, JSON.stringify(state.doc), JSON.stringify(state.filterState)]);

  React.useEffect(() => {
    setSaveMsg(state.dirty ? "unsaved changes" : state.processKey ? "saved" : "");
  }, [state.dirty, state.processKey]);

  if (!signedIn) return <Login onDone={() => setSignedIn(true)} />;

  const openReport = async (key, mode) => {
    const full = await api.process(key);
    dispatch({ type: "open", doc: full.definition, key, connectionId: full.connection_id, mode });
    reloadCatalog();
  };

  const newReport = async () => {
    const doc = { ...blankDoc(), sections: [] };
    const r = await api.createProcess(doc, state.connectionId);
    await reloadReports();
    dispatch({ type: "open", doc, key: r.process_key, connectionId: state.connectionId });
  };

  const save = async () => {
    if (!state.processKey) return;
    await api.saveProcess(state.processKey, state.doc, state.connectionId);
    dispatch({ type: "saved", key: state.processKey });
    setSaveMsg("saved just now");
    reloadReports();
  };

  const leave = async (view) => {
    if (state.dirty) await save();
    dispatch({ type: "close" });
    dispatch({ type: "view", view });
    reloadReports();
  };

    const publish = async () => {
    try {
      if (state.published) {
        await api.unpublish(state.processKey);
        dispatch({ type: "published", published: null });
        setSelectedRoles(new Set(ROLE_OPTIONS.map((r) => r.value)));
      } else {
        await save();
        const r = await api.publish(state.processKey, [...selectedRoles]);
        dispatch({ type: "published", published: r });
      }
      reloadReports();
    } catch (e) {
      dispatch({ type: "error", error: e.message });
    }
  };

  // Live already, and the designer is changing which roles see it (without a full
  // unpublish/republish round trip) — same endpoint, just called again with the new selection.
  const republishRoles = async () => {
    try {
      const r = await api.publish(state.processKey, [...selectedRoles]);
      dispatch({ type: "published", published: r });
      reloadReports();
    } catch (e) {
      dispatch({ type: "error", error: e.message });
    }
  };

  const editing = state.view === "editor";

    const EXPORT_EXT = { pdf: "pdf", pptx: "pptx", xlsx: "xlsx", table: "pdf" };
  const exportAs = async (fmt) => {
    if (!state.processKey) return;
    setExporting(fmt);
    try {
      const safe = (state.doc.name || "report").replace(/[^\w-]+/g, "-").toLowerCase();
      const suffix = fmt === "table" ? "-table" : "";
      await api.exportReport(state.processKey, fmt, state.filterState,
        `${safe}${suffix}.${EXPORT_EXT[fmt]}`);
    } catch (e) {
      dispatch({ type: "error", error: e.message });
    } finally {
      setExporting(null);
    }
  };
    const restoreDraft = () => {
    dispatch({ type: "loadDraft", doc: recoverable.doc });
    setRecoverable(null);
  };
  const discardDraft = () => {
    clearDraft(state.processKey);
    setRecoverable(null);
  };

  return (
    <div className="pane">
      <div className="wordmark"><b>NEXD</b><span>v14</span></div>

      <div className="pagebar">
        {editing ? (
          <>
            <button className="pb" onClick={() => leave("reports")}>Reports / Dashboards</button>
            <button className="pb" onClick={() => leave("settings")}>System Settings</button>
            <span className="pbsep" />
            <button className="pb" aria-pressed={state.mode === "design"}
              onClick={() => dispatch({ type: "mode", mode: "design" })}>Design</button>
            <button className="pb" aria-pressed={state.mode === "preview"}
              onClick={() => dispatch({ type: "mode", mode: "preview" })}>Preview</button>
            <button className="pb" onClick={save}>Save</button>
          <span className="pbsep" />
          <button className="pb" disabled={exporting === "pdf"} onClick={() => exportAs("pdf")}>
            {exporting === "pdf" ? "Preparing…" : "Download PDF"}
          </button>
          <button className="pb" disabled={exporting === "pptx"} onClick={() => exportAs("pptx")}>
            {exporting === "pptx" ? "Preparing…" : "PPT"}
          </button>
          <button
  className="pb"
  type="button"
  onClick={async () => {
    const email = window.prompt(
      "Enter the email address to send the report to:"
    );

    if (!email) return;

    try {
      const response = await fetch(
        `${API_BASE}/r/${slug}/email`,
        {
          method: "POST",
          headers: {
            "Content-Type": "application/json",
          },
          body: JSON.stringify({
            email: email.trim(),
            message: "",
          }),
        }
      );

      const data = await response.json();

      if (!response.ok) {
        throw new Error(data.error || "Failed to send report");
      }

      window.alert(`Report successfully emailed to ${email}`);

    } catch (error) {
      console.error("Email report error:", error);
      window.alert(error.message || "Failed to send report");
    }
  }}
>
  Email Report
</button>
          <button className="pb" disabled={exporting === "xlsx"} onClick={() => exportAs("xlsx")}>
            {exporting === "xlsx" ? "Preparing…" : "Excel"}
          </button>
          <button className="pb" disabled={exporting === "table"} onClick={() => exportAs("table")}>
            {exporting === "table" ? "Preparing…" : "Table"}
          </button>
          
          <span className="pbsep" />
          <details className="roledrop">
            <summary className="pb">Publish to &#9662;</summary>
            <div className="roledrop-panel">
              {ROLE_OPTIONS.map((r) => (
                <label key={r.value} className="roledrop-opt">
                  <input
                    type="checkbox"
                    checked={selectedRoles.has(r.value)}
                    onChange={() => toggleRole(r.value)}
                  />
                  {r.label}
                </label>
              ))}
            </div>
          </details>
          {state.published && (
            <button className="pb" disabled={selectedRoles.size === 0} onClick={republishRoles}>
              Update roles
            </button>
          )}
          <button className={`pb ${state.published ? "live" : "go"}`}
            disabled={!state.published && selectedRoles.size === 0} onClick={publish}>
            {state.published ? "Unpublish" : "Publish"}
          </button>
            <button className="pb" onClick={() => leave("reports")}>Close</button>
          </>
        ) : (
          <>
            <button className="pb go" onClick={newReport}>New</button>
            <button className="pb" aria-pressed={state.view === "reports"}
              onClick={() => dispatch({ type: "view", view: "reports" })}>Reports / Dashboards</button>
            <button className="pb" aria-pressed={state.view === "settings"}
              onClick={() => dispatch({ type: "view", view: "settings" })}>System Settings</button>
          </>
            
        )}
        <span className="espacer" />
        <span className="sstate">{state.busy ? "running…" : saveMsg}</span>
      </div>

                  {state.published && editing && (() => {
        const links = state.published.links || [];
        const current = links.find((l) => l.role === pubRole) || links[0];
        return (
          <div className="pubbar pubbar-multi">
            <b>Live — pinned to version {state.published.pinned_version}.</b>
            {current && (
              <div className="publink">
                <select value={pubRole} onChange={(e) => setPubRole(e.target.value)}>
                  {links.map((l) => (
                    <option key={l.role} value={l.role}>{l.role}</option>
                  ))}
                </select>
                <code>{window.location.origin + fullPublicUrl(current.url)}</code>
                <a className="prim" href={fullPublicUrl(current.url)} target="_blank" rel="noopener noreferrer">
                  Open
                </a>
              </div>
            )}
          </div>
        );
      })()}

      {state.error && <div className="fx bad" style={{ marginBottom: 14 }}>{state.error}</div>}

      {state.view === "reports" && (
        <Reports onOpen={openReport} onNew={newReport} reload={reloadReports} />
      )}
      {state.view === "settings" && <Settings reloadCatalog={reloadCatalog} />}
      {editing && <Canvas />}

      {state.notice && (
        <div className="toast" onAnimationEnd={() => dispatch({ type: "notice", notice: null })}>
          {state.notice}
        </div>
      )}
    </div>
  );
}

function Login({ onDone }) {
  const [username, setUsername] = React.useState("");
  const [password, setPassword] = React.useState("");
  const [error, setError] = React.useState("");

  const submit = async () => {
    try {
      const r = await api.login(username, password);
      setToken(r.token);
      onDone();
    } catch (e) { setError(e.message); }
  };

  return (
    <div className="pane" style={{ maxWidth: 420, paddingTop: 80 }}>
      <div className="wordmark"><b>NEXD</b><span>v14</span></div>
      <section className="hcard">
        <header><h2>Sign in</h2></header>
        <div style={{ padding: "18px 20px" }}>
          <div className="fld">
            <label>Username</label>
            <input value={username} autoFocus
              onChange={(e) => setUsername(e.target.value)}
              onKeyDown={(e) => e.key === "Enter" && submit()} />
          </div>
          <div className="fld">
            <label>Password</label>
            <input type="password" value={password}
              onChange={(e) => setPassword(e.target.value)}
              onKeyDown={(e) => e.key === "Enter" && submit()} />
          </div>
          {error && <div className="fx bad">{error}</div>}
          <button className="pb go" style={{ width: "100%", marginTop: 12 }} onClick={submit}>
            Sign in
          </button>
        </div>
      </section>
    </div>
  );
}
