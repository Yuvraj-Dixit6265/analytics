"""Reaching a column that is not on the box's base table.

A report box reads one base table plus whatever it joins. Ask for a column
that lives somewhere else — "put the HSN number on this" when hsn_code is on
the item master, not on the invoice lines — and the box has two honest
outcomes: fail the catalogue check, or quietly drop the column. Neither is
what was meant.

This module supplies the missing third option. db.relationships() says which
columns stitch which tables together; the graph here walks that, shortest
path first, and returns the joins a box would need to bring a column into
scope. ai_report applies them before the definition is validated, so an AI
answer that named `items.hsn_code` on an invoice base table comes back as a
working box rather than an error message.

Nothing here invents an identifier. Every table and column it emits came out
of INFORMATION_SCHEMA by way of db.relationships(), and the result still goes
through querybuilder.build() afterwards like any hand-built box.
"""

from collections import deque

# A join is only added on its own initiative when it cannot change the number
# of rows — the far side has to be a primary or unique key (many-to-one).
# Walking a link backwards (one-to-many) can multiply rows and so silently
# inflate a SUM, so it is used only when the request explicitly named a column
# that needs it, and it is always reported as a note.


def edges(relationships):
    """{table: [step, ...]} — every link, usable in either direction.

    A step is (neighbour_table, column_on_this_table, column_on_neighbour,
    to_one), where to_one is True when joining the neighbour cannot multiply
    rows.
    """
    out = {}
    for r in relationships or []:
        ft, fc = r["from_table"], r["from_column"]
        tt, tc = r["to_table"], r["to_column"]
        if ft == tt:
            continue
        to_one = bool(r.get("to_unique"))
        out.setdefault(ft, []).append((tt, fc, tc, to_one))
        # The reverse direction is one-to-many unless the near side is itself
        # a key, which db.relationships() does not claim, so assume it is not.
        out.setdefault(tt, []).append((ft, tc, fc, False))
    return out


def path(scope, target, graph, safe_only=False):
    """Shortest list of join steps bringing `target` into scope.

    `scope` is every table the query can already refer to (the base table and
    anything joined so far), so a second lookup can hang off a table an
    earlier one joined rather than starting over from the base.

    Returns [(from_table, from_column, to_table, to_column, to_one)], [] when
    the target is already in scope, or None when nothing links them.
    """
    if target in scope:
        return []
    seen = set(scope)
    queue = deque((t, []) for t in scope)
    while queue:
        table, steps = queue.popleft()
        for nxt, near_col, far_col, to_one in graph.get(table, ()):
            if nxt in seen or (safe_only and not to_one):
                continue
            step = steps + [(table, near_col, nxt, far_col, to_one)]
            if nxt == target:
                return step
            seen.add(nxt)
            queue.append((nxt, step))
    return None


def ref(table, column, base):
    """How a column is written inside a box: bare on the base table,
    `table.column` on anything joined — the same rule querybuilder reads."""
    return column if table == base else f"{table}.{column}"


def _apply(src, steps, base):
    """Turn path steps into the join rows a definition carries."""
    if not isinstance(src.get("joins"), list):
        src["joins"] = []
    for from_table, near_col, to_table, far_col, _ in steps:
        src["joins"].append({
            "table": to_table,
            "type": "LEFT",  # never drop rows to reach an extra column
            "leftCol": ref(from_table, near_col, base),
            "rightCol": far_col,
        })


def _slots(box):
    """Every column reference in a box, as (read, write) pairs.

    Listed explicitly rather than walked generically so that a key which only
    looks like a column — a chart's "sort": "value", a manual value box — is
    never rewritten by accident.
    """
    out = []
    src = box.get("src") or {}
    for cond in src.get("where") or []:
        if isinstance(cond, dict):
            out.append((lambda c=cond: c.get("col"),
                        lambda v, c=cond: c.__setitem__("col", v)))

    kind = box.get("kind")
    if kind == "value":
        cfg = box.get("value") or {}
        if cfg.get("source") not in ("manual", "formula"):
            out.append((lambda: cfg.get("column"),
                        lambda v: cfg.__setitem__("column", v)))
    elif kind == "chart":
        cfg = box.get("chart") or {}
        for key in ("category", "column"):
            out.append((lambda k=key: cfg.get(k),
                        lambda v, k=key: cfg.__setitem__(k, v)))
    elif kind == "table":
        cfg = box.get("table") or {}
        for col in cfg.get("columns") or []:
            if isinstance(col, dict):
                out.append((lambda c=col: c.get("col"),
                            lambda v, c=col: c.__setitem__("col", v)))
        if cfg.get("sort"):
            out.append((lambda: cfg.get("sort"),
                        lambda v: cfg.__setitem__("sort", v)))
    return out


def _resolve(value, base, scope, catalogue):
    """What a reference is asking for: (table, column), or None if it cannot
    be placed. A bare name is the base table's column when it has one, and
    otherwise a column that exists on exactly one other table in the schema —
    which is how "hsn_code" on an invoice box finds the item master."""
    if not value or not isinstance(value, str):
        return None
    if "." in value:
        table, column = value.split(".", 1)
        if column in catalogue.get(table, set()):
            return table, column
        return None
    if value in catalogue.get(base, set()):
        return base, value
    owners = [t for t in scope if value in catalogue.get(t, set())]
    if not owners:
        owners = [t for t, cols in catalogue.items() if value in cols]
    if len(owners) == 1:
        return owners[0], value
    return None


def autolink_box(box, catalogue, graph, notes):
    """Add the joins a box's own column references need, and rewrite a bare
    column name to `table.column` once it is reachable. Anything that cannot
    be placed is left exactly as it was, for validation to report."""
    src = box.get("src") or {}
    base = src.get("base")
    if not base or src.get("mode") == "sql" or base not in catalogue:
        return
    title = box.get("title") or box.get("id") or "a box"

    scope = [base]
    for join in src.get("joins") or []:
        if join.get("table") and join["table"] in catalogue:
            scope.append(join["table"])

    for read, write in _slots(box):
        value = read()
        placed = _resolve(value, base, scope, catalogue)
        if not placed:
            continue
        table, column = placed
        if table not in scope:
            steps = path(scope, table, graph)
            if steps is None:
                continue  # nothing links them — leave it for validation
            _apply(src, steps, base)
            scope.extend(s[2] for s in steps)
            hops = " -> ".join(
                f"{f}.{fc} = {t}.{tc}" for f, fc, t, tc, _ in steps)
            notes.append(f"{title}: joined {table} to read {column} ({hops}).")
            if any(not step[4] for step in steps):
                notes.append(
                    f"{title}: that join can match several rows per "
                    f"{base} row — check any totals on this box.")
        want = ref(table, column, base)
        if want != value:
            write(want)


def autolink_filters(definition, catalogue, graph, notes):
    """A filter only narrows a box whose query can see its column. Where a
    box is one safe, row-preserving join away from that column, add it — a
    filter that silently does nothing to half the report is the other way
    "the values don't come through"."""
    filters = [f for f in definition.get("filters") or []
               if f.get("table") and f.get("column")
               and f["column"] in catalogue.get(f["table"], set())]
    if not filters:
        return
    for section in definition.get("sections") or []:
        for box in section.get("boxes") or []:
            if box.get("useFilters") is False or box.get("kind") in ("note", "form"):
                continue
            src = box.get("src") or {}
            base = src.get("base")
            if not base or src.get("mode") == "sql" or base not in catalogue:
                continue
            scope = [base] + [j["table"] for j in src.get("joins") or []
                              if j.get("table") in catalogue]
            title = box.get("title") or box.get("id") or "a box"
            for f in filters:
                if f["table"] in scope:
                    continue
                steps = path(scope, f["table"], graph, safe_only=True)
                if not steps:
                    if steps is None:
                        notes.append(
                            f"{title}: filter {f.get('label') or f['column']!r} "
                            f"cannot reach {base} — it will not narrow this box.")
                    continue
                _apply(src, steps, base)
                scope.extend(s[2] for s in steps)
                notes.append(
                    f"{title}: joined {f['table']} so the "
                    f"{f.get('label') or f['column']!r} filter applies.")


def autolink(definition, catalogue, relationships):
    """Run both passes over a whole definition. Returns the notes worth
    showing — what was joined, and what still cannot be reached."""
    notes = []
    graph = edges(relationships)
    if not graph:
        return notes
    for section in definition.get("sections") or []:
        for box in section.get("boxes") or []:
            if isinstance(box, dict):
                autolink_box(box, catalogue, graph, notes)
    autolink_filters(definition, catalogue, graph, notes)
    return notes


# --------------------------------------------------------------------------
# does the link actually hold in the data?
# --------------------------------------------------------------------------
def probe_sql(link, catalogue, sample=2000):
    """(sql, params) counting how many of a sample of values on the near side
    find a match on the far side. A link that is declared but matches nothing
    is the difference between "the tables are joined" and "the numbers are
    right", and only the data can tell you which you have."""
    from querybuilder import BadDefinition, _quote

    ft, fc = link["from_table"], link["from_column"]
    tt, tc = link["to_table"], link["to_column"]
    for table, column in ((ft, fc), (tt, tc)):
        if column not in catalogue.get(table, set()):
            raise BadDefinition(f"unknown column: {table}.{column}")
    sample = max(1, min(int(sample), 10000))
    sql = (
        "SELECT COUNT(*) AS sampled,\n"
        f"       SUM(EXISTS(SELECT 1 FROM {_quote(tt)} r\n"
        f"                   WHERE r.{_quote(tc)} = l.{_quote(fc)})) AS matched\n"
        f"FROM   (SELECT {_quote(fc)} FROM {_quote(ft)}\n"
        f"         WHERE {_quote(fc)} IS NOT NULL LIMIT {sample}) l"
    )
    return sql, []
