/* model.js — the document shape.

   Deliberately identical to what the single-file build exports, so a
   definition moves between the two without conversion. `migrate` fills in
   anything an older file is missing rather than rejecting it. */

export const uid = (p) => `${p}-${Math.random().toString(36).slice(2, 7)}`;

export const PALETTE = ["#0D6E62", "#3B5BA5", "#96610A", "#9E332B",
  "#5E8C6A", "#7A5C8E", "#B8862A", "#1B2529"];
export const SWATCH = ["", "#1A2326", "#0D6E62", "#3B5BA5", "#96610A", "#9E332B", "#6B7A78"];
export const BGSWATCH = ["", "#F7F9F8", "#E0EFEC", "#F6EEDC", "#F6E5E3", "#EAEFF7", "#1B2529"];
export const BCOLORS = ["#D5DDDA", "#1A2326", "#0D6E62", "#3B5BA5", "#96610A", "#9E332B"];
export const SIZES = [11, 12, 13, 14, 16, 18, 20, 24, 28, 32, 40, 48];
export const FONTS = [
  ["", "Default"], ["Georgia, 'Times New Roman', serif", "Serif"],
  ["var(--mono)", "Mono"], ["Arial, Helvetica, sans-serif", "Arial"],
  ["'Trebuchet MS', sans-serif", "Trebuchet"], ["Verdana, Geneva, sans-serif", "Verdana"],
  ["'Courier New', monospace", "Courier"], ["'Palatino Linotype', Palatino, serif", "Palatino"],
];
export const ALIGNS = [["", "Auto"], ["left", "L"], ["center", "C"], ["right", "R"], ["justify", "J"]];
export const CASES = [["", "Aa"], ["uppercase", "AA"], ["lowercase", "aa"], ["capitalize", "Aa·"]];
export const AGGS = ["SUM", "AVG", "COUNT", "COUNT DISTINCT", "MIN", "MAX"];
export const JOIN_TYPES = [["INNER", "INNER JOIN"], ["LEFT", "LEFT JOIN"]];
export const OPS = [["=", "="], ["<>", "≠"], [">", ">"], [">=", "≥"], ["<", "<"], ["<=", "≤"],
  ["contains", "contains"], ["starts", "starts with"], ["in", "in list"],
  ["blank", "is blank"], ["notblank", "is not blank"]];
export const CHARTS = [
  ["bar", "Bar"],
  ["hbar", "Bars →"],
  ["stacked", "Single Stacked Bar"],
  ["line", "Line"],
  ["area", "Area"],
  ["pie", "Pie"],
  ["donut", "Donut"],
];
export const CONTROLS = [["text", "Text box"], ["date", "Date"], ["daterange", "Date range"],
  ["select", "Dropdown"], ["radio", "Option buttons"], ["checkbox", "Check boxes"],
  ["toggle", "Yes / No"], ["number", "Number"]];
export const LABEL_POS = [["top", "Above"], ["left", "Left"], ["right", "Right"], ["hidden", "Hidden"]];
export const FWIDTHS = [["narrow", "S"], ["auto", "M"], ["wide", "L"], ["full", "Full row"]];
export const FMTS = [["auto", "Auto"], ["text", "Text"], ["number", "Number"],
  ["currency", "Currency"], ["percent", "Percent"], ["date", "Date"]];
export const BSTYLES = [["solid", "Solid"], ["dashed", "Dashed"], ["dotted", "Dotted"], ["double", "Double"]];
export const BOX_KINDS = [
  ["value", "Value"],
  ["chart", "Graph"],
  ["table", "Table"],
  ["manualTable", "Manual Table"],
  ["note", "Note"],
  ["form", "Form"],
];
export const PUBLIC_ROLES = [["vendor", "Vendor"], ["admin", "Admin"], ["employee", "Employee"]];

export const S = (o = {}) => ({
  font: "", size: null, color: "", bg: "", align: "", caps: "",
  bold: null, italic: null, underline: null, ...o,
});
export const F = (o = {}) => ({
  on: false, style: "solid", width: 1, color: "#D5DDDA", radius: 3, pad: 14, bg: "", ...o,
});
export const normS = (st) => S(st || {});
export const normF = (fr) => F(fr || {});

export const newSrc = (base = "") => ({ base, joins: [], where: [], whereLink: "AND" });

export const blankDoc = () => ({
  name: "New Report / Dashboard",
  numberFormat: "en-IN",
  nameStyle: S({ size: 24, bold: true }),

  organisationSettings: {
    companyCode: "",
    plant: "",
    period: "",
  },

  filters: [],
  sections: [],
});

export const newFilter = (table = "") => ({
  id: uid("flt"), label: "", control: "text", table, column: "",
  optionSource: "list", optTable: "", optColumn: "", list: "", value: "",
  visible: true, labelPos: "left", colon: true, width: "auto",
  labelWidth: "", ctrlWidth: "", gap: 8, placeholder: "",
  style: S(), ctrlStyle: S(), roles: [],
});

export const newSection = () => ({
  id: uid("sec"), name: "", desc: "", visible: true, boxes: [], cols: 4,
  style: S(), descStyle: S(), rule: true, nameVisible: true, subVisible: true, frame: F(),
});

/* A box carries all four configurations, so switching what it shows never
   discards what you already set up for the others. */
export function ensureConfigs(b) {
  if (!b.tableMode) b.tableMode = "data";
  if (!b.value) b.value = {
    source: "data", manual: "0", formula: "", agg: "COUNT", column: "",
    prefix: "", suffix: "", decimals: 0, unit: "", delta: "", deltaDir: "up",
    note: "", tone: "#1A2326", showTrack: false, trackPct: 64,
    fLeft: "", fOp: "/", fRight: "", fExtra: "", round: 2,
  };
  if (!b.chart) b.chart = {
  type: "bar",

  // Database = existing chart behaviour
  // values = build chart from existing Value boxes
  source: "database",

  category: "",
  agg: "COUNT",
  column: "",

  // Value-box based charts
  valueBoxes: [],

  legendPos: "bottom",
  limit: 8,
  sort: "value",
  dir: "desc",
  height: 220,
  legend: true,
  grid: true,
  values: false,
  palette: 0,
};
  if (!b.table) b.table = {
    columns: [], limit: 8, sort: "", dir: "asc", zebra: true, totals: false, headStyle: S(),
  };
  if (!b.manualTable) b.manualTable = {
  columns: [
    { id: uid("col"), label: "Column 1" },
    { id: uid("col"), label: "Column 2" },
    { id: uid("col"), label: "Column 3" },
  ],
  rows: [
    {
      id: uid("row"),
      cells: ["", "", ""],
    },
  ],
  zebra: true,
  headStyle: S(),
};
  if (!b.note) b.note = { html: "" };
  return b;
}

export const newBox = (base = "") => ensureConfigs({
  id: uid("box"),
  kind: "value",
  tableMode: "data",
  title: "",
  span: 1,
  style: S(),
  titleStyle: S(),
  frame: F(),
  useFilters: true,
  visible: true,
  titleVisible: true,
  src: newSrc(base),
  roles: [],
});

/* ---------------- layout helpers ---------------- */
export function spanLabel(v, cols) {
  if (v >= cols) return "Full width";
  const f = v / cols;
  const names = [[0.25, "Quarter"], [1 / 3, "Third"], [0.5, "Half"],
    [2 / 3, "Two thirds"], [0.75, "Three quarters"]];
  const hit = names.find(([x]) => Math.abs(x - f) < 0.001);
  return hit ? hit[1] : `${v} of ${cols} cells`;
}
export const widthOptions = (cols) =>
  Array.from({ length: cols }, (_, i) => [i + 1, spanLabel(i + 1, cols)]);

/* ---------------- schema helpers ---------------- */
export const colsOf = (catalog, t) =>
  (catalog.tables.find((x) => x.name === t) || {}).columns || [];

export function colOptions(catalog, src) {
  if (!src || !src.base) return [];
  const out = colsOf(catalog, src.base).map((c) => ({ name: c.name, type: c.type }));
  (src.joins || []).forEach((j) => {
    if (!j.table) return;
    colsOf(catalog, j.table).forEach((c) =>
      out.push({ name: `${j.table}.${c.name}`, type: c.type }));
  });
  return out;
}

/* Give a box a usable starting binding, and re-bind when its table changes. */
export function applyDefaults(b, catalog) {
  const cs = colOptions(catalog, b.src);
  const firstText = (cs.find((c) => c.type === "text") || cs[0] || {}).name || "";
  const firstNum = (cs.find((c) => c.type === "number") || {}).name || "";
  b.value.column = firstNum || (cs[0] || {}).name || "";
  b.value.agg = firstNum ? "SUM" : "COUNT";
  b.chart.category = firstText;
  b.chart.column = firstNum || firstText;
  b.chart.agg = firstNum ? "SUM" : "COUNT";
  b.table.columns = cs.map((c, i) => ({
    col: c.name,
    label: c.name.replace(/_/g, " "),
    fmt: c.type === "number" ? "number" : c.type === "date" ? "date" : "auto",
    align: c.type === "number" ? "right" : "left",
    width: "", on: i < 6,
  }));
  b.table.sort = "";
  return b;
}

/* ---------------- migration ---------------- */
export function migrate(d) {
  const doc = { ...blankDoc(), ...(d || {}) };
  doc.organisationSettings = {
    ...blankDoc().organisationSettings,
    ...(d?.organisationSettings || {}),
  };
  if (d && d.heading && d.heading.title && (!d.name || d.name === "Untitled report"))
    doc.name = d.heading.title;
  delete doc.heading;
  doc.nameStyle = normS(doc.nameStyle);
  (doc.filters || []).forEach((f) => {
    f.style = normS(f.style);
    f.ctrlStyle = normS(f.ctrlStyle);
    f.labelPos = f.labelPos || "top";
    f.width = f.width || "auto";
    if (f.colon === undefined) f.colon = false;
    if (f.gap === undefined) f.gap = 8;
    f.labelWidth = f.labelWidth || "";
    f.ctrlWidth = f.ctrlWidth || "";
    f.placeholder = f.placeholder || "";
    if (!Array.isArray(f.roles)) f.roles = [];
  });
  (doc.sections || []).forEach((sc) => {
    sc.style = normS(sc.style);
    sc.descStyle = normS(sc.descStyle);
    if (sc.cols === undefined) sc.cols = 12;   // older files were a 12-column grid
    if (sc.rule === undefined) sc.rule = true;
    if (sc.nameVisible === undefined) sc.nameVisible = true;
    if (sc.subVisible === undefined) sc.subVisible = true;
    sc.frame = normF(sc.frame);
    (sc.boxes || []).forEach((b) => {
      b.style = normS(b.style);
      b.titleStyle = normS(b.titleStyle);
      b.frame = normF(b.frame);
      if (b.visible === undefined) b.visible = true;
      if (!Array.isArray(b.roles)) b.roles = [];
      ensureConfigs(b);
      if (b.table) b.table.headStyle = normS(b.table.headStyle);
      if (b.value && b.value.formula === undefined) b.value.formula = "";
      if (b.value) {
        if (b.value.fLeft === undefined) b.value.fLeft = "";
        if (b.value.fOp === undefined) b.value.fOp = "/";
        if (b.value.fRight === undefined) b.value.fRight = "";
        if (b.value.fExtra === undefined) b.value.fExtra = "";
        if (b.value.round === undefined) b.value.round = 2;
      }
      if (b.chart && !b.chart.legendPos) b.chart.legendPos = "bottom";
      if (!b.src) b.src = newSrc("");
      b.src.joins = b.src.joins || [];
      b.src.where = b.src.where || [];
      b.src.whereLink = b.src.whereLink || "AND";
    });
  });
  return doc;
}

/* ---------------- presentation ---------------- */
export function styleDecl(st, skip = {}) {
  if (!st) return [];
  const p = [];
  if (st.font) p.push(`font-family:${st.font}`);
  if (st.size) p.push(`font-size:${st.size}px`);
  if (st.color) p.push(`color:${st.color}`);
  if (st.bg && !skip.bg) p.push(`background:${st.bg}`);
  if (st.align && !skip.align) p.push(`text-align:${st.align}`);
  if (st.bold !== null && st.bold !== undefined) p.push(`font-weight:${st.bold ? 700 : 400}`);
  if (st.italic) p.push("font-style:italic");
  if (st.underline) p.push("text-decoration:underline");
  if (st.caps) p.push(`text-transform:${st.caps}`);
  return p;
}
/* React wants an object, not a string */
export function styleObj(st, skip) {
  const out = {};
  styleDecl(st, skip).forEach((d) => {
    const i = d.indexOf(":");
    const key = d.slice(0, i).replace(/-([a-z])/g, (_, c) => c.toUpperCase());
    out[key] = d.slice(i + 1);
  });
  return out;
}
export function frameStyle(fr) {
  if (!fr || !fr.on) return {};
  return {
    border: `${+fr.width || 1}px ${fr.style || "solid"} ${fr.color || "#D5DDDA"}`,
    borderRadius: `${fr.radius === undefined ? 3 : +fr.radius}px`,
    padding: `${fr.pad === undefined ? 14 : +fr.pad}px`,
    ...(fr.bg ? { background: fr.bg } : {}),
  };
}
export const fmtNumber = (n, dec, locale) =>
  n === null || n === undefined || isNaN(n) ? "—"
    : Number(n).toLocaleString(locale || "en-IN",
        { minimumFractionDigits: dec || 0, maximumFractionDigits: dec || 0 });

export function fmtCell(v, fmt, locale) {
  if (v === null || v === undefined || v === "") return "";
  switch (fmt) {
    case "number": return fmtNumber(v, 0, locale);
    case "currency": return "₹" + fmtNumber(v, 0, locale);
    case "percent": return fmtNumber(v, 1, locale) + "%";
    case "date": return String(v).slice(0, 10);
    case "text": return String(v);
    default:
      return typeof v === "number"
        ? fmtNumber(v, Number.isInteger(v) ? 0 : 1, locale)
        : String(v);
  }
}
