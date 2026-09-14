/* Views.jsx — the two non-editor views: the report list, and system settings. */

import React from "react";
import api from "../api.js";
import { useStore } from "../store.jsx";
import { Check, Field, Hint, Row, Select, Text, Toggles } from "./Panels.jsx";

const whenTxt = (t) => {
  if (!t) return "never saved";

  const d = (Date.now() - new Date(t).getTime()) / 1000;

  if (d < 60) return "just now";
  if (d < 3600) return `${Math.floor(d / 60)} min ago`;
  if (d < 86400) return `${Math.floor(d / 3600)} hr ago`;

  return new Date(t).toLocaleDateString();
};

/* ---------------- reports ---------------- */

export function Reports({ onOpen, onNew, onGenerate, reload }) {
  const { state, dispatch } = useStore();
  const [pendingDel, setPendingDel] = React.useState(null);
  const [aiPrompt, setAiPrompt] = React.useState("");
  const [aiBusy, setAiBusy] = React.useState(false);
  const [aiError, setAiError] = React.useState("");

  const runGenerate = async () => {
    if (!aiPrompt.trim() || aiBusy) return;
    setAiBusy(true);
    setAiError("");
    try {
      await onGenerate(aiPrompt.trim());
      setAiPrompt("");
    } catch (e) {
      setAiError(e.message);
    } finally {
      setAiBusy(false);
    }
  };

  const rename = async (r, name) => {
    if (!name.trim() || name === r.name) return;

    try {
      const full = await api.process(r.process_key);

      await api.saveProcess(
        r.process_key,
        { ...full.definition, name },
        full.connection_id
      );

      reload();
    } catch (e) {
      dispatch({ type: "error", error: e.message });
    }
  };

  /* Duplicate an existing report/dashboard */
  const duplicate = async (r) => {
    try {
      const full = await api.process(r.process_key);

      const definition = {
        ...full.definition,
        name: `${r.name} (Copy)`,
      };

      await api.createProcess(definition, full.connection_id);

      reload();
    } catch (e) {
      dispatch({ type: "error", error: e.message });
    }
  };

  /* Export the report definition as a .nexd.json file */
  const exportReport = async (r) => {
    try {
      const full = await api.process(r.process_key);

      const blob = new Blob(
        [JSON.stringify(full.definition, null, 2)],
        { type: "application/json" }
      );
      

      const url = URL.createObjectURL(blob);
      const a = document.createElement("a");

      a.href = url;
      a.download =
        `${r.name.replace(/[^a-z0-9]+/gi, "-").toLowerCase()}.nexd.json`;

      document.body.appendChild(a);
      a.click();
      a.remove();

      URL.revokeObjectURL(url);
    } catch (e) {
      dispatch({ type: "error", error: e.message });
    }
  };
  
  return (
    <section className="hcard" id="vReports">
      <header>
        <h2>Reports &amp; dashboards</h2>
      </header>

      <div style={{ padding: "14px 18px", borderBottom: "1px solid var(--line-soft)" }}>
        <div className="fld" style={{ marginBottom: 8 }}>
          <textarea
            rows={2}
            value={aiPrompt}
            disabled={aiBusy}
            onChange={(e) => setAiPrompt(e.target.value)}
            placeholder='Describe a report — e.g. "total sales and open invoices as boxes, a table of the top 10 vendors by spend, and a bar chart of monthly sales, filterable by status and date"'
          />
        </div>
        <button className="pb go" disabled={aiBusy || !aiPrompt.trim()} onClick={runGenerate}>
          {aiBusy ? "Generating…" : "Generate with AI"}
        </button>
        {aiError && <div className="fx bad" style={{ marginTop: 8 }}>{aiError}</div>}
      </div>

      <div id="repList">
        {!state.reports.length && (
          <div className="nothing">
            Nothing here yet.
            <br />
            <br />

            <button className="pb go" onClick={onNew}>
              New
            </button>
          </div>
        )}

        {state.reports.map((r) =>
          pendingDel === r.process_key ? (
            <div className="ritem" key={r.process_key}>
              <div className="rmain">
                <div className="rname">
                  Delete “{r.name}”?
                </div>

                <div className="rmeta">
                  This cannot be undone.
                </div>
              </div>

              <div className="racts">
                <button
                  className="sbtn warn"
                  onClick={async () => {
                    await api.deleteProcess(r.process_key);
                    setPendingDel(null);
                    reload();
                  }}
                >
                  Yes, delete
                </button>

                <button
                  className="sbtn"
                  onClick={() => setPendingDel(null)}
                >
                  Keep it
                </button>
              </div>
            </div>
          ) : (
            <div className="ritem" key={r.process_key}>
              <div className="rmain">
                <div>
                  <span
                    className="rname"
                    contentEditable
                    suppressContentEditableWarning
                    onBlur={(e) =>
                      rename(r, e.currentTarget.textContent)
                    }
                    onKeyDown={(e) => {
                      if (e.key === "Enter") {
                        e.preventDefault();
                        e.currentTarget.blur();
                      }
                    }}
                  >
                    {r.name}
                  </span>

                  <span
                    className={`pill${r.published ? " on" : ""}`}
                  >
                    {r.published ? "published" : "draft"}
                  </span>
                </div>

                <div className="rmeta">
                  v{r.version} · {whenTxt(r.updated_at)}
                </div>
              </div>

              <div className="racts">
                <button
                  className="sbtn"
                  onClick={() => onOpen(r.process_key)}
                >
                  Edit
                </button>
                

                <button
                  className="sbtn"
                  onClick={() => duplicate(r)}
                >
                  Duplicate
                </button>

                <button
                  className="sbtn"
                  onClick={() => exportReport(r)}
                >
                  Export
                </button>

                <button
                  className="sbtn warn"
                  onClick={() => setPendingDel(r.process_key)}
                >
                  Delete
                </button>
              </div>
            </div>
          )
        )}
      </div>
    </section>
  );
}

/* ---------------- system settings ---------------- */

export function Settings({ reloadCatalog }) {
  const { state, dispatch } = useStore();

  /*
   * open can contain:
   * - connection id       -> connection editor is open
   * - "table:<name>"      -> table columns are open
   */
  const [open, setOpen] = React.useState(null);
  const [pendingDel, setPendingDel] = React.useState(null);
  const [draft, setDraft] = React.useState({});

  const load = React.useCallback(async () => {
    try {
      dispatch({
        type: "connections",
        connections: await api.connections(),
      });
    } catch (e) {
      dispatch({ type: "error", error: e.message });
    }
  }, [dispatch]);

  React.useEffect(() => {
    load();
  }, [load]);

  const add = async () => {
    const c = await api.createConnection({
      name: "New connection",
      engine: "mysql",
      host: "localhost",
      port: 3306,
      database: "",
      username: "",
      password: "",
    });

    await load();
    setOpen(c.id);
  };

  const save = async (c, patch) => {
    try {
      await api.updateConnection(c.id, patch);
      await load();
      reloadCatalog();
    } catch (e) {
      dispatch({ type: "error", error: e.message });
    }
  };

  return (
    <section className="hcard" id="vSettings">
      <header>
        <h2>System settings</h2>

        <button className="prim ghost" onClick={add}>
          + Connection
        </button>
      </header>

      <div id="connList">
        {!state.connections.length && (
          <div className="nothing">
            No database connected.
            <br />
            <br />

            <button className="prim ghost" onClick={add}>
              + Add a connection
            </button>
          </div>
        )}

        {state.connections.map((c) =>
          pendingDel === c.id ? (
            <div className="conn" key={c.id}>
              <div className="conn-top">
                <div className="conn-nm">
                  Delete “{c.name}”?
                </div>

                <button
                  className="sbtn warn"
                  onClick={async () => {
                    await api.deleteConnection(c.id);
                    setPendingDel(null);
                    await load();
                  }}
                >
                  Yes, delete
                </button>

                <button
                  className="sbtn"
                  onClick={() => setPendingDel(null)}
                >
                  Keep it
                </button>
              </div>
            </div>
          ) : (
            <div className="conn" key={c.id}>
              <div
                className="conn-top"
                onClick={() =>
                  setOpen(open === c.id ? null : c.id)
                }
              >
                <span
                  className={`dot ${
                    c.status === "ok"
                      ? "ok"
                      : c.status === "bad"
                        ? "bad"
                        : "warn"
                  }`}
                />

                <span className="conn-nm">
                  {c.name}
                </span>

                <span className="conn-sub">
                  {c.engine} · {c.host}:{c.port}/{c.database_name}
                </span>

                <span className="sbtn">
                  {open === c.id ? "Close" : "Edit"}
                </span>
              </div>

              {open === c.id && (
                <div className="conn-body">
                  <Row>
                    <Field label="Name">
                      <Text
                        value={c.name}
                        onChange={(v) =>
                          save(c, { name: v })
                        }
                      />
                    </Field>

                    <Field label="Engine">
                      <Select
                        value={c.engine}
                        onChange={(v) =>
                          save(c, { engine: v })
                        }
                        options={[
                          ["mysql", "MySQL / MariaDB"],
                          ["postgres", "PostgreSQL"],
                          ["mssql", "SQL Server"],
                          ["oracle", "Oracle"],
                        ]}
                      />
                    </Field>
                  </Row>

                  <Row>
                    <Field label="Host">
                      <Text
                        value={c.host}
                        onChange={(v) =>
                          save(c, { host: v })
                        }
                      />
                    </Field>

                    <Field label="Port">
                      <Text
                        type="number"
                        value={c.port}
                        onChange={(v) =>
                          save(c, { port: v })
                        }
                      />
                    </Field>

                    <Field label="Database">
                      <Text
                        value={c.database_name}
                        onChange={(v) =>
                          save(c, { database: v })
                        }
                      />
                    </Field>
                  </Row>

                  <Row>
                    <Field label="Username">
                      <Text
                        value={c.username}
                        onChange={(v) =>
                          save(c, { username: v })
                        }
                      />
                    </Field>

                    <Field label="Password">
                      <input
                        type="password"
                        placeholder="••••••••"
                        value={draft[c.id] ?? ""}
                        onChange={(e) =>
                          setDraft({
                            ...draft,
                            [c.id]: e.target.value,
                          })
                        }
                        onBlur={() => {
                          if (draft[c.id]) {
                            save(c, {
                              password: draft[c.id],
                            });

                            setDraft({
                              ...draft,
                              [c.id]: "",
                            });
                          }
                        }}
                      />
                    </Field>
                  </Row>

                  <Toggles>
                    <Check
                      on={!!c.use_ssl}
                      label="Require SSL"
                      onChange={(v) =>
                        save(c, { ssl: v })
                      }
                    />
                  </Toggles>

                  {c.status_note && (
                    <div
                      className={`fx ${
                        c.status === "ok" ? "ok" : "bad"
                      }`}
                    >
                      {c.status_note}
                    </div>
                  )}

                  <Hint>
                    The password is Fernet-encrypted before it is
                    stored, and report queries run through a
                    read-only account inside a read-only transaction.
                  </Hint>

                  <div
                    style={{
                      display: "flex",
                      gap: 7,
                      flexWrap: "wrap",
                      marginTop: 10,
                    }}
                  >
                    <button
                      className="sbtn"
                      onClick={async () => {
                        const r =
                          await api.testConnection(c.id);

                        dispatch({
                          type: "notice",
                          notice: r.ok
                            ? "Connected."
                            : r.note,
                        });

                        await load();
                        reloadCatalog();
                      }}
                    >
                      Test connection
                    </button>

                    <button
                      className="sbtn warn"
                      onClick={() =>
                        setPendingDel(c.id)
                      }
                    >
                      Delete connection
                    </button>
                  </div>
                </div>
              )}
            </div>
          )
        )}
      </div>

      {/* ---------------- tables & columns ---------------- */}

      <div className="defs">
        <div
          className="grp"
          style={{
            marginTop: 0,
            paddingTop: 0,
            border: "none",
          }}
        >
          Tables &amp; columns
        </div>

        {state.catalog.tables.length ? (
          <>
            <Hint>
              Read live from{" "}
              <span className="mono">
                INFORMATION_SCHEMA
              </span>
              . This is also the allowlist every generated query
              is checked against.
            </Hint>

            <div
              className="collist"
              style={{ marginTop: 8 }}
            >
              {state.catalog.tables.map((t) => {
                const tableKey = `table:${t.name}`;
                const tableOpen = open === tableKey;

                return (
                  <React.Fragment key={t.name}>
                    {/* Table row */}
                    <div
                      className="colrow"
                      style={{
                        gridTemplateColumns:
                          "1fr auto auto",
                        cursor: "pointer",
                      }}
                      onClick={() =>
                        setOpen(
                          tableOpen
                            ? null
                            : tableKey
                        )
                      }
                    >
                      <span className="mono">
                        {t.name}
                      </span>

                      <span className="conn-sub">
                        {t.columns.length} columns
                      </span>

                      <button
                        type="button"
                        className="sbtn"
                        onClick={(e) => {
                          e.stopPropagation();

                          setOpen(
                            tableOpen
                              ? null
                              : tableKey
                          );
                        }}
                      >
                        {tableOpen ? "Close" : "Edit"}
                      </button>
                    </div>

                    {/* Expanded table */}
                    {tableOpen && (
                      <div
                        style={{
                          border: "1px solid var(--line, #d9e0de)",
                          borderTop: "none",
                          padding: "12px",
                          background: "#fff",
                        }}
                      >
                        <div
                          className="grp"
                          style={{
                            marginTop: 0,
                            paddingTop: 0,
                          }}
                        >
                          Columns
                        </div>

                        <div
                          className="collist"
                          style={{ marginTop: 8 }}
                        >
                          {t.columns.map((c) => (
                            <div
                              className="colrow"
                              key={c.name}
                              style={{
                                gridTemplateColumns:
                                  "1fr auto",
                              }}
                            >
                              <span className="mono">
                                {c.name}
                              </span>

                              <span className="conn-sub">
                                {c.type ||
                                  c.data_type ||
                                  "unknown"}
                              </span>
                            </div>
                          ))}
                        </div>

                        <Hint>
                          These columns are read directly from the
                          live database through{" "}
                          <span className="mono">
                            INFORMATION_SCHEMA
                          </span>
                          . They are used as the allowlist for
                          generated queries.
                        </Hint>
                      </div>
                    )}
                  </React.Fragment>
                );
              })}
            </div>
          </>
        ) : (
          <Hint>
            Nothing yet — connect a database above and press{" "}
            <b>Test connection</b>.
          </Hint>
        )}
      </div>
    </section>
  );
}