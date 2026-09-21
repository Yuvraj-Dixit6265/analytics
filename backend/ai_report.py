"""Turn a plain-English description into a NexD report definition.

Claude never touches the database and never writes SQL. It only sees the
live catalogue (the same introspected tables/columns querybuilder.py
checks every box against), how those tables link to each other, and a
description of the document shape, and returns a definition in that same
shape. A request may also carry screenshots or mock-ups, which go to the
model alongside the words.

Before it is handed back to the browser, links.autolink() adds any join a
box needs to reach a column that is not on its base table, and then every
box is run through querybuilder.build() as a dry check — the same
identifier-safety pass a hand-built report already goes through — so a
hallucinated table or column is rejected here with a clear message rather
than surfacing as a confusing error later.
"""
import base64
import binascii
import json
import os
import re

import requests

import links
from querybuilder import BadDefinition, build

# Anthropic accepts these, and nothing else, as an image block.
IMAGE_TYPES = {"image/png", "image/jpeg", "image/gif", "image/webp"}
MAX_IMAGES = 5
MAX_IMAGE_BYTES = 4 * 1024 * 1024
_DATA_URL_RE = re.compile(r"^data:([\w.+-]+/[\w.+-]+);base64,(.*)$", re.DOTALL)


def _catalog_text(tables):
    lines = []
    for t in tables:
        cols = ", ".join(f"{c['name']} ({c['type']})" for c in t["columns"])
        lines.append(f'- "{t["name"]}": {cols}')
    return "\n".join(lines)


def _relationship_text(relationships):
    """The join map. Without it the model can see that hsn_code exists on the
    item master but has no idea which column ties it to an invoice line, so it
    either guesses a key or leaves the column out — the two failures this
    section exists to remove."""
    if not relationships:
        return ("(No links between tables could be read from the schema — this "
                "database declares no foreign keys and no column names matched. "
                "Prefer boxes that read a single table.)")
    lines = []
    for r in relationships:
        how = "foreign key" if r.get("source") == "fk" else "matched by name"
        shape = "many-to-one" if r.get("to_unique") else "may match many rows"
        lines.append(
            f'- {r["from_table"]}.{r["from_column"]} = '
            f'{r["to_table"]}.{r["to_column"]}  ({how}, {shape})')
    return "\n".join(lines)


def _where_columns_live(tables):
    """Column name -> the tables carrying it, for the ones that sit on only a
    few tables. This is what lets "add the HSN number" land on the right table
    instead of being dropped as unknown."""
    owners = {}
    for t in tables:
        for c in t["columns"]:
            owners.setdefault(c["name"], []).append(t["name"])
    shared = {c: ts for c, ts in owners.items() if len(ts) > 1}
    if not shared:
        return ""
    lines = [f'- {c}: {", ".join(sorted(ts))}' for c, ts in sorted(shared.items())]
    return ("\nColumns that appear on more than one table — say which you mean "
            "with \"table.column\":\n" + "\n".join(lines[:200]))


SCHEMA_DOC = """Output shape — a NexD report "definition":

{
  "name": "short report title",
  "filters": [
    {"id": "flt-1", "label": "Status", "control": "select", "table": "<table>",
     "column": "<column>", "optionSource": "list", "list": "A\\nB\\nC", "visible": true},
    {"id": "flt-2", "label": "Date", "control": "daterange", "table": "<table>",
     "column": "<a date column>", "visible": true}
  ],
  "sections": [
    {"id": "sec-1", "name": "Overview", "cols": 4, "boxes": [

      {"id": "box-1", "kind": "value", "title": "Total sales", "span": 1,
       "useFilters": true,
       "src": {"base": "<table>", "joins": [], "where": [], "whereLink": "AND"},
       "value": {"source": "data", "agg": "SUM", "column": "<number column>"}},

      {"id": "box-2", "kind": "chart", "title": "Sales by month", "span": 2,
       "useFilters": true,
       "src": {"base": "<table>", "joins": [], "where": [], "whereLink": "AND"},
       "chart": {"type": "bar", "source": "database", "category": "<column>",
                 "agg": "SUM", "column": "<number column>", "limit": 8,
                 "sort": "value", "dir": "desc"}},

      {"id": "box-3", "kind": "table", "title": "Top customers", "span": 4,
       "useFilters": true,
       "src": {"base": "<table>", "joins": [], "where": [], "whereLink": "AND"},
       "table": {"columns": [{"col": "<column>", "label": "Column", "on": true}],
                 "limit": 10, "sort": "<column>", "dir": "desc"}}
    ]}
  ]
}

Rules:
- Every "base"/"column"/join "table" must be an exact name from the catalogue below —
  never invent one.
- A join is {"table": "...", "type": "INNER"|"LEFT", "leftCol": "...", "rightCol": "..."}.
  leftCol must already be in scope (the base table, or an earlier join); rightCol is a
  column on the table being joined. Use "table.column" for a joined table's column
  anywhere else in the box (e.g. "vendors.name").
- A column the request asks for is often not on the base table. Never drop it and never
  substitute a different column: find it in the catalogue, then join its table using a
  link from the "How the tables link up" list and refer to it as "table.column". If it
  takes two hops, add both joins, in order — each one's leftCol must be in scope by the
  time it appears. Use LEFT joins for this so no rows are lost.
- Only join through a link that list actually shows. If a column genuinely cannot be
  reached from the base table, pick a base table it can be reached from instead.
- Every filter's table must be reachable from each box it should narrow, by the same
  rule — a filter on a table a box never joins does nothing to that box.
- "value" boxes show one number: an aggregate over one column ("agg":"COUNT" works with
  any column, for a row count).
- "chart" boxes group by "category" (a text or date column) and aggregate "column".
- "table" boxes list several columns — put the ones the request actually cares about first.
- aggregates: SUM, AVG, COUNT, "COUNT DISTINCT", MIN, MAX. chart types: bar, hbar, stacked,
  line, area, pie, donut. filter controls: text, date, daterange, select, radio, checkbox,
  toggle, number, status-tabs.
- ids like "flt-1", "box-1", "sec-1" — short and unique within the document.
- Give every section a sensible "cols" (e.g. 4) and every box a "span" from 1 (a quarter
  width value box) up to "cols" (a full-width table or chart).
- At most 2 filters and 6 boxes, unless the request clearly asks for more.
- If the request is ambiguous, make the most reasonable choice rather than asking a
  question back — this runs non-interactively.
"""


class SpecError(Exception):
    pass


def image_blocks(images) -> list:
    """Validate what the browser attached and turn it into Anthropic image
    blocks. Accepts either a data: URL or an explicit {media_type, data} pair,
    because the file picker produces the first and an API caller finds the
    second easier to send.

    Everything is checked here rather than trusted: an oversized or unknown
    attachment should be one clear message in the composer, not a 400 from
    somewhere downstream.
    """
    if not images:
        return []
    if not isinstance(images, list):
        raise SpecError("Attachments must be sent as a list.")
    if len(images) > MAX_IMAGES:
        raise SpecError(f"Attach at most {MAX_IMAGES} images.")

    blocks = []
    for item in images:
        if isinstance(item, str):
            item = {"data": item}
        if not isinstance(item, dict):
            raise SpecError("An attachment was not in a readable shape.")
        name = item.get("name") or "an attachment"
        data = (item.get("data") or "").strip()
        media_type = (item.get("media_type") or item.get("type") or "").strip().lower()

        match = _DATA_URL_RE.match(data)
        if match:
            media_type = media_type or match.group(1).lower()
            data = match.group(2)
        data = re.sub(r"\s+", "", data)

        if media_type == "image/jpg":
            media_type = "image/jpeg"
        if media_type not in IMAGE_TYPES:
            raise SpecError(
                f"{name} is a {media_type or 'unknown'} file — attach a PNG, "
                "JPEG, GIF or WebP image.")
        if not data:
            raise SpecError(f"{name} came through empty.")
        try:
            raw = base64.b64decode(data, validate=True)
        except (binascii.Error, ValueError):
            raise SpecError(f"{name} could not be read as an image.")
        if len(raw) > MAX_IMAGE_BYTES:
            raise SpecError(
                f"{name} is {len(raw) // (1024 * 1024)}MB — attach an image "
                f"under {MAX_IMAGE_BYTES // (1024 * 1024)}MB.")

        blocks.append({"type": "image", "source": {
            "type": "base64", "media_type": media_type, "data": data}})
    return blocks


def _call_claude(system: str, user_prompt: str, max_tokens: int = 3000,
                 images=None) -> dict:
    key = os.environ.get("ANTHROPIC_API_KEY")
    if not key:
        raise SpecError("AI report generation needs ANTHROPIC_API_KEY set on the server.")
    # Images first: the model reads them as context for the words that follow,
    # which is the order a person would describe a screenshot in.
    content = image_blocks(images) + [{"type": "text", "text": user_prompt[:4000]}]
    r = requests.post(
        "https://api.anthropic.com/v1/messages", timeout=120,
        headers={"x-api-key": key, "anthropic-version": "2023-06-01",
                 "content-type": "application/json"},
        json={"model": os.environ.get("AI_REPORT_MODEL", "claude-sonnet-4-5"),
              "max_tokens": max_tokens, "system": system,
              "messages": [{"role": "user", "content": content}]},
    )
    if r.status_code >= 400:
        try:
            detail = (r.json().get("error") or {}).get("message") or r.text[:300]
        except ValueError:
            detail = r.text[:300]
        raise SpecError(f"The AI service refused the request: {detail}")
    r.raise_for_status()
    resp = r.json()
    body = "".join(b.get("text", "") for b in resp.get("content", []))
    body = re.sub(r"^```(?:json)?|```$", "", body.strip(), flags=re.M).strip()
    try:
        return json.loads(body)
    except json.JSONDecodeError:
        if resp.get("stop_reason") == "max_tokens":
            raise SpecError("The report is too large to edit in one go — try asking for a "
                             "smaller change, or trim the report first.")
        raise SpecError("The model did not return valid JSON. Try rephrasing the request.")


IMAGE_NOTE = (
    "\nThe request may come with screenshots, mock-ups or photos attached. Read them as "
    "part of the instruction: a marked-up screenshot of this designer says which box to "
    "change, and a sketch or a spreadsheet screenshot says what to build — match its "
    "layout, its column order and its wording where the catalogue allows. If an image "
    "names a field, find that field in the catalogue (joining to reach it if needed) "
    "rather than inventing a column to match the picture.\n"
)


def _schema_brief(tables, relationships):
    return (
        "Available tables and columns (use these exact names, never invent one):\n"
        f"{_catalog_text(tables)}\n"
        f"{_where_columns_live(tables)}\n\n"
        "How the tables link up — the only joins you may use:\n"
        f"{_relationship_text(relationships)}\n\n"
        f"{SCHEMA_DOC}{IMAGE_NOTE}"
    )


def generate_definition(prompt: str, tables: list, relationships=None,
                        images=None) -> dict:
    if not (prompt or "").strip() and not images:
        raise SpecError("Describe the report you want first.")
    if not tables:
        raise SpecError("No data connection catalogue is available yet. Add and test a "
                         "connection in System Settings first.")

    system = (
        "You turn a plain-English request into a JSON report definition for a "
        "report-designer tool. Return ONLY a JSON object — no prose, no markdown fences, "
        "nothing before or after it.\n\n"
        + _schema_brief(tables, relationships)
    )
    return _call_claude(system, prompt or "Build the report shown in the attached image.",
                        max_tokens=4096, images=images)


def generate_edit(prompt: str, current_definition: dict, tables: list,
                  relationships=None, images=None) -> dict:
    """Apply a plain-English change to a report that already exists (saved or
    still an unsaved draft in the Canvas) and return the complete updated
    definition — not a diff. The model is told to copy everything it wasn't
    asked to touch through unchanged, ids included, so an edit for "add a
    chart" doesn't quietly rewrite boxes the user never mentioned."""
    if not (prompt or "").strip() and not images:
        raise SpecError("Describe the change you want first.")
    if not isinstance(current_definition, dict) or not current_definition.get("sections"):
        raise SpecError("There's no report open to edit yet.")
    if not tables:
        raise SpecError("No data connection catalogue is available yet. Add and test a "
                         "connection in System Settings first.")

    current_json = json.dumps(current_definition)[:60000]
    system = (
        "You edit an existing JSON report definition for a report-designer tool, based on a "
        "plain-English instruction. Return ONLY the complete updated JSON object — no prose, "
        "no markdown fences, nothing before or after it. Output the JSON directly with no "
        "preamble, and do not stop until the closing brace.\n\n"
        + _schema_brief(tables, relationships) +
        "\nYou are EDITING an existing report, not creating one from scratch:\n"
        "- Apply exactly the change the instruction describes.\n"
        "- Copy every section, box, filter and id the instruction doesn't touch through "
        "completely unchanged — do not rewrite ids, titles or configuration you weren't asked "
        "to change.\n"
        "- Only add, remove or modify what the instruction actually asks about.\n"
        "- Adding a column to an existing box means adding it to that box's own \"src\", "
        "including any join it needs — do not move the box to a different base table and do "
        "not rebuild the rest of it.\n\n"
        f"Current definition:\n{current_json}"
    )
    return _call_claude(system, prompt or "Apply the change shown in the attached image.",
                        max_tokens=8192, images=images)


def validate_definition(definition: dict, catalogue: dict) -> None:
    """Dry-run every box through the real query builder — the same
    identifier-safety pass a hand-built report goes through — plus a
    quick check on any filters, which build() does not itself see."""
    if not isinstance(definition, dict) or not isinstance(definition.get("sections"), list) \
            or not definition["sections"]:
        raise SpecError("Malformed report definition (no sections).")

    filters = definition.get("filters") or []
    for f in filters:
        table, col = f.get("table"), f.get("column")
        if table and col and (table not in catalogue or col not in catalogue.get(table, set())):
            raise SpecError(
                f"Filter {f.get('label') or f.get('id')!r} refers to an unknown column: "
                f"{table}.{col}")

    any_box = False
    for sec in definition["sections"]:
        for box in sec.get("boxes") or []:
            any_box = True
            try:
                build(box, filters, {}, catalogue)
            except BadDefinition as exc:
                raise SpecError(f"Box {box.get('title') or box.get('id')!r}: {exc}")
    if not any_box:
        raise SpecError("The generated report has no boxes.")


def finish_definition(definition: dict, catalogue: dict, relationships) -> list:
    """Everything between the model's answer and the browser: stitch in the
    joins the boxes need, then validate what came out.

    The order matters. Auto-linking first means a box that named a column on
    another table — the ordinary case for "add the HSN number" — arrives at
    validation as a working join rather than as "unknown column", while a
    column that genuinely links to nothing still fails, loudly, here."""
    notes = links.autolink(definition, catalogue, relationships)
    validate_definition(definition, catalogue)
    return notes
