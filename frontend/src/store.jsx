/* store.jsx — the designer's document lives here.

   One reducer owns the whole definition. Every edit is an action, which keeps
   dirty-tracking and "save the exact thing on screen" straightforward. */

import React, { createContext, useContext, useMemo, useReducer } from "react";
import {
  applyDefaults, blankDoc, ensureConfigs, migrate, newBox, newFilter, newSection,
  
} from "./model.js";

const Ctx = createContext(null);
export const useStore = () => useContext(Ctx);

export const initialState = {
  view: "reports",              // reports | settings | editor
  doc: blankDoc(),
  processKey: null,
  connectionId: null,
  dirty: false,
  sel: null,                    // {kind:'doc'|'filter'|'section'|'box', id}
  cfgOpen: false,
  cfgTab: "data",               // data | format | border
  pendingDel: null,
  mode: "design",               // design | preview
  catalog: { tables: [] },
  connections: [],
  reports: [],
  filterState: {},
  results: {},
  published: null,
  busy: false,
  error: null,
  notice: null,
};

/* set a nested path like "value.agg" without mutating */
function setPath(obj, path, value) {
  const [head, ...rest] = path.split(".");
  const key = /^\d+$/.test(head) ? Number(head) : head;
  if (!rest.length) {
    if (Array.isArray(obj)) {
      const copy = obj.slice();
      copy[key] = value;
      return copy;
    }
    return { ...obj, [key]: value };
  }
  const child = setPath(obj[key] ?? {}, rest.join("."), value);
  if (Array.isArray(obj)) {
    const copy = obj.slice();
    copy[key] = child;
    return copy;
  }
  return { ...obj, [key]: child };
}

const mapSections = (doc, fn) => ({ ...doc, sections: doc.sections.map(fn) });

function withBox(doc, boxId, fn) {
  return mapSections(doc, (sc) => {
    if (!sc.boxes.some((b) => b.id === boxId)) return sc;
    return { ...sc, boxes: sc.boxes.map((b) => (b.id === boxId ? fn(b, sc) : b)) };
  });
}
function moveIn(arr, i, d) {
  const j = i + d;
  if (i < 0 || j < 0 || j >= arr.length) return arr;
  const copy = arr.slice();
  [copy[i], copy[j]] = [copy[j], copy[i]];
  return copy;
}

export function reducer(state, a) {
  const touch = (doc) => ({ ...state, doc, dirty: true });

  switch (a.type) {
    /* ---- shell ---- */
    case "view":       return { ...state, view: a.view, sel: null, cfgOpen: false };
    case "mode":       return { ...state, mode: a.mode, sel: null, cfgOpen: false };
    case "busy":       return { ...state, busy: a.busy };
    case "error":      return { ...state, error: a.error };
    case "notice":     return { ...state, notice: a.notice };
    case "catalog":    return { ...state, catalog: a.catalog };
    case "connections":return { ...state, connections: a.connections };
    case "reports":    return { ...state, reports: a.reports };
    case "results":    return { ...state, results: a.results };
    case "published":  return { ...state, published: a.published };

    case "open":
      return {
        ...state, view: "editor", doc: migrate(a.doc), processKey: a.key,
        connectionId: a.connectionId ?? state.connectionId,
        dirty: false, sel: null, cfgOpen: false, results: {}, filterState: {},
        published: a.published || null, mode: a.mode || "design",
      };
    case "close":
      return { ...state, view: "reports", processKey: null, doc: blankDoc(),
        dirty: false, sel: null, cfgOpen: false, results: {}, published: null };
    case "saved":      return { ...state, dirty: false, processKey: a.key || state.processKey };
    case "loadDraft":  return { ...state, doc: a.doc, dirty: true };
    case "connection": return { ...state, connectionId: a.id, dirty: true };

    /* ---- selection ---- */
    case "select":
      return { ...state, sel: a.sel, cfgOpen: a.open ?? false, cfgTab: "data", pendingDel: null };
    case "cfgOpen":    return { ...state, cfgOpen: a.open };
    case "cfgTab":     return { ...state, cfgTab: a.tab };
    case "askDel":     return { ...state, pendingDel: a.sel };
    case "cancelDel":  return { ...state, pendingDel: null };

    /* ---- filter values (not part of the definition) ---- */
    case "filterValue":
      return { ...state, filterState: { ...state.filterState, [a.id]: a.value } };
    case "clearFilters": return { ...state, filterState: {} };

    /* ---- generic path write ---- */
    case "set": {
      const { target, id, path, value } = a;
      if (target === "doc") return touch(setPath(state.doc, path, value));
      if (target === "filter")
        return touch({ ...state.doc, filters: state.doc.filters.map(
          (f) => (f.id === id ? setPath(f, path, value) : f)) });
      if (target === "section")
        return touch(mapSections(state.doc, (sc) => {
          if (sc.id !== id) return sc;
          let next = setPath(sc, path, value);
          if (path === "cols") {
            const n = Math.max(1, Math.min(12, Number(value) || 4));
            next = { ...next, cols: n,
              boxes: next.boxes.map((b) => ({ ...b, span: Math.max(1, Math.min(n, b.span || 1)) })) };
          }
          return next;
        }));
      if (target === "box")
        return touch(withBox(state.doc, id, (b) => {
          let next = setPath(b, path, value);
          if (path === "kind") { next = ensureConfigs({ ...next });
            if (next.src.base) next = applyDefaults({ ...next }, state.catalog); }
          if (path === "src.base") {
            next = { ...next, src: { ...next.src, joins: [], where: [] } };
            next = applyDefaults({ ...next }, state.catalog);
          }
          if (/^src\.joins\.\d+\.table$/.test(path)) {
            const i = Number(path.split(".")[2]);
            const joins = next.src.joins.slice();
            const left = [next.src.base,
              ...joins.slice(0, i).map((x) => x.table)].filter(Boolean);
            const cols = (state.catalog.tables.find((t) => t.name === value) || {}).columns || [];
            const shared = cols.map((c) => c.name).find((c) =>
              left.some((t) => ((state.catalog.tables.find((x) => x.name === t) || {}).columns || [])
                .some((cc) => cc.name === c)));
            joins[i] = { ...joins[i], leftCol: shared || "", rightCol: shared || "" };
            next = { ...next, src: { ...next.src, joins } };
          }
          return next;
        }));
      return state;
    }

    /* ---- structure ---- */
    case "addFilter": {
      const f = newFilter((state.catalog.tables[0] || {}).name || "");
      return { ...state, dirty: true, doc: { ...state.doc, filters: [...state.doc.filters, f] },
        sel: { kind: "filter", id: f.id }, cfgOpen: true, cfgTab: "data" };
    }
    case "moveFilter": {
      const i = state.doc.filters.findIndex((f) => f.id === a.id);
      return touch({ ...state.doc, filters: moveIn(state.doc.filters, i, a.d) });
    }
    case "reorderFilter": {
      const i = state.doc.filters.findIndex((f) => f.id === a.id);
      const arr = state.doc.filters.slice();
      arr.splice(a.to, 0, arr.splice(i, 1)[0]);
      return touch({ ...state.doc, filters: arr });
    }

    case "addSection": {
      const s = newSection();
      return { ...state, dirty: true, doc: { ...state.doc, sections: [...state.doc.sections, s] },
        sel: { kind: "section", id: s.id }, cfgOpen: true, cfgTab: "data" };
    }
    case "moveSection": {
      const i = state.doc.sections.findIndex((s) => s.id === a.id);
      return touch({ ...state.doc, sections: moveIn(state.doc.sections, i, a.d) });
    }
    case "dupSection": {
      const i = state.doc.sections.findIndex((s) => s.id === a.id);
      const copy = JSON.parse(JSON.stringify(state.doc.sections[i]));
      copy.id = `sec-${Math.random().toString(36).slice(2, 7)}`;
      copy.boxes.forEach((b) => { b.id = `box-${Math.random().toString(36).slice(2, 7)}`; });
      const arr = state.doc.sections.slice();
      arr.splice(i + 1, 0, copy);
      return { ...touch({ ...state.doc, sections: arr }), sel: { kind: "section", id: copy.id } };
    }

    case "addBox": {
      let box = newBox((state.catalog.tables[0] || {}).name || "");
      if (box.src.base) box = applyDefaults(box, state.catalog);
      return {
        ...state, dirty: true,
        doc: mapSections(state.doc, (sc) =>
          sc.id === a.sectionId ? { ...sc, boxes: [...sc.boxes, box] } : sc),
        sel: { kind: "box", id: box.id }, cfgOpen: true, cfgTab: "data",
      };
    }
    case "moveBox":
      return touch(mapSections(state.doc, (sc) => {
        const i = sc.boxes.findIndex((b) => b.id === a.id);
        return i < 0 ? sc : { ...sc, boxes: moveIn(sc.boxes, i, a.d) };
      }));
    case "dupBox":
      return touch(mapSections(state.doc, (sc) => {
        const i = sc.boxes.findIndex((b) => b.id === a.id);
        if (i < 0) return sc;
        const copy = JSON.parse(JSON.stringify(sc.boxes[i]));
        copy.id = `box-${Math.random().toString(36).slice(2, 7)}`;
        const boxes = sc.boxes.slice();
        boxes.splice(i + 1, 0, copy);
        return { ...sc, boxes };
      }));
    case "moveColumn":
      return touch(withBox(state.doc, a.id, (b) => {
        const cols = b.table.columns.slice();
        const j = a.index + a.d;
        if (j < 0 || j >= cols.length) return b;
        cols.splice(j, 0, cols.splice(a.index, 1)[0]);
        return { ...b, table: { ...b.table, columns: cols } };
      }));

    case "addJoin":
      return touch(withBox(state.doc, a.id, (b) => ({
        ...b, src: { ...b.src, joins: [...b.src.joins,
          { type: "LEFT", table: "", leftCol: "", rightCol: "" }] },
      })));
    case "delJoin":
      return touch(withBox(state.doc, a.id, (b) => ({
        ...b, src: { ...b.src, joins: b.src.joins.filter((_, i) => i !== a.index) },
      })));
    case "addWhere":
      return touch(withBox(state.doc, a.id, (b) => ({
        ...b, src: { ...b.src, where: [...b.src.where, { col: "", op: "=", val: "" }] },
      })));
    case "delWhere":
      return touch(withBox(state.doc, a.id, (b) => ({
        ...b, src: { ...b.src, where: b.src.where.filter((_, i) => i !== a.index) },
      })));

    case "delete": {
      const { kind, id } = a.sel || {};
      let doc = state.doc;
      if (kind === "filter") doc = { ...doc, filters: doc.filters.filter((f) => f.id !== id) };
      if (kind === "section") doc = { ...doc, sections: doc.sections.filter((s) => s.id !== id) };
      if (kind === "box") doc = mapSections(doc, (sc) =>
        ({ ...sc, boxes: sc.boxes.filter((b) => b.id !== id) }));
      return { ...state, doc, dirty: true, sel: null, cfgOpen: false, pendingDel: null };
    }

    default: return state;
  }
}

export function StoreProvider({ children }) {
  const [state, dispatch] = useReducer(reducer, initialState);
  const value = useMemo(() => ({ state, dispatch }), [state]);
  return <Ctx.Provider value={value}>{children}</Ctx.Provider>;
}
