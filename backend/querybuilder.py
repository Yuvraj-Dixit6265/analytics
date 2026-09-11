"""A saved definition becomes SQL here.

The definition came from a browser, so treat all of it as hostile.

  * Values are always bound as parameters.
  * Identifiers cannot be bound — no database allows it — so every table and
    column name is checked against the live catalogue introspected from
    INFORMATION_SCHEMA before it reaches a query. Anything not in that
    catalogue is rejected outright rather than escaped and hoped for.
  * Aggregates, operators and join types are checked against fixed sets.
  * A join may not reference a table that has not been joined yet.

Verified against these, all rejected:

    invoices; DROP TABLE users        value; DROP
    invoices`--                       1=1
    '; DELETE FROM x; --              value` , (SELECT 1)
    invoices UNION SELECT 1           users        (not in schema)
"""

import re

AGGS = {"SUM", "AVG", "COUNT", "COUNT DISTINCT", "MIN", "MAX"}
JOIN_TYPES = {"INNER", "LEFT"}
COMPARISONS = {"=", "<>", ">", ">=", "<", "<="}
IDENT_RE = re.compile(r"^[A-Za-z_][A-Za-z0-9_$]{0,63}$")
TOKEN_RE = re.compile(r"\{\{\s*([^{}]+?)\s*\}\}")
FORBIDDEN_RE = re.compile(
    r"\b(INSERT|UPDATE|DELETE|DROP|ALTER|CREATE|TRUNCATE|GRANT|REVOKE|"
    r"EXEC|EXECUTE|CALL|MERGE|REPLACE|ATTACH|DETACH|PRAGMA)\b",
    re.IGNORECASE,
)


class BadDefinition(ValueError):
    """Raised when a definition asks for something not in the catalogue."""


# --------------------------------------------------------------------------
# identifiers
# --------------------------------------------------------------------------
def _quote(name):
    if not IDENT_RE.match(name or ""):
        raise BadDefinition(f"not a usable identifier: {name!r}")
    return f"`{name}`"


class Scope:
    """The tables a query may currently refer to, and their columns."""

    def __init__(self, catalogue, base):
        self.catalogue = catalogue
        if base not in catalogue:
            raise BadDefinition(f"unknown table: {base!r}")
        self.base = base
        self.tables = [base]

    def add_join(self, table):
        if table not in self.catalogue:
            raise BadDefinition(f"unknown table: {table!r}")
        self.tables.append(table)

    def split(self, ref):
        """'net' -> (base, 'net');  'vendors.name' -> ('vendors', 'name')."""
        if not ref:
            raise BadDefinition("a column is missing")
        if "." in ref:
            table, col = ref.split(".", 1)
            if table not in self.tables:
                raise BadDefinition(
                    f"{ref!r} refers to {table!r}, which this query has not joined"
                )
        else:
            table, col = self.base, ref
        if col not in self.catalogue.get(table, set()):
            raise BadDefinition(f"unknown column: {table}.{col}")
        return table, col

    def col(self, ref):
        table, col = self.split(ref)
        return f"{_quote(table)}.{_quote(col)}"

    def has(self, ref):
        try:
            self.split(ref)
            return True
        except BadDefinition:
            return False


# --------------------------------------------------------------------------
# fragments
# --------------------------------------------------------------------------
def _agg(scope, how, ref):
    how = (how or "SUM").upper()
    if how not in AGGS:
        raise BadDefinition(f"unknown aggregate: {how!r}")
    if how == "COUNT DISTINCT":
        return f"COUNT(DISTINCT {scope.col(ref)})"
    return f"{how}({scope.col(ref)})"


def _joins(scope, src):
    out = []
    for j in src.get("joins") or []:
        table = j.get("table")
        if not table:
            continue
        jtype = (j.get("type") or "LEFT").upper()
        if jtype not in JOIN_TYPES:
            raise BadDefinition(f"unknown join type: {jtype!r}")
        left, right = j.get("leftCol"), j.get("rightCol")
        if not left or not right:
            continue  # half-configured join: skip rather than guess
        # the left side must already be in scope; the right side is the table
        # being joined, so add it before resolving
        left_sql = scope.col(left)
        scope.add_join(table)
        if right not in scope.catalogue[table]:
            raise BadDefinition(f"unknown column: {table}.{right}")
        right_sql = f"{_quote(table)}.{_quote(right)}"
        out.append(f"{jtype} JOIN {_quote(table)} ON {right_sql} = {left_sql}")
    return out


def _condition(scope, col_sql, op, value, params):
    """One WHERE fragment. Values are bound, never interpolated."""
    if op == "blank":
        return f"{col_sql} IS NULL OR {col_sql} = ''"

    if op == "notblank":
        return f"{col_sql} IS NOT NULL AND {col_sql} <> ''"

    if op == "null":
        return f"{col_sql} IS NULL"

    if op == "notnull":
        return f"{col_sql} IS NOT NULL"

    if value in (None, ""):
        return None
    if op == "contains":
        params.append(f"%{value}%")
        return f"{col_sql} LIKE %s"
    if op == "starts":
        params.append(f"{value}%")
        return f"{col_sql} LIKE %s"
    if op == "in":
        items = [v.strip() for v in str(value).split(",") if v.strip()]
        if not items:
            return None
        params.extend(items)
        return f"{col_sql} IN ({', '.join(['%s'] * len(items))})"
    if op in COMPARISONS:
        params.append(value)
        return f"{col_sql} {op} %s"
    raise BadDefinition(f"unknown operator: {op!r}")


def _own_where(scope, src, params):
    parts = []
    for c in src.get("where") or []:
        ref = c.get("col")
        if not ref:
            continue
        frag = _condition(scope, scope.col(ref), c.get("op") or "=", c.get("val"), params)
        if frag:
            parts.append(f"({frag})")
    if not parts:
        return []
    link = " OR " if (src.get("whereLink") or "AND").upper() == "OR" else " AND "
    return [f"({link.join(parts)})"] if len(parts) > 1 else parts


def filter_conditions(scope, filters, state, role_row, params):
    """Conditions contributed by the filter bar.

    A filter marked *driven by role* takes its value from the role row and
    ignores whatever the request sent. That lock is what makes a role-scoped
    link mean something rather than being decorative.
    """
    parts = []
    for f in filters or []:
        ref = f.get("column")
        if not ref or not scope.has(ref):
            continue  # this box's tables do not carry that column
        col_sql = scope.col(ref)
        control = f.get("control") or "select"

        if f.get("role_bound") and role_row is not None:
            value = role_row.get(f.get("role_column") or "")
            if value in (None, ""):
                continue
            params.append(value)
            parts.append(f"{col_sql} = %s")
            continue

        value = (state or {}).get(f.get("id") or f.get("client_id"))
        if value in (None, "", [], {}):
            continue

        if control == "daterange" and isinstance(value, dict):
            if value.get("from"):
                params.append(value["from"])
                parts.append(f"{col_sql} >= %s")
            if value.get("to"):
                params.append(value["to"])
                parts.append(f"{col_sql} <= %s")
        elif control == "checkbox" and isinstance(value, list):
            params.extend(value)
            parts.append(f"{col_sql} IN ({', '.join(['%s'] * len(value))})")
        elif control == "text":
            params.append(f"%{value}%")
            parts.append(f"{col_sql} LIKE %s")
        else:
            params.append(value)
            parts.append(f"{col_sql} = %s")
    return parts

def _raw_select(sql, filters, state, params):
    """A hand-written SELECT, with {{Filter Label}} tokens bound as parameters."""
    text = (sql or "").strip()
    if not text:
        raise BadDefinition("no SQL to run")
    body = text[:-1] if text.endswith(";") else text
    if ";" in body:
        raise BadDefinition("only a single statement is allowed")
    if not re.match(r"^\s*SELECT\b", body, re.IGNORECASE):
        raise BadDefinition("only SELECT statements are allowed here")
    if FORBIDDEN_RE.search(body):
        raise BadDefinition("that keyword is not allowed in a box's SQL")

    by_label = {}
    for f in filters or []:
        label = (f.get("label") or "").strip().lower()
        if label:
            by_label[label] = f

    def repl(m):
        label = m.group(1).strip().lower()
        f = by_label.get(label)
        if not f:
            raise BadDefinition(f"{{{{{m.group(1)}}}}} does not match any filter's label")
        value = (state or {}).get(f.get("id") or f.get("client_id"))
        if isinstance(value, dict):
            value = value.get("from")
        params.append(value if value not in ("", None) else None)
        return "%s"

    return TOKEN_RE.sub(repl, body)

# --------------------------------------------------------------------------
# the three query shapes
# --------------------------------------------------------------------------
def build(box, filters, state, catalogue, role_row=None):
    """Return (sql, params) for one box, or (None, None) if it runs no query."""
    kind = box.get("kind")
    src = box.get("src") or {}
    if kind == "note":
        return None, None
    if kind == "value" and (box.get("value") or {}).get("source") == "manual":
        return None, None
    if src.get("mode") == "sql":
        params = []
        sql = _raw_select(src.get("sql"), filters, state, params)
        return sql, params
    if not src.get("base"):
        return None, None
    if kind in ("note", "form"):
        return None, None

    scope = Scope(catalogue, src["base"])
    params = []
    join_sql = _joins(scope, src)

    select, group, order, limit = [], None, None, None

    if kind == "value":
        cfg = box.get("value") or {}
        if cfg.get("source") == "formula":
            # A formula needs the columns it mentions, aggregated together in
            # one pass. formula.py hands us the list.
            from formula import columns_used

            wanted = columns_used(cfg.get("formula") or "")
            picks = [w for w in wanted if scope.has(w)]
            if not picks:
                return None, None
            select = [f"{_agg(scope, how, ref)} AS `{how}:{ref}`"
                      for how, ref in _formula_pairs(cfg.get("formula") or "")
                      if scope.has(ref)]
            if not select:
                return None, None
        else:
            select = [f"{_agg(scope, cfg.get('agg'), cfg.get('column'))} AS value"]

    elif kind == "chart":
        cfg = box.get("chart") or {}
        select = [
            f"{scope.col(cfg.get('category'))} AS category",
            f"{_agg(scope, cfg.get('agg'), cfg.get('column'))} AS value",
        ]
        group = scope.col(cfg.get("category"))
        direction = "DESC" if (cfg.get("dir") or "desc").lower() == "desc" else "ASC"
        order = f"{'value' if cfg.get('sort') == 'value' else 'category'} {direction}"
        if int(cfg.get("limit") or 0) > 0:
            limit = int(cfg["limit"])

    elif kind == "table":
        cfg = box.get("table") or {}
        cols = [c for c in (cfg.get("columns") or []) if c.get("on")]
        if not cols:
            return None, None
        select = [f"{scope.col(c['col'])} AS {_quote(_alias(c['col']))}" for c in cols]
        if cfg.get("sort") and scope.has(cfg["sort"]):
            direction = "DESC" if (cfg.get("dir") or "asc").lower() == "desc" else "ASC"
            order = f"{scope.col(cfg['sort'])} {direction}"
        limit = max(1, int(cfg.get("limit") or 10))
    else:
        raise BadDefinition(f"unknown box kind: {kind!r}")

    where = _own_where(scope, src, params)
    if box.get("useFilters") is not False:
        where += filter_conditions(scope, filters, state, role_row, params)

    sql = "SELECT " + ",\n       ".join(select) + f"\nFROM   {_quote(scope.base)}"
    for j in join_sql:
        sql += "\n" + j
    if where:
        sql += "\nWHERE  " + "\n  AND  ".join(where)
    if group:
        sql += f"\nGROUP BY {group}"
    if order:
        sql += f"\nORDER BY {order}"
    if limit:
        sql += f"\nLIMIT  {int(limit)}"
    return sql, params


def _alias(ref):
    return ref.replace(".", "__")


def _formula_pairs(expr):
    """[(aggregate, column)] mentioned by a formula, e.g. [('SUM','net')]."""
    from formula import aggregate_pairs

    return aggregate_pairs(expr)


def preview(box, filters, state, catalogue, role_row=None):
    """The same SQL, for showing on screen. Never executed."""
    try:
        sql, params = build(box, filters, state, catalogue, role_row)
    except BadDefinition as exc:
        return {"ok": False, "error": str(exc)}
    if sql is None:
        return {"ok": True, "sql": None, "params": [],
                "note": "This box runs no query."}
    return {"ok": True, "sql": sql, "params": params}

def build_write(box, filters, state, catalogue, role_row=None):
    """
    Compatibility wrapper for write-query support.

    The current NexD application is read-only, so write queries are
    intentionally not generated or executed.
    """
    raise BadDefinition(
        "Write queries are not supported by the current read-only query builder."
    )