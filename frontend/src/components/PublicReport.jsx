import React from "react";
import { StoreProvider, useStore } from "../store.jsx";
import { normS, styleObj, frameStyle, fmtCell, fmtNumber } from "../model.js";
import Chart from "../charts/Chart.jsx";
import api from "../api.js";

const API_BASE = import.meta.env.VITE_API_BASE || "/api";

async function getPublishedReport(slug) {
  const res = await fetch(`${API_BASE}/r/${encodeURIComponent(slug)}`);

  const text = await res.text();

  let data;
  try {
    data = text ? JSON.parse(text) : {};
  } catch {
    throw new Error("Published report returned invalid JSON");
  }

  if (!res.ok) {
    throw new Error(data.error || `${res.status} ${res.statusText}`);
  }

  return data;
}

async function executePublished(slug, definition, filters = {}) {
  const res = await fetch(`${API_BASE}/r/${encodeURIComponent(slug)}/execute`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
    },
    body: JSON.stringify({
  filters,
}),
  });

  const text = await res.text();

  let data;
  try {
    data = text ? JSON.parse(text) : {};
  } catch {
    throw new Error("Published report execution returned invalid JSON");
  }

  if (!res.ok) {
    throw new Error(data.error || `${res.status} ${res.statusText}`);
  }

  return data;
}

export default function PublicReport() {
  const slug = window.location.pathname.split("/r/")[1];

  return (
    <StoreProvider>
      <PublicReportInner slug={decodeURIComponent(slug || "")} />
    </StoreProvider>
  );
}

// frontend/src/components/PublicReport.jsx

function PublicReportInner({ slug }) {
  const { state, dispatch } = useStore();
  const [publicKey, publicToken] = slug.split("/");
  const [loading, setLoading] = React.useState(true);
  const [error, setError] = React.useState(null);

  React.useEffect(() => {
    let cancelled = false;

    async function load() {
      try {
        setLoading(true);
        setError(null);

        const report = await getPublishedReport(slug);

        if (cancelled) return;

        dispatch({
          type: "open",
          doc: report.definition,
          key: report.process_key,
          connectionId: report.connection_id || null,
        });

        dispatch({
          type: "mode",
          mode: "preview",
        });

        try {
          const result = await executePublished(slug, report.definition);

          if (!cancelled) {
            dispatch({
              type: "results",
              results: result.results || {},
            });
          }
        } catch (executeError) {
          if (!cancelled) setError(executeError.message);
        }
      } catch (e) {
        if (!cancelled) setError(e.message);
      } finally {
        if (!cancelled) setLoading(false);
      }
    }

    load();

    return () => {
      cancelled = true;
    };
  }, [slug, dispatch]);

  if (loading) {
    return (
      <div className="pane">
        <div className="hcard">
          <div style={{ padding: 30 }}>Loading dashboard...</div>
        </div>
      </div>
    );
  }

  if (error) {
    return (
      <div className="pane">
        <div className="hcard">
          <div style={{ padding: 30 }}>
            <h2>Unable to load dashboard</h2>
            <div className="fx bad">{error}</div>
          </div>
        </div>
      </div>
    );
  }

  return (
    <div className="pane public-report">

      {/* ONLY download options for employees */}
      <div
  className="export-actions"
  style={{
    display: "flex",
    justifyContent: "flex-end",
    gap: 10,
    marginBottom: 16,
  }}
>
  <a
    className="pb go"
    href={`${API_BASE}/r/${slug}/export/pdf`}
  >
    Download PDF
  </a>

  <a
    className="pb"
    href={`${API_BASE}/r/${slug}/export/pptx`}
  >
    Download PPT
  </a>
  <div
  style={{
    display: "flex",
    justifyContent: "flex-end",
    gap: 10,
    marginBottom: 16,
  }}
>
  <a
    className="pb go"
    href={`${API_BASE}/r/${slug}/export/pdf`}
  >
    Download PDF
  </a>

  <a
    className="pb"
    href={`${API_BASE}/r/${slug}/export/pptx`}
  >
    Download PPT
  </a>

 <button
  className="pb"
  type="button"
  onClick={async () => {
    const email = window.prompt(
      "Enter the email address to send the report to:"
    );

    if (!email) {
      return;
    }

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
        throw new Error(
          data.error || "Failed to send report"
        );
      }

      window.alert(
        `Report successfully emailed to ${email}`
      );

    } catch (error) {
      console.error(
        "Email report error:",
        error
      );

      window.alert(
        error.message || "Failed to send report"
      );
    }
  }}
>
  Email Report
</button>
</div>
</div>

      {/* Published report - read only */}
      <PublicCanvas doc={state.doc} />
    </div>
  );
}

function PublicCanvas({ doc }) {
  return (
    <div className="sheet">
      <div
        className="rep-name-wrap"
        style={
          normS(doc.nameStyle).align
            ? { textAlign: normS(doc.nameStyle).align }
            : undefined
        }
      >
        <div
          className="rep-name"
          style={styleObj(normS(doc.nameStyle))}
        >
          {doc.name}
        </div>
      </div>
      {doc.sections?.length > 0 && (
        <div className="section-nav">
          {doc.sections
            .filter((section) => section.visible !== false)
            .map((section) => (
              <button
                key={section.id}
                type="button"
                className="section-nav-item TEST-BUTTON" data-test-nav="yes"
                onClick={() => {
                  const el = document.getElementById(`section-${section.id}`);

                  if (el) {
                    const y = el.getBoundingClientRect().top + window.scrollY;

                    window.scrollTo({
                      top: y,
                      behavior: "smooth",
                    });
                  }
                }}
              >
                {section.name || "Untitled Section"}
              </button>
            ))}
        </div>
      )}
      {doc.sections.map((section, index) => (
        <PublicSection
          key={section.id}
          section={section}
          index={index + 1}
        />
      ))}
    </div>
  );
}

function PublicSection({ section, index }) {
  if (section.visible === false) return null;

  const cols = Math.max(
    1,
    Math.min(12, Number(section.cols) || 4)
  );

  const nst = normS(section.style);
  const dst = normS(section.descStyle);

  const nameVisible = section.nameVisible !== false;
  const subVisible = section.subVisible !== false;

  const ruleStyle = {
    ...(nst.color ? { background: nst.color } : {}),
    ...(nst.align === "center"
      ? { marginLeft: "auto", marginRight: "auto" }
      : nst.align === "right"
      ? { marginLeft: "auto" }
      : {}),
  };

  return (
  <div
  className="sec"
  id={`section-${section.id}`}
  >
      {nameVisible && (
        <>
          <div
            className="sec-head"
            style={
              nst.align
                ? {
                    justifyContent:
                      nst.align === "center"
                        ? "center"
                        : nst.align === "right"
                        ? "flex-end"
                        : "flex-start",
                  }
                : undefined
            }
          >
            <div
              className="sec-name"
              style={styleObj(nst)}
            >
              {section.name}
            </div>
          </div>

          {section.rule !== false && (
            <div
              className="sec-rule"
              style={ruleStyle}
            />
          )}
        </>
      )}

      {subVisible && (
        <div
          className="sec-desc"
          style={styleObj(dst)}
        >
          {section.desc}
        </div>
      )}

      <div
        className="grid"
        style={{
          gridTemplateColumns: `repeat(${cols}, minmax(0, 1fr))`,
          breakInside: "auto",
        }}
      >
        {section.boxes
          .filter((box) => box.visible !== false)
          .map((box) => (
            <PublicBox
              key={box.id}
              box={box}
              cols={cols}
              publicKey={publicKey}
              publicToken={publicToken}
            />
          ))}
      </div>
    </div>
  );
}

function PublicBox({
  box,
  cols,
  publicKey,
  publicToken,
}) {
  const span = Math.max(
    1,
    Math.min(cols, box.span || 1)
  );

  return (
    <div
      className={`box${box.frame?.on ? " framed" : ""}`}
      style={{
        gridColumn: `span ${span}`,
        ...(box.style?.bg
          ? { background: box.style.bg }
          : {}),
        ...(box.style?.align
          ? { textAlign: box.style.align }
          : {}),
        ...frameStyle(box.frame),
      }}
    >
      {box.titleVisible !== false && (
        <div
          className="box-title"
          style={styleObj(normS(box.titleStyle))}
        >
          {box.title}
        </div>
      )}

      <div style={styleObj(box.style, { bg: true, align: true })}>
        <PublicBoxBody
          box={box}
          publicKey={publicKey}
          publicToken={publicToken}
        />
      </div>
    </div>
  );
}

function PublicBoxBody({
  box,
  publicKey,
  publicToken,
}) {
  const { state } = useStore();

  const [detailItems, setDetailItems] = React.useState(null);
  const [detailValue, setDetailValue] = React.useState("");
  const [detailLoading, setDetailLoading] = React.useState(false);
  const result = state.results[box.id];
  const locale = state.doc.numberFormat;

  if (box.kind === "note") {
    return (
      <div
        className="note-body"
        dangerouslySetInnerHTML={{
          __html: box.note?.html || "",
        }}
      />
    );
  }

  if (box.kind === "value") {
    if (result?.error) {
      return (
        <div className="ph">
          <b>Formula problem</b>
          <span>{result.error}</span>
        </div>
      );
    }

    const v = result?.value;

    return (
      <>
        <div
          className="kpi"
          style={{ color: box.value?.tone || "#1A2326" }}
        >
          {box.value?.prefix || ""}
          {v === null || v === undefined
            ? "—"
            : formatNumber(
                v,
                box.value?.decimals,
                locale
              )}
          {box.value?.suffix || ""}
          {box.value?.unit && (
            <span className="kpi-unit">
              {box.value.unit}
            </span>
          )}
        </div>

        {box.value?.note && (
          <div className="kpi-note">
            {box.value.note}
          </div>
        )}
      </>
    );
  }

  if (box.kind === "chart") {
  const c = box.chart || {};

  let data = result?.data || [];

  if (c.source === "table" && c.tableBoxId) {
    const tableBox = state.doc.sections
      .flatMap((section) => section.boxes || [])
      .find((b) => b.id === c.tableBoxId);

    if (tableBox) {
      const categoryId =
        c.tableCategoryColumnId;

      const valueId =
        c.tableValueColumnId;

      if (tableBox.tableMode === "manual") {
        const columns =
          tableBox.manualTable?.columns || [];

        const categoryIndex =
          columns.findIndex(
            (col) => col.id === categoryId
          );

        const valueIndex =
          columns.findIndex(
            (col) => col.id === valueId
          );

        if (
          categoryIndex >= 0 &&
          valueIndex >= 0
        ) {
          data = (
            tableBox.manualTable?.rows || []
          )
            .map((row) => ({
              label:
                row.cells?.[categoryIndex] || "",
              value:
                Number(
                  row.cells?.[valueIndex]
                ) || 0,
            }))
            .filter(
              (row) => row.label !== ""
            );
        }
      } else {
        const columns =
          tableBox.table?.columns || [];

        const categoryColumn =
          columns.find(
            (col) => col.col === categoryId
          );

        const valueColumn =
          columns.find(
            (col) => col.col === valueId
          );

        const tableResult =
          state.results[tableBox.id];

        if (
          categoryColumn &&
          valueColumn &&
          tableResult?.rows
        ) {
          data = tableResult.rows
            .map((row) => ({
              label:
                row[categoryColumn.col] ?? "",
              value:
                Number(
                  row[valueColumn.col]
                ) || 0,
            }))
            .filter(
              (row) => row.label !== ""
            );
        }
      }
    }
  }

  if (!data.length) {
    return (
      <div className="ph">
        <b>No data</b>
      </div>
    );
  }

  return (
    <div className="chartwrap">
      <div className="chartsvg">
        <Chart
          data={data}
          cfg={box.chart}
        />
      </div>
    </div>
  );
}

  // Manual Table: data is stored directly in the box definition,
  // so it does not come from state.results.
  if (box.tableMode === "manual") {
    const manual = box.manualTable || {};
    const columns = manual.columns || [];
    const rows = manual.rows || [];

    if (!columns.length) {
      return (
        <div className="empty">
          No columns configured.
        </div>
      );
    }

    return (
      <table className="rt">
        <thead>
          <tr>
            {columns.map((col) => (
              <th
                key={col.id}
                style={styleObj(normS(manual.headStyle))}
              >
                {col.label || "Column"}
              </th>
            ))}
          </tr>
        </thead>

        <tbody>
          {rows.map((row, rowIndex) => (
            <tr
              key={row.id || rowIndex}
              className={
                manual.zebra && rowIndex % 2
                  ? "z"
                  : undefined
              }
            >
              {columns.map((col, colIndex) => (
                <td key={col.id}>
                  {row.cells?.[colIndex] || ""}
                </td>
              ))}
            </tr>
          ))}
        </tbody>
      </table>
    );
  }

  // Existing Data Table
  const columns = (box.table?.columns || []).filter(
    (x) => x.on
  );

  const rows = result?.rows || [];
  const detail = box.table?.detail || {};

  if (!columns.length) {
    return (
      <div className="empty">
        No columns selected.
      </div>
    );
  }

  const clickable =
    detail.enabled &&
    detail.keyColumn &&
    columns.find(
      (col) =>
        String(col.col) === String(detail.keyColumn)
    );

  return (
    <table className="rt">
      <thead>
        <tr>
          {columns.map((col) => (
            <th
              key={col.col}
              className={
                col.align === "right" ? "num" : undefined
              }
            >
              {col.label || col.col}
            </th>
          ))}
        </tr>
      </thead>

      <tbody>
        {rows.map((row, rowIndex) => {
          const rowDetailValue = clickable
            ? row[clickable.col]
            : null;

          const isSelected =
            rowDetailValue != null &&
            String(detailValue) ===
              String(rowDetailValue) &&
            detailItems !== null;

          return (
            <React.Fragment key={rowIndex}>
              <tr>
                {columns.map((col) => {
                  const value =
                    row[col.col] ??
                    row[col.col?.split(".").pop()];

                  const isClickable =
                    detail.enabled &&
                    detail.keyColumn &&
                    String(col.col) ===
                      String(detail.keyColumn) &&
                    value != null;

                  return (
                    <td
                      key={col.col}
                      className={
                        col.align === "right"
                          ? "num"
                          : undefined
                      }
                    >
                      {isClickable ? (
                        <button
                          type="button"
                          className="pr-link"
                          onClick={async () => {
                            const clickedValue =
                              String(value);

                            setDetailValue(
                              clickedValue
                            );
                            setDetailItems([]);
                            setDetailLoading(true);

                            try {
                                const params = new URLSearchParams({
                                  parentTable: box?.src?.base || "",
                                  lookupColumn: detail.keyColumn,
                                  value: clickedValue,
                                  detailColumns: (detail.columns || [])
                                    .map((col) => col.col)
                                    .filter(Boolean)
                                    .join(","),
                                  limit: String(detail.limit || 20),
                                });

                                console.log("PUBLIC DETAIL REQUEST", {
                                  key,
                                  token,
                                  parentTable: box?.src?.base || "",
                                  lookupColumn: detail.keyColumn,
                                  value: clickedValue,
                                  detailColumns: (detail.columns || [])
                                    .map((col) => col.col)
                                    .filter(Boolean),
                                });
                                console.log(
                                  " PUBLIC DETAIL URL",
                                  `${API_BASE}/r/${encodeURIComponent(key)}/${encodeURIComponent(token)}/detail?${params.toString()}`
                                );
                                const res = await fetch(
                                  `${API_BASE}/r/${encodeURIComponent(key)}/${encodeURIComponent(token)}/detail?${params.toString()}`
                                );  

                                if (!res.ok) {
                                  throw new Error("Could not load detail rows");
                                }

                                const data = await res.json();

                                console.log("PUBLIC DETAIL DATA", data);

                                setDetailItems(data.rows || []);
                              } catch (err) {
                              console.error(
                                "Could not load detail rows:",
                                err
                              );
                              setDetailItems([]);
                            } finally {
                              setDetailLoading(false);
                            }
                          }}
                        >
                          {fmtCell(
                            value,
                            col.fmt,
                            locale
                          )}
                        </button>
                      ) : (
                        fmtCell(
                          value,
                          col.fmt,
                          locale
                        )
                      )}
                    </td>
                  );
                })}
              </tr>

              {isSelected && (
                <tr>
                  <td colSpan={columns.length}>
                    <div className="pr-inline">
                      <div className="pr-inline-header">
                        <strong>
                          {detail.title || "Details"} —{" "}
                          {detailValue}
                        </strong>

                        <button
                          type="button"
                          onClick={() => {
                            setDetailItems(null);
                            setDetailValue("");
                          }}
                        >
                          ×
                        </button>
                      </div>

                      {detailLoading ? (
                        <div className="pr-empty">
                          Loading details...
                        </div>
                      ) : detailItems.length === 0 ? (
                        <div className="pr-empty">
                          No detail records found.
                        </div>
                      ) : (
                        <div className="pr-items-table-wrap">
                          <table className="rt pr-items-table">
                            <thead>
                              <tr>
                                {(detail.columns || [])
                                  .filter(
                                    (col) => col.col
                                  )
                                  .map((col) => (
                                    <th key={col.col}>
                                      {col.label ||
                                        col.col}
                                    </th>
                                  ))}
                              </tr>
                            </thead>

                            <tbody>
                              {detailItems.map(
                                (
                                  item,
                                  itemIndex
                                ) => (
                                  <tr
                                    key={
                                      itemIndex
                                    }
                                  >
                                    {(detail.columns || [])
                                      .filter(
                                        (col) =>
                                          col.col
                                      )
                                      .map(
                                        (col) => {
                                          const value =
                                            item[
                                              col.col
                                            ] ??
                                            item[
                                              col.col
                                                ?.split(
                                                  "."
                                                )
                                                .pop()
                                            ];

                                          return (
                                            <td
                                              key={
                                                col.col
                                              }
                                            >
                                              {fmtCell(
                                                value,
                                                col.fmt,
                                                locale
                                              )}
                                            </td>
                                          );
                                        }
                                      )}
                                  </tr>
                                )
                              )}
                            </tbody>
                          </table>
                        </div>
                      )}
                    </div>
                  </td>
                </tr>
              )}
            </React.Fragment>
          );
        })}
      </tbody>
    </table>
  );
}
function formatNumber(value, decimals, locale) {
  const n = Number(value);

  if (!Number.isFinite(n)) return String(value);

  return n.toLocaleString(locale || "en-IN", {
    minimumFractionDigits: decimals ?? 0,
    maximumFractionDigits: decimals ?? 0,
  });
}