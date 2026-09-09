"""NexD Designer — Flask middleware.

The browser sends a definition and the filter state. This process builds the
SQL, runs it read-only, evaluates any formula, and returns finished values.
The browser never receives a row it is not entitled to, which is what makes a
role-scoped link meaningful rather than decorative.
"""

import base64
import json
import os
import re
import secrets
import requests
from datetime import datetime ,date
from datetime import datetime, timedelta, timezone
from decimal import Decimal
from functools import wraps
from flask.json.provider import DefaultJSONProvider
import jwt
from flask import Flask, g, jsonify, request
from flask_cors import CORS
from werkzeug.security import check_password_hash

import db
import exporters
import formula
from querybuilder import BadDefinition, build, build_write, preview

class _SafeJSONProvider(DefaultJSONProvider):
    """MySQL hands back SUM()/AVG() as Decimal and dates as date/datetime —
    neither of which the default JSON encoder knows how to serialize. Left
    unhandled, that turns into a 500 with an HTML error page instead of
    JSON, which is what breaks a page silently rather than showing an error."""
    def default(self, obj):
        if isinstance(obj, Decimal):
            return float(obj)
        if isinstance(obj, (date, datetime)):
            return obj.isoformat()
        return super().default(obj)

app = Flask(__name__)
CORS(
    app,
    resources={r"/api/*": {"origins": os.environ.get(
        "ALLOWED_ORIGINS", "http://localhost:5173").split(",")}},
    supports_credentials=True,
)

JWT_SECRET = os.environ.get("JWT_SECRET", "")
if not JWT_SECRET:
    raise RuntimeError("JWT_SECRET is not set. openssl rand -hex 32")
TOKEN_HOURS = int(os.environ.get("TOKEN_HOURS", 12))


# --------------------------------------------------------------------------
# auth
# --------------------------------------------------------------------------
def issue(user):
    payload = {
        "sub": user["id"],
        "username": user["username"],
        "role": user["role"],
        "exp": datetime.now(timezone.utc) + timedelta(hours=TOKEN_HOURS),
    }
    return jwt.encode(payload, JWT_SECRET, algorithm="HS256")


def auth(required_role=None):
    def outer(fn):
        @wraps(fn)
        def inner(*a, **kw):
            head = request.headers.get("Authorization", "")
            if not head.startswith("Bearer "):
                return jsonify(error="sign in first"), 401
            try:
                g.user = jwt.decode(head[7:], JWT_SECRET, algorithms=["HS256"])
            except jwt.ExpiredSignatureError:
                return jsonify(error="session expired"), 401
            except jwt.InvalidTokenError:
                return jsonify(error="bad token"), 401
            if required_role == "admin" and g.user.get("role") != "admin":
                return jsonify(error="admins only"), 403
            return fn(*a, **kw)
        return inner
    return outer


@app.post("/api/auth/login")
def login():
    body = request.get_json(silent=True) or {}
    row = db.q1(
        "SELECT * FROM users WHERE username=%s AND is_active=1",
        (body.get("username", ""),),
    )
    if not row or not check_password_hash(row["password_hash"], body.get("password", "")):
        return jsonify(error="those details do not match"), 401
    return jsonify(token=issue(row), user=db.clean(
        {k: row[k] for k in ("id", "username", "full_name", "role")}))


# --------------------------------------------------------------------------
# connections
# --------------------------------------------------------------------------
@app.get("/api/connections")
@auth()
def list_connections():
    return jsonify(db.clean(db.qall(
        "SELECT * FROM data_connections ORDER BY name")))


@app.post("/api/connections")
@auth("admin")
def create_connection():
    b = request.get_json(silent=True) or {}
    cid = db.execute(
        "INSERT INTO data_connections "
        "(name,engine,host,port,database_name,username,password_enc,use_ssl,read_only) "
        "VALUES (%s,%s,%s,%s,%s,%s,%s,%s,%s)",
        (b.get("name", "New connection"), b.get("engine", "mysql"),
         b.get("host", ""), int(b.get("port") or 3306), b.get("database", ""),
         b.get("username", ""), db.encrypt(b.get("password", "")),
         1 if b.get("ssl") else 0, 1 if b.get("readOnly", True) else 0),
    )
    return jsonify(db.clean(db.q1("SELECT * FROM data_connections WHERE id=%s", (cid,))))


@app.put("/api/connections/<int:cid>")
@auth("admin")
def update_connection(cid):
    b = request.get_json(silent=True) or {}
    fields, args = [], []
    for key, col in (("name", "name"), ("engine", "engine"), ("host", "host"),
                     ("database", "database_name"), ("username", "username")):
        if key in b:
            fields.append(f"{col}=%s")
            args.append(b[key])
    if "port" in b:
        fields.append("port=%s")
        args.append(int(b["port"] or 3306))
    if "ssl" in b:
        fields.append("use_ssl=%s")
        args.append(1 if b["ssl"] else 0)
    if b.get("password"):
        fields.append("password_enc=%s")
        args.append(db.encrypt(b["password"]))
    if not fields:
        return jsonify(error="nothing to change"), 400
    fields.append("status='untested'")
    args.append(cid)
    db.execute(f"UPDATE data_connections SET {', '.join(fields)} WHERE id=%s", tuple(args))
    db.forget_pool(cid)
    return jsonify(db.clean(db.q1("SELECT * FROM data_connections WHERE id=%s", (cid,))))


@app.delete("/api/connections/<int:cid>")
@auth("admin")
def delete_connection(cid):
    db.execute("DELETE FROM data_connections WHERE id=%s", (cid,))
    db.forget_pool(cid)
    return jsonify(ok=True)


@app.post("/api/connections/<int:cid>/test")
@auth()
def test_conn(cid):
    row = db.q1("SELECT * FROM data_connections WHERE id=%s", (cid,))
    if not row:
        return jsonify(error="no such connection"), 404
    ok, note = db.test_connection(row)
    db.execute("UPDATE data_connections SET status=%s, status_note=%s WHERE id=%s",
               ("ok" if ok else "bad", note, cid))
    return jsonify(ok=ok, note=note)


# --------------------------------------------------------------------------
# catalogue
# --------------------------------------------------------------------------
def _connection_for(process=None, cid=None):
    if cid:
        return db.q1("SELECT * FROM data_connections WHERE id=%s", (cid,))
    if process and process.get("connection_id"):
        return db.q1("SELECT * FROM data_connections WHERE id=%s",
                     (process["connection_id"],))
    return db.q1("SELECT * FROM data_connections ORDER BY id LIMIT 1")


@app.get("/api/catalog")
@auth()
def catalog():
    row = _connection_for(cid=request.args.get("connection_id", type=int))
    if not row:
        return jsonify(tables=[], note="No connection configured yet.")
    try:
        return jsonify(tables=db.introspect(row))
    except Exception as exc:  # noqa: BLE001
        return jsonify(tables=[], note=str(exc)[:300]), 200


# --------------------------------------------------------------------------
# processes
# --------------------------------------------------------------------------
@app.get("/api/processes")
@auth()
def list_processes():
    rows = db.qall(
        "SELECT p.process_key, p.name, p.version, p.updated_at, p.connection_id, "
        "       (SELECT COUNT(*) FROM publications pub "
        "         WHERE pub.process_id = p.id AND pub.is_active = 1) AS published "
        "FROM processes p ORDER BY p.updated_at DESC")
    return jsonify(db.clean(rows))


@app.get("/api/processes/<key>")
@auth()
def get_process(key):
    row = db.q1("SELECT * FROM processes WHERE process_key=%s", (key,))
    if not row:
        return jsonify(error="no such report"), 404
    out = db.clean(row)
    out["definition"] = row["definition"] if isinstance(row["definition"], dict) \
        else json.loads(row["definition"])
    pubs = db.qall("SELECT role, token, pinned_version FROM publications "
                   "WHERE process_id=%s AND is_active=1", (row["id"],))
    out["published"] = {
        "pinned_version": pubs[0]["pinned_version"],
        "links": [{"role": p["role"], "url": f"/r/{key}/{p['token']}"} for p in pubs],
    } if pubs else None
    return jsonify(out)


@app.post("/api/processes")
@auth()
def create_process():
    b = request.get_json(silent=True) or {}
    key = b.get("process_key") or "rpt_" + secrets.token_hex(4)
    definition = b.get("definition") or {"name": "New Report / Dashboard",
                                         "filters": [], "sections": []}
    pid = db.execute(
        "INSERT INTO processes (process_key,name,connection_id,definition,created_by) "
        "VALUES (%s,%s,%s,%s,%s)",
        (key, definition.get("name", "New Report / Dashboard"),
         b.get("connection_id"), json.dumps(definition), g.user["sub"]),
    )
    db.execute("INSERT INTO process_versions (process_id,version,definition,saved_by) "
               "VALUES (%s,1,%s,%s)", (pid, json.dumps(definition), g.user["sub"]))
    return jsonify(process_key=key, version=1)


@app.put("/api/processes/<key>")
@auth()
def save_process(key):
    b = request.get_json(silent=True) or {}
    row = db.q1("SELECT id, version FROM processes WHERE process_key=%s", (key,))
    if not row:
        return jsonify(error="no such report"), 404
    definition = b.get("definition") or {}
    version = row["version"] + 1
    db.execute("UPDATE processes SET name=%s, connection_id=%s, definition=%s, "
               "version=%s WHERE id=%s",
               (definition.get("name", "Untitled"), b.get("connection_id"),
                json.dumps(definition), version, row["id"]))
    db.execute("INSERT INTO process_versions (process_id,version,definition,saved_by) "
               "VALUES (%s,%s,%s,%s)",
               (row["id"], version, json.dumps(definition), g.user["sub"]))
    return jsonify(process_key=key, version=version)


@app.delete("/api/processes/<key>")
@auth()
def delete_process(key):
    db.execute("DELETE FROM processes WHERE process_key=%s", (key,))
    return jsonify(ok=True)


# --------------------------------------------------------------------------
# execution
# --------------------------------------------------------------------------
def _catalogue(conn_row):
    return db.catalogue_index(db.introspect(conn_row))


def _run_box(box, definition, state, conn_row, cat, role_row, values):
    """Return the finished payload for one box."""
    kind = box.get("kind")
        # ------------------------------------------------------------
    # CHART FROM EXISTING VALUE BOXES
    # ------------------------------------------------------------
    if kind == "chart":
        chart = box.get("chart") or {}

        if chart.get("source") == "value_boxes":
            selected_ids = chart.get("valueBoxes") or []

            if not selected_ids:
                return {"data": []}

            all_boxes = [
                b
                for sec in definition.get("sections", [])
                for b in sec.get("boxes", [])
            ]

            boxes_by_id = {
                b.get("id"): b
                for b in all_boxes
            }

            data = []

            for box_id in selected_ids:
                value_box = boxes_by_id.get(box_id)

                if not value_box:
                    continue

                if value_box.get("kind") != "value":
                    continue

                value = values.get(box_id)

                if value is None:
                    title = value_box.get("title") or ""
                    value = values.get(title)

                if value is None:
                    value_cfg = value_box.get("value") or {}

                    if value_cfg.get("source") == "manual":
                        value = value_cfg.get("manual")

                try:
                    numeric_value = float(value)
                except (TypeError, ValueError):
                    continue

                data.append({
                    "label": value_box.get("title") or "Unnamed value",
                    "value": numeric_value,
                })

            return {"data": data}
    if kind == "note":
        return None

    if kind == "value" and (box.get("value") or {}).get("source") == "manual":
        return {"value": box["value"].get("manual")}

    if kind == "value" and (box.get("value") or {}).get("source") == "formula":
        src = box["src"] or {}
        cols = set()
        if src.get("base") in cat:
            cols |= cat[src["base"]]
            for j in src.get("joins") or []:
                if j.get("table") in cat:
                    cols |= {f"{j['table']}.{c}" for c in cat[j["table"]]}
        expr = box["value"].get("formula") or ""
        ok, note = formula.check(expr, cols)
        if not ok:
            return {"error": note}
        sql, params = build(box, definition.get("filters"), state, cat, role_row)
        aggregates = {}
        if sql:
            rows = db.run_report_query(conn_row, sql, params)
            if rows:
                for how, ref in formula.aggregate_pairs(expr):
                    aggregates[(how, ref)] = rows[0].get(f"{how}:{ref}")
        try:
            return {"value": formula.evaluate(expr, aggregates, values, cols)}
        except formula.FormulaError as exc:
            return {"error": str(exc)}

    sql, params = build(box, definition.get("filters"), state, cat, role_row)
    if sql is None:
        return {"value": None}
    rows = db.run_report_query(conn_row, sql, params)
    if kind == "value":
        return {"value": rows[0]["value"] if rows else None}
    if kind == "chart":
        return {"data": [{"label": str(r["category"]), "value": r["value"]} for r in rows]}
    return {"rows": rows}


def _execute_boxes(definition, state, conn_row, cat, allow_forms=True):
    """Run every box in a definition and return {box_id: payload}. Shared by
    the authenticated editor's execute-all and the public, role-scoped
    viewer, so the two can never quietly drift apart from each other."""
    results, values = {}, {}
    ordered = [b for sec in definition.get("sections", []) for b in sec.get("boxes", [])]

    # Plain value boxes first, then formulas (which may reference them by
    # title), then everything else — charts/tables/notes/forms.
    def _order_key(b):
        if b.get("kind") == "value":
            return 0 if (b.get("value") or {}).get("source") != "formula" else 1
        return 2
    ordered.sort(key=_order_key)

    for box in ordered:
        if not allow_forms and box.get("kind") == "form":
            continue  # a public link never gets a box that can write data
        try:
            payload = _run_box(box, definition, state, conn_row, cat, None, values)
        except BadDefinition as exc:
            payload = {"error": str(exc)}
        except Exception as exc:  # noqa: BLE001
            payload = {"error": str(exc)[:300]}
        if payload is None:
            continue
        results[box["id"]] = payload
                # Make Value-box results available to other boxes by ID.
        if box.get("kind") == "value" and "value" in payload:
            values[box["id"]] = payload["value"]

            # Keep title references too because formulas already use titles.
            title = box.get("title")
            if title:
                values[title] = payload["value"]
        if box.get("kind") == "value":
            v = payload.get("value")
            try:
                v = float(v) if v is not None and v != "" else None
            except (TypeError, ValueError):
                v = None
            if v is not None:
                values[str(box.get("title", "")).strip().lower()] = v
    return results


def _render_boxes(definition, results):
    """Merge each box's definition (title, kind, formatting) with its
    computed result into one flat, format-agnostic shape — the shared input
    for every export (PDF/PPTX/XLSX), so the three formats can't drift
    apart from each other or from what the dashboard itself shows."""
    out = []
    for sec in definition.get("sections", []):
        boxes = []
        for box in sec.get("boxes", []):
            if box.get("visible") is False or box.get("kind") == "form":
                continue
            payload = results.get(box["id"], {}) or {}
            entry = {"title": box.get("title") or "", "kind": box.get("kind")}
            if payload.get("error"):
                entry["error"] = payload["error"]
            elif box.get("kind") == "value":
                v = payload.get("value")
                vc = box.get("value") or {}
                if isinstance(v, (int, float)):
                    dec = int(vc.get("decimals") or 0)
                    entry["text"] = f"{vc.get('prefix', '')}{v:,.{dec}f}{vc.get('suffix', '')}"
                elif v not in (None, ""):
                    entry["text"] = f"{vc.get('prefix', '')}{v}{vc.get('suffix', '')}"
                else:
                    entry["text"] = "—"
                entry["note"] = vc.get("note", "")
            elif box.get("kind") == "chart":
                entry["rows"] = [["Category", "Value"]] + [
                    [d.get("label"), d.get("value")] for d in (payload.get("data") or [])]
            elif box.get("kind") == "table":
                cols = [c for c in (box.get("table") or {}).get("columns", [])
                        if c.get("on", True)]
                headers = [c.get("label") or c.get("col") for c in cols]
                entry["rows"] = [headers] + [
                    [r.get(c["col"]) for c in cols] for r in (payload.get("rows") or [])]
            elif box.get("kind") == "note":
                entry["text"] = re.sub("<[^<]+?>", "", (box.get("note") or {}).get("html", ""))
            boxes.append(entry)
            out.append({"name": sec.get("name") or "", "desc": sec.get("desc") or "",
                        "boxes": boxes})
    return out


@app.post("/api/processes/<key>/execute-all")
@auth()
def execute_all(key):
    body = request.get_json(silent=True) or {}
    row = db.q1("SELECT * FROM processes WHERE process_key=%s", (key,))
    if not row:
        return jsonify(error="no such report"), 404
    definition = body.get("definition") or (
        row["definition"] if isinstance(row["definition"], dict)
        else json.loads(row["definition"]))
    conn_row = _connection_for(row)
    if not conn_row:
        return jsonify(error="no data connection configured"), 400
    try:
        cat = _catalogue(conn_row)
    except Exception as exc:  # noqa: BLE001
        return jsonify(error=f"could not read the catalogue: {exc}"), 502

    state = body.get("filters") or {}
    results = _execute_boxes(definition, state, conn_row, cat, allow_forms=True)
    return jsonify(results=results)


@app.post("/api/processes/<key>/preview-sql")
@auth()
def preview_sql(key):
    body = request.get_json(silent=True) or {}
    row = db.q1("SELECT * FROM processes WHERE process_key=%s", (key,))
    definition = body.get("definition") or {}
    conn_row = _connection_for(row)
    if not conn_row:
        return jsonify(error="no data connection configured"), 400
    cat = _catalogue(conn_row)
    box = body.get("box") or {}
    return jsonify(preview(box, definition.get("filters"), body.get("filters") or {}, cat))


@app.get("/api/processes/<key>/filters/<client_id>/options")
@auth()
def filter_options(key, client_id):
    row = db.q1("SELECT * FROM processes WHERE process_key=%s", (key,))
    if not row:
        return jsonify(error="no such report"), 404
    definition = row["definition"] if isinstance(row["definition"], dict) \
        else json.loads(row["definition"])
    flt = next((f for f in definition.get("filters", []) if f.get("id") == client_id), None)
    if not flt:
        return jsonify(options=[])
    if flt.get("optionSource") == "list":
        vals = [v.strip() for v in (flt.get("list") or "").replace(",", "\n").split("\n")]
        return jsonify(options=[{"value": v, "label": v} for v in vals if v])

    conn_row = _connection_for(row)
    if not conn_row:
        return jsonify(options=[])
    cat = _catalogue(conn_row)
    table = flt.get("optTable") if flt.get("optionSource") == "table" else flt.get("table")
    column = flt.get("optColumn") if flt.get("optionSource") == "table" else flt.get("column")
    if table not in cat or column not in cat.get(table, set()):
        return jsonify(options=[])
    sql = f"SELECT DISTINCT `{table}`.`{column}` AS v FROM `{table}` " \
          f"WHERE `{table}`.`{column}` IS NOT NULL ORDER BY v LIMIT 500"
    rows = db.run_report_query(conn_row, sql, ())
    return jsonify(options=[{"value": r["v"], "label": str(r["v"])} for r in rows])


# --------------------------------------------------------------------------
# publishing
# --------------------------------------------------------------------------
@app.post("/api/processes/<key>/write")
@auth()
def write_box(key):
    """Insert or update a row from a form box. Requires the connection's DB
    user to actually have write privileges — this is not a report query, so
    it does not go through db.reporting()'s forced read-only transaction."""
    row = db.q1("SELECT * FROM processes WHERE process_key=%s", (key,))
    if not row:
        return jsonify(error="no such report"), 404
    conn_row = _connection_for(row)
    if not conn_row:
        return jsonify(error="no data connection configured"), 400

    body = request.get_json(silent=True) or {}
    kind = body.get("kind")
    table = body.get("table")
    values = body.get("values") or {}
    key_column = body.get("key_column")
    key_value = body.get("key_value")

    try:
        cat = _catalogue(conn_row)
        sql, params = build_write(kind, table, key_column, key_value, values, cat)
        affected = db.run_write_query(conn_row, sql, params)
    except BadDefinition as exc:
        return jsonify(error=str(exc)), 400
    except Exception as exc:  # noqa: BLE001 - surfaced to the person editing
        return jsonify(error=str(exc)[:300]), 502
    return jsonify(ok=True, affected=affected)


# --------------------------------------------------------------------------
# exporting — PDF / PPTX / XLSX, all built from the same computed results
# --------------------------------------------------------------------------
EXPORT_KINDS = {
    "pdf": ("application/pdf", exporters.build_browser_pdf, "pdf"),
    "pptx": ("application/vnd.openxmlformats-officedocument.presentationml.presentation",
             exporters.build_pptx, "pptx"),
    "xlsx": ("application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
             exporters.build_xlsx, "xlsx"),
    "table": ("application/pdf", exporters.build_table_pdf, "pdf"),
}


def _export_bytes(definition, filters, conn_row, fmt):
    """Shared by the authenticated editor's export and the public, role-scoped
    one — same rules as _execute_boxes, so the two can't drift apart.
    Returns (bytes, mime type, filename stem, real file extension) — 'table'
    is a PDF too, just a different layout, so its extension is 'pdf', not
    'table'."""
    cat = _catalogue(conn_row)
    results = _execute_boxes(definition, filters, conn_row, cat, allow_forms=False)
    sections = _render_boxes(definition, results)
    name = definition.get("name") or "report"
    mime, builder, ext = EXPORT_KINDS[fmt]
    data = builder(name, sections)
    safe = re.sub(r"[^\w-]+", "-", name).strip("-").lower() or "report"
    return data, mime, safe, ext


@app.get("/api/processes/<key>/export/<fmt>")
@auth()
def export_report(key, fmt):
    if fmt not in EXPORT_KINDS:
        return jsonify(error="unknown export format"), 400
    row = db.q1("SELECT * FROM processes WHERE process_key=%s", (key,))
    if not row:
        return jsonify(error="no such report"), 404
    definition = row["definition"] if isinstance(row["definition"], dict) \
        else json.loads(row["definition"])
    conn_row = _connection_for(row)
    if not conn_row:
        return jsonify(error="no data connection configured"), 400
    try:
        filters = json.loads(request.args.get("filters") or "{}")
    except ValueError:
        filters = {}
    try:
        data, mime, safe, ext = _export_bytes(definition, filters, conn_row, fmt)
    except Exception as exc:  # noqa: BLE001
        return jsonify(error=str(exc)[:300]), 502

    resp = app.response_class(data, mimetype=mime)
    resp.headers["Content-Disposition"] = f'attachment; filename="{safe}.{ext}"'
    return resp

@app.get("/api/processes/<key>/table")
@auth()
def report_table(key):
    row = db.q1(
        "SELECT * FROM processes WHERE process_key=%s",
        (key,)
    )

    if not row:
        return jsonify(error="no such report"), 404

    definition = (
        row["definition"]
        if isinstance(row["definition"], dict)
        else json.loads(row["definition"])
    )

    conn_row = _connection_for(row)

    if not conn_row:
        return jsonify(error="no data connection configured"), 400

    try:
        cat = _catalogue(conn_row)
    except Exception as exc:  # noqa: BLE001
        return jsonify(
            error=f"could not read the catalogue: {exc}"
        ), 502

    try:
        filters = json.loads(
            request.args.get("filters") or "{}"
        )
    except ValueError:
        filters = {}

    results = _execute_boxes(
        definition,
        filters,
        conn_row,
        cat,
        allow_forms=False,
    )

    sections = _render_boxes(
        definition,
        results,
    )

    return jsonify({
        "name": definition.get("name") or "report",
        "sections": sections,
    })
# --------------------------------------------------------------------------
# role-scoped visibility — which boxes/filters a published link may show
# --------------------------------------------------------------------------
PUBLIC_ROLES = ["vendor", "admin", "employee"]


def _visible(node, role):
    """A box or filter is visible to a role unless it names a roles list of
    its own that this role isn't in. No list set at all = visible to everyone."""
    roles = node.get("roles") or []
    return not roles or role in roles


def _definition_for_role(definition, role):
    """Trim a definition down to what one role may see, on the server, before
    it ever reaches a browser — so a public viewer can never retrieve a box's
    data by editing the page, because that box was never sent to it.
    """
    out = dict(definition)
    out["filters"] = [
        f for f in definition.get("filters", [])
        if _visible(f, role)
    ]
    out["sections"] = []

    for sec in definition.get("sections", []):
        boxes = [
            b for b in sec.get("boxes", [])
            if _visible(b, role)
        ]

        out["sections"].append({
            **sec,
            "boxes": boxes
        })

    return out


def _resolve_pub(key, token):
    """One published link -> its row (and therefore its role, and the report
    it belongs to). Looked up by two separate URL segments — key and token
    are never glued into one string, so a token that happens to contain a
    hyphen or slash of its own can never corrupt the lookup."""
    return db.q1(
        "SELECT pub.*, p.process_key, p.connection_id "
        "FROM publications pub JOIN processes p ON p.id = pub.process_id "
        "WHERE p.process_key=%s AND pub.token=%s AND pub.is_active=1", (key, token))


# --------------------------------------------------------------------------
# publishing
# --------------------------------------------------------------------------
@app.post("/api/processes/<key>/publish")
@auth()
def publish(key):
    row = db.q1("SELECT id, version FROM processes WHERE process_key=%s", (key,))
    if not row:
        return jsonify(error="no such report"), 404

    body = request.get_json(silent=True) or {}
    requested_roles = body.get("roles")
    # No body / no "roles" key => every existing caller keeps today's behavior (publish to
    # everyone). An explicit empty list is meaningful though — respected as "no roles selected".
    roles = PUBLIC_ROLES if requested_roles is None else [r for r in requested_roles if r in PUBLIC_ROLES]

    links = []
    for role in roles:
        existing = db.q1(
            "SELECT id, token FROM publications WHERE process_id=%s AND role=%s "
            "ORDER BY id DESC LIMIT 1",
            (row["id"], role))
        if existing:
            # This role already has a permanent link for this report — reuse
            # it (whether it was active or not), and just repoint which
            # version it shows and mark it live again. Scoped to this exact
            # row's id, not just (process_id, role) — that broader match
            # used to reactivate every *other* historical row for this role
            # too (each with its own stale token), which is how a report
            # published more than once ended up with two simultaneously
            # "live" links for the same role.
            token = existing["token"]
            db.execute(
                "UPDATE publications SET pinned_version=%s, is_active=1 "
                "WHERE id=%s",
                (row["version"], existing["id"]))
            db.execute(
                "UPDATE publications SET is_active=0 "
                "WHERE process_id=%s AND role=%s AND id<>%s",
                (row["id"], role, existing["id"]))
        else:
            token = secrets.token_urlsafe(16)
            db.execute("INSERT INTO publications (process_id,token,role,pinned_version) "
                       "VALUES (%s,%s,%s,%s)", (row["id"], token, role, row["version"]))
        links.append({"role": role, "url": f"/r/{key}/{token}"})

    # Any role that WAS active but isn't in this publish's selection goes inactive — this is
    # what makes "publish to employee only" actually mean only employee, not "employee plus
    # whatever roles were active from a previous publish."
    dropped_roles = [r for r in PUBLIC_ROLES if r not in roles]
    if dropped_roles:
        placeholders = ",".join(["%s"] * len(dropped_roles))
        db.execute(
            f"UPDATE publications SET is_active=0 WHERE process_id=%s AND role IN ({placeholders})",
            (row["id"], *dropped_roles))

    return jsonify(links=links, pinned_version=row["version"])


@app.post("/api/processes/<key>/unpublish")
@auth()
def unpublish(key):
    row = db.q1("SELECT id FROM processes WHERE process_key=%s", (key,))
    if row:
        db.execute("UPDATE publications SET is_active=0 WHERE process_id=%s", (row["id"],))
    return jsonify(ok=True)


@app.get("/api/processes/published")
@auth()
def list_published():
    """Every currently-active publication for one role, for a trusted server-side caller only
    (behind @auth() — the vendor_portal employee/vendor portals reach this via backend_java's own
    service credential, never directly from an employee's browser). Unlike /api/r/<key>/<token>,
    this is a listing/discovery endpoint, so it stays authenticated rather than public — a
    published report shouldn't be enumerable by anyone who doesn't already hold its link.
    Returns the full working URL (with the /analytics prefix nginx actually proxies) rather than
    the bare token, since the caller is meant to use it directly, not re-derive it."""
    role = request.args.get("role", "")
    if not role:
        return jsonify(error="role is required"), 400
    rows = db.qall(
        "SELECT p.process_key, p.name, p.updated_at, pub.token "
        "FROM publications pub JOIN processes p ON p.id = pub.process_id "
        "WHERE pub.role=%s AND pub.is_active=1 ORDER BY p.updated_at DESC",
        (role,))
    return jsonify(reports=[
        {
            "key": r["process_key"],
            "name": r["name"],
            "updatedAt": r["updated_at"],
            "url": f"/analytics/r/{r['process_key']}/{r['token']}",
        }
        for r in rows
    ])


@app.get("/api/r/<key>/<token>")
def resolve_public(key, token):
    """What a published link resolves to: the report's definition, trimmed
    to whatever this link's own role may see."""
    pub = _resolve_pub(key, token)
    if not pub:
        return jsonify(error="this link is not live"), 404
    db.execute("INSERT INTO publication_access (publication_id,remote_addr,role_claimed) "
               "VALUES (%s,%s,%s)", (pub["id"], request.remote_addr or "", pub["role"]))
    ver = db.q1("SELECT definition FROM process_versions "
                "WHERE process_id=%s AND version=%s",
                (pub["process_id"], pub["pinned_version"]))
    definition = ver["definition"] if isinstance(ver["definition"], dict) \
        else json.loads(ver["definition"])
    definition = _definition_for_role(definition, pub["role"])
    return jsonify(process_key=pub["process_key"], role=pub["role"],
                   pinned_version=pub["pinned_version"], definition=definition)


@app.post("/api/r/<key>/<token>/execute")
def execute_public(key, token):
    """The public, no-login counterpart to execute-all: same box-running
    logic (via _execute_boxes), scoped to this link's role, and never given
    a form box — a public link can show data, not write it."""
    pub = _resolve_pub(key, token)
    if not pub:
        return jsonify(error="this link is not live"), 404
    body = request.get_json(silent=True) or {}
    ver = db.q1("SELECT definition FROM process_versions "
                "WHERE process_id=%s AND version=%s",
                (pub["process_id"], pub["pinned_version"]))
    definition = ver["definition"] if isinstance(ver["definition"], dict) \
        else json.loads(ver["definition"])
    definition = _definition_for_role(definition, pub["role"])

    conn_row = _connection_for(cid=pub["connection_id"])
    if not conn_row:
        return jsonify(error="no data connection configured"), 400
    try:
        cat = _catalogue(conn_row)
    except Exception as exc:  # noqa: BLE001
        return jsonify(error=f"could not read the catalogue: {exc}"), 502

    state = body.get("filters") or {}
    results = _execute_boxes(definition, state, conn_row, cat, allow_forms=False)
    return jsonify(results=results)

@app.get("/api/r/<key>/<token>/export/<fmt>")
def export_public_report(key, token, fmt):
    if fmt not in ("pdf", "pptx"):
        return jsonify(error="unknown export format"), 400

    pub = _resolve_pub(key, token)
    if not pub:
        return jsonify(error="this link is not live"), 404

    ver = db.q1(
        "SELECT definition FROM process_versions "
        "WHERE process_id=%s AND version=%s",
        (pub["process_id"], pub["pinned_version"])
    )

    if not ver:
        return jsonify(error="published version not found"), 404

    definition = (
        ver["definition"]
        if isinstance(ver["definition"], dict)
        else json.loads(ver["definition"])
    )

    # Apply the same role-based visibility as the published page
    definition = _definition_for_role(definition, pub["role"])

    conn_row = _connection_for(cid=pub["connection_id"])
    if not conn_row:
        return jsonify(error="no data connection configured"), 400

    try:
        cat = _catalogue(conn_row)
    except Exception as exc:
        return jsonify(error=f"could not read the catalogue: {exc}"), 502

    try:
        filters = json.loads(request.args.get("filters") or "{}")
    except ValueError:
        filters = {}

    results = _execute_boxes(
        definition,
        filters,
        conn_row,
        cat,
        allow_forms=False,
    )

    sections = _render_boxes(definition, results)
    name = definition.get("name") or "report"

    if fmt == "pdf":
        mime = "application/pdf"
        extension = "pdf"

        # Frontend URL used by Playwright to render the published report.
        #
        # Local development:
        #   Frontend = http://localhost:5173
        #
        # Production:
        #   Frontend = https://nexdsupportal.in/analytics
        #
        # PUBLIC_BASE_URL should point to the FRONTEND, not the backend.
        # This avoids relying on request.path because nginx strips
        # /analytics before forwarding the request to Flask.

        frontend_base_url = os.environ.get(
            "PUBLIC_BASE_URL",
            "http://localhost:5173"
        ).rstrip("/")

        public_url = (
            f"{frontend_base_url}/r/{key}/{token}"
        )

        print("PDF PUBLIC URL:", public_url)

        data = exporters.build_browser_pdf(public_url)

    else:
        mime = (
            "application/vnd.openxmlformats-officedocument."
            "presentationml.presentation"
        )
        extension = "pptx"

        data = exporters.build_pptx(
            name,
            sections
        )

    safe = re.sub(
        r"[^\w-]+",
        "-",
        name
    ).strip("-").lower() or "report"

    resp = app.response_class(
        data,
        mimetype=mime
    )

    resp.headers["Content-Disposition"] = (
        f'attachment; filename="{safe}.{extension}"'
    )

    return resp


# ==============================================================
# EMAIL PUBLIC REPORT
# ==============================================================

def _generate_and_send_report(pub, key, token, recipient, custom_message="", filters=None):
    """Core of "email this report": render the same PDF the public link shows
    and send it through WorkFlow's AR01 template. Shared by the on-demand
    HTTP route below and run_scheduled_reports.py (the scheduler), so a
    scheduled send behaves identically to a human clicking "Email report" —
    same role-scoped definition, same PDF, same branded template.

    Returns (ok: bool, error: str | None, info: dict) — info carries
    filename/generated_at/report_name on success, for the caller to log or
    return as-is.
    """

    # ----------------------------------------------------------
    # Get published version
    # ----------------------------------------------------------

    ver = db.q1(
        "SELECT definition FROM process_versions "
        "WHERE process_id=%s AND version=%s",
        (
            pub["process_id"],
            pub["pinned_version"]
        )
    )

    if not ver:
        return False, "published version not found", {}

    definition = (
        ver["definition"]
        if isinstance(ver["definition"], dict)
        else json.loads(ver["definition"])
    )

    # ----------------------------------------------------------
    # Apply role visibility
    # ----------------------------------------------------------

    definition = _definition_for_role(
        definition,
        pub["role"]
    )

    # ----------------------------------------------------------
    # Resolve connection
    # ----------------------------------------------------------

    conn_row = _connection_for(
        cid=pub["connection_id"]
    )

    if not conn_row:
        return False, "no data connection configured", {}

    # ----------------------------------------------------------
    # Read catalogue
    # ----------------------------------------------------------

    try:
        cat = _catalogue(conn_row)

    except Exception as exc:
        return False, f"could not read the catalogue: {exc}", {}

    # ----------------------------------------------------------
    # Execute report (fail fast before spending a browser PDF render)
    # ----------------------------------------------------------

    try:

        _execute_boxes(
            definition,
            filters or {},
            conn_row,
            cat,
            allow_forms=False,
        )

    except Exception as exc:

        return False, f"could not execute report: {exc}", {}

    # ----------------------------------------------------------
    # Generate the SAME PDF
    # ----------------------------------------------------------

    frontend_base_url = os.environ.get(
        "PUBLIC_BASE_URL",
        "http://localhost:5173"
    ).rstrip("/")

    public_url = (
        f"{frontend_base_url}/r/{key}/{token}"
    )

    print(
        "EMAIL PDF PUBLIC URL:",
        public_url
    )

    try:

        pdf_data = exporters.build_browser_pdf(
            public_url
        )

    except Exception as exc:

        print(
            "EMAIL PDF GENERATION ERROR:",
            exc
        )

        return False, f"could not generate PDF: {exc}", {}

    # ----------------------------------------------------------
    # Report name
    # ----------------------------------------------------------

    report_name = (
        definition.get("name")
        or "report"
    )

    safe_name = re.sub(
        r"[^\w-]+",
        "-",
        report_name
    ).strip("-").lower() or "report"

    filename = f"{safe_name}.pdf"

    # ----------------------------------------------------------
    # Current date/time
    # ----------------------------------------------------------

    generated_at = datetime.now().strftime(
        "%d %b %Y, %I:%M %p"
    )

    # ----------------------------------------------------------
    # Send via WorkFlow's shared branded-email system (template AR01,
    # "Analytical Report") instead of a bare SMTP message built here — reuses
    # the SMTP credentials WorkFlow already has configured (this service has
    # none of its own) and gives the send the same masthead/footer every
    # other transactional email in the app uses. custom_message (if the
    # sender typed one) is passed through as a variable so it can be shown
    # if/when the admin adds a {{custom_message}} tag to the template.
    # ----------------------------------------------------------

    workflow_base_url = os.environ.get(
        "WORKFLOW_BASE_URL", "http://localhost:8000"
    ).rstrip("/")

    workflow_service_token = os.environ.get("WORKFLOW_SERVICE_TOKEN")

    if not workflow_service_token:
        return False, "WORKFLOW_SERVICE_TOKEN is not configured", {}

    try:

        resp = requests.post(
            f"{workflow_base_url}/api/email-templates/trigger/AR01",
            headers={"X-Service-Token": workflow_service_token},
            json={
                "to_email": recipient,
                "variables": {
                    "report_name": report_name,
                    "generated_at": generated_at,
                    "custom_message": custom_message,
                },
                "attachments": [
                    {
                        "filename": filename,
                        "content_base64": base64.b64encode(pdf_data).decode("ascii"),
                        "subtype": "pdf",
                    }
                ],
            },
            timeout=30,
        )

        resp.raise_for_status()

        if not resp.json().get("sent"):
            return False, "email template AR01 is missing or disabled", {}

        print(
            "REPORT EMAIL SENT SUCCESSFULLY via WorkFlow (AR01)"
        )

    except Exception as exc:

        print(
            "WORKFLOW EMAIL TRIGGER ERROR:",
            exc
        )

        return False, f"could not send email: {exc}", {}

    return True, None, {
        "filename": filename,
        "generated_at": generated_at,
        "report_name": report_name,
    }


@app.post("/api/r/<key>/<token>/email")
def email_public_report(key, token):

    pub = _resolve_pub(key, token)

    if not pub:
        return jsonify(error="this link is not live"), 404

    body = request.get_json(silent=True) or {}

    recipient = (body.get("email") or "").strip()
    custom_message = (body.get("message") or "").strip()

    if not recipient:
        return jsonify(error="recipient email is required"), 400

    ok, error, info = _generate_and_send_report(
        pub, key, token, recipient, custom_message, filters=body.get("filters") or {}
    )

    if not ok:
        return jsonify(error=error), 500

    return jsonify(
        success=True,
        message="report emailed successfully",
        recipient=recipient,
        **info,
    )


# ==============================================================
# INTERNAL — for WorkFlow only (report_schedules and its admin UI live
# there; this service just renders reports and sends them, on request or on
# WorkFlow's behalf). Gated by the same shared secret WorkFlow's own
# /api/email-templates/trigger/{mail_key} checks, reused here in the other
# direction rather than inventing a second secret for one endpoint.
# ==============================================================

def _require_service_token():
    expected = os.environ.get("WORKFLOW_SERVICE_TOKEN")
    got = request.headers.get("X-Service-Token")
    if not expected or got != expected:
        return jsonify(error="invalid or missing service token"), 401
    return None


@app.get("/api/internal/reports")
def list_reports_for_workflow():
    """Every live published report link, for WorkFlow's "pick a report"
    schedule-creation dropdown — includes the key/token/role WorkFlow needs
    to later call POST /api/r/<key>/<token>/email on a schedule's behalf."""
    denied = _require_service_token()
    if denied:
        return denied
    rows = db.qall(
        "SELECT p.process_key, p.name AS report_name, pub.token, pub.role "
        "FROM publications pub JOIN processes p ON p.id = pub.process_id "
        "WHERE pub.is_active = 1 "
        "ORDER BY p.name, pub.role"
    )
    return jsonify(db.clean(rows))


@app.get("/api/health")
def health():
    return jsonify(
        ok=True,
        service="nexd-designer"
    )


if __name__ == "__main__":
    app.run(
        port=int(os.environ.get("PORT", 5000)),
        debug=True
    )