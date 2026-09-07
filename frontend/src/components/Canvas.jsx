/* Canvas.jsx — the report itself: its name, the filter bar above it, and the
   sections beneath. Everything is edited where it sits. */

import React from "react";
import api from "../api.js";
import { useStore } from "../store.jsx";
import Box from "./Box.jsx";
import {
  ALIGNS, CONTROLS, FWIDTHS, LABEL_POS, colsOf, frameStyle, normS, styleDecl, styleObj,
} from "../model.js";
import {
  Check, Chips, ConfirmBar, DeleteButton, Field, FormatPanel, FrameControls,
  Group, Hint, Row, RoleChips, Select, Switch, Text, TextArea, Toggles,
} from "./Panels.jsx";

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
function SectionNav() {
  const { state } = useStore();

  if (!state.doc.sections?.length) return null;

  const scrollToSection = (id) => {
    const el = document.getElementById(`section-${id}`);

    if (el) {
      const y = el.getBoundingClientRect().top + window.scrollY - 80;

      window.scrollTo({
        top: y,
        behavior: "smooth",
      });
    }
  };

  return (
    <div className="section-nav">
      {state.doc.sections.map((section) => (
        <button
          key={section.id}
          type="button"
          className="section-nav-item"
          onMouseDown={(e) => e.stopPropagation()}
          onClick={() => scrollToSection(section.id)}
        >
          {section.name || "Untitled Section"}
        </button>
      ))}
    </div>
  );
}
export default function Canvas() {
  const { state, dispatch } = useStore();
  const design = state.mode === "design";
  return (
  <div className="sheet" onMouseDown={() => dispatch({ type: "select", sel: null })}>
    <ReportName />
    <FilterBar />

    <SectionNavigation />

    {state.doc.sections.map((sc, i) => (
      <Section key={sc.id} section={sc} index={i + 1} />
    ))}
      {design && (
        <div className="addbar">
          <button className="add big" onClick={() => dispatch({ type: "addSection" })}>
            + Section
          </button>
        </div>
      )}
    </div>
  );
}

/* ---------------- report name ---------------- */
function ReportName() {
  const { state, dispatch } = useStore();
  const selected = state.sel?.kind === "doc";
  const st = normS(state.doc.nameStyle);
  const design = state.mode === "design";
  const set = (path, value) => dispatch({ type: "set", target: "doc", path, value });

  return (
    <div className={`rep-name-wrap${selected ? " sel" : ""}`}
      style={st.align ? { textAlign: st.align } : undefined}
      onMouseDown={(e) => {
        if (!design) return;
        e.stopPropagation();
        if (!selected) dispatch({ type: "select", sel: { kind: "doc", id: "doc" } });
      }}>
      {selected && design && (
        <div className="tools" onMouseDown={(e) => e.stopPropagation()}>
          <button aria-pressed={state.cfgOpen}
            onClick={() => dispatch({ type: "cfgOpen", open: !state.cfgOpen })}>⚙ Format</button>
          <span className="sp" />
          <button aria-pressed={!!st.bold} style={{ fontWeight: 700 }}
            onClick={() => set("nameStyle.bold", st.bold ? null : true)}>B</button>
          <button aria-pressed={!!st.italic} style={{ fontStyle: "italic" }}
            onClick={() => set("nameStyle.italic", st.italic ? null : true)}>I</button>
          <button aria-pressed={!!st.underline} style={{ textDecoration: "underline" }}
            onClick={() => set("nameStyle.underline", st.underline ? null : true)}>U</button>
          <span className="sp" />
          {ALIGNS.slice(1).map(([v, l]) => (
            <button key={v} aria-pressed={st.align === v}
              onClick={() => set("nameStyle.align", v)}>{l}</button>
          ))}
        </div>
      )}
      <Editable className="rep-name" value={state.doc.name} placeholder="Name this report"
        style={styleObj(st, { align: true })} onChange={(v) => set("name", v)} />
      {selected && state.cfgOpen && design && (
        <div className="cfg" style={{ textAlign: "left" }} onMouseDown={(e) => e.stopPropagation()}>
          <FormatPanel label="Report name" style={st} onSet={(k, v) => set(`nameStyle.${k}`, v)} />
          <Group>Report</Group>
          <Row>
            <Field label="Numbers">
              <Select value={state.doc.numberFormat}
                options={[["en-IN", "Indian — 12,34,567"], ["en-US", "International — 1,234,567"]]}
                onChange={(v) => set("numberFormat", v)} />
            </Field>
          </Row>
        </div>
      )}
    </div>
  );
}

/* ---------------- filters ---------------- */
function OrganisationSettings() {
  const { state, dispatch } = useStore();

  const settings = state.doc.organisationSettings || {};

  const set = (key, value) =>
    dispatch({
      type: "setDoc",
      path: `organisationSettings.${key}`,
      value,
    });

  return (
    <div className="org-settings">
      <div className="org-title">
        Organisation Settings
      </div>

      <select
        value={settings.companyCode || ""}
        onChange={(e) => set("companyCode", e.target.value)}
      >
        <option value="">Company Code</option>
        <option value="1000">1000</option>
        <option value="2000">2000</option>
      </select>

      <select
        value={settings.plant || ""}
        onChange={(e) => set("plant", e.target.value)}
      >
        <option value="">Plant</option>
        <option value="1100">1100</option>
        <option value="1200">1200</option>
      </select>

      <select
        value={settings.period || ""}
        onChange={(e) => set("period", e.target.value)}
      >
        <option value="">Period</option>
        <option value="2026">2026</option>
        <option value="2025">2025</option>
      </select>
    </div>
  );
}

function SectionNavigation() {
  const { state } = useStore();

  const sections = (state.doc.sections || [])
    .filter((section) => section.visible !== false);

  if (!sections.length) return null;

  const scrollToSection = (id) => {
    const el = document.getElementById(`section-${id}`);

    if (el) {
      el.scrollIntoView({
        behavior: "smooth",
        block: "start",
      });
    }
  };

  return (
    <div className="section-nav">
      {sections.map((section) => (
        <button
          key={section.id}
          type="button"
          onClick={() => scrollToSection(section.id)}
        >
          {section.name || "Untitled Section"}
        </button>
      ))}
    </div>
  );
}
function FilterBar() {
  const { state, dispatch } = useStore();
  const design = state.mode === "design";
  if (!design && !state.doc.filters.length) return null;
  return (
    <div className="fbar">
      {!state.doc.filters.length && design && (
        <div className="hint" style={{ margin: "4px 8px 0" }}>
          No filters yet — add one and name it in place.
        </div>
      )}
      {state.doc.filters.map((f, i) => <Filter key={f.id} filter={f} index={i} />)}
      {(design || Object.keys(state.filterState).length > 0) && (
        <div className="fbar-add">
          {design && (
            <button className="add" onClick={() => dispatch({ type: "addFilter" })}>+ Filter</button>
          )}
          {Object.keys(state.filterState).length > 0 && (
            <button className="add" onClick={() => dispatch({ type: "clearFilters" })}>Clear</button>
          )}
        </div>
      )}
    </div>
  );
}

function Filter({ filter: f, index }) {
  const { state, dispatch } = useStore();
  const selected = state.sel?.kind === "filter" && state.sel.id === f.id;
  const pending = state.pendingDel?.kind === "filter" && state.pendingDel.id === f.id;
  const design = state.mode === "design";
  const fst = normS(f.style), cst = normS(f.ctrlStyle);
  const pos = f.labelPos || "top";
  const gap = f.gap === undefined || f.gap === "" ? 8 : Number(f.gap);
  const lw = String(f.labelWidth || "").trim();
  const cw = String(f.ctrlWidth || "").trim();
  const wide = ["radio", "checkbox"].includes(f.control) && (f.width || "auto") === "auto";
  const set = (path, value) => dispatch({ type: "set", target: "filter", id: f.id, path, value });

  const labelStyle = { ...styleObj(fst, { bg: true }),
    ...(lw ? { flex: `0 0 ${lw}px`, width: `${lw}px`, maxWidth: "none" } : {}) };

  return (
    <div className={`fchip w-${f.width || "auto"}${wide ? " w-wide" : ""}${selected ? " sel" : ""}`}
      style={fst.bg ? { background: fst.bg } : undefined}
      onMouseDown={(e) => {
        if (!design) return;
        e.stopPropagation();
        if (!selected) dispatch({ type: "select", sel: { kind: "filter", id: f.id } });
      }}>
      {design && (
        <div className="ftools" onMouseDown={(e) => e.stopPropagation()}>
          <button title="Move earlier" onClick={() => dispatch({ type: "moveFilter", id: f.id, d: -1 })}>◀</button>
          <span className="fpos">{index + 1}</span>
          <button title="Move later" onClick={() => dispatch({ type: "moveFilter", id: f.id, d: 1 })}>▶</button>
          <span className="sp" />
          <button aria-pressed={selected && state.cfgOpen}
            onClick={() => { dispatch({ type: "select", sel: { kind: "filter", id: f.id }, open: true }); }}>
            ⚙ Set up
          </button>
          <button className="warn" title="Delete this filter"
            onClick={() => dispatch({ type: "askDel", sel: { kind: "filter", id: f.id } })}>🗑</button>
        </div>
      )}

      <div className={`fbody pos-${pos}`} style={{ gap: `${gap}px` }}>
        <Editable className={`fname${pos === "hidden" ? " lbl-hidden" : ""}`}
          value={f.label} placeholder="Label" style={labelStyle}
          onChange={(v) => set("label", v)} />
        {f.colon && pos !== "hidden" && (
          <span className="fcolon" style={styleObj(fst, { bg: true })}>:</span>
        )}
        <div className="fctrl" style={cw ? { flex: `0 0 ${cw}px`, width: `${cw}px` } : undefined}>
          <div style={styleObj(cst)}><Control filter={f} /></div>
        </div>
      </div>

      {pending ? (
        <ConfirmBar what={`the filter "${f.label || "Unnamed"}"`}
          onYes={() => dispatch({ type: "delete", sel: { kind: "filter", id: f.id } })}
          onNo={() => dispatch({ type: "cancelDel" })} />
      ) : selected && state.cfgOpen && design ? (
        <FilterPanel filter={f} />
      ) : null}
    </div>
  );
}

/* Options come from the server so a dropdown shows what is in the column
   today, not what was there when the definition was saved. */
function useOptions(f) {
  const { state } = useStore();
  const [options, setOptions] = React.useState([]);
  React.useEffect(() => {
    let alive = true;
    if (f.optionSource === "list") {
      const vals = (f.list || "").split(/[\n,]/).map((s) => s.trim()).filter(Boolean);
      setOptions(vals.map((v) => ({ value: v, label: v })));
      return () => { alive = false; };
    }
    if (!state.processKey) { setOptions([]); return () => { alive = false; }; }
    api.filterOptions(state.processKey, f.id)
      .then((r) => alive && setOptions(r.options || []))
      .catch(() => alive && setOptions([]));
    return () => { alive = false; };
  }, [state.processKey, f.id, f.optionSource, f.list, f.table, f.column, f.optTable, f.optColumn]);
  return options;
}

function Control({ filter: f }) {
  const { state, dispatch } = useStore();
  const value = state.filterState[f.id];
  const options = useOptions(f);
  const set = (v) => dispatch({ type: "filterValue", id: f.id, value: v });

  switch (f.control) {
    case "text":
      return <input type="text" value={value || ""} placeholder={f.placeholder || "Contains…"}
        onChange={(e) => set(e.target.value)} />;
    case "number":
      return <input type="number" value={value || ""} placeholder={f.placeholder || "Exact"}
        onChange={(e) => set(e.target.value)} />;
    case "date":
      return <input type="date" value={value || ""} onChange={(e) => set(e.target.value)} />;
    case "daterange": {
      const o = value && typeof value === "object" ? value : {};
      return (
        <span className="pair">
          <input type="date" value={o.from || ""} onChange={(e) => set({ ...o, from: e.target.value })} />
          <input type="date" value={o.to || ""} onChange={(e) => set({ ...o, to: e.target.value })} />
        </span>
      );
    }
    case "toggle":
      return (
        <div className="opts">
          {[["", "Any"], ["Yes", "Yes"], ["No", "No"]].map(([v, l]) => (
            <label key={l}>
              <input type="radio" name={`r-${f.id}`} checked={String(value || "") === v}
                onChange={() => set(v)} />{l}
            </label>
          ))}
        </div>
      );
    case "radio":
      return (
        <div className="opts">
          <label>
            <input type="radio" name={`r-${f.id}`} checked={!value} onChange={() => set("")} />All
          </label>
          {options.slice(0, 12).map((o) => (
            <label key={o.value}>
              <input type="radio" name={`r-${f.id}`} checked={String(value) === String(o.value)}
                onChange={() => set(o.value)} />{o.label}
            </label>
          ))}
        </div>
      );
    case "checkbox": {
      const arr = Array.isArray(value) ? value.map(String) : [];
      return (
        <div className="opts">
          {options.slice(0, 14).map((o) => (
            <label key={o.value}>
              <input type="checkbox" checked={arr.includes(String(o.value))}
                onChange={(e) => set(e.target.checked
                  ? [...arr, String(o.value)]
                  : arr.filter((x) => x !== String(o.value)))} />
              {o.label}
            </label>
          ))}
        </div>
      );
    }
    default:
      return (
        <select value={value ?? ""} onChange={(e) => set(e.target.value)}>
          <option value="">All</option>
          {options.map((o) => (
            <option key={String(o.value)} value={o.value}>{o.label}</option>
          ))}
        </select>
      );
  }
}

function FilterPanel({ filter: f }) {
  const { state, dispatch } = useStore();
  const [tableSearch, setTableSearch] = React.useState("");
  const tab = state.cfgTab;
  const tables = state.catalog.tables.map((t) => t.name);
  const set = (path, value) => dispatch({ type: "set", target: "filter", id: f.id, path, value });
  const idx = state.doc.filters.findIndex((x) => x.id === f.id);
  const n = state.doc.filters.length;

  return (
    <div className="cfg" style={{ minWidth: 280 }} onMouseDown={(e) => e.stopPropagation()}>
      <div className="cfg-tabs">
        <button aria-pressed={tab === "data"} onClick={() => dispatch({ type: "cfgTab", tab: "data" })}>
          Set up
        </button>
        <button aria-pressed={tab === "format"} onClick={() => dispatch({ type: "cfgTab", tab: "format" })}>
          Format
        </button>
      </div>

      {tab === "format" ? (
        <>
          <FormatPanel label="Filter name" style={f.style} onSet={(k, v) => set(`style.${k}`, v)} />
          <FormatPanel label="The control itself" style={f.ctrlStyle}
            onSet={(k, v) => set(`ctrlStyle.${k}`, v)} />
          <Group>Remove</Group>
          <DeleteButton what="this filter"
            onClick={() => dispatch({ type: "askDel", sel: { kind: "filter", id: f.id } })} />
        </>
      ) : (
        <>
          <Group>Label</Group>
          <Row>
            <Field label="Filter label">
              <Text value={f.label} placeholder="Vendor Name" onChange={(v) => set("label", v)} />
            </Field>
          </Row>

          <Group>Type</Group>
          <Chips value={f.control} options={CONTROLS} onChange={(v) => set("control", v)} />

          <Group>Placement in the filter bar</Group>
          <Row>
            <Field label="Position">
              <select value={idx} onChange={(e) =>
                dispatch({ type: "reorderFilter", id: f.id, to: Number(e.target.value) })}>
                {state.doc.filters.map((_, k) => (
                  <option key={k} value={k}>{k + 1} of {n}</option>
                ))}
              </select>
            </Field>
            <Field label="Chip width">
              <Chips value={f.width || "auto"} options={FWIDTHS} onChange={(v) => set("width", v)} />
            </Field>
          </Row>

          <Group>The row: label and control</Group>
          <Row>
            <Field label="Label sits">
              <Chips value={f.labelPos || "top"} options={LABEL_POS}
                onChange={(v) => set("labelPos", v)} />
            </Field>
          </Row>
          <Row>
            <Field label="Label width (px)">
              <Text type="number" value={f.labelWidth} placeholder="auto"
                onChange={(v) => set("labelWidth", v)} />
            </Field>
            <Field label="Control width (px)">
              <Text type="number" value={f.ctrlWidth} placeholder="fill"
                onChange={(v) => set("ctrlWidth", v)} />
            </Field>
            <Field label="Gap (px)">
              <Text type="number" value={f.gap} placeholder="8" onChange={(v) => set("gap", Number(v)) } />
            </Field>
          </Row>
          <Toggles>
            <Check on={!!f.colon} label="Put a colon after the label"
              onChange={(v) => set("colon", v)} />
          </Toggles>
          <Row>
            <Field label="Placeholder inside the box">
              <Text value={f.placeholder} placeholder="e.g. start typing…"
                onChange={(v) => set("placeholder", v)} />
            </Field>
          </Row>
          <Hint>Label left plus a fixed label width lines several filters up into a column.</Hint>

          <Group>Filters which column</Group>
          <Row>
            <Field label="Table">
              <input
                type="text"
                value={tableSearch}
                placeholder="Search table..."
                onChange={(e) => setTableSearch(e.target.value)}
              />
              <Select
                value={f.table}
                options={[
                  "",
                  ...tables.filter((table) =>
                    table.toLowerCase().includes(tableSearch.toLowerCase())
                ),
              ]}
              onChange={(v) => {
                set("table", v);
                setTableSearch("");
              }}
              />
            </Field>
            <Field label="Column">
              <Select value={f.column}
                options={["", ...colsOf(state.catalog, f.table).map((c) => c.name)]}
                onChange={(v) => set("column", v)} />
            </Field>
          </Row>
          <Hint>Applies to every box whose tables carry a column of this name.</Hint>

          <Group>Who can see this filter on a published link</Group>
          <RoleChips value={f.roles} onChange={(v) => set("roles", v)} />
          <Hint>Nothing picked = shown on every published link, whatever role opened it.</Hint>

          {["select", "radio", "checkbox"].includes(f.control) && (
            <>
              <Group>Where the choices come from</Group>
              <Chips value={f.optionSource} onChange={(v) => set("optionSource", v)}
                options={[["auto", "Values in that column"], ["table", "Another table"],
                  ["list", "A list I type"]]} />
              {f.optionSource === "table" && (
                <Row style={{ marginTop: 8 }}>
                  <Field label="Lookup table">
                    <Select value={f.optTable} options={["", ...tables]}
                      onChange={(v) => set("optTable", v)} />
                  </Field>
                  <Field label="Value column">
                    <Select value={f.optColumn}
                      options={["", ...colsOf(state.catalog, f.optTable).map((c) => c.name)]}
                      onChange={(v) => set("optColumn", v)} />
                  </Field>
                </Row>
              )}
              {f.optionSource === "list" && (
                <div style={{ marginTop: 8 }}>
                  <Field label="Values — one per line">
                    <TextArea value={f.list} placeholder={"Open\nOn hold\nClosed"}
                      onChange={(v) => set("list", v)} />
                  </Field>
                </div>
              )}
            </>
          )}

          <Group>Remove</Group>
          <DeleteButton what="this filter"
            onClick={() => dispatch({ type: "askDel", sel: { kind: "filter", id: f.id } })} />
        </>
      )}
    </div>
  );
}

/* ---------------- sections ---------------- */
function Section({ section: sc, index }) {
  const { state, dispatch } = useStore();
  const selected = state.sel?.kind === "section" && state.sel.id === sc.id;
  const pending = state.pendingDel?.kind === "section" && state.pendingDel.id === sc.id;
  const design = state.mode === "design";
  const nst = normS(sc.style), dst = normS(sc.descStyle);
  const nameOff = sc.nameVisible === false;
  const subOff = sc.subVisible === false;
  const cols = Math.max(1, Math.min(12, Number(sc.cols) || 4));
  const set = (path, value) => dispatch({ type: "set", target: "section", id: sc.id, path, value });

  const ruleStyle = {
    ...(nst.color ? { background: nst.color } : {}),
    ...(nst.align === "center" ? { marginLeft: "auto", marginRight: "auto" }
      : nst.align === "right" ? { marginLeft: "auto" } : {}),
  };

  return (
    <div
      id={`section-${sc.id}`}
      className={`sec${sc.frame?.on ? " framed" : ""}${selected ? " sel" : ""}`}
      style={frameStyle(sc.frame)}
      onMouseDown={(e) => {
        if (!design) return;
        e.stopPropagation();
        if (!selected) dispatch({ type: "select", sel: { kind: "section", id: sc.id } });
      }}>
      {design && (
        <div className="tools sectools" onMouseDown={(e) => e.stopPropagation()}>
          <span className="tlabel">Section</span>
          <button aria-pressed={selected && state.cfgOpen}
            onClick={() => dispatch({ type: "select", sel: { kind: "section", id: sc.id }, open: true })}>
            ⚙ Set up
          </button>
          <span className="sp" />
          <button title="Move up" onClick={() => dispatch({ type: "moveSection", id: sc.id, d: -1 })}>↑</button>
          <button title="Move down" onClick={() => dispatch({ type: "moveSection", id: sc.id, d: 1 })}>↓</button>
          <button onClick={() => dispatch({ type: "dupSection", id: sc.id })}>⧉ Copy</button>
          <button className="warn" title="Delete this section"
            onClick={() => dispatch({ type: "askDel", sel: { kind: "section", id: sc.id } })}>🗑 Delete</button>
        </div>
      )}

      {design && <div className="secidx">Section {String(index).padStart(2, "0")}</div>}

      <div className={`sec-head${nameOff ? " lbl-hidden" : ""}`}
        style={nst.align ? {
          justifyContent: nst.align === "center" ? "center"
            : nst.align === "right" ? "flex-end" : "flex-start",
        } : undefined}>
        <Editable className="sec-name" value={sc.name} placeholder="Untitled section"
          style={styleObj(nst, { align: true })} onChange={(v) => set("name", v)} />
      </div>
      {sc.rule !== false && !nameOff && <div className="sec-rule" style={ruleStyle} />}
      <Editable className={`sec-desc${subOff ? " lbl-hidden" : ""}`} value={sc.desc}
        placeholder="Sub-heading" style={styleObj(dst, { align: true })}
        onChange={(v) => set("desc", v)} />

      {selected && state.cfgOpen && design && <SectionPanel section={sc} />}

      {pending && (
        <ConfirmBar what={`the section "${sc.name || "Untitled"}"`}
          extra={sc.boxes.length
            ? `Its ${sc.boxes.length} box${sc.boxes.length > 1 ? "es" : ""} will go with it.` : ""}
          onYes={() => dispatch({ type: "delete", sel: { kind: "section", id: sc.id } })}
          onNo={() => dispatch({ type: "cancelDel" })} />
      )}

      <div className="grid" style={{ gridTemplateColumns: `repeat(${cols},minmax(0,1fr))` }}>
        {sc.boxes.map((b) => <Box key={b.id} box={b} cols={cols} />)}
      </div>
      {!sc.boxes.length && <div className="empty">Nothing here yet — add a box below.</div>}

      {design && (
        <div className="secadd">
          <button className="addbox" onMouseDown={(e) => e.stopPropagation()}
            onClick={() => dispatch({ type: "addBox", sectionId: sc.id })}>
            + Add a box to “{sc.name || "this section"}”
          </button>
        </div>
      )}
    </div>
  );
}

function SectionPanel({ section: sc }) {
  const { state, dispatch } = useStore();
  const tab = state.cfgTab;
  const set = (path, value) => dispatch({ type: "set", target: "section", id: sc.id, path, value });
  const del = () => dispatch({ type: "askDel", sel: { kind: "section", id: sc.id } });

  return (
    <div className="cfg" style={{ marginBottom: 12 }} onMouseDown={(e) => e.stopPropagation()}>
      <div className="cfg-tabs">
        {[["data", "Headings"], ["format", "Format"], ["border", "Border"]].map(([t, l]) => (
          <button key={t} aria-pressed={tab === t} onClick={() => dispatch({ type: "cfgTab", tab: t })}>
            {l}
          </button>
        ))}
      </div>

      {tab === "format" && (
        <>
          <FormatPanel label="Section name" style={sc.style} onSet={(k, v) => set(`style.${k}`, v)} />
          <FormatPanel label="Sub-heading" style={sc.descStyle} onSet={(k, v) => set(`descStyle.${k}`, v)} />
          <Group>Remove</Group>
          <DeleteButton what="this section" onClick={del} />
        </>
      )}

      {tab === "border" && (
        <>
          <Group>Section border</Group>
          <FrameControls frame={sc.frame} what="this section" onSet={(k, v) => set(`frame.${k}`, v)} />
          <Hint>The border wraps the whole section, so every box you add sits inside it.</Hint>
          <Group>Remove</Group>
          <DeleteButton what="this section" onClick={del} />
        </>
      )}

      {tab === "data" && (
        <>
          <Group>Section name</Group>
          <Row>
            <Field label="Name">
              <Text value={sc.name} placeholder="Headlines" onChange={(v) => set("name", v)} />
            </Field>
          </Row>
          <Toggles>
            <Check on={sc.nameVisible !== false} label="Show the name"
              onChange={(v) => set("nameVisible", v)} />
            <Check on={sc.rule !== false} label="Show the rule under it"
              onChange={(v) => set("rule", v)} />
          </Toggles>

          <Group>Sub-heading</Group>
          <Row>
            <Field label="Sub-heading">
              <Text value={sc.desc} placeholder="A line under the section name"
                onChange={(v) => set("desc", v)} />
            </Field>
          </Row>
          <Toggles>
            <Check on={sc.subVisible !== false} label="Show the sub-heading"
              onChange={(v) => set("subVisible", v)} />
          </Toggles>
          <Hint>
            Hidden headings stay here, struck through, so you can still edit them. They are
            dropped from Preview and from the published report.
          </Hint>

          <Group>Boxes per row</Group>
          <Chips value={Math.max(1, Math.min(12, Number(sc.cols) || 4))}
            options={[[1, "1"], [2, "2"], [3, "3"], [4, "4"], [5, "5"], [6, "6"]]}
            onChange={(v) => set("cols", v)} />
          <Row style={{ marginTop: 8 }}>
            <Field label="Or a custom number (1–12)">
              <Text type="number" value={sc.cols} placeholder="4"
                onChange={(v) => set("cols", Number(v))} />
            </Field>
          </Row>
          <Hint>Each box is then sized in cells from its own Data tab.</Hint>

          <Group>Remove</Group>
          <DeleteButton what="this section" onClick={del} />
        </>
      )}
    </div>
  );
}
