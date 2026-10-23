/* Box.jsx — one box on the canvas, its toolbar, and its settings panel.

   Everything is configured on the box itself. There is no separate inspector;
   selecting a box reveals its own strip and its own panel, in place. */
import api from "../api";
import React from "react";
import { useStore } from "../store.jsx";
import Chart, { Legend, legendItems } from "../charts/Chart.jsx";
import {
  AGGS, BOX_KINDS, CHARTS, FMTS, colOptions, fmtCell, fmtNumber,
  frameStyle, normS, styleObj, widthOptions, uid,
} from "../model.js";
import {
  Check, Chips, ConfirmBar, DeleteButton, Field, FormatPanel, FrameControls,
  Group, Hint, Row, RoleChips, SegBar, Select, SourceEditor, Switch, Text, TextArea, Toggles,
} from "./Panels.jsx";
/* An editable line that writes on blur, so typing never re-renders the tree. */
function Editable({
  value,
  onChange,
  className,
  placeholder,
  style,
  editable = true,
}) {
  const ref = React.useRef(null);

  React.useEffect(() => {
    if (
      ref.current &&
      ref.current.textContent !== (value || "")
    ) {
      ref.current.textContent = value || "";
    }
  }, [value]);

  return (
    <div
      ref={ref}
      className={className}
      style={style}
      contentEditable={editable}
      suppressContentEditableWarning
      data-ph={editable ? placeholder : undefined}
      onBlur={
        editable
          ? (e) => onChange(e.currentTarget.textContent)
          : undefined
      }
      onKeyDown={
        editable
          ? (e) => {
              if (e.key === "Enter") {
                e.preventDefault();
                e.currentTarget.blur();
              }
            }
          : undefined
      }
    />
  );
}

export default function Box({ box, cols }) {
  const { state, dispatch } = useStore();
  const selected = state.sel?.kind === "box" && state.sel.id === box.id;
  const pending = state.pendingDel?.kind === "box" && state.pendingDel.id === box.id;
  const design = state.mode === "design";
  const span = Math.max(1, Math.min(cols, box.span || 1));

  const set = (path, value) =>
    dispatch({ type: "set", target: "box", id: box.id, path, value });

  const cls = ["box"];
  if (box.frame?.on) cls.push("framed");
  if (box.visible === false) cls.push("boxoff");
  if (selected) cls.push("sel");

  return (
    <div
      className={cls.join(" ")}
      style={{
        gridColumn: `span ${span}`,
        ...(box.style.bg ? { background: box.style.bg } : {}),
        ...(box.style.align ? { textAlign: box.style.align } : {}),
        ...frameStyle(box.frame),
      }}
      onMouseDown={(e) => {
        if (!design) return;
        e.stopPropagation();
        if (!selected) dispatch({ type: "select", sel: { kind: "box", id: box.id } });
      }}
    >
      {selected && design && <Toolbar box={box} />}

      {box.titleVisible !== false && (
        <Editable className="box-title" value={box.title} placeholder="Unnamed box"
          style={styleObj(normS(box.titleStyle))}
          editable={design}
          onChange={(v) => set("title", v)} />
      )}

      <div style={styleObj(box.style, { bg: true, align: true })}>
        <Body box={box} />
      </div>

      {pending ? (
        <ConfirmBar what={`the box "${box.title || "Unnamed"}"`}
          onYes={() => dispatch({ type: "delete", sel: { kind: "box", id: box.id } })}
          onNo={() => dispatch({ type: "cancelDel" })} />
      ) : selected && state.cfgOpen && design ? (
        <Panel box={box} cols={cols} />
      ) : null}
    </div>
  );
}

function Toolbar({ box }) {
  const { dispatch } = useStore();
  const stop = (fn) => (e) => { e.stopPropagation(); fn(); };
  return (
    <div className="btools">
      <button title="Set up this box"
        onMouseDown={(e) => e.stopPropagation()}
        onClick={stop(() => dispatch({ type: "cfgOpen", open: true }))}>⚙</button>
      <button title="Move earlier" onMouseDown={(e) => e.stopPropagation()}
        onClick={stop(() => dispatch({ type: "moveBox", id: box.id, d: -1 }))}>←</button>
      <button title="Move later" onMouseDown={(e) => e.stopPropagation()}
        onClick={stop(() => dispatch({ type: "moveBox", id: box.id, d: 1 }))}>→</button>
      <button title="Duplicate" onMouseDown={(e) => e.stopPropagation()}
        onClick={stop(() => dispatch({ type: "dupBox", id: box.id }))}>⧉</button>
      <button className="warn" title="Delete this box" onMouseDown={(e) => e.stopPropagation()}
        onClick={stop(() => dispatch({ type: "askDel", sel: { kind: "box", id: box.id } }))}>✕</button>
    </div>
  );
}

/* ---------------- what a box shows ---------------- */
const stateNote = (box, catalog) => {
  if (!catalog.tables.length) return ["No tables available", "Connect a database in System Settings"];
  if (!box.src.base) return ["No table chosen", "Open Set up and pick one"];
  return ["Waiting on the database", "Run the report to fill this in"];
};

const Placeholder = ({ msg, sub, height }) => (
  <div className="ph" style={height ? { minHeight: height } : undefined}>
    <b>{msg}</b>{sub && <span>{sub}</span>}
  </div>
);

/* ---- record popup (header, detail boxes, line items) ---- */
async function fetchDetailRows({ box, processKey, keyColumn, value, columns, limit, signal }) {
  if (window.location.pathname.includes("/r/")) {
    const [, publicPath] = window.location.pathname.split("/r/");
    const [publicKey, publicToken] = publicPath.split("/");
    const params = new URLSearchParams({
      parentTable: box?.src?.base || "",
      lookupColumn: keyColumn,
      value,
      detailColumns: columns.join(","),
      limit: String(limit),
    });
    const vt = new URLSearchParams(window.location.search).get("vt");
    if (vt) params.set("vt", vt);
    const res = await fetch(
      `/api/r/${encodeURIComponent(publicKey)}/${encodeURIComponent(publicToken)}/detail?${params.toString()}`,
      { signal }
    );
    if (!res.ok) throw new Error("Could not load details");
    return await res.json();
  }
  return api.getDetailRows(
    processKey,
    box?.src?.base || "",
    keyColumn,
    value,
    columns,
    limit
  );
}

const newDetailSection = (type = "fields") => ({
  id: uid("sec"),
  type,
  title:
    type === "lineItems" ? "Line Items" : type === "header" ? "Header" : "New Section",
  columns: [],
});

const DETAIL_TYPE_LABEL = {
  header: "Header",
  fields: "Details",
  lineItems: "Line items",
};

const popupCard = {
  border: "1px solid #E3E8EA",
  background: "#F7F8FA",
  borderRadius: 8,
  padding: "16px 20px",
  marginBottom: 16,
};
const popupSectionTitle = {
  fontSize: 12,
  fontWeight: 700,
  letterSpacing: ".06em",
  textTransform: "uppercase",
  color: "#5B6B70",
  marginBottom: 12,
};
const popupLabel = {
  fontSize: 11,
  letterSpacing: ".05em",
  textTransform: "uppercase",
  color: "#5B6B70",
  marginBottom: 2,
};
const popupPill = {
  display: "inline-block",
  padding: "3px 10px",
  borderRadius: 6,
  fontSize: 13,
  fontWeight: 600,
  background: "#FFF6DB",
  border: "1px solid #F0DFA0",
  color: "#6B4E00",
};

function DetailPopup({
  box,
  detail,
  sectionRows,
  detailValue,
  design,
  locale,
  catalog,
  dispatch,
  onClose,
}) {
  const sections = detail.sections || [];
  const write = (path, value) =>
    dispatch({ type: "set", target: "box", id: box.id, path, value });
  const setSections = (next) => write("table.detail.sections", next);
  const patch = (i, p) =>
    setSections(sections.map((sec, idx) => (idx === i ? { ...sec, ...p } : sec)));
  const move = (i, d) => {
    const j = i + d;
    if (j < 0 || j >= sections.length) return;
    const next = [...sections];
    [next[i], next[j]] = [next[j], next[i]];
    setSections(next);
  };
  const remove = (i) => setSections(sections.filter((_, idx) => idx !== i));
  const add = (type) => setSections([...sections, newDetailSection(type)]);

  const allCols = (catalog?.tables || []).flatMap((t) =>
    typeof t === "string"
      ? []
      : (t.columns || [])
          .map((c) => (typeof c === "string" ? c : c.name))
          .filter(Boolean)
          .map((n) => `${t.name}.${n}`)
  );
  const known = new Set(allCols);
  const listId = `dl-${box.id}`;

  const alias = (ref) => String(ref || "").replace(/\./g, "__");
  const labelFrom = (ref) => String(ref).split(".").pop().replace(/_/g, " ");
  const valueOf = (rows, col) => {
    const r = rows?.[0];
    return r ? r[alias(col)] ?? r[col] : undefined;
  };
  const show = (val, fmt) =>
    val === undefined || val === null || val === ""
      ? "—"
      : fmtCell(val, fmt || "auto", locale);

  const renderEditor = (sec, i) => {
    const cols = sec.columns || [];
    const patchCol = (j, p) =>
      patch(i, {
        columns: cols.map((c, idx) => (idx === j ? { ...c, ...p } : c)),
      });
    const swap = (j, d) => {
      const k = j + d;
      if (k < 0 || k >= cols.length) return;
      const next = [...cols];
      [next[j], next[k]] = [next[k], next[j]];
      patch(i, { columns: next });
    };

    return (
      <div
        style={{
          border: "1px dashed #B8C4C8",
          borderRadius: 8,
          padding: 10,
          marginBottom: 12,
          display: "grid",
          gap: 8,
          background: "#fff",
        }}
      >
        <input
          list={listId}
          placeholder="Add a column — type to search any table.column (e.g. uom, material, vendor)"
          onChange={(e) => {
            const v = e.target.value;
            if (known.has(v)) {
              patch(i, {
                columns: [...cols, { col: v, label: labelFrom(v), fmt: "auto" }],
              });
              e.target.value = "";
            }
          }}
          style={{ padding: "6px 8px", width: "100%" }}
        />

        {cols.length > 0 && (
          <div style={{ display: "flex", flexWrap: "wrap", gap: 6 }}>
            {cols.map((c, j) => (
              <span
                key={`${c.col}-${j}`}
                title={c.col}
                style={{
                  display: "inline-flex",
                  alignItems: "center",
                  gap: 4,
                  padding: "2px 6px",
                  border: "1px solid #CBD5D8",
                  borderRadius: 12,
                  fontSize: 12,
                }}
              >
                <button
                  type="button"
                  className="xbtn"
                  title="Move left"
                  disabled={j === 0}
                  onClick={() => swap(j, -1)}
                >
                  ←
                </button>
                <Editable
                  value={c.label || labelFrom(c.col)}
                  placeholder="Label"
                  style={{ display: "inline-block", minWidth: 40 }}
                  onChange={(v) => patchCol(j, { label: v })}
                />
                <Select
                  value={c.fmt || "auto"}
                  options={FMTS}
                  onChange={(v) => patchCol(j, { fmt: v })}
                />
                <button
                  type="button"
                  className="xbtn"
                  title="Move right"
                  disabled={j === cols.length - 1}
                  onClick={() => swap(j, 1)}
                >
                  →
                </button>
                <button
                  type="button"
                  className="xbtn"
                  title="Remove column"
                  onClick={() =>
                    patch(i, { columns: cols.filter((_, idx) => idx !== j) })
                  }
                >
                  ×
                </button>
              </span>
            ))}
          </div>
        )}
      </div>
    );
  };

  const renderBody = (sec) => {
    const cols = (sec.columns || []).filter((c) => c.col);
    const data = sectionRows[sec.id];
    const fresh = data && data.value === detailValue;

    if (!cols.length) {
      return design ? (
        <p style={{ fontSize: 13, opacity: 0.7 }}>
          Add columns above to fill this box.
        </p>
      ) : null;
    }
    if (!fresh || data.loading) return <p>Loading…</p>;
    if (data.error) return <p role="alert">{data.error}</p>;

    if (sec.type === "header") {
      const [first, ...rest] = cols;
      const pills = rest
        .map((c) => show(valueOf(data.rows, c.col), c.fmt))
        .filter((v) => v !== "—");
      return (
        <>
          <div style={{ fontSize: 28, fontWeight: 700, lineHeight: 1.2 }}>
            {show(valueOf(data.rows, first.col), first.fmt)}
          </div>
          {pills.length > 0 && (
            <div style={{ display: "flex", flexWrap: "wrap", gap: 8, marginTop: 10 }}>
              {pills.map((p, idx) => (
                <span key={idx} style={popupPill}>
                  {p}
                </span>
              ))}
            </div>
          )}
        </>
      );
    }

    if (sec.type === "lineItems") {
      if (!data.rows.length) return <p>No line items found.</p>;
      return (
        <div className="rt-table-wrap">
          <table className="rt">
            <thead>
              <tr>
                <th>#</th>
                {cols.map((c, j) => (
                  <th key={`${c.col}-${j}`}>{c.label || labelFrom(c.col)}</th>
                ))}
              </tr>
            </thead>
            <tbody>
              {data.rows.map((row, r) => (
                <tr key={r}>
                  <td>{r + 1}</td>
                  {cols.map((c, j) => (
                    <td key={`${c.col}-${j}`}>
                      {show(row[alias(c.col)] ?? row[c.col], c.fmt)}
                    </td>
                  ))}
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      );
    }

    return (
      <div
        style={{
          display: "grid",
          gridTemplateColumns: "repeat(auto-fit, minmax(190px, 1fr))",
          gap: "18px 24px",
        }}
      >
        {cols.map((c, j) => (
          <div key={`${c.col}-${j}`}>
            <div style={popupLabel}>{c.label || labelFrom(c.col)}</div>
            <div style={{ fontWeight: 700, fontSize: 15 }}>
              {show(valueOf(data.rows, c.col), c.fmt)}
            </div>
          </div>
        ))}
      </div>
    );
  };

  const hasHeader = sections.some((sec) => sec.type === "header");

  return (
    <div style={{ position: "relative" }}>
      <datalist id={listId}>
        {allCols.map((v) => (
          <option key={v} value={v} />
        ))}
      </datalist>

      <button
        type="button"
        className="xbtn"
        onClick={onClose}
        aria-label="Close details"
        style={{ position: "absolute", top: 0, right: 0, zIndex: 1 }}
      >
        ×
      </button>

      {!hasHeader && (
        <h3 style={{ margin: "0 40px 16px 0" }}>
          {detail.title || "Details"} — {detailValue}
        </h3>
      )}

      {sections.map((sec, i) => {
        const isHeader = sec.type === "header";
        return (
          <div
            key={sec.id || i}
            style={isHeader ? { marginBottom: 20, paddingRight: 40 } : popupCard}
          >
            {design ? (
              <div style={{ display: "flex", alignItems: "center", gap: 6, marginBottom: 10 }}>
                <Editable
                  value={sec.title}
                  placeholder="Box title"
                  style={{ ...popupSectionTitle, marginBottom: 0, flex: 1 }}
                  onChange={(v) => patch(i, { title: v })}
                />
                <span style={{ fontSize: 11, opacity: 0.6 }}>
                  {DETAIL_TYPE_LABEL[sec.type] || sec.type}
                </span>
                <button type="button" className="xbtn" title="Move up" disabled={i === 0} onClick={() => move(i, -1)}>
                  ↑
                </button>
                <button type="button" className="xbtn" title="Move down" disabled={i === sections.length - 1} onClick={() => move(i, 1)}>
                  ↓
                </button>
                <button type="button" className="xbtn" title="Remove this box" onClick={() => remove(i)}>
                  ×
                </button>
              </div>
            ) : (
              !isHeader && <div style={popupSectionTitle}>{sec.title}</div>
            )}

            {design && renderEditor(sec, i)}
            {renderBody(sec)}
          </div>
        );
      })}

      {design && (
        <div style={{ display: "flex", flexWrap: "wrap", gap: 8, marginTop: 4 }}>
          <button type="button" className="pb" onClick={() => add("fields")}>
            + Add Box
          </button>
          <button type="button" className="pb" onClick={() => add("lineItems")}>
            + Add Line Items
          </button>
          <button type="button" className="pb" onClick={() => add("header")}>
            + Add Header
          </button>
        </div>
      )}
    </div>
  );
}

/* ---- popup section helpers ---- */
const newPopupManualTable = () => {
  const stamp = uid("col");
  return {
    columns: [
      { id: `${stamp}_1`, label: "Item" },
      { id: `${stamp}_2`, label: "Quantity" },
      { id: `${stamp}_3`, label: "Amount" },
    ],
    rows: [{ id: `${uid("row")}_1`, cells: ["", "", ""] }],
    zebra: true,
  };
};

const newPopupSection = (type = "fields", keyColumn = "") => ({
  id: uid("section"),
  title:
    type === "dataTable" || type === "lineItems"
      ? "Line Items"
      : type === "manualTable"
      ? "Manual Table"
      : "New Section",
  type,
  keyColumn,
  columns: [],
  manualTable: newPopupManualTable(),
  table: "",
  mode: "related",
  columnSource: "table",
  parentColumn: "",
  relatedColumn: "",
});

/* A popup table can only load once it knows which table, and (when it
   belongs to the selected record) how that table links to the record. */
const isStandaloneSection = (section) =>
  section.type === "dataTable" && section.mode === "standalone";

const popupSectionReady = (section, fallbackKey = "") => {
  if (section.type === "dataTable") {
    if (!section.table) return false;
    if (isStandaloneSection(section)) return true;
    return !!(section.relationship?.fromColumn && section.relationship?.toColumn);
  }
  if (section.type === "lineItems") {
    return !!(
      (section.keyColumn || fallbackKey) &&
      (section.columns || []).some((c) => c.col)
    );
  }
  if (section.type === "relatedTable") {
    return !!(section.table && section.parentColumn && section.relatedColumn);
  }
  return true;
};

const popupRecFor = (section, recordKey) =>
  isStandaloneSection(section) ? "" : recordKey;

const cellAlign = (col) =>
  col?.align === "right"
    ? { className: "num" }
    : col?.align === "center"
    ? { style: { textAlign: "center" } }
    : {};

function Body({ box }) {
  const { state, dispatch } = useStore();
  const publicPath = window.location.pathname.match(/^\/(?:analytics\/)?r\/([^/]+)\/([^/]+)/);
  const publicSlug = publicPath ? `${publicPath[1]}/${publicPath[2]}` : null;
  const [detailItems, setDetailItems] = React.useState(null);
  const [detailValue, setDetailValue] = React.useState("");
  const [detailLoading, setDetailLoading] = React.useState(false);
  const [reportSearchTerm, setReportSearchTerm] = React.useState("");
  const [reportPage, setReportPage] = React.useState(1);
  const [selectedReportRecord, setSelectedReportRecord] = React.useState(null);
  const [relatedRows, setRelatedRows] = React.useState({});
  const result = state.results[box.id];
  const locale = state.doc.numberFormat;
  const recordKey = selectedReportRecord ? JSON.stringify(selectedReportRecord) : "";

  /* Record popup boxes (header / details / line items) for the table box. */
  const [sectionRows, setSectionRows] = React.useState({});
  const tableDetail = box.kind === "table" ? box.table?.detail || {} : {};
  const tableDetailSections = tableDetail.sections || [];
  React.useEffect(() => {
    if (box.kind !== "table" || !detailValue || !tableDetailSections.length) return;

    const todo = tableDetailSections.filter((sec) =>
      (sec.columns || []).some((c) => c.col)
    );
    if (!todo.length) return;

    let cancelled = false;
    const controller = new AbortController();

    setSectionRows((prev) => {
      const next = { ...prev };
      todo.forEach((sec) => {
        next[sec.id] = { loading: true, rows: [], error: "", value: detailValue };
      });
      return next;
    });

    todo.forEach(async (sec) => {
      try {
        const data = await fetchDetailRows({
          box,
          processKey: state.processKey,
          keyColumn: tableDetail.keyColumn,
          value: detailValue,
          columns: (sec.columns || []).map((c) => c.col).filter(Boolean),
          limit: sec.type === "lineItems" ? tableDetail.limit || 100 : 1,
          signal: controller.signal,
        });
        if (cancelled) return;
        setSectionRows((prev) => ({
          ...prev,
          [sec.id]: { loading: false, rows: data.rows || [], error: "", value: detailValue },
        }));
      } catch (err) {
        if (cancelled || err.name === "AbortError") return;
        setSectionRows((prev) => ({
          ...prev,
          [sec.id]: {
            loading: false,
            rows: [],
            error: err.message || "Could not load this box.",
            value: detailValue,
          },
        }));
      }
    });

    return () => {
      cancelled = true;
      controller.abort();
    };
  }, [
    box.kind,
    detailValue,
    tableDetail.keyColumn,
    box.src?.base,
    JSON.stringify(
      tableDetailSections.map((sec) => [
        sec.id,
        sec.type,
        (sec.columns || []).map((c) => c.col),
      ])
    ),
  ]);

React.useEffect(() => {
  if (box.kind !== "reportView") return;

  const fallbackKey =
    box.reportView?.clickableColumn ||
    (box.reportView?.columns || []).find((c) => c.col)?.col ||
    "";

  const sections = (box.reportView?.popupSections || []).filter(
    (section) =>
      (section.type === "dataTable" && section.mode === "standalone") ||
      (
        !!selectedReportRecord &&
        (
          section.type === "relatedTable" ||
          section.type === "lineItems" ||
          (section.type === "dataTable" && section.mode !== "standalone")
        )
      )
  ).filter((sec) => popupSectionReady(sec, fallbackKey));

  if (!sections.length) return;

  let cancelled = false;
  const controller = new AbortController();

  /* Same lookup the main table's row-detail list uses, so line items can
     pull columns from any table for the record that is open. */
  const toAlias = (n) => String(n || "").replace(/\./g, "__");
  const loadLineItems = async (section) => {
    const keyCol = section.keyColumn || fallbackKey;
    const record = selectedReportRecord || {};
    const raw = record[toAlias(keyCol)] ?? record[keyCol];
    const detailColumns = (section.columns || []).map((c) => c.col).filter(Boolean);
    const limit = section.limit || 100;
    const debug = {
      parentTable: box?.src?.base || "",
      keyColumn: keyCol,
      value: raw === undefined || raw === null ? "" : String(raw),
      columns: detailColumns,
      recordKeys: Object.keys(record),
    };
    console.log("LINE ITEMS LOOKUP:", debug);
    if (raw === undefined || raw === null || raw === "") {
      return { rows: [], _debug: debug };
    }

    const value = String(raw);

    if (window.location.pathname.includes("/r/")) {
      const [, publicPath] = window.location.pathname.split("/r/");
      const [publicKey, publicToken] = publicPath.split("/");
      const params = new URLSearchParams({
        parentTable: box?.src?.base || "",
        lookupColumn: keyCol,
        value,
        detailColumns: detailColumns.join(","),
        limit: String(limit),
      });
      const vt = new URLSearchParams(window.location.search).get("vt");
      if (vt) params.set("vt", vt);

      const res = await fetch(
        `/api/r/${encodeURIComponent(publicKey)}/${encodeURIComponent(publicToken)}/detail?${params.toString()}`,
        { signal: controller.signal }
      );
      if (!res.ok) throw new Error("Could not load line items");
      return { ...(await res.json()), _debug: debug };
    }

    const result = await api.getDetailRows(
      state.processKey,
      box?.src?.base || "",
      keyCol,
      value,
      detailColumns,
      limit
    );
    return { ...result, _debug: debug };
  };

  async function loadRelatedRows() {
    const initial = {};
    sections.forEach((section) => {
      initial[section.id] = {
        loading: true,
        rows: [],
        error: "",
        rec: popupRecFor(section, recordKey),
      };
    });
    setRelatedRows((previous) => ({ ...previous, ...initial }));

    await Promise.all(
      sections.map(async (section) => {
        try {
          if (!section.id) {
            throw new Error("Save this popup section before using it.");
          }

          const data = section.type === "lineItems"
            ? await loadLineItems(section)
            : publicSlug
            ? await api.publicReportViewRelatedRows(
                publicSlug,
                box.id,
                section.id,
                section.type === "dataTable" && section.mode === "standalone"
                  ? null
                  : selectedReportRecord,
                state.filterState,
                100,
                controller.signal
              )
            : await api.getReportViewRelatedRows(
                state.processKey,
                box.id,
                section.id,
                section.type === "dataTable" && section.mode === "standalone"
                  ? null
                  : selectedReportRecord,
                state.filterState,
                100,
                controller.signal
              );

          if (!cancelled) {
            setRelatedRows((previous) => ({
              ...previous,
              [section.id]: {
                loading: false,
                rows: data.rows || [],
                error: "",
                debug: data._debug,
                rec: popupRecFor(section, recordKey),
              },
            }));
          }
        } catch (error) {
          if (cancelled || error.name === "AbortError") return;

          setRelatedRows((previous) => ({
            ...previous,
            [section.id]: {
              loading: false,
              rows: [],
              error: error.message || "Could not load related rows.",
              rec: popupRecFor(section, recordKey),
            },
          }));
        }
      })
    );
  }

  loadRelatedRows();

  return () => {
    cancelled = true;
    controller.abort();
  };
}, [
  selectedReportRecord,
  box.id,
  box.kind,
  JSON.stringify(box.reportView?.popupSections || []),
  publicSlug,
  state.processKey,
  JSON.stringify(state.filterState),
]);

    if (box.kind === "reportView") {
    const config = box.reportView || {};
    const rows = result?.rows || [];
    const columns = (config.columns || [])
      .filter((col) => col.col);

    const alias = (name) => name.replace(/\./g, "__");

    const design = state.mode === "design";
    const popupSections = config.popupSections || [];
    const setBox = (path, value) =>
      dispatch({ type: "set", target: "box", id: box.id, path, value });
    const defaultKeyColumn =
      config.clickableColumn || (config.columns || []).find((c) => c.col)?.col || "";
    const addPopupSection = (type) =>
      setBox("reportView.popupSections", [
        ...popupSections,
        newPopupSection(type, defaultKeyColumn),
      ]);
    const removePopupSection = (index) =>
      setBox(
        "reportView.popupSections",
        popupSections.filter((_, i) => i !== index)
      );

    /* Only ever show rows that were loaded for the record that is open now. */
    const freshRows = (section) => {
      const raw = relatedRows[section.id];
      return raw && raw.rec === popupRecFor(section, recordKey) ? raw : undefined;
    };

    const catalogTableList = (state.catalog?.tables || [])
      .map((t) => (typeof t === "string" ? { name: t, columns: [] } : t))
      .filter((t) => t?.name);
    const tableColumnNames = (tableName) =>
      (catalogTableList.find((t) => t.name === tableName)?.columns || [])
        .map((c) => (typeof c === "string" ? c : c.name))
        .filter(Boolean);
    const allTableColumns = catalogTableList.flatMap((t) =>
      (t.columns || [])
        .map((c) => (typeof c === "string" ? c : c.name))
        .filter(Boolean)
        .map((name) => [`${t.name}.${name}`, `${t.name}.${name}`])
    );
    const relationshipsFor = (tableName) => {
      const parent = box?.src?.base || "";
      return (state.catalog?.relationships || []).flatMap((r) => {
        if (r.from_table === tableName && r.to_table === parent)
          return [{ fromColumn: r.from_column, toColumn: r.to_column }];
        if (r.from_table === parent && r.to_table === tableName)
          return [{ fromColumn: r.to_column, toColumn: r.from_column }];
        return [];
      });
    };
    const parentTableName = box?.src?.base || "";
    const parentColumnNames = colOptions(state.catalog, box.src)
      .map((c) => c.name)
      .filter(Boolean)
      .map((n) =>
        parentTableName && n.startsWith(`${parentTableName}.`)
          ? n.slice(parentTableName.length + 1)
          : n
      );

    /* Pick the table, how it links to the open record, and its columns —
       right inside the popup. */
    const renderPopupDataBar = (section, sectionIndex) => {
      const base = `reportView.popupSections.${sectionIndex}`;
      const cols = section.columns || [];
      const standalone = isStandaloneSection(section);
      const used = new Set(cols.map((c) => c.col));
      const tableCols = tableColumnNames(section.table);
      const addable = tableCols.filter((n) => !used.has(n));
      const rels = relationshipsFor(section.table);
      const relKey = (r) => `${r?.fromColumn}|${r?.toColumn}`;
      const link = section.relationship || {};
      const setLink = (patch) =>
        setBox(`${base}.relationship`, {
          fromColumn: link.fromColumn || "",
          toColumn: link.toColumn || "",
          ...patch,
        });

      const labelled = (text, control) => (
        <label style={{ display: "grid", gap: 2, fontSize: 11, opacity: 0.95 }}>
          <span style={{ opacity: 0.7 }}>{text}</span>
          {control}
        </label>
      );

      return (
        <div
          style={{
            border: "1px dashed var(--border, #bbb)",
            borderRadius: 8,
            padding: 10,
            margin: "6px 0 10px",
            display: "grid",
            gap: 10,
          }}
        >
          {labelled(
            standalone ? "Database table" : "Line item table",
            <Select
              value={section.table || ""}
              options={[
                ["", "Select a table"],
                ...catalogTableList.map((t) => [t.name, t.name]),
              ]}
              onChange={(v) => {
                setBox(`${base}.table`, v);
                setBox(`${base}.columns`, []);
                const candidates = relationshipsFor(v);
                setBox(
                  `${base}.relationship`,
                  !standalone && candidates.length === 1 ? candidates[0] : null
                );
              }}
            />
          )}

          {!standalone && section.table && (
            <div style={{ display: "grid", gap: 6 }}>
              {rels.length > 0 &&
                labelled(
                  "Detected link to the invoice",
                  <Select
                    value={link.fromColumn && link.toColumn ? relKey(link) : ""}
                    options={[
                      ["", "Choose a detected link"],
                      ...rels.map((r) => [
                        relKey(r),
                        `${section.table}.${r.fromColumn} = ${parentTableName}.${r.toColumn}`,
                      ]),
                    ]}
                    onChange={(v) => {
                      const picked = rels.find((r) => relKey(r) === v);
                      setBox(`${base}.relationship`, picked || null);
                    }}
                  />
                )}

              <div style={{ display: "flex", flexWrap: "wrap", gap: 8, alignItems: "end" }}>
                {labelled(
                  `${section.table} column`,
                  <Select
                    value={link.fromColumn || ""}
                    options={[["", "Select column"], ...tableCols]}
                    onChange={(v) => setLink({ fromColumn: v })}
                  />
                )}
                <span style={{ paddingBottom: 6 }}>=</span>
                {labelled(
                  `${parentTableName || "Invoice"} column`,
                  <Select
                    value={link.toColumn || ""}
                    options={[["", "Select column"], ...parentColumnNames]}
                    onChange={(v) => setLink({ toColumn: v })}
                  />
                )}
              </div>

              {!rels.length && (
                <div style={{ fontSize: 12, opacity: 0.75 }}>
                  No saved relationship between {section.table} and{" "}
                  {parentTableName || "the report table"}. Pick the two matching
                  columns above (for example invoice_id = id).
                </div>
              )}
            </div>
          )}

          <div style={{ display: "flex", flexWrap: "wrap", gap: 8, alignItems: "end" }}>
            {labelled(
              "Add column from this table",
              <Select
                value=""
                options={[["", "Choose column…"], ...addable]}
                onChange={(v) => {
                  if (!v) return;
                  setBox(`${base}.columns`, [
                    ...cols,
                    { col: v, label: v.split(".").pop(), fmt: "auto", align: "left" },
                  ]);
                }}
              />
            )}

            {labelled(
              "Add column from any table",
              <Select
                value=""
                options={[["", "Choose column…"], ...allTableColumns]}
                onChange={(v) => {
                  if (!v) return;
                  const [tableName, ...rest] = v.split(".");
                  const name = rest.join(".");
                  setBox(`${base}.columns`, [
                    ...cols,
                    tableName === section.table
                      ? { col: name, label: name, fmt: "auto", align: "left" }
                      : {
                          table: tableName,
                          col: name,
                          key: v,
                          label: name,
                          fmt: "auto",
                          align: "left",
                        },
                  ]);
                }}
              />
            )}

            <button
              type="button"
              className="pb"
              onClick={() =>
                setBox(`${base}.columns`, [
                  ...cols,
                  ...addable.map((n) => ({
                    col: n,
                    label: n.split(".").pop(),
                    fmt: "auto",
                    align: "left",
                  })),
                ])
              }
            >
              + All columns
            </button>
          </div>

          {cols.length > 0 && (
            <div style={{ display: "flex", flexWrap: "wrap", gap: 6 }}>
              {cols.map((c, i) => (
                <span
                  key={`${c.col}-${i}`}
                  style={{
                    display: "inline-flex",
                    alignItems: "center",
                    gap: 4,
                    padding: "2px 6px",
                    border: "1px solid var(--border, #ccc)",
                    borderRadius: 12,
                    fontSize: 12,
                  }}
                >
                  <button
                    type="button"
                    className="xbtn"
                    title="Move left"
                    disabled={i === 0}
                    onClick={() => {
                      const next = [...cols];
                      [next[i - 1], next[i]] = [next[i], next[i - 1]];
                      setBox(`${base}.columns`, next);
                    }}
                  >
                    ←
                  </button>
                  <Editable
                    value={c.label || c.col}
                    placeholder="Heading"
                    style={{ display: "inline-block", minWidth: 40 }}
                    onChange={(v) => setBox(`${base}.columns.${i}.label`, v)}
                  />
                  <button
                    type="button"
                    className="xbtn"
                    title="Move right"
                    disabled={i === cols.length - 1}
                    onClick={() => {
                      const next = [...cols];
                      [next[i + 1], next[i]] = [next[i], next[i + 1]];
                      setBox(`${base}.columns`, next);
                    }}
                  >
                    →
                  </button>
                  <button
                    type="button"
                    className="xbtn"
                    title="Remove column"
                    onClick={() =>
                      setBox(
                        `${base}.columns`,
                        cols.filter((_, idx) => idx !== i)
                      )
                    }
                  >
                    ×
                  </button>
                </span>
              ))}
            </div>
          )}
        </div>
      );
    };

    /* Line items: choose what identifies the record, then add columns from
       any table — type to search. */
    const renderLineItemsBar = (section, sectionIndex) => {
      const base = `reportView.popupSections.${sectionIndex}`;
      const cols = section.columns || [];
      const visiblePairs = (config.columns || [])
        .filter((c) => c.col)
        .map((c) => [c.col, c.label || c.col]);
      const seenKeys = new Set(visiblePairs.map((p) => p[0]));
      const keyOptions = [
        ...visiblePairs,
        ...colOptions(state.catalog, box.src)
          .map((c) => c.name)
          .filter((n) => n && !seenKeys.has(n))
          .map((n) => [n, n]),
      ];
      const known = new Set(allTableColumns.map((o) => o[0]));
      const listId = `li-cols-${box.id}-${sectionIndex}`;

      const addColumn = (v) =>
        setBox(`${base}.columns`, [
          ...cols,
          { col: v, label: v.split(".").pop(), fmt: "auto", align: "left" },
        ]);

      return (
        <div
          style={{
            border: "1px dashed var(--border, #bbb)",
            borderRadius: 8,
            padding: 10,
            margin: "6px 0 10px",
            display: "grid",
            gap: 10,
          }}
        >
          <div style={{ display: "flex", flexWrap: "wrap", gap: 10, alignItems: "end" }}>
            <label style={{ display: "grid", gap: 2, fontSize: 11 }}>
              <span style={{ opacity: 0.7 }}>Match line items to this record by</span>
              <Select
                value={section.keyColumn || defaultKeyColumn || ""}
                options={[["", "Select column"], ...keyOptions]}
                onChange={(v) => setBox(`${base}.keyColumn`, v)}
              />
            </label>

            <label style={{ display: "grid", gap: 2, fontSize: 11, flex: 1, minWidth: 220 }}>
              <span style={{ opacity: 0.7 }}>
                Add a column from any table — type to search (e.g. uom, material)
              </span>
              <input
                list={listId}
                placeholder="table.column"
                onChange={(e) => {
                  const v = e.target.value;
                  if (known.has(v)) {
                    addColumn(v);
                    e.target.value = "";
                  }
                }}
                style={{ padding: "6px 8px" }}
              />
              <datalist id={listId}>
                {allTableColumns.map(([value]) => (
                  <option key={value} value={value} />
                ))}
              </datalist>
            </label>
          </div>

          {cols.some((c) => !String(c.col).includes(".")) && (
            <div style={{ fontSize: 12, color: "#B3261E" }}>
              Some columns have no table name (shown in red). Remove them and add
              them again by typing table.column.
            </div>
          )}

          {cols.length > 0 && (
            <div style={{ display: "flex", flexWrap: "wrap", gap: 6 }}>
              {cols.map((c, i) => (
                <span
                  key={`${c.col}-${i}`}
                  style={{
                    display: "inline-flex",
                    alignItems: "center",
                    gap: 4,
                    padding: "2px 6px",
                    border: `1px solid ${
                      String(c.col).includes(".") ? "var(--border, #ccc)" : "#B3261E"
                    }`,
                    borderRadius: 12,
                    fontSize: 12,
                  }}
                  title={c.col}
                >
                  <button
                    type="button"
                    className="xbtn"
                    title="Move left"
                    disabled={i === 0}
                    onClick={() => {
                      const next = [...cols];
                      [next[i - 1], next[i]] = [next[i], next[i - 1]];
                      setBox(`${base}.columns`, next);
                    }}
                  >
                    ←
                  </button>
                  <Editable
                    value={c.label || c.col}
                    placeholder="Heading"
                    style={{ display: "inline-block", minWidth: 40 }}
                    onChange={(v) => setBox(`${base}.columns.${i}.label`, v)}
                  />
                  <button
                    type="button"
                    className="xbtn"
                    title="Move right"
                    disabled={i === cols.length - 1}
                    onClick={() => {
                      const next = [...cols];
                      [next[i + 1], next[i]] = [next[i], next[i + 1]];
                      setBox(`${base}.columns`, next);
                    }}
                  >
                    →
                  </button>
                  <button
                    type="button"
                    className="xbtn"
                    title="Remove column"
                    onClick={() =>
                      setBox(
                        `${base}.columns`,
                        cols.filter((_, idx) => idx !== i)
                      )
                    }
                  >
                    ×
                  </button>
                </span>
              ))}
            </div>
          )}
        </div>
      );
    };

    const filteredRows = rows.filter((row) => {
      if (!config.search || !reportSearchTerm.trim()) return true;

      const query = reportSearchTerm.toLowerCase();

      return columns.some((col) =>
        String(row[alias(col.col)] ?? row[col.col] ?? "")
          .toLowerCase()
          .includes(query)
      );
    });

    const pageSize = Math.max(1, Number(config.pageSize) || 10);
    const totalPages = Math.max(1, Math.ceil(filteredRows.length / pageSize));
    const currentPage = Math.min(reportPage, totalPages);
    const pageRows = config.pagination
      ? filteredRows.slice((currentPage - 1) * pageSize, currentPage * pageSize)
      : filteredRows;

    return (
      <div className="report-view">
        {config.search && (
          <input
            type="search"
            className="report-view-search"
            placeholder="Search records..."
            value={reportSearchTerm}
            onChange={(e) => {
              setReportSearchTerm(e.target.value);
              setReportPage(1);
            }}
          />
        )}

        <div className="rt-table-wrap">
          <table className="rt">
            <thead>
              <tr>
                {columns.map((col) => (
                  <th key={col.col}>{col.label || col.col}</th>
                ))}
              </tr>
            </thead>

            <tbody>
              {pageRows.map((row, index) => (
                <tr
                  key={index}
                  onClick={() => setSelectedReportRecord(row)}
                  style={{ cursor: "pointer" }}
                >
                  {columns.map((col) => {
                    const value = row[alias(col.col)] ?? row[col.col];
                    const isClickable =
                      config.clickableColumn === col.col && value != null;

                    return (
                      <td key={col.col}>
                        {isClickable ? (
                          <span
                            className="report-view-clickable-cell"
                            role="button"
                            tabIndex={0}
                            onClick={() => setSelectedReportRecord(row)}
                            onKeyDown={(e) => {
                              if (e.key === "Enter" || e.key === " ") {
                                e.preventDefault();
                                setSelectedReportRecord(row);
                              }
                            }}
                          >
                            {fmtCell(value, col.fmt || "auto", locale)}
                          </span>
                        ) : (
                          fmtCell(value, col.fmt || "auto", locale)
                        )}
                      </td>
                    );
                  })}
                </tr>
              ))}

              {!pageRows.length && (
                <tr>
                  <td colSpan={Math.max(1, columns.length)}>
                    {result?.error || "No matching records found."}
                  </td>
                </tr>
              )}
            </tbody>
          </table>
        </div>

        {config.pagination && filteredRows.length > 0 && (
          <div className="report-view-pagination">
            <span>
              {filteredRows.length} records · Page {currentPage} of {totalPages}
            </span>

            <button
              className="pb"
              disabled={currentPage <= 1}
              onClick={() => setReportPage((p) => Math.max(1, p - 1))}
            >
              Previous
            </button>

            <button
              className="pb"
              disabled={currentPage >= totalPages}
              onClick={() => setReportPage((p) => Math.min(totalPages, p + 1))}
            >
              Next
            </button>
          </div>
        )}


        {(config.popupSections || [])
          .filter(
            (section) =>
              section.type === "dataTable" && section.mode === "standalone"
          )
          .map((section, sectionIndex) => {
            const data = freshRows(section);
            const standaloneColumns = (section.columns || []).filter(
              (col) => col.col
            );
            const cellAlias = (name) => name.replace(/\./g, "__");

            return (
              <section
                className="report-view-popup-section"
                key={section.id || `standalone-${sectionIndex}`}
              >
                <h4>{section.title || "Data Table"}</h4>
                {design && renderPopupDataBar(section, sectionIndex)}
                {!popupSectionReady(section, defaultKeyColumn) ? (
                  <p>Choose a database table above.</p>
                ) : data?.loading || !data ? (
                  <p>Loading database records…</p>
                ) : data.error ? (
                  <p role="alert">{data.error}</p>
                ) : !standaloneColumns.length ? (
                  <p>No columns configured for this table.</p>
                ) : !data.rows.length ? (
                  <p>No records found.</p>
                ) : (
                  <div className="rt-table-wrap">
                    <table className="rt">
                      <thead>
                        <tr>
                          {standaloneColumns.map((col) => (
                            <th key={col.col} {...cellAlign(col)}>{col.label || col.col}</th>
                          ))}
                        </tr>
                      </thead>
                      <tbody>
                        {data.rows.slice(0, section.limit || 100).map((row, rowIndex) => (
                          <tr
                            key={rowIndex}
                            className={section.zebra && rowIndex % 2 ? "z" : undefined}
                          >
                            {standaloneColumns.map((col) => (
                              <td key={col.col} {...cellAlign(col)}>
                                {fmtCell(
                                  row[cellAlias(col.key || col.col)] ?? row[col.key || col.col],
                                  col.fmt || "auto",
                                  locale
                                )}
                              </td>
                            ))}
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </div>
                )}
              </section>
            );
          })}

        {selectedReportRecord && (
          <div
            className="report-view-overlay"
            onMouseDown={(e) => {
              if (e.target === e.currentTarget) setSelectedReportRecord(null);
            }}
          >
            <div className="report-view-modal" role="dialog" aria-modal="true">
              <div className="report-view-modal-header">
                <h3>{config.detailTitle || "Record Details"}</h3>
                <button
                  className="xbtn"
                  onClick={() => setSelectedReportRecord(null)}
                  aria-label="Close details"
                >
                  ×
                </button>
              </div>

              {(config.popupSections || []).length > 0 ? (
                <div className="report-view-popup-sections">
                  {config.popupSections.map((section, sectionIndex) => {
                    const sectionColumns = (section.columns || []).filter(
                      (col) => col.col
                    );

                    return (
                      <section
                        className="report-view-popup-section"
                        key={section.id || sectionIndex}
                      >
                        {design ? (
                          <div
                            style={{
                              display: "flex",
                              alignItems: "center",
                              justifyContent: "space-between",
                              gap: 8,
                            }}
                          >
                            <Editable
                              className="box-title"
                              style={{ fontWeight: 600, flex: 1 }}
                              value={section.title}
                              placeholder={`Section ${sectionIndex + 1}`}
                              onChange={(v) =>
                                setBox(
                                  `reportView.popupSections.${sectionIndex}.title`,
                                  v
                                )
                              }
                            />
                            <button
                              type="button"
                              className="xbtn"
                              title="Remove this box"
                              onClick={() => removePopupSection(sectionIndex)}
                            >
                              ×
                            </button>
                          </div>
                        ) : (
                          <h4>{section.title || `Section ${sectionIndex + 1}`}</h4>
                        )}

                        {section.type === "manualTable" ? (
                          <div className="report-view-related-table">
                            {(() => {
                              const table = section.manualTable || {};
                              const tableColumns = table.columns || [];
                              const tableRows = table.rows || [];
                              const base = `reportView.popupSections.${sectionIndex}.manualTable`;

                              const writeTable = (next) =>
                                setBox(base, {
                                  zebra: true,
                                  ...table,
                                  columns: tableColumns,
                                  rows: tableRows,
                                  ...next,
                                });

                              const addRow = () =>
                                writeTable({
                                  rows: [
                                    ...tableRows,
                                    {
                                      id: uid("row"),
                                      cells: tableColumns.map(() => ""),
                                    },
                                  ],
                                });

                              const addColumn = () =>
                                writeTable({
                                  columns: [
                                    ...tableColumns,
                                    {
                                      id: uid("col"),
                                      label: `Column ${tableColumns.length + 1}`,
                                    },
                                  ],
                                  rows: tableRows.map((row) => ({
                                    ...row,
                                    cells: [...(row.cells || []), ""],
                                  })),
                                });

                              const removeColumn = (index) =>
                                writeTable({
                                  columns: tableColumns.filter((_, i) => i !== index),
                                  rows: tableRows.map((row) => ({
                                    ...row,
                                    cells: (row.cells || []).filter((_, i) => i !== index),
                                  })),
                                });

                              const removeRow = (index) =>
                                writeTable({
                                  rows: tableRows.filter((_, i) => i !== index),
                                });

                              const setLabel = (index, value) =>
                                writeTable({
                                  columns: tableColumns.map((col, i) =>
                                    i === index ? { ...col, label: value } : col
                                  ),
                                });

                              const setCell = (rowIndex, colIndex, value) =>
                                writeTable({
                                  rows: tableRows.map((row, r) =>
                                    r !== rowIndex
                                      ? row
                                      : {
                                          ...row,
                                          cells: tableColumns.map((_, c) =>
                                            c === colIndex
                                              ? value
                                              : row.cells?.[c] ?? ""
                                          ),
                                        }
                                  ),
                                });

                              if (!tableColumns.length && !design) {
                                return <p>No columns configured for this table.</p>;
                              }

                              return (
                                <div className="manual-table-wrap">
                                  <div className="rt-table-wrap">
                                    <table className="rt manual-table">
                                      <thead>
                                        <tr>
                                          {tableColumns.map((col, i) => (
                                            <th key={col.id || i}>
                                              <div
                                                style={{
                                                  display: "flex",
                                                  alignItems: "center",
                                                  gap: 4,
                                                }}
                                              >
                                                <Editable
                                                  value={col.label}
                                                  placeholder={`Column ${i + 1}`}
                                                  editable={design}
                                                  onChange={(v) => setLabel(i, v)}
                                                />
                                                {design && tableColumns.length > 1 && (
                                                  <button
                                                    type="button"
                                                    className="xbtn"
                                                    title="Remove column"
                                                    onClick={() => removeColumn(i)}
                                                  >
                                                    ×
                                                  </button>
                                                )}
                                              </div>
                                            </th>
                                          ))}
                                          {design && <th style={{ width: 28 }} />}
                                        </tr>
                                      </thead>
                                      <tbody>
                                        {tableRows.map((row, rowIndex) => (
                                          <tr
                                            key={row.id || rowIndex}
                                            className={
                                              table.zebra && rowIndex % 2 ? "z" : undefined
                                            }
                                          >
                                            {tableColumns.map((col, colIndex) => (
                                              <td key={col.id || colIndex}>
                                                <Editable
                                                  value={row.cells?.[colIndex] ?? ""}
                                                  placeholder=""
                                                  editable={design}
                                                  onChange={(v) =>
                                                    setCell(rowIndex, colIndex, v)
                                                  }
                                                />
                                              </td>
                                            ))}
                                            {design && (
                                              <td>
                                                <button
                                                  type="button"
                                                  className="xbtn"
                                                  title="Remove row"
                                                  onClick={() => removeRow(rowIndex)}
                                                >
                                                  ×
                                                </button>
                                              </td>
                                            )}
                                          </tr>
                                        ))}
                                      </tbody>
                                    </table>
                                  </div>

                                  {design && (
                                    <div className="manual-table-actions">
                                      <button type="button" className="pb" onClick={addRow}>
                                        + Add Row
                                      </button>
                                      <button type="button" className="pb" onClick={addColumn}>
                                        + Add Column
                                      </button>
                                    </div>
                                  )}
                                </div>
                              );
                            })()}
                          </div>
                        ) : section.type === "relatedTable" ||
                          section.type === "dataTable" ||
                          section.type === "lineItems" ? (

<div className="report-view-related-table">
  {design && section.type === "dataTable" && renderPopupDataBar(section, sectionIndex)}
  {design && section.type === "lineItems" && renderLineItemsBar(section, sectionIndex)}
  {(() => {
    const data = freshRows(section);
    const relatedColumns = sectionColumns;

    if (!popupSectionReady(section, defaultKeyColumn)) {
      return (
        <p>
          {design
            ? section.type === "lineItems"
              ? "Choose what to match on, then add columns above."
              : "Rows will appear once the line item table is linked to the invoice (pick the matching columns above)."
            : "This section is not configured yet."}
        </p>
      );
    }

    if (data?.loading || !data) {
      return <p>Loading related records…</p>;
    }

    if (data.error) {
      return <p role="alert">{data.error}</p>;
    }

    if (!data.rows.length) {
      const d = data.debug;
      return (
        <>
          <p>No related records found.</p>
          {design && d && (
            <div style={{ fontSize: 12, opacity: 0.8, display: "grid", gap: 2 }}>
              <div>
                Looked up <b>{d.parentTable || "(no table)"}</b> where{" "}
                <b>{d.keyColumn}</b> = <b>{d.value === "" ? "(empty)" : d.value}</b>
              </div>
              <div>Columns asked for: {d.columns.join(", ") || "(none)"}</div>
              {d.value === "" && (
                <div style={{ color: "#B3261E" }}>
                  This record has no value for “{d.keyColumn}”. Its fields are:{" "}
                  {d.recordKeys.join(", ")}. Pick one of those in “Match line
                  items to this record by”.
                </div>
              )}
              {d.columns.some((c) => !c.includes(".")) && (
                <div style={{ color: "#B3261E" }}>
                  Columns without a table name (
                  {d.columns.filter((c) => !c.includes(".")).join(", ")}) can't be
                  found. Remove them and add them again by typing table.column.
                </div>
              )}
            </div>
          )}
        </>
      );
    }

    if (!relatedColumns.length) {
      return <p>No columns configured for this related table.</p>;
    }

    const cellAlias = (name) => name.replace(/\./g, "__");

    return (
      <div className="rt-table-wrap">
        <table className="rt">
          <thead>
            <tr>
              {relatedColumns.map((col) => (
                <th key={col.col} {...cellAlign(col)}>{col.label || col.col}</th>
              ))}
            </tr>
          </thead>
          <tbody>
            {data.rows.slice(0, section.limit || 100).map((row, rowIndex) => (
              <tr
                key={rowIndex}
                className={section.zebra && rowIndex % 2 ? "z" : undefined}
              >
                {relatedColumns.map((col) => (
                  <td key={col.col} {...cellAlign(col)}>
                    {fmtCell(
                      row[cellAlias(col.key || col.col)] ?? row[col.key || col.col],
                      col.fmt || "auto",
                      locale
                    )}
                  </td>
                ))}
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    );
  })()}
</div>

                        ) : (
                          <div className="report-view-details">
                            {sectionColumns.map((col) => {
                              const value =
                                selectedReportRecord[alias(col.col)] ??
                                selectedReportRecord[col.col];

                              return (
                                <div
                                  className="report-view-detail"
                                  key={col.col}
                                >
                                  <span>{col.label || col.col}</span>
                                  <strong>
                                    {fmtCell(value, col.fmt || "auto", locale)}
                                  </strong>
                                </div>
                              );
                            })}

                            {!sectionColumns.length && (
                              <p>No fields configured for this section.</p>
                            )}
                          </div>
                        )}
                      </section>
                    );
                  })}
                </div>
              ) : (
                <div className="report-view-details">
                  {(config.detailColumns?.length
                    ? config.detailColumns
                    : columns
                  )
                    .filter((col) => col.col)
                    .map((col) => (
                      <div className="report-view-detail" key={col.col}>
                        <span>{col.label || col.col}</span>
                        <strong>
                          {fmtCell(
                            selectedReportRecord[alias(col.col)] ??
                              selectedReportRecord[col.col],
                            col.fmt || "auto",
                            locale
                          )}
                        </strong>
                      </div>
                    ))}
                </div>
              )}

              {design && (
                <div className="manual-table-actions" style={{ marginTop: 12 }}>
                  <button
                    type="button"
                    className="pb"
                    onClick={() => addPopupSection("lineItems")}
                  >
                    + Add Box
                  </button>
                  <button
                    type="button"
                    className="pb"
                    onClick={() => addPopupSection("fields")}
                  >
                    + Add Fields
                  </button>
                  <button
                    type="button"
                    className="pb"
                    onClick={() => addPopupSection("manualTable")}
                  >
                    + Add Manual Table
                  </button>
                </div>
              )}
            </div>
          </div>
        )}

      </div>
    );
  }
  const slug = window.location.pathname.split("/r/")[1] || "";
  const [publicKey, publicToken] = slug.split("/");

  if (box.kind === "note") {
    return (
      <Editable className="note-body" value={box.note.html}
        placeholder="Write a note, a caveat, a definition…"
        onChange={(v) => dispatch({ type: "set", target: "box", id: box.id, path: "note.html", value: v })} />
    );
  }

  if (box.kind === "value") {
    const c = box.value;
    let shown;
    if (c.source === "manual") {
      shown = (
        <Editable className="kpi-inline" value={c.manual} placeholder="0"
          onChange={(v) => dispatch({ type: "set", target: "box", id: box.id, path: "value.manual", value: v })} />
      );
    } else if (result?.error) {
      return <Placeholder msg="Formula problem" sub={result.error} />;
    } else {
      const v = result?.value;
      shown = v === null || v === undefined ? "—" : fmtNumber(v, c.decimals, locale);
    }
    return (
      <>
        <div className="kpi" style={{ color: c.tone || "#1A2326" }}>
          {c.prefix}{shown}{c.suffix}
          {c.unit && <span className="kpi-unit">{c.unit}</span>}
        </div>
        {c.delta && (
          <div className={`kpi-delta ${c.deltaDir}`}>
            {c.deltaDir === "up" ? "▲" : c.deltaDir === "down" ? "▼" : "■"} {c.delta}
          </div>
        )}
        {c.showTrack && (
          <div className="track">
            <i style={{ width: `${Math.max(0, Math.min(100, c.trackPct))}%`,
              background: c.tone || "#0D6E62" }} />
          </div>
        )}
        {c.note && <div className="kpi-note">{c.note}</div>}
      </>
    );
  }

  if (box.kind === "chart") {
  const c = box.chart || {};

  let data = result?.data || [];

  /*
   * TABLE -> GRAPH
   */
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
        /*
         * Database table
         */
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

      /*
       * Sort using the chart settings.
       */
      if (c.sort === "value") {
        data.sort((a, b) =>
          c.dir === "asc"
            ? a.value - b.value
            : b.value - a.value
        );
      } else {
        data.sort((a, b) =>
          c.dir === "asc"
            ? String(a.label).localeCompare(
                String(b.label)
              )
            : String(b.label).localeCompare(
                String(a.label)
              )
        );
      }

      if (Number(c.limit) > 0) {
        data = data.slice(
          0,
          Number(c.limit)
        );
      }
    }
  }

  if (!data.length) {
    const [msg, sub] =
      stateNote(box, state.catalog);

    const label =
      (
        CHARTS.find(
          (x) => x[0] === c.type
        ) || ["", "Chart"]
      )[1];

    return (
      <Placeholder
        msg={`${label} · ${msg}`}
        sub={sub}
        height={c.height || 220}
      />
    );
  }

  const pos =
    c.legendPos || "bottom";

  return (
    <div className={`chartwrap lp-${pos}`}>
      <div className="chartsvg">
        <Chart
          data={data}
          cfg={c}
        />
      </div>

      {c.legend && (
        <Legend
          items={legendItems(data, c)}
          position={pos}
          showValues={c.type === "donut"}
        />
      )}
    </div>
  );
}
/* GRAPH TABLE */
if (box.tableMode === "graph") {
  const graphBox = state.doc.sections
    .flatMap((section) => section.boxes || [])
    .find((b) => b.id === box.table?.graphBoxId);

  const graphData = graphBox
    ? state.results[graphBox.id]?.data || []
    : [];

  if (!graphBox) {
    return (
      <div className="empty">
        Select a graph in <b>⚙ Set up</b>.
      </div>
    );
  }

  if (!graphData.length) {
    return (
      <div className="empty">
        Waiting for graph data.
      </div>
    );
  }

  const rows = graphData.slice(0, box.table?.limit || 10);

  return (
    <table className="rt">
      <thead>
        <tr>
          <th>Category</th>
          <th className="num">Value</th>
        </tr>
      </thead>

      <tbody>
        {rows.map((row, i) => (
          <tr
            key={i}
            className={
              box.table?.zebra && i % 2 ? "z" : undefined
            }
          >
            <td>{row.label}</td>
            <td className="num">
              {fmtNumber(
                row.value,
                0,
                locale
              )}
            </td>
          </tr>
        ))}
      </tbody>
    </table>
  );
}
    /* table */
  if (box.tableMode === "manual") {
    const t = box.manualTable;

    return (
      <div className="manual-table-wrap">
        <table className="rt manual-table">
          <thead>
            <tr>
              {t.columns.map((col, colIndex) => (
                <th
                  key={col.id}
                  style={styleObj(normS(t.headStyle))}
                >
                  <Editable
                    value={col.label}
                    placeholder="Column name"
                    onChange={(v) =>
                      dispatch({
                        type: "set",
                        target: "box",
                        id: box.id,
                        path: `manualTable.columns.${colIndex}.label`,
                        value: v,
                      })
                    }
                  />
                </th>
              ))}
            </tr>
          </thead>

          <tbody>
            {t.rows.map((row, rowIndex) => (
              <tr
                key={row.id}
                className={t.zebra && rowIndex % 2 ? "z" : undefined}
              >
                {t.columns.map((col, colIndex) => (
                  <td key={col.id}>
                    <Editable
                      value={row.cells[colIndex] || ""}
                      placeholder=""
                      onChange={(v) =>
                        dispatch({
                          type: "set",
                          target: "box",
                          id: box.id,
                          path: `manualTable.rows.${rowIndex}.cells.${colIndex}`,
                          value: v,
                        })
                      }
                    />
                  </td>
                ))}
              </tr>
            ))}
          </tbody>
        </table>

        {state.mode === "design" && (
          <div className="manual-table-actions">
            <button
              type="button"
              onClick={(e) => {
                e.stopPropagation();

                const nextRows = [
                  ...t.rows,
                  {
                    id: `row_${Date.now()}`,
                    cells: t.columns.map(() => ""),
                  },
                ];

                dispatch({
                  type: "set",
                  target: "box",
                  id: box.id,
                  path: "manualTable.rows",
                  value: nextRows,
                });
              }}
            >
              + Add Row
            </button>

            <button
              type="button"
              onClick={(e) => {
                e.stopPropagation();

                const newColumn = {
                  id: `col_${Date.now()}`,
                  label: `Column ${t.columns.length + 1}`,
                };

                const nextColumns = [
                  ...t.columns,
                  newColumn,
                ];

                const nextRows = t.rows.map((row) => ({
                  ...row,
                  cells: [...row.cells, ""],
                }));

                dispatch({
                  type: "set",
                  target: "box",
                  id: box.id,
                  path: "manualTable.columns",
                  value: nextColumns,
                });

                dispatch({
                  type: "set",
                  target: "box",
                  id: box.id,
                  path: "manualTable.rows",
                  value: nextRows,
                });
              }}
            >
              + Add Column
            </button>
          </div>
        )}
      </div>
    );
  }

  /* DATA TABLE */
  const c = box.table;
  console.log("DETAIL CONFIG:", JSON.stringify(c.detail, null, 2));
  const shown = c.columns.filter((x) => x.on);

  if (!shown.length)
    return (  
      <div className="empty">
        No columns selected. Open <b>⚙ Set up</b> and tick some.
      </div>
    );

  const rows = result?.rows || [];
  const [msg, sub] = stateNote(box, state.catalog);
  const alias = (ref) => ref.replace(/\./g, "__");

  /* The clicked row's details open in a popup (turn off in Row Detail List). */
  const detail = c.detail || {};
  const popupMode = detail.popup !== false;
  const closeDetail = () => {
    setDetailItems(null);
    setDetailValue("");
  };

  const isDesign = state.mode === "design";
  const hasSections = (detail.sections || []).length > 0;
  /* First box added keeps whatever line-item columns were already set up. */
  const legacyAsSection = () => {
    const legacy = (detail.columns || []).filter((x) => x.col);
    return legacy.length
      ? [
          {
            id: uid("sec"),
            type: "lineItems",
            title: "Line Items",
            columns: legacy.map((x) => ({
              col: x.col,
              label: x.label || x.col.split(".").pop().replace(/_/g, " "),
              fmt: x.fmt || "auto",
            })),
          },
        ]
      : [];
  };
  const addFirstSection = (type) =>
    dispatch({
      type: "set",
      target: "box",
      id: box.id,
      path: "table.detail.sections",
      value: [...legacyAsSection(), newDetailSection(type)],
    });

  const detailBody = detailItems === null ? null : (
    <>
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
                              .filter((col) => col.col)
                              .map((col) => (
                                <th key={col.col}>
                                  {col.label || col.col}
                                </th>
                              ))}
                          </tr>
                        </thead>

                        <tbody>
                          {detailItems.map((item, itemIndex) => (
                            <tr key={itemIndex}>
                              {(detail.columns || [])
                                .filter((col) => col.col)
                                .map((col) => {
                                  const value =
                                    item[alias(col.col)] ??
                                    item[col.col];

                                  return (
                                    <td
                                      key={col.col}
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
                                })}
                            </tr>
                          ))}
                        </tbody>
                      </table>
                    </div>
                  )}
    </>
  );

    return (
    <div className="rt-table-wrap">
      <table className="rt">
        <thead>
        <tr>
        
              {shown.map((col) => {
                const i = c.columns.indexOf(col);

                return (
                  <th
                    key={col.col}
                    className={col.align === "right" ? "num" : undefined}
                    style={{
                      ...styleObj(normS(c.headStyle)),
                      ...(col.width ? { width: col.width } : {}),
                      position: "relative",
                    }}
                    onDragOver={(e) => {
                      e.preventDefault();
                    }}
                    onDrop={(e) => {
                      e.preventDefault();

                      const draggedCol = e.dataTransfer.getData("text/plain");

                      if (!draggedCol || draggedCol === col.col) {
                        return;
                      }

                      const currentColumns = [...c.columns];

                      const fromIndex = currentColumns.findIndex(
                        (x) => x.col === draggedCol
                      );

                      const toIndex = currentColumns.findIndex(
                        (x) => x.col === col.col
                      );

                      if (fromIndex === -1 || toIndex === -1) {
                        return;
                      }

                      const [movedColumn] = currentColumns.splice(fromIndex, 1);

                      currentColumns.splice(toIndex, 0, movedColumn);

                      dispatch({
                        type: "set",
                        target: "box",
                        id: box.id,
                        path: "table.columns",
                        value: currentColumns,
                      });
                    }}
                  >
                    <span
                      draggable
                      onDragStart={(e) => {
                        e.stopPropagation();
                        e.dataTransfer.setData("text/plain", col.col);
                        e.dataTransfer.effectAllowed = "move";
                      }}
                      style={{
                        display: "inline-block",
                        marginRight: "8px",
                        cursor: "grab",
                        opacity: 0.55,
                        userSelect: "none",
                        fontSize: "13px",
                      }}
                      title="Drag to move column"
                    >
                      ⋮⋮
                    </span>

                    <Editable
                      value={col.label}
                      placeholder="name"
                      onChange={(v) =>
                        dispatch({
                          type: "set",
                          target: "box",
                          id: box.id,
                          path: `table.columns.${i}.label`,
                          value: v,
                        })
                      }
                    />
                  </th>
                );
              })}
            </tr>
          </thead>

      <tbody>
  {rows.length ? (
    rows.slice(0, c.limit || 10).map((r, i) => {
      const detail = c.detail || {};
      console.log("DETAIL USED:", {
        baseTable: box?.src?.base || "",
        keyColumn: detail.keyColumn,
        detailColumns: (detail.columns || []).map((x) => x.col),
      });
      console.log("FULL TABLE CONFIG:", JSON.stringify(c, null, 2));

      const clickable =
        detail.enabled &&
        detail.keyColumn &&
        shown.find(
          (col) => String(col.col) === String(detail.keyColumn)
        );

      const rowDetailValue = clickable
        ? r[alias(clickable.col)]
        : null;

      const isSelected =
        rowDetailValue != null &&
        String(detailValue) === String(rowDetailValue) &&
        detailItems !== null;

      return (
        <React.Fragment key={i}>
          <tr
            className={c.zebra && i % 2 ? "z" : undefined}
          >
            {shown.map((col) => {
              const value = r[alias(col.col)];

              const isClickable =
              detail.enabled &&
              detail.keyColumn &&
              String(col.col) === String(detail.keyColumn) &&
              value != null;
              return (
                <td
                  key={col.col}
                  className={
                    col.align === "right" ? "num" : undefined
                  }
                  style={
                    col.align === "center"
                      ? { textAlign: "center" }
                      : undefined
                  }
                >
                  {isClickable ? (
                    <button
                      type="button"
                      className="pr-link"
                      onClick={async () => {
                        const clickedValue = String(value);

                        setDetailValue(clickedValue);
                        setDetailItems([]);
                        setDetailLoading(true);
                          console.log("PROCESS KEY AT DETAIL:", state.processKey);
                          console.log("BOX ID:", box.id);
                          console.log("BOX SRC:", box.src);
                                                try {
                          const isPublished = window.location.pathname.includes("/r/");

                          let data;

                          if (isPublished) {
                            const [, publicPath] = window.location.pathname.split("/r/");
                            const [publicKey, publicToken] = publicPath.split("/");

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
                            const vt = new URLSearchParams(window.location.search).get("vt");
                            if (vt) params.set("vt", vt);

                            const res = await fetch(
                              `/api/r/${encodeURIComponent(publicKey)}/${encodeURIComponent(publicToken)}/detail?${params.toString()}`
                            );

                            if (!res.ok) {
                              throw new Error("Could not load public detail rows");
                            }

                            data = await res.json();
                          } else {
                            data = await api.getDetailRows(
                              state.processKey,
                              box?.src?.base || "",
                              detail.keyColumn,
                              clickedValue,
                              (detail.columns || [])
                                .map((col) => col.col)
                                .filter(Boolean),
                              detail.limit || 20
                            );
                          }

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
                      {fmtCell(value, col.fmt, locale)}
                    </button>
                  ) : (
                    fmtCell(value, col.fmt, locale)
                  )}
                </td>
              );
            })}
          </tr>

          {isSelected && !popupMode && (
            <tr className="pr-items-row">
              <td colSpan={shown.length}>
                <div className="pr-inline">
                  <div className="pr-inline-header">
                    <strong>
                      {detail.title || "Details"} — {detailValue}
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

                  {detailBody}
                </div>
              </td>
            </tr>
          )}
        </React.Fragment>
      );
    })
  ) : (
    <>
      {[0, 1, 2].map((i) => (
        <tr
          key={i}
          className={`ghost${c.zebra && i % 2 ? " z" : ""}`}
        >
          {shown.map((col) => (
            <td
              key={col.col}
              className={
                col.align === "right" ? "num" : undefined
              }
            >
              —
            </td>
          ))}
        </tr>
      ))}

      <tr>
        <td
          className="ghost-note"
          colSpan={shown.length}
        >
          {msg} · {sub}
        </td>
      </tr>
    </>
  )}
</tbody>

            {c.totals && rows.length > 0 && (
        <tfoot>
          <tr>
            {shown.map((col, i) => {
              const isNum =
                typeof rows[0][alias(col.col)] === "number";

              return (
                <td
                  key={col.col}
                  className={
                    col.align === "right" ? "num" : undefined
                  }
                >
                  {i === 0
                    ? "Total"
                    : isNum
                    ? fmtCell(
                        rows.reduce(
                          (a, r) =>
                            a + (+r[alias(col.col)] || 0),
                          0
                        ),
                        col.fmt,
                        locale
                      )
                    : ""}
                </td>
              );
            })}
          </tr>
        </tfoot>
      )}

    </table>

      {popupMode && detailItems !== null && detailValue !== "" && (
        <div
          className="report-view-overlay"
          onMouseDown={(e) => {
            if (e.target === e.currentTarget) closeDetail();
          }}
        >
          <div
            className="report-view-modal"
            role="dialog"
            aria-modal="true"
            style={
              hasSections
                ? { width: "min(1100px, 94vw)", maxHeight: "88vh", overflowY: "auto" }
                : undefined
            }
          >
            {hasSections ? (
              <DetailPopup
                box={box}
                detail={detail}
                sectionRows={sectionRows}
                detailValue={detailValue}
                design={isDesign}
                locale={locale}
                catalog={state.catalog}
                dispatch={dispatch}
                onClose={closeDetail}
              />
            ) : (
              <>
                <div className="report-view-modal-header">
                  <h3>
                    {detail.title || "Details"} — {detailValue}
                  </h3>
                  <button
                    type="button"
                    className="xbtn"
                    onClick={closeDetail}
                    aria-label="Close details"
                  >
                    ×
                  </button>
                </div>

                {detailBody}

                {isDesign && (
                  <div style={{ display: "flex", flexWrap: "wrap", gap: 8, marginTop: 14 }}>
                    <button type="button" className="pb" onClick={() => addFirstSection("fields")}>
                      + Add Box
                    </button>
                    <button type="button" className="pb" onClick={() => addFirstSection("lineItems")}>
                      + Add Line Items
                    </button>
                    <button type="button" className="pb" onClick={() => addFirstSection("header")}>
                      + Add Header
                    </button>
                  </div>
                )}
              </>
            )}
          </div>
        </div>
      )}
    </div>
  );
}

/* ---------------- settings ---------------- */
function Panel({ box, cols }) {
  const { state, dispatch } = useStore();
  const tab = state.cfgTab;
  const [popupColumnSearch, setPopupColumnSearch] = React.useState({});
  const set = (path, value) =>
    dispatch({ type: "set", target: "box", id: box.id, path, value });
  const del = () => dispatch({ type: "askDel", sel: { kind: "box", id: box.id } });

  return (
    <div className="cfg" onMouseDown={(e) => e.stopPropagation()}>
      <div className="cfg-tabs">
        {["data", "format", "border"].map((t) => (
          <button key={t} aria-pressed={tab === t}
            onClick={() => dispatch({ type: "cfgTab", tab: t })}>
            {t === "data" ? "Data" : t === "format" ? "Format" : "Border"}
          </button>
        ))}
      </div>

      {tab === "border" && (
        <>
          <Group>Box border</Group>
          <FrameControls frame={box.frame} what="this box"
            onSet={(k, v) => set(`frame.${k}`, v)} />
          <Hint>Off keeps the standard box outline.</Hint>
          <Group>Remove</Group>
          <DeleteButton what="this box" onClick={del} />
        </>
      )}

      {tab === "format" && (
        <>
          {box.titleVisible !== false && (
            <FormatPanel label="Box title" style={box.titleStyle}
              onSet={(k, v) => set(`titleStyle.${k}`, v)} />
          )}
          <FormatPanel label={box.kind === "note" ? "Note text" : "Content"} style={box.style}
            onSet={(k, v) => set(`style.${k}`, v)} />
          <Group>Box</Group>
          <Toggles>
            <Check on={box.useFilters} label="Obey the filter bar"
              onChange={(v) => set("useFilters", v)} />
          </Toggles>
          {box.kind === "value" && <ValueFormat box={box} set={set} />}
          {box.kind === "chart" && <ChartFormat box={box} set={set} />}
          {box.kind === "table" && (
            <>
              <Group>Table type</Group>

              <SegBar
                value={box.tableMode || "data"}
                options={[
                  ["data", "Data table"],
                  ["graph", "Graph table"],
                  ["manual", "Manual table"],
                ]}
                onChange={(v) => set("tableMode", v)}
              />

              {box.tableMode === "data" && (
                <TableData box={box} set={set} />
              )}

              {box.tableMode === "graph" && (
                <GraphTableData box={box} set={set} />
              )}

              {box.tableMode === "manual" && (
                <ManualTableData box={box} set={set} />
              )}
            </>
          )}
          <Group>Remove</Group>
          <DeleteButton what="this box" onClick={del} />
        </>
      )}

      {tab === "data" && (
        <>
          <Row style={{ marginBottom: 2 }}>
            <Field label="Box name">
              <Text value={box.title} placeholder="Approval rate"
                onChange={(v) => set("title", v)} />
            </Field>
          </Row>
          <div className="swblock">
            <Switch on={box.visible !== false} label="Show this box"
              onChange={(v) => set("visible", v)} />
            <Switch on={box.titleVisible !== false} label="Show box heading"
              onChange={(v) => set("titleVisible", v)} />
          </div>
          <Group>Who can see this box on a published link</Group>
          <RoleChips value={box.roles} onChange={(v) => set("roles", v)} />
          <Hint>Nothing picked = shown on every published link, whatever role opened it.</Hint>
          <Group>This box shows</Group>
          <SegBar value={box.kind} options={BOX_KINDS} onChange={(v) => set("kind", v)} />
          <Row style={{ marginTop: 10 }}>
            <Field label="Width">
              <Select value={Math.max(1, Math.min(cols, box.span || 1))} numeric
                options={widthOptions(cols)} onChange={(v) => set("span", v)} />
            </Field>
          </Row>

          {box.kind === "reportView" && (() => {
            const config = box.reportView || {};
            const availableColumns = colOptions(state.catalog, box.src)
              .map((col) => col.name)
              .filter(Boolean);

            const addColumn = (path, current) =>
              set(path, [
                ...(current || []),
                {
                  col: "",
                  label: "",
                  fmt: "auto",
                },
              ]);

            const lineItemOptions = (state.catalog?.tables || []).flatMap((t) => {
              if (typeof t === "string") return [];
              return (t.columns || [])
                .map((c) => (typeof c === "string" ? c : c.name))
                .filter(Boolean)
                .map((name) => [`${t.name}.${name}`, `${t.name}.${name}`]);
            });

            const moveItem = (items, path, index, d) => {
              const next = [...(items || [])];
              const target = index + d;
              if (target < 0 || target >= next.length) return;
              [next[index], next[target]] = [next[target], next[index]];
              set(path, next);
            };

            const changePopupType = (index, section, v) => {
              set(`reportView.popupSections.${index}.type`, v);
              if (v === "manualTable" && !section.manualTable?.columns?.length) {
                set(
                  `reportView.popupSections.${index}.manualTable`,
                  newPopupManualTable()
                );
              }
            };

            const renderColumnEditor = (
              items,
              path,
              columnOptions = availableColumns,
              opts = {}
            ) => (
              <div className="collist">
                {(items || []).map((col, i) => (
                  <div className="colrow" key={`${path}-${i}`}>
                    {opts.move && (
                      <span className="colmv">
                        <button
                          type="button"
                          className="xbtn"
                          title="Move up"
                          disabled={i === 0}
                          onClick={() => moveItem(items, path, i, -1)}
                        >
                          ↑
                        </button>
                        <button
                          type="button"
                          className="xbtn"
                          title="Move down"
                          disabled={i === (items || []).length - 1}
                          onClick={() => moveItem(items, path, i, 1)}
                        >
                          ↓
                        </button>
                      </span>
                    )}

                    <Field label="Database column">
                      <Select
                        value={col.col || ""}
                        options={[
                          ["", "Select column"],
                          ...columnOptions,
                        ]}
                        onChange={(v) => {
                          set(`${path}.${i}.col`, v);
                          if (v && !col.label) {
                            set(`${path}.${i}.label`, v.split(".").pop());
                          }
                        }}
                      />
                    </Field>

                    <Field label="Display heading">
                      <Text
                        value={col.label || ""}
                        placeholder="Heading"
                        onChange={(v) => set(`${path}.${i}.label`, v)}
                      />
                    </Field>

                    {opts.fmt && (
                      <Field label="Format">
                        <Select
                          value={col.fmt || "auto"}
                          options={FMTS}
                          onChange={(v) => set(`${path}.${i}.fmt`, v)}
                        />
                      </Field>
                    )}

                    {opts.align && (
                      <Field label="Align">
                        <Select
                          value={col.align || "left"}
                          options={[
                            ["left", "Left"],
                            ["center", "Centre"],
                            ["right", "Right"],
                          ]}
                          onChange={(v) => set(`${path}.${i}.align`, v)}
                        />
                      </Field>
                    )}

                    <button
                      type="button"
                      className="xbtn"
                      title="Remove column"
                      onClick={() =>
                        set(
                          path,
                          (items || []).filter((_, index) => index !== i)
                        )
                      }
                    >
                      ×
                    </button>
                  </div>
                ))}
              </div>
            );

            return (
              <>
                <Group>Report View — Display</Group>

                <Switch
                  on={config.search !== false}
                  label="Enable search"
                  onChange={(v) => set("reportView.search", v)}
                />

                <Switch
                  on={config.pagination !== false}
                  label="Enable pagination"
                  onChange={(v) => set("reportView.pagination", v)}
                />

                <Row>
                  <Field label="Rows per page">
                    <Select
                      value={config.pageSize || 10}
                      numeric
                      options={[5, 10, 15, 25, 50, 100]}
                      onChange={(v) => set("reportView.pageSize", v)}
                    />
                  </Field>
                </Row>

                <Group>Visible Columns</Group>
                {renderColumnEditor(config.columns, "reportView.columns")}

                <button
                  type="button"
                  className="pb"
                  onClick={() => addColumn("reportView.columns", config.columns)}
                >
                  + Add Report Column
                </button>

                <Group>Record Details Modal</Group>

                <Field label="Column that opens the popup">
                  <Select
                    value={config.clickableColumn || ""}
                    options={[
                      ["", "Select clickable column"],
                      ...availableColumns,
                    ]}
                    onChange={(v) => set("reportView.clickableColumn", v)}
                  />
                </Field>

                <Field label="Modal title">
                  <Text
                    value={config.detailTitle || ""}
                    placeholder="Record Details"
                    onChange={(v) => set("reportView.detailTitle", v)}
                  />
                </Field>

                <Hint>
                  Leave detail columns empty to show the report columns in the
                  modal. Otherwise, configure a separate set of detail fields.
                </Hint>

                {renderColumnEditor(
                  config.detailColumns,
                  "reportView.detailColumns"
                )}

                <button
                  type="button"
                  className="pb"
                  onClick={() =>
                    addColumn("reportView.detailColumns", config.detailColumns)
                  }
                >
                  + Add Detail Field
                </button>
                <Group>Popup Sections</Group>

<Hint>
  Build the popup using multiple sections. Each section can display record
  fields or a related table. Configure the relationship for related data.
</Hint>

{(config.popupSections || []).map((section, index) => (
  <div
    key={section.id || index}
    style={{
      border: "1px solid var(--border, #ddd)",
      borderRadius: 8,
      padding: 12,
      marginBottom: 12,
    }}
  >
    <Field label="Section title">
      <Text
        value={section.title || ""}
        placeholder="Section title"
        onChange={(v) =>
          set(`reportView.popupSections.${index}.title`, v)
        }
      />
    </Field>

    <Group>Section type</Group>
    <SegBar
      value={section.type || "fields"}
      options={[
        ["fields", "Detail fields"],
        ["lineItems", "Line items"],
        ["manualTable", "Manual table"],
        ["dataTable", "Data table (advanced)"],
        ...(section.type === "relatedTable"
          ? [["relatedTable", "Related (legacy)"]]
          : []),
      ]}
      onChange={(v) => changePopupType(index, section, v)}
    />

    {section.type === "manualTable" && (
      <ManualTableData
        box={{
          manualTable: section.manualTable || {
            columns: [
              { id: "popup-item", label: "Item" },
              { id: "popup-quantity", label: "Quantity" },
              { id: "popup-amount", label: "Amount" },
            ],
            rows: [
              { id: "popup-row-1", cells: ["", "", ""] },
            ],
            zebra: true,
          },
        }}
        set={(path, value) =>
          set(`reportView.popupSections.${index}.${path}`, value)
        }
      />
    )}

    {section.type === "lineItems" && (
      <>
        <Field label="Match line items to the record by">
          <Select
            value={
              section.keyColumn ||
              config.clickableColumn ||
              (config.columns || []).find((c) => c.col)?.col ||
              ""
            }
            options={[
              ["", "Select column"],
              ...(config.columns || [])
                .filter((c) => c.col)
                .map((c) => [c.col, c.label || c.col]),
              ...availableColumns
                .filter((n) => !(config.columns || []).some((c) => c.col === n))
                .map((n) => [n, n]),
            ]}
            onChange={(v) =>
              set(`reportView.popupSections.${index}.keyColumn`, v)
            }
          />
        </Field>

        <Group>Line item columns</Group>
        {renderColumnEditor(
          section.columns || [],
          `reportView.popupSections.${index}.columns`,
          lineItemOptions,
          { move: true, fmt: true, align: true }
        )}

        <button
          type="button"
          className="pb"
          style={{ marginTop: 10 }}
          onClick={() =>
            addColumn(
              `reportView.popupSections.${index}.columns`,
              section.columns
            )
          }
        >
          + Add Column
        </button>

        <Row>
          <Field label="Rows">
            <Select
              value={section.limit || 100}
              numeric
              options={[5, 10, 20, 50, 100]}
              onChange={(v) =>
                set(`reportView.popupSections.${index}.limit`, v)
              }
            />
          </Field>
        </Row>

        <Switch
          on={section.zebra === true}
          label="Striped rows"
          onChange={(v) =>
            set(`reportView.popupSections.${index}.zebra`, v)
          }
        />

        <Hint>
          Pick columns from any table, the same way as the main table's row
          detail list.
        </Hint>
      </>
    )}

    {section.type === "relatedTable" && (
      <>
        <Field label="Related table">
          <Select
            value={section.table || ""}
            options={[
              ["", "Select related table"],
              ...((state.catalog?.tables || []).map((t) =>
                typeof t === "string"
                  ? [t, t]
                  : [t.name, t.name]
              )),
            ]}
            onChange={(v) =>
              set(`reportView.popupSections.${index}.table`, v)
            }
          />
        </Field>

        <Field label="Parent key column">
          <Select
            value={section.parentColumn || ""}
            options={[
              ["", "Select parent key"],
              ...availableColumns,
            ]}
            onChange={(v) =>
              set(`reportView.popupSections.${index}.parentColumn`, v)
            }
          />
        </Field>

        <Field label="Related table key column">
          <Text
            value={section.relatedColumn || ""}
            placeholder="e.g. invoice_id"
            onChange={(v) =>
              set(`reportView.popupSections.${index}.relatedColumn`, v)
            }
          />
        </Field>
      </>
    )}

    {section.type === "dataTable" && (
      <div style={{ marginTop: 10 }}>
        <Field label="Table mode">
          <Select
            value={section.mode || "related"}
            options={[
              ["related", "Related to selected record"],
              ["standalone", "Standalone database table"],
            ]}
            onChange={(v) =>
              set(`reportView.popupSections.${index}.mode`, v)
            }
          />
        </Field>

        <Field label="Choose database table">
          <Select
            value={section.table || ""}
            options={[
              ["", "Select database table"],
              ...(state.catalog?.tables || [])
                .map((t) => {
                  const name = typeof t === "string" ? t : t.name;
                  return name ? [name, name] : null;
                })
                .filter(Boolean),
            ]}
            
            onChange={(v) => {
              set(`reportView.popupSections.${index}.table`, v);
              set(`reportView.popupSections.${index}.columns`, []);
              set(`reportView.popupSections.${index}.relationship`, null);
            }}

          />
        </Field>

        {section.mode !== "standalone" && (
        <Field label="Select relationship">
          {(() => {
            const parentTable = box?.src?.base || "";

            const options = (state.catalog?.relationships || []).filter(
              (r) =>
                r.from_table === section.table &&
                r.to_table === parentTable &&
                r.to_unique
            );

            return (
              <Select
                value={
                  section.relationship
                    ? `${section.relationship.fromColumn}|${section.relationship.toColumn}`
                    : ""
                }
                options={[
                  ["", options.length ? "Select relationship" : "No valid relationships found"],
                  ...options.map((r) => [
                    `${r.from_column}|${r.to_column}`,
                    `${r.from_column} → ${r.to_table}.${r.to_column} (${r.source})`,
                  ]),
                ]}
                onChange={(v) => {
                  const selected = options.find(
                    (r) => `${r.from_column}|${r.to_column}` === v
                  );

                  set(
                    `reportView.popupSections.${index}.relationship`,
                    selected
                      ? {
                          fromColumn: selected.from_column,
                          toColumn: selected.to_column,
                        }
                      : null
                  );
                }}
              />
            );
          })()}
        </Field>
        )}

        <Row>
          <Field label="Rows">
            <Select
              value={section.limit || 100}
              numeric
              options={[5, 10, 15, 25, 50, 100]}
              onChange={(v) =>
                set(`reportView.popupSections.${index}.limit`, v)
              }
            />
          </Field>
        </Row>

        <Switch
          on={section.zebra === true}
          label="Striped rows"
          onChange={(v) =>
            set(`reportView.popupSections.${index}.zebra`, v)
          }
        />

        <Field label="Displayed database columns">
          <Hint>
            {section.mode === "standalone"
              ? "Choose which database fields to display in this standalone table."
              : "Choose fields from the selected table and select its relationship to the report record."}
          </Hint>
        </Field>

        <Field label="Column source">
          <Select
            value={section.columnSource || "table"}
            options={[
              ["table", "Selected table only"],
              ["database", "Entire database"],
            ]}
            onChange={(value) =>
              set(`reportView.popupSections.${index}.columnSource`, value)
            }
          />
        </Field>

        {(() => {
          const catalogTables = (state.catalog?.tables || [])
            .map((item) => typeof item === "string"
              ? { name: item, columns: [] }
              : item)
            .filter((item) => item?.name);
          const getColumns = (tableName) => {
            const entry = catalogTables.find((item) => item.name === tableName);
            return (entry?.columns || [])
              .map((column) => typeof column === "string"
                ? column
                : column.name)
              .filter(Boolean);
          };
          const search = popupColumnSearch[section.id || index] || "";
          const sourceMode = section.columnSource || "table";
          const columnPath = `reportView.popupSections.${index}.columns`;
          const selectedColumns = section.columns || [];

          if (sourceMode === "table") {
            const filtered = getColumns(section.table).filter((name) =>
              name.toLowerCase().includes(search.trim().toLowerCase())
            );
            return (
              <>
                <Field label="Search columns">
                  <Text
                    value={search}
                    placeholder="Search selected table columns…"
                    onChange={(value) =>
                      setPopupColumnSearch((current) => ({
                        ...current,
                        [section.id || index]: value,
                      }))
                    }
                  />
                </Field>
                {renderColumnEditor(
                  section.columns || [],
                  `reportView.popupSections.${index}.columns`,
                  filtered,
                  { move: true, fmt: true, align: true }
                )}

                <div style={{ display: "flex", gap: 8, marginTop: 10 }}>
                  <button
                    type="button"
                    className="pb"
                    onClick={() =>
                      addColumn(
                        `reportView.popupSections.${index}.columns`,
                        section.columns
                      )
                    }
                  >
                    + Add Column
                  </button>

                  <button
                    type="button"
                    className="pb"
                    onClick={() => {
                      const existing = new Set(
                        (section.columns || []).map((c) => c.col).filter(Boolean)
                      );
                      set(`reportView.popupSections.${index}.columns`, [
                        ...(section.columns || []),
                        ...getColumns(section.table)
                          .filter((name) => !existing.has(name))
                          .map((name) => ({
                            col: name,
                            label: name.split(".").pop(),
                            fmt: "auto",
                            align: "left",
                          })),
                      ]);
                    }}
                  >
                    + Add All Columns
                  </button>
                </div>
              </>
            );
          }

      const allColumns = catalogTables.flatMap((table) =>
        (table.columns || [])
          .map((column) => {
            const name =
              typeof column === "string" ? column : column.name;

            if (!name) return null;

            return {
              table: table.name,
              name,
              type:
                typeof column === "object"
                  ? column.column_type ||
                    column.data_type ||
                    column.type ||
                    ""
                  : "",
            };
          })
          .filter(Boolean)
      );

      const matchingColumns = allColumns.filter((column) =>
        `${column.table} ${column.name} ${column.type}`
          .toLowerCase()
          .includes(search.trim().toLowerCase())
      );

      const addDatabaseColumn = (column) => {
        const exists = selectedColumns.some(
          (item) =>
            (item.table || section.table) === column.table &&
            item.col === column.name
        );

        if (exists) return;

        set(columnPath, [
          ...selectedColumns,
          {
            table: column.table,
            col: column.name,
            key: `${column.table}.${column.name}`,
            label: column.name,
            fmt: "auto",
          },
        ]);
      };

      return (
        <div className="collist">
          <Field label="Search all database columns">
            <Text
              value={search}
              placeholder="Search any table or column…"
              onChange={(value) =>
                setPopupColumnSearch((current) => ({
                  ...current,
                  [section.id || index]: value,
                }))
              }
            />
          </Field>

          <Hint>
            Search the database catalog by table name, column name, or
            data type. Add the columns you want to display.
          </Hint>

          <Field label={`Search results (${matchingColumns.length})`}>
            <div
              style={{
                maxHeight: 280,
                overflowY: "auto",
                border: "1px solid var(--border, #ddd)",
                borderRadius: 8,
              }}
            >
              {matchingColumns.slice(0, 200).map((column) => {
                const exists = selectedColumns.some(
                  (item) =>
                    (item.table || section.table) === column.table &&
                    item.col === column.name
                );

                return (
                  <div
                    key={`${column.table}.${column.name}`}
                    style={{
                      display: "flex",
                      alignItems: "center",
                      justifyContent: "space-between",
                      gap: 8,
                      padding: "8px 10px",
                      borderBottom: "1px solid var(--border, #eee)",
                    }}
                  >
                    <div style={{ minWidth: 0 }}>
                      <div style={{ fontWeight: 500 }}>
                        {column.table}.{column.name}
                      </div>

                      {column.type && (
                        <div
                          style={{
                            fontSize: 12,
                            opacity: 0.7,
                            overflowWrap: "anywhere",
                          }}
                        >
                          {column.type}
                        </div>
                      )}
                    </div>

                    <button
                      type="button"
                      className="pb"
                      disabled={exists}
                      onClick={() => addDatabaseColumn(column)}
                    >
                      {exists ? "Added" : "+ Add"}
                    </button>
                  </div>
                );
              })}

              {matchingColumns.length === 0 && (
                <p style={{ padding: 12 }}>
                  {search.trim()
                    ? "No matching database columns."
                    : "Enter a search term to find columns across the database."}
                </p>
              )}

              {matchingColumns.length > 200 && (
                <p style={{ padding: 10, fontSize: 12 }}>
                  Showing the first 200 matches. Refine your search.
                </p>
              )}
            </div>
          </Field>

          <Field label={`Selected columns (${selectedColumns.length})`}>
            {selectedColumns.length === 0 ? (
              <Hint>
                No columns added yet. Search above and click + Add.
              </Hint>
            ) : (
              selectedColumns.map((column, columnIndex) => {
                const rowPath = `${columnPath}.${columnIndex}`;

                return (
                  <div className="colrow" key={rowPath}>
                    <div style={{ flex: 1, minWidth: 0 }}>
                      <div style={{ fontWeight: 500 }}>
                        {column.table || section.table}.{column.col}
                      </div>
                    </div>

                    <Field label="Display heading">
                      <Text
                        value={column.label || ""}
                        placeholder={column.col}
                        onChange={(value) =>
                          set(`${rowPath}.label`, value)
                        }
                      />
                    </Field>

                    <button
                      type="button"
                      className="xbtn"
                      title="Remove column"
                      onClick={() =>
                        set(
                          columnPath,
                          selectedColumns.filter(
                            (_, itemIndex) =>
                              itemIndex !== columnIndex
                          )
                        )
                      }
                    >
                      ×
                    </button>
                  </div>
                );
              })
            )}
          </Field>
        </div>
      );
    })()}
  </div>
)}

    {section.type !== "dataTable" &&
      section.type !== "manualTable" &&
      section.type !== "lineItems" && (
      <>
        {renderColumnEditor(
          section.columns || [],
          `reportView.popupSections.${index}.columns`,
          availableColumns,
          { move: true, fmt: true }
        )}

        <button
          type="button"
          className="pb"
          style={{ marginTop: 10 }}
          onClick={() =>
            addColumn(
              `reportView.popupSections.${index}.columns`,
              section.columns
            )
          }
        >
          + Add Field
        </button>
      </>
    )}

    <button
      type="button"
      className="xbtn"
      onClick={() =>
        set(
          "reportView.popupSections",
          config.popupSections.filter((_, i) => i !== index)
        )
      }
    >
      Remove Section
    </button>
  </div>
))}

<div style={{ display: "flex", gap: 8, marginBottom: 8 }}>
  <button
    type="button"
    className="pb"
    onClick={() =>
      set("reportView.popupSections", [
        ...(config.popupSections || []),
        newPopupSection("fields"),
      ])
    }
  >
    + Add Box
  </button>

  <button
    type="button"
    className="pb"
    onClick={() =>
      set("reportView.popupSections", [
        ...(config.popupSections || []),
        newPopupSection(
          "lineItems",
          config.clickableColumn ||
            (config.columns || []).find((c) => c.col)?.col ||
            ""
        ),
      ])
    }
  >
    + Add Line Items
  </button>

  <button
    type="button"
    className="pb"
    onClick={() =>
      set("reportView.popupSections", [
        ...(config.popupSections || []),
        newPopupSection("manualTable"),
      ])
    }
  >
    + Add Manual Table
  </button>
</div>
                <Group>Data Source</Group>
                <SourceEditor box={box} />
              </>
            );
          })()}

          {box.kind === "value" && <ValueData box={box} set={set} />}
          {box.kind === "chart" && <ChartData box={box} set={set} />}
            {box.kind === "table" && (
              <>
                <Group>Table type</Group>

                <SegBar
                  value={box.tableMode || "data"}
                  options={[
                    ["data", "Data table"],
                    ["graph", "Graph table"],
                    ["manual", "Manual table"],
                  ]}
                  onChange={(v) => set("tableMode", v)}
                />

                {box.tableMode === "data" && (
                  <TableData box={box} set={set} />
                )}

                {box.tableMode === "graph" && (
                  <GraphTableData box={box} set={set} />
                )}

                {box.tableMode === "manual" && (
                  <ManualTableData box={box} set={set} />
                )}
              </>
            )}
          {box.kind === "note" && (
            <Hint>Click into the box and type. Use <b>Format</b> for size, colour and alignment.</Hint>
          )}

          <Group>Remove</Group>
          <DeleteButton what="this box" onClick={del} />
        </>
      )}
    </div>
  );
}

/* ---- value ---- */
function ValueData({ box, set }) {
  const { state } = useStore();
  const c = box.value;
  const cols = colOptions(state.catalog, box.src).map((x) => x.name);
  return (
    <>
      <Group>Where the number comes from</Group>
      <Chips value={c.source} onChange={(v) => set("value.source", v)}
        options={[["data", "One aggregate"], ["formula", "An Excel formula"],
          ["manual", "A number I type"]]} />
      {c.source === "data" && (
        <Row style={{ marginTop: 9 }}>
          <Field label="Aggregate">
            <Select value={c.agg} options={AGGS} onChange={(v) => set("value.agg", v)} />
          </Field>
          <Field label="Of column">
            <Select value={c.column} options={cols} onChange={(v) => set("value.column", v)} />
          </Field>
        </Row>
      )}
      {c.source === "manual" && (
        <Hint>Click the number in the box and type over it.</Hint>
      )}
      {c.source === "formula" && <FormulaBuilder box={box} c={c} set={set} />}
      <Group>Presentation</Group> 
      <Row>
        <Field label="Prefix"><Text value={c.prefix} placeholder="₹" onChange={(v) => set("value.prefix", v)} /></Field>
        <Field label="Suffix"><Text value={c.suffix} placeholder="%" onChange={(v) => set("value.suffix", v)} /></Field>
        <Field label="Unit note"><Text value={c.unit} placeholder="per month" onChange={(v) => set("value.unit", v)} /></Field>
      </Row>
      <Row>
        <Field label="Change label">
          <Text value={c.delta} placeholder="8.2% vs last quarter" onChange={(v) => set("value.delta", v)} />
        </Field>
        <Field label="Direction">
          <Chips value={c.deltaDir} options={[["up", "▲"], ["down", "▼"], ["flat", "■"]]}
            onChange={(v) => set("value.deltaDir", v)} />
        </Field>
      </Row>
      <Row>
        <Field label="Footnote">
          <Text value={c.note} placeholder="Excludes cancelled orders" onChange={(v) => set("value.note", v)} />
        </Field>
      </Row>
      {c.source !== "manual" && <SourceEditor box={box} />}
    </>
  );
}

function buildFormula(c) {
  const wrap = (s) => {
    s = (s || "").trim();
    if (!s) return "0";
    return /^[[(]/.test(s) || /^-?\d+(\.\d+)?$/.test(s) ? s : `[${s}]`;
  };
  const body = `${wrap(c.fLeft)} ${c.fOp || "/"} ${wrap(c.fRight)}`
    + (c.fExtra?.trim() ? ` ${c.fExtra.trim()}` : "");
  return `=ROUND(${body}, ${c.round ?? 2})`;
}

const FORMULA_OPS = ["+", "-", "*", "/", "^"];

function FormulaBuilder({ box, c, set }) {
  const update = (patch) => {
    const next = { ...c, ...patch };
    set("value.formula", buildFormula(next));
    for (const [k, v] of Object.entries(patch)) set(`value.${k}`, v);
  };

  return (
    <>
            <Group>Round to</Group>
      <Field label="Decimal places">
        <Select value={String(c.round ?? 2)}
          options={[["1", "1 decimal"], ["2", "2 decimals"], ["3", "3 decimals"], ["4", "4 decimals"]]}
          onChange={(v) => update({ round: Number(v) })} />
      </Field>

      <Group>Build the formula</Group>
      <div className="fbrow">
        <Text value={c.fLeft} placeholder="e.g. Approved vendors"
          onChange={(v) => update({ fLeft: v })} />
        <Select value={c.fOp || "/"} options={FORMULA_OPS} onChange={(v) => update({ fOp: v })} />
        <Text value={c.fRight} placeholder="e.g. Total no of vendors"
          onChange={(v) => update({ fRight: v })} />
      </div>
      <Field label="Then (optional)">
        <Text value={c.fExtra} placeholder="* 100" onChange={(v) => update({ fExtra: v })} />
      </Field>
      <Hint>
        Runs after the division above, before rounding — so <span className="mono">* 100</span> here
        turns a ratio into a percentage. Pair it with a <span className="mono">%</span> suffix under
        Presentation below to label it.
      </Hint>

      <Group>The formula this builds</Group>
      <div className="sqlbox">{c.formula || buildFormula(c)}</div>
      <Hint>
        Type the name of another box in the first or third field and it's matched by title,
        e.g. <span className="mono">Approved vendors</span> becomes{" "}
        <span className="mono">[Approved vendors]</span> automatically. A plain number works too.
      </Hint>
    </>
  );
}

function ValueFormat({ box, set }) {
  const c = box.value;
  return (
    <>
      <Row>
        <Field label="Colour">
          <Chips value={c.tone} onChange={(v) => set("value.tone", v)}
            options={[["#1A2326", "Ink"], ["#0D6E62", "Oxide"], ["#3B5BA5", "Blue"],
              ["#96610A", "Amber"], ["#9E332B", "Iron"]]} />
        </Field>
        <Field label="Decimals">
          <Select value={c.decimals} numeric options={[0, 1, 2]}
            onChange={(v) => set("value.decimals", v)} />
        </Field>
      </Row>
      <Toggles>
        <Check on={c.showTrack} label="Progress bar" onChange={(v) => set("value.showTrack", v)} />
      </Toggles>
      {c.showTrack && (
        <Row>
          <Field label="Fill %">
            <Text type="number" value={c.trackPct} onChange={(v) => set("value.trackPct", Number(v))} />
          </Field>
        </Row>
      )}
    </>
  );
}

/* ---- chart ---- */
function ChartData({ box, set }) {
  const { state, dispatch } = useStore();
  const c = box.chart || {};

  const cols = colOptions(state.catalog, box.src).map((x) => x.name);

  /*
   * Tables available inside this report.
   * A graph can use either a database query or another table box.
   */
  const tableBoxes = state.doc.sections
    .flatMap((section) =>
      (section.boxes || []).map((b) => ({
        ...b,
        sectionName: section.name || "Unnamed section",
      }))
    )
    .filter(
      (b) =>
        b.kind === "table" &&
        b.id !== box.id
    );

  const selectedTable = tableBoxes.find(
    (t) => t.id === c.tableBoxId
  );

  const tableColumns = selectedTable
    ? selectedTable.tableMode === "manual"
      ? (selectedTable.manualTable?.columns || []).map((col) => ({
          id: col.id,
          label: col.label || "Untitled",
        }))
      : (selectedTable.table?.columns || [])
          .filter((col) => col.on !== false)
          .map((col) => ({
            id: col.col,
            label: col.label || col.col || "Untitled",
          }))
    : [];

  return (
    <>
      <Group>Chart</Group>

      <Chips
        value={c.type}
        options={CHARTS}
        onChange={(v) => set("chart.type", v)}
      />
      

      <Row style={{ marginTop: 9 }}>
        <Field label="Data source">
          <Select
            value={c.source || "database"}
            options={[
              ["database", "Query data"],
              ["value_boxes", "Value boxes"],
              ["table", "Table data"],
            ]}
            onChange={(v) => set("chart.source", v)}
          />
        </Field>
      </Row>

      {/* ======================================================
          TABLE DATA SOURCE
         ====================================================== */}
      {c.source === "table" ? (
        <>
          <Group>Source table</Group>

          <Field label="Table">
            <Select
              value={c.tableBoxId || ""}
              options={[
                ["", "Select a table"],
                ...tableBoxes.map((t) => [
                  t.id,
                  `${t.title || "Untitled table"} · ${t.sectionName}`,
                ]),
              ]}
              onChange={(v) => {
                set("chart.tableBoxId", v);
                set("chart.tableCategoryColumnId", "");
                set("chart.tableValueColumnId", "");
              }}
            />
          </Field>

          {selectedTable && (
            <>
              <Row style={{ marginTop: 9 }}>
                <Field label="Category column">
                  <Select
                    value={c.tableCategoryColumnId || ""}
                    options={[
                      ["", "Select category"],
                      ...tableColumns.map((col) => [
                        col.id,
                        col.label,
                      ]),
                    ]}
                    onChange={(v) =>
                      set(
                        "chart.tableCategoryColumnId",
                        v
                      )
                    }
                  />
                </Field>

                <Field label="Value column">
                  <Select
                    value={c.tableValueColumnId || ""}
                    options={[
                      ["", "Select value"],
                      ...tableColumns.map((col) => [
                        col.id,
                        col.label,
                      ]),
                    ]}
                    onChange={(v) =>
                      set(
                        "chart.tableValueColumnId",
                        v
                      )
                    }
                  />
                </Field>
              </Row>

              <Hint>
                The graph reads the rows from this table.
                Add or edit rows in the table and the graph updates automatically.
              </Hint>
            </>
          )}
        </>
      ) : c.source === "value_boxes" ? (
        <>
          <Group>Value boxes</Group>

          <Hint>
            Select existing Value boxes that should become
            chart categories.
          </Hint>

          <div
            style={{
              marginTop: 8,
              display: "flex",
              flexDirection: "column",
              gap: 7,
            }}
          >
            {state.doc.sections
              .flatMap((section) => section.boxes || [])
              .filter(
                (b) =>
                  b.kind === "value" &&
                  b.id !== box.id
              )
              .map((b) => (
                <label
                  key={b.id}
                  style={{
                    display: "flex",
                    alignItems: "center",
                    gap: 8,
                  }}
                >
                  <input
                    type="checkbox"
                    checked={
                      Array.isArray(c.valueBoxes) &&
                      c.valueBoxes.includes(b.id)
                    }
                    onChange={() => {
                      const current =
                        Array.isArray(c.valueBoxes)
                          ? c.valueBoxes
                          : [];

                      const next =
                        current.includes(b.id)
                          ? current.filter(
                              (x) => x !== b.id
                            )
                          : [...current, b.id];

                      set(
                        "chart.valueBoxes",
                        next
                      );
                    }}
                  />

                  {b.title || "Unnamed value"}
                </label>
              ))}
          </div>
        </>
      ) : (
        /* ======================================================
           EXISTING DATABASE CHART
           ====================================================== */
        <>
          <Row style={{ marginTop: 9 }}>
            <Field label="Group by">
              <Select
                value={c.category}
                options={cols}
                onChange={(v) =>
                  set("chart.category", v)
                }
              />
            </Field>

            <Field label="Aggregate">
              <Select
                value={c.agg}
                options={AGGS}
                onChange={(v) =>
                  set("chart.agg", v)
                }
              />
            </Field>

            <Field label="Of column">
              <Select
                value={c.column}
                options={cols}
                onChange={(v) =>
                  set("chart.column", v)
                }
              />
            </Field>
          </Row>

          <Row>
            <Field label="Sort by">
              <Select
                value={c.sort}
                options={[
                  ["value", "Value"],
                  ["label", "Name"],
                ]}
                onChange={(v) =>
                  set("chart.sort", v)
                }
              />
            </Field>

            <Field label="Order">
              <Select
                value={c.dir}
                options={[
                  ["desc", "High → low"],
                  ["asc", "Low → high"],
                ]}
                onChange={(v) =>
                  set("chart.dir", v)
                }
              />
            </Field>

            <Field label="Keep top">
              <Select
                value={c.limit}
                numeric
                options={[
                  [0, "All"],
                  5,
                  6,
                  8,
                  10,
                  12,
                ]}
                onChange={(v) =>
                  set("chart.limit", v)
                }
              />
            </Field>
          </Row>

          <SourceEditor box={box} />
        </>
      )}
    </>
  );
}
function ChartFormat({ box, set }) {
  const c = box.chart;
  return (
    <>
      <Row>
        <Field label="Height">
          <Select value={c.height} numeric options={[160, 200, 220, 260, 320, 400, 480]}
            onChange={(v) => set("chart.height", v)} />
        </Field>
        <Field label="Colour set">
          <Select value={c.palette} numeric
            options={[[0, "Oxide"], [1, "Blue"], [2, "Amber"], [3, "Iron"]]}
            onChange={(v) => set("chart.palette", v)} />
        </Field>
      </Row>
      <Toggles>
        <Check on={c.grid} label="Grid lines" onChange={(v) => set("chart.grid", v)} />
        <Check on={c.values} label="Show values" onChange={(v) => set("chart.values", v)} />
        <Check on={c.legend} label="Legend" onChange={(v) => set("chart.legend", v)} />
      </Toggles>
      {c.type === "donut" && (
        <Hint>
          Donut shows the main percentage in the centre.
          The legend shows each category's value and percentage.
        </Hint>
      )}
      {c.legend && (
        <Row>
          <Field label="Legend sits">
            <Chips value={c.legendPos || "bottom"}
              options={[["top", "Above"], ["bottom", "Below"], ["right", "Right"]]}
              onChange={(v) => set("chart.legendPos", v)} />
          </Field>
        </Row>
      )}
      <Hint>Box width is set in the Data tab; height is here.</Hint>
    </>
  );
}
/* ---- graph table ---- */
function GraphTableData({ box, set }) {
  const { state } = useStore();
  const c = box.table || {};

  const graphBoxes = state.doc.sections
    .flatMap((section) =>
      (section.boxes || []).map((b) => ({
        ...b,
        sectionName: section.name || "Unnamed section",
      }))
    )
    .filter(
      (b) =>
        b.kind === "chart" &&
        b.id !== box.id
    );

  return (
    <>
      <Group>Graph source</Group>

      <Field label="Graph">
        <Select
          value={c.graphBoxId || ""}
          options={[
            ["", "Select a graph"],
            ...graphBoxes.map((g) => [
              g.id,
              `${g.title || "Untitled graph"} · ${g.sectionName}`,
            ]),
          ]}
          onChange={(v) => set("table.graphBoxId", v)}
        />
      </Field>

      {c.graphBoxId && (
        <Hint>
          This table reads the selected graph's data automatically.
        </Hint>
      )}

      <Group>Rows</Group>

      <Row>
        <Field label="Rows">
          <Select
            value={c.limit || 10}
            numeric
            options={[5, 8, 10, 15, 25, 50]}
            onChange={(v) => set("table.limit", v)}
          />
        </Field>
      </Row>
    </>
  );
}
/* ---- table ---- */
function TableData({ box, set }) {
  const { state, dispatch } = useStore();
  const c = box.table || {};
  React.useEffect(() => {
  const details = c.detail?.columns || [];

  details.forEach((col, i) => {
    if (!col.col || !col.col.includes(".")) return;

    const actualName = col.col.split(".").pop();

    if (!col.label || col.label === col.col || col.label === actualName) {
      set(`table.detail.columns.${i}.label`, actualName);
    }
  });
}, [c.detail?.columns]);
  const parentTable = box.src?.base || "";

  // Get columns from the selected database source
  const availableColumns = colOptions(state.catalog, box.src)
  .map((x) => x.name);

const detailAvailableColumns = [
  ...(state.catalog?.tables || []).flatMap((table) =>
    (table.columns || []).map((col) => [
      `${table.name}.${col.name}`,
      col.name,
    ])
  ),
];
const addAllColumns = () => {
  const allColumns = colOptions(state.catalog, box.src)
    .map((x) => x.name)
    .filter(Boolean);

  const existing = new Set(
    columns
      .map((c) => c.col)
      .filter(Boolean)
  );

  const newColumns = allColumns
    .filter((name) => !existing.has(name))
    .map((name) => ({
      col: name,
      label: name.split(".").pop(),
      on: true,
      fmt: "auto",
      align: "left",
      width: "auto",
    }));

  set("table.columns", [
    ...columns,
    ...newColumns,
  ]);
};
  const columns = c.columns || [];

  const addColumn = () => {
    const nextColumn = {
      col: "",
      label: "",
      on: true,
      fmt: "auto",
      align: "left",
      width: "auto",
    };

    set("table.columns", [
      ...columns,
      nextColumn,
    ]);
  };

  const removeColumn = (index) => {
    set(
      "table.columns",
      columns.filter((_, i) => i !== index)
    );
  };

  return (
    <>
      <Group>Rows</Group>

      <Row>
        <Field label="Rows">
          <Select
            value={c.limit || 10}
            numeric
            options={[5, 8, 10, 15, 25, 50]}
            onChange={(v) => set("table.limit", v)}
          />
        </Field>

        <Field label="Sort by">
          <Select
            value={c.sort || ""}
            options={[
              ["", "None"],
              ...columns.map((x) => [
                x.col,
                x.label || x.col || "Untitled",
              ]),
            ]}
            onChange={(v) => set("table.sort", v)}
          />
        </Field>

        <Field label="Order">
          <Select
            value={c.dir || "asc"}
            options={[
              ["asc", "A → Z"],
              ["desc", "Z → A"],
            ]}
            onChange={(v) => set("table.dir", v)}
          />
        </Field>
      </Row>

      <Group>Columns</Group>

      <div className="collist">
        {columns.map((col, i) => (
          <div className="colrow" key={`${col.col}-${i}`}>

            <span className="colmv">
              <button
                className="xbtn"
                title="Move up"
                disabled={i === 0}
                onClick={() =>
                  dispatch({
                    type: "moveColumn",
                    id: box.id,
                    index: i,
                    d: -1,
                  })
                }
              >
                ↑
              </button>

              <button
                className="xbtn"
                title="Move down"
                disabled={i === columns.length - 1}
                onClick={() =>
                  dispatch({
                    type: "moveColumn",
                    id: box.id,
                    index: i,
                    d: 1,
                  })
                }
              >
                ↓
              </button>
            </span>

            <input
              type="checkbox"
              checked={col.on !== false}
              onChange={(e) =>
                set(
                  `table.columns.${i}.on`,
                  e.target.checked
                )
              }
            />

            <Field label="Column">
              <Select
                value={col.col || ""}
                options={[
                  ["", "Blank column"],
                  ...availableColumns,
                ]}
                onChange={(v) => {
                  set(`table.columns.${i}.col`, v);

                  if (v) {
                    set(
                      `table.columns.${i}.label`,
                      v.split(".").pop()
                    );
                  }
                }}
              />
            </Field>

            <Field label="Heading">
              <Text
                value={col.label || ""}
                placeholder="Column heading"
                onChange={(v) =>
                  set(
                    `table.columns.${i}.label`,
                    v
                  )
                }
              />
            </Field>

            <Field label="Format">
              <Select
                value={col.fmt || "auto"}
                options={FMTS}
                onChange={(v) =>
                  set(
                    `table.columns.${i}.fmt`,
                    v
                  )
                }
              />
            </Field>

            <Field label="Align">
              <Select
                value={col.align || "left"}
                options={[
                  ["left", "Left"],
                  ["center", "Centre"],
                  ["right", "Right"],
                ]}
                onChange={(v) =>
                  set(
                    `table.columns.${i}.align`,
                    v
                  )
                }
              />
            </Field>

            <Field label="Width">
              <Text
                value={col.width || ""}
                placeholder="auto"
                onChange={(v) =>
                  set(
                    `table.columns.${i}.width`,
                    v
                  )
                }
              />
            </Field>

            <button
              className="xbtn"
              title="Remove column"
              onClick={() => removeColumn(i)}
            >
              ×
            </button>

          </div>
        ))}
      </div>

<div style={{ display: "flex", gap: 8, marginTop: 10 }}>
  <button
    className="pb"
    onClick={addColumn}
  >
    + Add Column
  </button>

  <button
    className="pb"
    onClick={addAllColumns}
  >
    + Add All Columns
  </button>
</div>

      <Hint>
        Add columns, connect them to database fields, rename their headings,
        or leave a column blank.
      </Hint>
              <Group>Row Detail List</Group>

      <Switch
        on={c.detail?.enabled === true}
        label="Enable detail list"
        onChange={(v) => set("table.detail.enabled", v)}
      />

      {c.detail?.enabled && (
        <>
        <Switch
          on={c.detail.popup !== false}
          label="Open details in a popup"
          onChange={(v) => set("table.detail.popup", v)}
        />
<Row>
  <Field label="Clickable column">
    <Select
      value={c.detail.keyColumn || ""}
      options={[
        ["", "Select column"],
        ...columns
          .filter((x) => x.col)
          .map((x) => [
            x.col,
            x.label || x.col,
          ]),
      ]}
      onChange={(v) =>
        set("table.detail.keyColumn", v)
      }
    />
  </Field>

  <Field label="Detail title">
    <Text
      value={c.detail.title || "Details"}
      placeholder="Details"
      onChange={(v) =>
        set("table.detail.title", v)
      }
    />
  </Field>

  <Field label="Rows">
    <Select
      value={c.detail.limit || 20}
      numeric
      options={[5, 10, 20, 50, 100]}
      onChange={(v) =>
        set("table.detail.limit", v)
      }
    />
  </Field>
</Row>
          <Group>Detail Columns</Group>

          <div className="collist">
            {(c.detail.columns || []).map((col, i) => (
              <div className="colrow" key={`${col.col}-${i}`}>

                <Field label="Column">
                  <Select
                    value={col.col || ""}
                    options={[
                      ["", "Select column"],
                      ...detailAvailableColumns,
                    ]}
                    onChange={(v) => {
                      set(
                        `table.detail.columns.${i}.col`,
                        v
                      );

                      if (!col.label && v) {
                        set(
                          `table.detail.columns.${i}.label`,
                          v
                        );
                      }
                    }}
                  />
                </Field>

                <Field label="Heading">
                  <Text
                    value={col.label || ""}
                    placeholder="Column heading"
                    onChange={(v) =>
                      set(
                        `table.detail.columns.${i}.label`,
                        v
                      )
                    }
                  />
                </Field>

                <Field label="Format">
                  <Select
                    value={col.fmt || "auto"}
                    options={FMTS}
                    onChange={(v) =>
                      set(
                        `table.detail.columns.${i}.fmt`,
                        v
                      )
                    }
                  />
                </Field>

                <button
                  className="xbtn"
                  title="Remove detail column"
                  onClick={() =>
                    set(
                      "table.detail.columns",
                      (c.detail.columns || []).filter(
                        (_, index) => index !== i
                      )
                    )
                  }
                >
                  ×
                </button>

              </div>
            ))}
          </div>

          <button
            className="pb"
            onClick={() =>
              set("table.detail.columns", [
                ...(c.detail.columns || []),
                {
                  col: "",
                  label: "",
                  fmt: "auto",
                  align: "left",
                  width: "auto",
                  on: true,
                },
              ])
            }
            style={{ marginTop: 10 }}
          >
            + Add Detail Column
          </button>

          <Hint>
            Choose a column to make clickable. The detail list can have
            its own database columns and headings.
          </Hint>
        </>
      )}
      <SourceEditor box={box} />
    </>
  );
}
/* ---- manual table ---- */
function ManualTableData({ box, set }) {
  const { dispatch } = useStore();
  const c = box.manualTable;

  const addColumn = () => {
    const newColumns = [
      ...c.columns,
      {
        id: uid("col"),
        label: `Column ${c.columns.length + 1}`,
      },
    ];

    const newRows = c.rows.map((row) => ({
      ...row,
      cells: [...row.cells, ""],
    }));

    set("manualTable.columns", newColumns);
    set("manualTable.rows", newRows);
  };

  const removeColumn = (index) => {
    if (c.columns.length <= 1) return;

    const newColumns = c.columns.filter((_, i) => i !== index);

    const newRows = c.rows.map((row) => ({
      ...row,
      cells: row.cells.filter((_, i) => i !== index),
    }));

    set("manualTable.columns", newColumns);
    set("manualTable.rows", newRows);
  };

  const addRow = () => {
    const newRow = {
      id: uid("row"),
      cells: c.columns.map(() => ""),
    };

    set("manualTable.rows", [...c.rows, newRow]);
  };

  const removeRow = (index) => {
    if (c.rows.length <= 1) return;

    set(
      "manualTable.rows",
      c.rows.filter((_, i) => i !== index)
    );
  };

  return (
    <>
      <Group>Manual table</Group>

      <Row>
        <button
          className="pb"
          type="button"
          onClick={addColumn}
        >
          + Add column
        </button>

        <button
          className="pb"
          type="button"
          onClick={addRow}
        >
          + Add row
        </button>
      </Row>

      <Group>Columns</Group>

      <div className="collist">
        {c.columns.map((col, i) => (
          <div
            className="colrow"
            key={col.id}
          >
            <Text
              value={col.label}
              placeholder={`Column ${i + 1}`}
              onChange={(v) =>
                set(
                  `manualTable.columns.${i}.label`,
                  v
                )
              }
            />

            <button
              className="xbtn"
              type="button"
              title="Remove column"
              onClick={() => removeColumn(i)}
            >
              ×
            </button>
          </div>
        ))}
      </div>

      <Group>Table data</Group>

      <div
        style={{
          overflowX: "auto",
          border: "1px solid #D5DDDA",
          borderRadius: 6,
        }}
      >
        <table
          style={{
            width: "100%",
            borderCollapse: "collapse",
          }}
        >
          <thead>
            <tr>
              {c.columns.map((col) => (
                <th
                  key={col.id}
                  style={{
                    padding: 8,
                    borderBottom: "1px solid #D5DDDA",
                    textAlign: "left",
                  }}
                >
                  {col.label || "Untitled"}
                </th>
              ))}

              <th
                style={{
                  width: 40,
                }}
              />
            </tr>
          </thead>

          <tbody>
            {c.rows.map((row, rowIndex) => (
              <tr key={row.id}>
                {c.columns.map((col, colIndex) => (
                  <td
                    key={col.id}
                    style={{
                      padding: 4,
                      borderBottom: "1px solid #E7ECEA",
                    }}
                  >
                    <input
                      value={
                        row.cells[colIndex] ?? ""
                      }
                      onChange={(e) =>
                        set(
                          `manualTable.rows.${rowIndex}.cells.${colIndex}`,
                          e.target.value
                        )
                      }
                      style={{
                        width: "100%",
                        border: "none",
                        outline: "none",
                        padding: 6,
                        background: "transparent",
                      }}
                    />
                  </td>
                ))}

                <td>
                  <button
                    className="xbtn"
                    type="button"
                    title="Remove row"
                    onClick={() =>
                      removeRow(rowIndex)
                    }
                  >
                    ×
                  </button>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      <Hint>
        Add columns and rows, then type directly into each cell.
      </Hint>
    </>
  );
}

function TableFormat({ box, set }) {
  const c = box.table;
  return (
    <>
      <Toggles>
        <Check on={c.zebra} label="Striped rows" onChange={(v) => set("table.zebra", v)} />
        <Check on={c.totals} label="Total row" onChange={(v) => set("table.totals", v)} />
      </Toggles>
      <FormatPanel label="Column headings" style={c.headStyle}
        onSet={(k, v) => set(`table.headStyle.${k}`, v)} />
    </>
  );
}
