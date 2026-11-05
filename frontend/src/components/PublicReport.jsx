import React from "react";
import { StoreProvider, useStore } from "../store.jsx";
import { normS, styleObj, frameStyle, fmtCell, fmtNumber } from "../model.js";
import Chart from "../charts/Chart.jsx";
import api, { getClientVendorName } from "../api.js";
import { cleanHeading } from "./Box.jsx";

const _urlParams = typeof window !== "undefined" ? new URLSearchParams(window.location.search) : new URLSearchParams();
const viewerToken = _urlParams.get("vt") || "";

function getViewerHeaders() {
  const vName = getClientVendorName();
  return {
    ...(viewerToken ? { "X-Viewer-Token": viewerToken } : {}),
    ...(vName ? { "X-Vendor-Name": vName } : {}),
  };
}
const API_BASE = import.meta.env.VITE_API_BASE || "/api";

function formatSlugUrl(slug, action = "") {
  const clean = (slug || "").replace(/^\/+|\/+$/g, "");
  const parts = clean.split("/").filter(Boolean).map(encodeURIComponent);
  let url = `${API_BASE}/r/${parts.join("/")}`;
  if (action) {
    url += action.startsWith("/") ? action : `/${action}`;
  }
  if (viewerToken) {
    url += (url.includes("?") ? "&" : "?") + `vt=${encodeURIComponent(viewerToken)}`;
  }
  const vName = getClientVendorName();
  if (vName) {
    url += (url.includes("?") ? "&" : "?") + `vendor_name=${encodeURIComponent(vName)}`;
  }
  return url;
}

async function getPublishedReport(slug) {
  const res = await fetch(formatSlugUrl(slug), {
    headers: getViewerHeaders(),
  });

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
  const res = await fetch(formatSlugUrl(slug, "execute"), {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      ...getViewerHeaders(),
    },
    body: JSON.stringify({ filters }),
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

      {/* ONLY download options for employees / viewers */}
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
          href={formatSlugUrl(slug, "export/pdf")}
        >
          Download PDF
        </a>

        <a
          className="pb go"
          href={(() => {
            let u = formatSlugUrl(slug, "export/xlsx");
            if (state?.filterState && Object.keys(state.filterState).length > 0) {
              u += (u.includes("?") ? "&" : "?") + `filters=${encodeURIComponent(JSON.stringify(state.filterState))}`;
            }
            return u;
          })()}
          download={`${(state?.doc?.name || "report").replace(/[^\w-]+/g, "-").toLowerCase()}.xlsx`}
        >
          Download Excel
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
                formatSlugUrl(slug, "email"),
                {
                  method: "POST",
                  headers: {
                    "Content-Type": "application/json",
                    ...getViewerHeaders(),
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

      {/* Published report - read only */}
      <PublicCanvas doc={state.doc} />
    </div>
  );
}

function PublicCanvas({ doc }) {
  const { state, dispatch } = useStore();
  const visibleSections = (doc.sections || []).filter(
    (section) => section.visible !== false
  );
  const namedSections = visibleSections.filter(
    (section) => section.name && section.name.trim() !== ""
  );
  const [activeSectionId, setActiveSectionId] = React.useState(
    namedSections[0]?.id || visibleSections[0]?.id || null
  );

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
          {doc.name || "Vendor Purchase Order Report"}
        </div>
        {doc.desc && (
          <div className="rep-subtitle">
            {doc.desc}
          </div>
        )}
      </div>

      <div className="pr-report-search-bar">
        <div className="fbar-search-inner">
          <svg className="fbar-search-svg" width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round">
            <circle cx="11" cy="11" r="8" />
            <line x1="21" y1="21" x2="16.65" y2="16.65" />
          </svg>
          <input
            type="text"
            className="fbar-search-input"
            placeholder="Search this report (PO number, date, amount, vendor, or details)..."
            value={state.searchTerm || ""}
            onChange={(e) => dispatch({ type: "searchTerm", value: e.target.value })}
          />
          {state.searchTerm && (
            <button
              type="button"
              className="fbar-search-clear"
              onClick={() => dispatch({ type: "searchTerm", value: "" })}
              title="Clear search"
            >
              ×
            </button>
          )}
        </div>
        {state.searchTerm && (
          <span className="pr-search-active-pill">
            Filtering by "{state.searchTerm}"
          </span>
        )}
      </div>

      {namedSections.length > 1 && (
        <div className="section-nav">
          {namedSections.map((section) => {
            const isActive =
              (activeSectionId || namedSections[0]?.id) === section.id;
            return (
              <button
                key={section.id}
                type="button"
                className={`section-nav-item ${isActive ? "active" : ""}`}
                onClick={() => {
                  setActiveSectionId(section.id);
                  const el = document.getElementById(`section-${section.id}`);
                  if (el) {
                    const y =
                      el.getBoundingClientRect().top +
                      window.scrollY -
                      30;
                    window.scrollTo({
                      top: y,
                      behavior: "smooth",
                    });
                  }
                }}
              >
                {section.name}
              </button>
            );
          })}
        </div>
      )}

      {visibleSections.map((section, index) => (
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

  const [openDetails, setOpenDetails] = React.useState({});
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
    const c = box.value || {};
    if (result?.error && c.source !== "manual") {
      return (
        <div className="ph">
          <b>Formula problem</b>
          <span>{result.error}</span>
        </div>
      );
    }

    let shown;
    const isVendorKpi = (
      c.showVendorNameOnVendorLogin !== false &&
      (
        ["VENDOR", "VENDORS", "TOTAL VENDOR", "TOTAL VENDORS", "VENDOR NAME"].includes((box.title || "").trim().toUpperCase()) ||
        ["vendor_id", "vendor_name", "vendor_bpno", "vendor", "vendor_no", "vendor_code"].includes((c.column || "").trim().toLowerCase())
      )
    );
    const clientVName = getClientVendorName();

    if (c.source === "manual") {
      shown = c.manual || "";
    } else {
      const v = result?.value;
      const isNum = v !== null && v !== undefined && v !== "" && typeof v === "number";
      const isNumericStr = typeof v === "string" && v.trim() !== "" && !isNaN(v) && !isNaN(parseFloat(v));

      if (isVendorKpi && (viewerToken || clientVName)) {
        if (v && typeof v === "string" && isNaN(v) && v !== "—") {
          shown = v;
        } else if (clientVName) {
          shown = clientVName;
        } else if (v !== null && v !== undefined && v !== "") {
          shown = String(v);
        } else {
          shown = "—";
        }
      } else {
        shown = (v === null || v === undefined || v === "")
          ? "—"
          : (isNum || isNumericStr)
            ? formatNumber(v, c.decimals, locale)
            : String(v);
      }
    }

    const textVal = String(shown || "");
    const textLen = textVal.length;
    const dynamicFontSize = c.fontSize || (textLen > 24 ? "15px" : textLen > 18 ? "18px" : textLen > 10 && isNaN(result?.value) ? "22px" : undefined);

    return (
      <>
        <div
          className="kpi"
          style={{
            color: c.tone || "#1A2326",
            fontSize: dynamicFontSize,
            lineHeight: 1.25,
            wordBreak: "break-word",
          }}
        >
          {c.prefix || ""}
          {shown}
          {c.suffix || ""}
          {c.unit && (
            <span className="kpi-unit">
              {c.unit}
            </span>
          )}
        </div>

        {c.delta && (
          <div className={`kpi-delta ${c.deltaDir}`}>
            {c.deltaDir === "up" ? "▲" : c.deltaDir === "down" ? "▼" : "■"} {c.delta}
          </div>
        )}

        {c.showTrack && (
          <div className="track">
            <i
              style={{
                width: `${Math.max(0, Math.min(100, c.trackPct || 0))}%`,
                background: c.tone || "#0D6E62",
              }}
            />
          </div>
        )}

        {c.note && (
          <div className="kpi-note">
            {c.note}
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

  const [tableSearch, setTableSearch] = React.useState("");
  const effectiveSearch = (tableSearch || state.searchTerm || "").trim().toLowerCase();

  const clickable =
    detail.enabled &&
    detail.keyColumn &&
    columns.find(
      (col) =>
        String(col.col) === String(detail.keyColumn)
    );

  const filteredRows = React.useMemo(() => {
    if (!effectiveSearch) return rows;
    return rows.filter((r) => {
      const matchCol = columns.some((col) => {
        const val = r[col.col] ?? r[col.col?.split(".").pop()];
        return String(val ?? "").toLowerCase().includes(effectiveSearch);
      });
      if (matchCol) return true;

      const rowDetailValue = clickable ? r[clickable.col] : null;
      if (rowDetailValue != null && openDetails[String(rowDetailValue)]?.items) {
        const items = openDetails[String(rowDetailValue)].items;
        return items.some((item) =>
          Object.values(item).some((val) =>
            String(val ?? "").toLowerCase().includes(effectiveSearch)
          )
        );
      }
      return false;
    });
  }, [rows, effectiveSearch, columns, openDetails, clickable]);

  if (!columns.length) {
    return (
      <div className="empty">
        No columns selected.
      </div>
    );
  }

  return (
    <>
      <div className="table-search-toolbar">
        <div className="table-search-input-wrap">
          <svg className="table-search-icon" width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round">
            <circle cx="11" cy="11" r="8" />
            <line x1="21" y1="21" x2="16.65" y2="16.65" />
          </svg>
          <input
            type="text"
            className="table-search-input"
            placeholder="Search records by PO#, date, amount, or details..."
            value={tableSearch}
            onChange={(e) => setTableSearch(e.target.value)}
          />
          {tableSearch && (
            <button
              type="button"
              className="table-search-clear"
              onClick={() => setTableSearch("")}
              title="Clear table search"
            >
              ×
            </button>
          )}
        </div>
        {effectiveSearch ? (
          <span className="table-search-count">
            {filteredRows.length} of {rows.length} {rows.length === 1 ? "record" : "records"}
          </span>
        ) : rows.length > 0 ? (
          <span style={{ fontSize: "12px", color: "#64748B" }}>
            {rows.length} {rows.length === 1 ? "record" : "records"}
          </span>
        ) : null}
      </div>

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
        {rows.length === 0 && (
          <tr>
            <td
              colSpan={columns.length}
              style={{
                textAlign: "center",
                color: "#64748B",
                padding: "32px 16px",
              }}
            >
              No records found for your account.
            </td>
          </tr>
        )}
        {rows.length > 0 && filteredRows.length === 0 && (
          <tr className="empty-search-row">
            <td colSpan={columns.length}>
              <div style={{ color: "#64748B", marginBottom: "8px" }}>
                No records found matching "{effectiveSearch}"
              </div>
              <button
                type="button"
                className="table-search-reset-btn"
                onClick={() => {
                  setTableSearch("");
                  dispatch({ type: "searchTerm", value: "" });
                }}
              >
                Clear Search
              </button>
            </td>
          </tr>
        )}
        {filteredRows.map((row, rowIndex) => {
          const rowDetailValue = clickable
            ? row[clickable.col]
            : null;
          const clickedValue = rowDetailValue != null ? String(rowDetailValue) : "";
          const isSelected = clickedValue !== "" && Boolean(openDetails[clickedValue]);
          const currentDetail = clickedValue ? openDetails[clickedValue] : null;
          const currentItems = currentDetail?.items || [];
          const isCurrentLoading = currentDetail?.loading;

          const handleRowClick = async () => {
            if (!clickable || rowDetailValue == null) return;
            if (openDetails[clickedValue]) {
              setOpenDetails((prev) => {
                const next = { ...prev };
                delete next[clickedValue];
                return next;
              });
              return;
            }

            setOpenDetails((prev) => ({
              ...prev,
              [clickedValue]: { items: [], loading: true, error: "" },
            }));

            try {
              const params = new URLSearchParams({
                parentTable: box?.src?.base || "",
                lookupColumn: detail.keyColumn,
                value: clickedValue,
                detailColumns: (detail.columns || [])
                  .map((col) => col.col)
                  .filter(Boolean)
                  .join(","),
                limit: String(detail.limit || 100),
              });

              if (viewerToken) {
                params.set("vt", viewerToken);
              }
              const detailUrl = `${API_BASE}/r/${encodeURIComponent(publicKey)}/${encodeURIComponent(publicToken)}/detail?${params.toString()}`;
              const res = await fetch(detailUrl, {
                headers: getViewerHeaders(),
              });

              if (!res.ok) {
                throw new Error("Could not load detail rows");
              }

              const data = await res.json();
              setOpenDetails((prev) => ({
                ...prev,
                [clickedValue]: { items: data.rows || [], loading: false, error: "" },
              }));
            } catch (err) {
              console.error("Could not load detail rows:", err);
              setOpenDetails((prev) => ({
                ...prev,
                [clickedValue]: { items: [], loading: false, error: err.message },
              }));
            }
          };

          return (
            <React.Fragment key={rowIndex}>
              <tr
                className={[
                  clickable ? "clickable-row" : "",
                  isSelected ? "selected-row" : "",
                ].filter(Boolean).join(" ") || undefined}
                style={clickable ? { cursor: "pointer" } : undefined}
                onClick={clickable ? handleRowClick : undefined}
              >
                {columns.map((col, colIdx) => {
                  const value =
                    row[col.col] ??
                    row[col.col?.split(".").pop()];
                  const isKeyCol = clickable && (String(col.col) === String(detail.keyColumn) || colIdx === 0);

                  return (
                    <td
                      key={col.col}
                      className={
                        col.align === "right"
                          ? "num"
                          : undefined
                      }
                    >
                      {isKeyCol ? (
                        <span className="po-toggle-wrap">
                          <span className="po-arrow-badge">{isSelected ? "▼" : "▶"}</span>
                          <span className="po-link">{fmtCell(value, col.fmt, locale)}</span>
                        </span>
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
                <tr className="pr-detail-row">
                  <td colSpan={columns.length} className="pr-detail-cell">
                    <div className="pr-detail-container">
                      {isCurrentLoading ? (
                        <div className="pr-detail-loading">
                          <div className="pr-spinner" />
                          <span>Loading line items...</span>
                        </div>
                      ) : currentItems.length === 0 ? (
                        <div className="pr-empty" style={{ padding: "24px", textAlign: "center", color: "#64748B" }}>
                          No line items found for this order.
                        </div>
                      ) : (
                        <div className="pr-items-card">
                          <div className="pr-detail-card-header">
                            <div className="pr-detail-title-pill">
                              <span className="pr-detail-icon-box">
                                <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round">
                                  <path d="M21 16V8a2 2 0 0 0-1-1.73l-7-4a2 2 0 0 0-2 0l-7 4A2 2 0 0 0 3 8v8a2 2 0 0 0 1 1.73l7 4a2 2 0 0 0 2 0l7-4A2 2 0 0 0 21 16z" />
                                  <polyline points="3.27 6.96 12 12.01 20.73 6.96" />
                                  <line x1="12" y1="22.08" x2="12" y2="12" />
                                </svg>
                              </span>
                              <span className="pr-detail-title-text">Line Items</span>
                              <span className="pr-detail-count-badge">
                                {currentItems.length} {currentItems.length === 1 ? "item" : "items"}
                              </span>
                            </div>
                            {clickedValue ? <div className="pr-detail-po-tag">PO #{clickedValue}</div> : null}
                          </div>

                          <div className="pr-items-table-wrap">
                            <table className="rt pr-items-table">
                              <thead>
                                <tr>
                                  {(detail.columns || [])
                                    .filter(
                                      (col) => col.col
                                    )
                                    .map((col) => (
                                      <th
                                        key={col.col}
                                        className={col.align === "right" ? "num" : undefined}
                                      >
                                        {cleanHeading(col.label || col.col)}
                                      </th>
                                    ))}
                                </tr>
                              </thead>

                              <tbody>
                                {currentItems.map(
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
                                                className={
                                                  col.align === "right"
                                                    ? "num"
                                                    : undefined
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
                              {currentItems.length > 0 && (
                                <tfoot>
                                  <tr>
                                    {(detail.columns || [])
                                      .filter((col) => col.col)
                                      .map((col, i) => {
                                        const values = currentItems.map(
                                          (item) => item[col.col] ?? item[col.col?.split(".").pop()]
                                        );
                                        const numericValues = values.filter(
                                          (val) => typeof val === "number" || (typeof val === "string" && val.trim() !== "" && !isNaN(val) && !isNaN(parseFloat(val)))
                                        );
                                        const isNumCol = col.align === "right" || (numericValues.length > 0 && numericValues.length === values.filter((val) => val != null && val !== "").length);
                                        const colKey = String(col.col || "").toLowerCase();
                                        const colLbl = String(col.label || "").toLowerCase();
                                        const isIdOrCode = /(_id|^id$|code|number|num$|hsn|item_no)/i.test(colKey) || /(_id|^id$|code|number|num$|hsn|item_no)/i.test(colLbl);
                                        const canSum = isNumCol && !isIdOrCode;
                                        const allCurrency = values.length > 0 && values.every((val) => val === "INR" || val === "USD" || val === "EUR");

                                        return (
                                          <td
                                            key={col.col}
                                            className={col.align === "right" || isNumCol ? "num" : undefined}
                                          >
                                            {i === 0 ? (
                                              <span className="pr-total-badge">
                                                <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round" style={{ marginRight: 4 }}>
                                                  <polyline points="20 6 9 17 4 12" />
                                                </svg>
                                                Total
                                              </span>
                                            ) : canSum ? (
                                              fmtCell(
                                                currentItems.reduce(
                                                  (a, item) => a + (Number(item[col.col] ?? item[col.col?.split(".").pop()]) || 0),
                                                  0
                                                ),
                                                col.fmt || "number",
                                                locale
                                              )
                                            ) : allCurrency ? (
                                              values[0]
                                            ) : (
                                              ""
                                            )}
                                          </td>
                                        );
                                      })}
                                  </tr>
                                </tfoot>
                              )}
                            </table>
                          </div>
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
      {filteredRows.length > 0 && (
        <tfoot>
          <tr>
            {columns.map((col, i) => {
              const values = filteredRows.map(
                (r) => r[col.col] ?? r[col.col?.split(".").pop()]
              );
              const numericValues = values.filter(
                (val) =>
                  typeof val === "number" ||
                  (typeof val === "string" &&
                    val.trim() !== "" &&
                    !isNaN(val) &&
                    !isNaN(parseFloat(val)))
              );
              const isNumCol =
                col.align === "right" ||
                (numericValues.length > 0 &&
                  numericValues.length ===
                    values.filter((val) => val != null && val !== "").length);
              const colKey = String(col.col || "").toLowerCase();
              const colLbl = String(col.label || "").toLowerCase();
              const isIdOrCode = /(_id|^id$|code|number|num$|hsn|item_no)/i.test(colKey) || /(_id|^id$|code|number|num$|hsn|item_no)/i.test(colLbl);
              const canSum = isNumCol && !isIdOrCode;
              const allCurrency =
                values.length > 0 &&
                values.every(
                  (val) =>
                    val === "INR" || val === "USD" || val === "EUR"
                );

              return (
                <td
                  key={col.col}
                  className={
                    col.align === "right" || isNumCol ? "num" : undefined
                  }
                >
                  {i === 0
                    ? `Total (${filteredRows.length} ${filteredRows.length === 1 ? "order" : "orders"})`
                    : canSum
                    ? fmtCell(
                        filteredRows.reduce(
                          (a, r) =>
                            a +
                            (Number(
                              r[col.col] ?? r[col.col?.split(".").pop()]
                            ) || 0),
                          0
                        ),
                        col.fmt || "currency",
                        locale
                      )
                    : allCurrency
                    ? values[0]
                    : ""}
                </td>
              );
            })}
          </tr>
        </tfoot>
      )}
    </table>
    <div className="report-table-footnote">
      {box.table?.note ? (
        <p>{box.table.note}</p>
      ) : clickable ? (
        <>
          <p>Select a purchase order number to show or hide its line items.</p>
          <p>Sample data for illustration. TDS is calculated on Total Price (before GST). TDS sections follow Income-tax Act, 1961 numbering.</p>
        </>
      ) : null}
    </div>
    </>
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