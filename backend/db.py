"""Pools, encryption and schema introspection.

Two kinds of connection live here and they are deliberately different:

  * the *metadata* pool holds definitions and is read/write;
  * a *reporting* pool is created per data_connection, is opened with a
    read-only account, and every query it runs is wrapped in a read-only
    transaction with a statement timeout and a row cap.

Introspection matters more than it looks. Report definitions arrive from a
browser, so every table and column name in them is untrusted input. No
database lets you bind an identifier as a parameter, so the only safe move is
to check each one against the catalogue this module reads from
INFORMATION_SCHEMA. Anything not in that catalogue never reaches a query.
"""

import os
from dotenv import load_dotenv
load_dotenv()
import threading
from contextlib import contextmanager

import mysql.connector
from mysql.connector import pooling
from cryptography.fernet import Fernet, InvalidToken

# --------------------------------------------------------------------------
# encryption
# --------------------------------------------------------------------------
_key = os.environ.get("DESIGNER_KEY", "")
if not _key:
    raise RuntimeError(
        "DESIGNER_KEY is not set. Generate one with:\n"
        "  python -c \"from cryptography.fernet import Fernet;"
        "print(Fernet.generate_key().decode())\"\n"
        "Back it up outside the database — lose it and every stored "
        "connection password becomes unreadable."
    )
_fernet = Fernet(_key.encode() if isinstance(_key, str) else _key)


def encrypt(text: str) -> bytes:
    return _fernet.encrypt((text or "").encode("utf-8"))


def decrypt(blob) -> str:
    if not blob:
        return ""
    try:
        return _fernet.decrypt(bytes(blob)).decode("utf-8")
    except InvalidToken:
        raise RuntimeError(
            "A stored password could not be decrypted. DESIGNER_KEY has "
            "changed since it was written."
        )


def clean(row):
    """Drop every bytes column before a row is serialised.

    Ciphertext must never leave the process, and it is far too easy to add an
    endpoint that returns `SELECT *`. Filtering centrally means no endpoint
    can leak it by accident.
    """
    if row is None:
        return None
    if isinstance(row, list):
        return [clean(r) for r in row]
    return {k: v for k, v in row.items() if not isinstance(v, (bytes, bytearray))}


# --------------------------------------------------------------------------
# metadata pool
# --------------------------------------------------------------------------
_meta_pool = None
_meta_lock = threading.Lock()


def meta_pool():
    global _meta_pool
    if _meta_pool is None:
        with _meta_lock:
            if _meta_pool is None:
                _meta_pool = pooling.MySQLConnectionPool(
                    pool_name="nexd_meta",
                    pool_size=int(os.environ.get("META_POOL_SIZE", 5)),
                    host=os.environ.get("META_DB_HOST", "localhost"),
                    port=int(os.environ.get("META_DB_PORT", 3306)),
                    user=os.environ.get("META_DB_USER", "nexd_designer"),
                    password=os.environ.get("META_DB_PASSWORD", ""),
                    database=os.environ.get("META_DB_NAME", "nexd_designer"),
                    autocommit=False,
                    charset="utf8mb4",
                )
    return _meta_pool


@contextmanager
def meta(dict_rows=True):
    conn = meta_pool().get_connection()
    cur = conn.cursor(dictionary=dict_rows)
    try:
        yield cur, conn
        conn.commit()
    except Exception:
        conn.rollback()
        raise
    finally:
        cur.close()
        conn.close()


def q1(sql, args=()):
    with meta() as (cur, _):
        cur.execute(sql, args)
        return cur.fetchone()


def qall(sql, args=()):
    with meta() as (cur, _):
        cur.execute(sql, args)
        return cur.fetchall()


def execute(sql, args=()):
    with meta() as (cur, conn):
        cur.execute(sql, args)
        return cur.lastrowid


# --------------------------------------------------------------------------
# reporting pools, one per data_connection
# --------------------------------------------------------------------------
_report_pools = {}
_report_lock = threading.Lock()

QUERY_TIMEOUT_MS = int(os.environ.get("QUERY_TIMEOUT_MS", 15000))
MAX_ROWS = int(os.environ.get("MAX_ROWS", 5000))


def _pool_for(conn_row):
    cid = conn_row["id"]
    with _report_lock:
        if cid not in _report_pools:
            _report_pools[cid] = pooling.MySQLConnectionPool(
                pool_name=f"nexd_rpt_{cid}",
                pool_size=int(os.environ.get("REPORT_POOL_SIZE", 4)),
                host=conn_row["host"],
                port=int(conn_row["port"] or 3306),
                user=conn_row["username"],
                password=decrypt(conn_row.get("password_enc")),
                database=conn_row["database_name"],
                autocommit=True,
                charset="utf8mb4",
                ssl_disabled=not bool(conn_row.get("use_ssl")),
            )
    return _report_pools[cid]


def forget_pool(cid):
    """Called when a connection's details change, so the next query redials."""
    with _report_lock:
        _report_pools.pop(cid, None)


@contextmanager
def reporting(conn_row):
    pool = _pool_for(conn_row)
    conn = pool.get_connection()
    cur = conn.cursor(dictionary=True)
    try:
        # A report has no business writing. This is belt and braces on top of
        # the read-only grant the account should already have.
        cur.execute("SET SESSION TRANSACTION READ ONLY")
        yield cur
    finally:
        try:
            cur.execute("SET SESSION TRANSACTION READ WRITE")
        except Exception:
            pass
        cur.close()
        conn.close()


def run_report_query(conn_row, sql, params):
    """Run one generated query under a timeout and a row cap."""
    hinted = sql
    if hinted.lstrip().upper().startswith("SELECT"):
        hinted = hinted.replace(
            "SELECT", f"SELECT /*+ MAX_EXECUTION_TIME({QUERY_TIMEOUT_MS}) */", 1
        )
    with reporting(conn_row) as cur:
        cur.execute(hinted, params)
        rows = cur.fetchmany(MAX_ROWS)
        # drain anything above the cap so the connection is reusable
        while cur.fetchmany(MAX_ROWS):
            pass
        return rows

@contextmanager
def writing(conn_row):
    pool = _pool_for(conn_row)
    conn = pool.get_connection()
    cur = conn.cursor(dictionary=True)
    try:
        yield cur
        conn.commit()
    except Exception:
        conn.rollback()
        raise
    finally:
        cur.close()
        conn.close()

def run_write_query(conn_row, sql, params):
    with writing(conn_row) as cur:
        cur.execute(sql, params)
        return cur.rowcount
def test_connection(conn_row):
    """Actually dial the database. Returns (ok, note)."""
    try:
        c = mysql.connector.connect(
            host=conn_row["host"],
            port=int(conn_row["port"] or 3306),
            user=conn_row["username"],
            password=decrypt(conn_row.get("password_enc")),
            database=conn_row["database_name"],
            connection_timeout=6,
            ssl_disabled=not bool(conn_row.get("use_ssl")),
        )
        cur = c.cursor()
        cur.execute("SELECT 1")
        cur.fetchall()
        cur.close()
        c.close()
        return True, "Connected."
    except Exception as exc:  # noqa: BLE001 - the message is for the operator
        return False, str(exc)[:480]


# --------------------------------------------------------------------------
# catalogue
# --------------------------------------------------------------------------
_TYPE_MAP = {
    "int": "number", "bigint": "number", "smallint": "number",
    "mediumint": "number", "tinyint": "number", "decimal": "number",
    "numeric": "number", "float": "number", "double": "number",
    "date": "date", "datetime": "date", "timestamp": "date",
    "bit": "bool", "boolean": "bool",
}


def introspect(conn_row):
    """Read the live catalogue: [{name, columns:[{name, type}]}].

    This is the allowlist the query builder validates against, and it is also
    what the designer's Tables & columns panel shows once a connection is up.
    """
    sql = (
        "SELECT TABLE_NAME AS t, COLUMN_NAME AS c, DATA_TYPE AS d "
        "FROM INFORMATION_SCHEMA.COLUMNS "
        "WHERE TABLE_SCHEMA = %s "
        "ORDER BY TABLE_NAME, ORDINAL_POSITION"
    )
    tables = {}
    with reporting(conn_row) as cur:
        cur.execute(sql, (conn_row["database_name"],))
        for row in cur.fetchall():
            tables.setdefault(row["t"], []).append(
                {"name": row["c"], "type": _TYPE_MAP.get(row["d"].lower(), "text")}
            )
    return [{"name": t, "columns": cols} for t, cols in tables.items()]


def catalogue_index(tables):
    """{table: {column, ...}} — the shape querybuilder wants."""
    return {t["name"]: {c["name"] for c in t["columns"]} for t in tables}


# --------------------------------------------------------------------------
# how the tables hang together
# --------------------------------------------------------------------------
# Introspecting columns alone is not enough to answer "put the HSN number on
# this report" when hsn_code lives on another table: something has to know
# which column stitches the two together. Declared foreign keys answer that
# exactly, but plenty of real reporting schemas (MyISAM tables, imports,
# anything built by hand) declare none at all, so a second, conservative pass
# infers the obvious ones by name and only trusts a match when the far side is
# a primary or unique key.

_KEYISH_SUFFIXES = ("_id", "_code", "_key", "_no", "_num", "_number")
# Names that are a key on their own table but mean nothing across tables.
_GENERIC = {"id", "name", "code", "status", "type", "value", "date",
            "created_at", "updated_at", "created_by", "updated_by"}
# Decoration real schemas put around the entity name.
_TABLE_NOISE = ("_master", "_mst", "_mstr", "_table", "_tbl", "_data", "_details",
                "_detail", "_info", "_list")
_TABLE_PREFIXES = ("tbl_", "t_", "m_", "mst_", "master_")


def _entity_names(table):
    """Every reasonable short name for a table: vendor_master -> {vendor_master,
    vendor, vendors}. Used to match a column stem like "vendor_id"."""
    base = table.lower()
    forms = {base}
    for prefix in _TABLE_PREFIXES:
        if base.startswith(prefix) and len(base) > len(prefix):
            forms.add(base[len(prefix):])
    for noise in _TABLE_NOISE:
        for f in list(forms):
            if f.endswith(noise) and len(f) > len(noise):
                forms.add(f[: -len(noise)])
    for f in list(forms):
        if f.endswith("ies"):
            forms.add(f[:-3] + "y")
        elif f.endswith("ses") or f.endswith("xes") or f.endswith("ches"):
            forms.add(f[:-2])
        elif f.endswith("s") and not f.endswith("ss"):
            forms.add(f[:-1])
        else:
            forms.add(f + "s")
    return {f for f in forms if f}


def _single_column_unique(cur, schema):
    """{table: {column, ...}} for every PRIMARY/UNIQUE index of exactly one
    column. A join onto one of these can never multiply rows, which is what
    makes it safe to add automatically."""
    cur.execute(
        "SELECT TABLE_NAME AS t, INDEX_NAME AS i, MIN(COLUMN_NAME) AS c, "
        "       COUNT(*) AS n "
        "FROM INFORMATION_SCHEMA.STATISTICS "
        "WHERE TABLE_SCHEMA = %s AND NON_UNIQUE = 0 "
        "GROUP BY TABLE_NAME, INDEX_NAME",
        (schema,),
    )
    out = {}
    for row in cur.fetchall():
        if int(row["n"]) == 1:
            out.setdefault(row["t"], set()).add(row["c"])
    return out


def _declared_foreign_keys(cur, schema):
    cur.execute(
        "SELECT TABLE_NAME AS ft, COLUMN_NAME AS fc, "
        "       REFERENCED_TABLE_NAME AS tt, REFERENCED_COLUMN_NAME AS tc "
        "FROM INFORMATION_SCHEMA.KEY_COLUMN_USAGE "
        "WHERE TABLE_SCHEMA = %s AND REFERENCED_TABLE_NAME IS NOT NULL",
        (schema,),
    )
    return cur.fetchall()


def _infer_links(tables, uniques, already):
    """Name-based guesses, only where the far side is a single-column key."""
    by_name = {t["name"]: [c["name"] for c in t["columns"]] for t in tables}
    # {entity form: [table, ...]} so "vendor" finds vendor_master
    by_entity = {}
    for name in by_name:
        for form in _entity_names(name):
            by_entity.setdefault(form, []).append(name)
    # {column name: [table, ...]} restricted to columns that are a key
    key_owner = {}
    for name, cols in by_name.items():
        for col in cols:
            if col in uniques.get(name, set()) and col.lower() not in _GENERIC:
                key_owner.setdefault(col.lower(), []).append((name, col))

    out = []
    for table, cols in by_name.items():
        for col in cols:
            if (table, col) in already:
                continue
            low = col.lower()
            target = None

            # vendor_id -> the vendor table's key
            for suffix in _KEYISH_SUFFIXES:
                if not low.endswith(suffix) or len(low) == len(suffix):
                    continue
                stem = low[: -len(suffix)]
                for cand in by_entity.get(stem, []):
                    if cand == table:
                        continue
                    keys = uniques.get(cand, set())
                    for want in (col, suffix.lstrip("_"), "id", f"{stem}{suffix}"):
                        match = next((k for k in keys if k.lower() == want.lower()), None)
                        if match:
                            target = (cand, match)
                            break
                    if target:
                        break
                if target:
                    break

            # hsn_code on one table, hsn_code as the key of another
            if not target and low not in _GENERIC:
                owners = [o for o in key_owner.get(low, []) if o[0] != table]
                if len(owners) == 1 and col not in uniques.get(table, set()):
                    target = owners[0]

            if target and target != (table, col):
                out.append({
                    "from_table": table, "from_column": col,
                    "to_table": target[0], "to_column": target[1],
                    "source": "inferred",
                })
    return out


def relationships(conn_row, tables=None):
    """[{from_table, from_column, to_table, to_column, source, to_unique}].

    `source` is "fk" for a link the database itself declares and "inferred"
    for one matched by name. `to_unique` says the far column is a primary or
    unique key, i.e. the join is many-to-one and cannot multiply rows — the
    only kind anything here adds to a report without being asked.
    """
    if tables is None:
        tables = introspect(conn_row)
    known = {t["name"]: {c["name"] for c in t["columns"]} for t in tables}

    with reporting(conn_row) as cur:
        schema = conn_row["database_name"]
        uniques = _single_column_unique(cur, schema)
        declared = _declared_foreign_keys(cur, schema)

    links, seen = [], set()
    for row in declared:
        key = (row["ft"], row["fc"], row["tt"], row["tc"])
        if key in seen:
            continue
        seen.add(key)
        links.append({"from_table": row["ft"], "from_column": row["fc"],
                      "to_table": row["tt"], "to_column": row["tc"],
                      "source": "fk"})

    covered = {(l["from_table"], l["from_column"]) for l in links}
    for link in _infer_links(tables, uniques, covered):
        key = (link["from_table"], link["from_column"],
               link["to_table"], link["to_column"])
        if key not in seen:
            seen.add(key)
            links.append(link)

    # Drop anything naming a table or column the reporting account cannot
    # actually see — the catalogue is the allowlist, here as everywhere else.
    out = []
    for l in links:
        if l["from_column"] in known.get(l["from_table"], set()) and \
                l["to_column"] in known.get(l["to_table"], set()):
            l["to_unique"] = l["to_column"] in uniques.get(l["to_table"], set())
            out.append(l)
    return out
