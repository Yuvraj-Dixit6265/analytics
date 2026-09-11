/* Panels.jsx — the small controls every in-place panel is built from,
   plus the two big shared panels: typography and the data source. */

import React from "react";
import api from "../api.js";
import { useStore } from "../store.jsx";
import {
  AGGS, ALIGNS, BCOLORS, BGSWATCH, BSTYLES, CASES, FONTS, JOIN_TYPES, OPS,
  PUBLIC_ROLES, SIZES, SWATCH, colOptions, colsOf, normF, normS,
} from "../model.js";

/* ---------------- primitives ---------------- */
export const Field = ({ label, children }) => (
  <div className="fld">
    <label>{label}</label>
    {children}
  </div>
);

export const Row = ({ children, style }) => (
  <div className="row" style={style}>{children}</div>
);

export const Group = ({ children }) => <div className="grp">{children}</div>;

export function Select({ value, options, onChange, numeric }) {
  return (
    <select
      value={value ?? ""}
      onChange={(e) => onChange(numeric ? Number(e.target.value) : e.target.value)}
    >
      {options.map((o) => {
        const [v, l] = Array.isArray(o) ? o : [o, o];
        return <option key={String(v)} value={v}>{l}</option>;
      })}
    </select>
  );
}

/* Text inputs commit on blur, so the document is not rewritten per keystroke. */
export function Text({ value, onChange, placeholder, type = "text" }) {
  const [draft, setDraft] = React.useState(value ?? "");
  React.useEffect(() => { setDraft(value ?? ""); }, [value]);
  return (
    <input
      type={type}
      value={draft}
      placeholder={placeholder}
      onChange={(e) => setDraft(e.target.value)}
      onBlur={() => draft !== (value ?? "") && onChange(draft)}
      onKeyDown={(e) => e.key === "Enter" && e.currentTarget.blur()}
    />
  );
}

export function TextArea({ value, onChange, placeholder }) {
  const [draft, setDraft] = React.useState(value ?? "");
  React.useEffect(() => { setDraft(value ?? ""); }, [value]);
  return (
    <textarea
      value={draft}
      placeholder={placeholder}
      onChange={(e) => setDraft(e.target.value)}
      onBlur={() => draft !== (value ?? "") && onChange(draft)}
    />
  );
}

export const Check = ({ on, onChange, label }) => (
  <label>
    <input type="checkbox" checked={!!on} onChange={(e) => onChange(e.target.checked)} />
    {label}
  </label>
);

export const Toggles = ({ children }) => <div className="toggles">{children}</div>;

export const Switch = ({ on, onChange, label }) => (
  <label className="swrow">
    <span>{label}</span>
    <span className="sw">
      <input type="checkbox" checked={!!on} onChange={(e) => onChange(e.target.checked)} />
      <i />
    </span>
  </label>
);

export const Chips = ({ value, options, onChange }) => (
  <div className="chips">
    {options.map((o) => {
      const [v, l] = Array.isArray(o) ? o : [o, o];
      return (
        <button key={String(v)} aria-pressed={String(v) === String(value)}
          onClick={() => onChange(v)}>{l}</button>
      );
    })}
  </div>
);

export const SegBar = ({ value, options, onChange }) => (
  <div className="segbar">
    {options.map(([v, l]) => (
      <button key={v} aria-pressed={String(v) === String(value)}
        onClick={() => onChange(v)}>{l}</button>
    ))}
  </div>
);

export const RoleChips = ({ value, onChange }) => {
  const roles = value || [];
  const toggle = (r) => onChange(
    roles.includes(r) ? roles.filter((x) => x !== r) : [...roles, r]);
  return (
    <div className="chips">
      {PUBLIC_ROLES.map(([v, l]) => (
        <button key={v} aria-pressed={roles.includes(v)} onClick={() => toggle(v)}>{l}</button>
      ))}
    </div>
  );
};

export const Swatches = ({ value, list, onChange }) => (
  <div className="swatches">
    {list.map((c) => (
      <button key={c || "none"} title={c || "none"} aria-pressed={c === (value || "")}
        onClick={() => onChange(c)}
        style={{
          background: c || "repeating-linear-gradient(45deg,#fff,#fff 4px,#E7ECEA 4px,#E7ECEA 8px)",
        }} />
    ))}
  </div>
);

export const Hint = ({ children }) => <div className="hint">{children}</div>;

export const DeleteButton = ({ what, onClick }) => (
  <button className="delbtn" onClick={onClick}>Delete {what}</button>
);

export function ConfirmBar({ what, extra, onYes, onNo }) {
  return (
    <div className="danger">
      <p><b>Delete {what}?</b> {extra} This cannot be undone.</p>
      <div className="btns">
        <button className="dbtn" onClick={onYes}>Yes, delete</button>
        <button className="dbtn cancel" onClick={onNo}>Keep it</button>
      </div>
    </div>
  );
}

/* ---------------- typography ---------------- */
export function FormatPanel({ label, style, onSet }) {
  const st = normS(style);
  return (
    <>
      {label !== null && <Group>{label || "Text"}</Group>}
      <Row>
        <Field label="Font">
          <Select value={st.font} options={FONTS} onChange={(v) => onSet("font", v)} />
        </Field>
        <Field label="Size">
          <Select value={st.size ?? ""} onChange={(v) => onSet("size", v === "" ? null : Number(v))}
            options={[["", "Default"], ...SIZES.map((s) => [s, `${s} px`])]} />
        </Field>
      </Row>
      <Row>
        <Field label="Style">
          <div className="chips">
            <button aria-pressed={!!st.bold} style={{ fontWeight: 700, minWidth: 30 }}
              onClick={() => onSet("bold", st.bold ? null : true)}>B</button>
            <button aria-pressed={!!st.italic} style={{ fontStyle: "italic", minWidth: 30 }}
              onClick={() => onSet("italic", st.italic ? null : true)}>I</button>
            <button aria-pressed={!!st.underline} style={{ textDecoration: "underline", minWidth: 30 }}
              onClick={() => onSet("underline", st.underline ? null : true)}>U</button>
          </div>
        </Field>
        <Field label="Align">
          <Chips value={st.align} options={ALIGNS} onChange={(v) => onSet("align", v)} />
        </Field>
      </Row>
      <Row>
        <Field label="Letter case">
          <Chips value={st.caps} options={CASES} onChange={(v) => onSet("caps", v)} />
        </Field>
      </Row>
      <Row>
        <Field label="Text colour">
          <Swatches value={st.color} list={SWATCH} onChange={(v) => onSet("color", v)} />
        </Field>
        <Field label="Background">
          <Swatches value={st.bg} list={BGSWATCH} onChange={(v) => onSet("bg", v)} />
        </Field>
      </Row>
    </>
  );
}

/* ---------------- borders ---------------- */
export function FrameControls({ frame, what, onSet }) {
  const fr = normF(frame);
  return (
    <>
      <Toggles>
        <Check on={fr.on} label={`Draw a border around ${what}`}
          onChange={(v) => onSet("on", v)} />
      </Toggles>
      {!fr.on ? <Hint>Off — {what} sits flush with the page.</Hint> : (
        <>
          <Row>
            <Field label="Style">
              <Chips value={fr.style} options={BSTYLES} onChange={(v) => onSet("style", v)} />
            </Field>
            <Field label="Thickness">
              <Select value={fr.width} numeric options={[1, 2, 3, 4, 6]}
                onChange={(v) => onSet("width", v)} />
            </Field>
          </Row>
          <Row>
            <Field label="Corner radius">
              <Select value={fr.radius} numeric options={[0, 2, 3, 6, 10, 16]}
                onChange={(v) => onSet("radius", v)} />
            </Field>
            <Field label="Inner padding">
              <Select value={fr.pad} numeric options={[0, 6, 10, 14, 20, 28]}
                onChange={(v) => onSet("pad", v)} />
            </Field>
          </Row>
          <Row>
            <Field label="Border colour">
              <Swatches value={fr.color} list={BCOLORS} onChange={(v) => onSet("color", v)} />
            </Field>
            <Field label="Fill">
              <Swatches value={fr.bg} list={BGSWATCH} onChange={(v) => onSet("bg", v)} />
            </Field>
          </Row>
        </>
      )}
    </>
  );
}

/* ---------------- the data source ----------------
   Base table, joins, WHERE conditions, and the SQL the middleware says it
   will run. The preview comes from the server rather than being guessed
   here, so what you read is what executes. */
export function SourceEditor({ box }) {
  const { state, dispatch } = useStore();
  const { catalog } = state;
  const src = box.src;
  const mode = src.mode === "sql" ? "sql" : "builder";
  const set = (path, value) =>
    dispatch({ type: "set", target: "box", id: box.id, path, value });

  return (
    <>
      <Group>How this box gets its data</Group>
      <SegBar value={mode} options={[["builder", "Built for me"], ["sql", "SQL I write"]]}
        onChange={(v) => set("src.mode", v)} />

      {mode === "sql" ? (
        <>
          <Group>The SQL this box will run</Group>
          <TextArea value={src.sql}
            placeholder={"SELECT COUNT(*) AS value\nFROM vendor_master\nWHERE application_status = {{Status}}"}
            onChange={(v) => set("src.sql", v)} />
          <Hint>
            One <b>SELECT</b> statement, read-only. Drop in a filter's current value with{" "}
            <span className="mono">{"{{Filter Label}}"}</span> — it matches the filter by its
            label, e.g. <span className="mono">{"{{Status}}"}</span>. Give the column your box
            expects the alias it needs: <span className="mono">value</span> for a Value box,{" "}
            <span className="mono">category</span> and <span className="mono">value</span> for a
            chart, or the same names as the table's column list.
          </Hint>
          <Group>The query this box will run</Group>
          <SqlPreview box={box} />
        </>
      ) : !catalog.tables.length ? (
        <>
          <Group>Read from</Group>
          <Hint>
            No tables available yet. Connect a database under <b>System Settings</b> —
            the catalogue is read from <span className="mono">INFORMATION_SCHEMA</span>.
          </Hint>
        </>
      ) : (
        <BuilderSourceEditor box={box} set={set} />
      )}
    </>
  );
}

/* The original table/join/where builder, unchanged — just split out so
   "SQL I write" mode above can skip straight past it. */
function BuilderSourceEditor({ box, set }) {
  const { state, dispatch } = useStore();
  const { catalog } = state;
  const src = box.src;
  const cols = colOptions(catalog, src);
  const tableNames = catalog.tables.map((t) => t.name);

  return (
    <>
      <Group>Read from</Group>
      <Row>
        <Field label="Base table">
          <Select value={src.base} options={["", ...tableNames]}
            onChange={(v) => set("src.base", v)} />
        </Field>
      </Row>

      <Group>Joins — how the tables are stitched together</Group>
      {(src.joins || []).map((j, i) => {
        const leftCols = colOptions(catalog,
          { base: src.base, joins: src.joins.slice(0, i) }).map((c) => c.name);
        return (
          <div className="joinrow" key={i}>
            <Select value={j.type} options={JOIN_TYPES}
              onChange={(v) => set(`src.joins.${i}.type`, v)} />
            <Select value={j.table} options={["", ...tableNames.filter((t) => t !== src.base)]}
              onChange={(v) => set(`src.joins.${i}.table`, v)} />
            <span className="eq">on</span>
            <Select value={j.rightCol}
              options={["", ...colsOf(catalog, j.table).map((c) => c.name)]}
              onChange={(v) => set(`src.joins.${i}.rightCol`, v)} />
            <Select value={j.leftCol} options={["", ...leftCols]}
              onChange={(v) => set(`src.joins.${i}.leftCol`, v)} />
            <button className="xbtn" title="Remove join"
              onClick={() => dispatch({ type: "delJoin", id: box.id, index: i })}>✕</button>
          </div>
        );
      })}
      {!(src.joins || []).length && (
        <Hint>No join — this box reads <b>{src.base || "nothing"}</b> only.</Hint>
      )}
      <button className="add" onClick={() => dispatch({ type: "addJoin", id: box.id })}>
        + Join a table
      </button>
      <Hint>Joined columns are named <span className="mono">table.column</span> everywhere below.</Hint>

      <Group>Where — conditions you set</Group>
      {(src.where || []).map((c, i) => {
        const needsVal = !["blank", "notblank", "null", "notnull"].includes(c.op);
        return (
          <div className="wherow" key={i}>
            {i === 0 ? <span className="eq">WHERE</span> : (
              <Select value={src.whereLink || "AND"} options={["AND", "OR"]}
                onChange={(v) => set("src.whereLink", v)} />
            )}
            <Select value={c.col} options={["", ...cols.map((x) => x.name)]}
              onChange={(v) => set(`src.where.${i}.col`, v)} />
            <Select value={c.op} options={OPS} onChange={(v) => set(`src.where.${i}.op`, v)} />
            {needsVal ? (
              <Text value={c.val} placeholder={c.op === "in" ? "a, b, c" : "value"}
                onChange={(v) => set(`src.where.${i}.val`, v)} />
            ) : <span className="eq">—</span>}
            <button className="xbtn" title="Remove condition"
              onClick={() => dispatch({ type: "delWhere", id: box.id, index: i })}>✕</button>
          </div>
        );
      })}
      {!(src.where || []).length && <Hint>No conditions — every row is included.</Hint>}
      <button className="add" onClick={() => dispatch({ type: "addWhere", id: box.id })}>
        + Condition
      </button>

      <Group>The query this box will run</Group>
      <SqlPreview box={box} />
    </>
  );
}

/* The middleware builds the SQL, so this asks it rather than reimplementing
   the builder in the browser and risking the two drifting apart. */
function SqlPreview({ box }) {
  const { state } = useStore();
  const [sql, setSql] = React.useState(null);
  const [err, setErr] = React.useState(null);

  React.useEffect(() => {
    let alive = true;
    if (!state.processKey) { setSql(null); setErr("Save the report to see its SQL."); return; }
    api.previewSql(state.processKey, box, state.doc, state.filterState)
      .then((r) => { if (!alive) return; setErr(r.ok ? null : r.error); setSql(r.sql); })
      .catch((e) => alive && setErr(e.message));
    return () => { alive = false; };
  }, [JSON.stringify(box.src), box.kind, JSON.stringify(box.value),
      JSON.stringify(box.chart), JSON.stringify(box.table),
      state.processKey, JSON.stringify(state.filterState)]);

  if (err) return <div className="fx bad">{err}</div>;
  if (!sql) return <Hint>This box runs no query.</Hint>;
  return <div className="sqlbox">{sql}</div>;
}

export { AGGS };