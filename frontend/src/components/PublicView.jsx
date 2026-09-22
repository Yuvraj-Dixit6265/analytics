/* PublicView.jsx — what a published link actually opens.

   No login, no editor chrome. It fetches the definition for this one link
   (already trimmed server-side to whatever role this link belongs to),
   drops it into the same store/Canvas the editor's Preview tab uses, and
   re-runs the boxes whenever a filter changes — against the public,
   role-scoped execute endpoint, never the authenticated one. */

import React from "react";
import api from "../api.js";
import { StoreProvider, useStore } from "../store.jsx";
import Canvas from "./Canvas.jsx";

/* If one box's rendering throws for any reason, this stops it from taking
   the whole published page down to a blank white screen — the person
   sharing this link gets a message instead of nothing at all. */
class Boundary extends React.Component {
  constructor(props) { super(props); this.state = { error: null }; }
  static getDerivedStateFromError(error) { return { error }; }
  render() {
    if (this.state.error) {
      return (
        <div className="pane" style={{ maxWidth: 520, paddingTop: 100, textAlign: "center" }}>
          <div className="wordmark" style={{ justifyContent: "center" }}><b>NEXD</b></div>
          <p style={{ color: "var(--muted)", marginTop: 18 }}>
            Something on this dashboard couldn't be shown.
          </p>
          <p className="fx bad" style={{ display: "inline-block", textAlign: "left" }}>
            {String(this.state.error.message || this.state.error)}
          </p>
        </div>
      );
    }
    return this.props.children;
  }
}

export default function PublicView({ slug }) {
  return (
    <StoreProvider>
      <Boundary>
        <PublicShell slug={slug} />
      </Boundary>
    </StoreProvider>
  );
}

function PublicShell({ slug }) {
  const { state, dispatch } = useStore();
  const [role, setRole] = React.useState(null);
  const [loaded, setLoaded] = React.useState(false);
  const [loadErr, setLoadErr] = React.useState(null);
  const [exporting, setExporting] = React.useState(null);

  const exportAs = async (fmt) => {
    setExporting(fmt);
    try {
      const safe = (state.doc.name || "report").replace(/[^\w-]+/g, "-").toLowerCase();
      await api.publicExport(slug, fmt, state.filterState, `${safe}.${fmt}`);
    } catch (e) {
      dispatch({ type: "error", error: e.message });
    } finally {
      setExporting(null);
    }
  };

  React.useEffect(() => {
    let alive = true;
    (async () => {
      try {
        const r = await api.publicDefinition(slug);
        if (!alive) return;
        setRole(r.role);
        dispatch({ type: "open", doc: r.definition, key: null, connectionId: null, publicSlug: slug });
        dispatch({ type: "mode", mode: "preview" });
        setLoaded(true);
      } catch (e) {
        if (alive) setLoadErr(e.message || "this link is not live");
      }
    })();
    return () => { alive = false; };
  }, [slug]);

  React.useEffect(() => {
    if (!loaded) return undefined;
    const ctrl = new AbortController();
    const t = setTimeout(async () => {
      dispatch({ type: "busy", busy: true });
      try {
        const r = await api.publicExecute(slug, state.filterState, ctrl.signal);
        dispatch({ type: "results", results: r.results || {} });
        dispatch({ type: "error", error: null });
      } catch (e) {
        if (e.name !== "AbortError") dispatch({ type: "error", error: e.message });
      } finally {
        dispatch({ type: "busy", busy: false });
      }
    }, 350);
    return () => { clearTimeout(t); ctrl.abort(); };
  }, [loaded, slug, JSON.stringify(state.doc), JSON.stringify(state.filterState)]);

  if (loadErr) {
    return (
      <div className="pane" style={{ maxWidth: 480, paddingTop: 100, textAlign: "center" }}>
        <div className="wordmark" style={{ justifyContent: "center" }}><b>NEXD</b></div>
        <p style={{ color: "var(--muted)", marginTop: 18 }}>{loadErr}</p>
      </div>
    );
  }
  if (!loaded) {
    return (
      <div className="pane" style={{ paddingTop: 100, textAlign: "center", color: "var(--muted)" }}>
        Loading…
      </div>
    );
  }

  return (
    <div className="pane">
            <div className="pagebar">
        <span className="espacer" />
        <button className="pb" disabled={exporting === "pdf"} onClick={() => exportAs("pdf")}>
          {exporting === "pdf" ? "Preparing…" : "Download PDF"}
        </button>
        <button className="pb" disabled={exporting === "pptx"} onClick={() => exportAs("pptx")}>
          {exporting === "pptx" ? "Preparing…" : "PPT"}
        </button>
      </div>
      {state.error && <div className="fx bad" style={{ marginBottom: 14 }}>{state.error}</div>}
      <Canvas />
    </div>
  );
}