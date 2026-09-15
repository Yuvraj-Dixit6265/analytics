"""Turn a plain-English description into a NexD report definition.

Claude never touches the database and never writes SQL. It only sees the
live catalogue (the same introspected tables/columns querybuilder.py
checks every box against) and a description of the document shape, and
returns a definition in that same shape.

Before it is handed back to the browser, every box is run through
querybuilder.build() as a dry check — the same identifier-safety pass a
hand-built report already goes through — so a hallucinated table or
column is rejected here with a clear message rather than surfacing as a
confusing error later.
"""
import json
import os
import re

import requests

from querybuilder import BadDefinition, build


def _catalog_text(tables):
    lines = []
    for t in tables:
        cols = ", ".join(f"{c['name']} ({c['type']})" for c in t["columns"])
        lines.append(f'- "{t["name"]}": {cols}')
    return "\n".join(lines)


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


def _call_claude(system: str, user_prompt: str) -> dict:
    key = os.environ.get("ANTHROPIC_API_KEY")
    if not key:
        raise SpecError("AI report generation needs ANTHROPIC_API_KEY set on the server.")
    r = requests.post(
        "https://api.anthropic.com/v1/messages", timeout=60,
        headers={"x-api-key": key, "anthropic-version": "2023-06-01",
                 "content-type": "application/json"},
        json={"model": os.environ.get("AI_REPORT_MODEL", "claude-sonnet-4-5"),
              "max_tokens": 3000, "system": system,
              "messages": [{"role": "user", "content": user_prompt[:4000]}]},
    )
    r.raise_for_status()
    body = "".join(b.get("text", "") for b in r.json().get("content", []))
    body = re.sub(r"^```(?:json)?|```$", "", body.strip(), flags=re.M).strip()
    try:
        return json.loads(body)
    except json.JSONDecodeError:
        raise SpecError("The model did not return valid JSON. Try rephrasing the request.")


def generate_definition(prompt: str, tables: list) -> dict:
    if not prompt or not prompt.strip():
        raise SpecError("Describe the report you want first.")
    if not tables:
        raise SpecError("No data connection catalogue is available yet. Add and test a "
                         "connection in System Settings first.")

    system = (
        "You turn a plain-English request into a JSON report definition for a "
        "report-designer tool. Return ONLY a JSON object — no prose, no markdown fences, "
        "nothing before or after it.\n\n"
        "Available tables and columns (use these exact names, never invent one):\n"
        f"{_catalog_text(tables)}\n\n{SCHEMA_DOC}"
    )
    return _call_claude(system, prompt)


def generate_edit(prompt: str, current_definition: dict, tables: list) -> dict:
    """Apply a plain-English change to a report that already exists (saved or
    still an unsaved draft in the Canvas) and return the complete updated
    definition — not a diff. The model is told to copy everything it wasn't
    asked to touch through unchanged, ids included, so an edit for "add a
    chart" doesn't quietly rewrite boxes the user never mentioned."""
    if not prompt or not prompt.strip():
        raise SpecError("Describe the change you want first.")
    if not isinstance(current_definition, dict) or not current_definition.get("sections"):
        raise SpecError("There's no report open to edit yet.")
    if not tables:
        raise SpecError("No data connection catalogue is available yet. Add and test a "
                         "connection in System Settings first.")

    current_json = json.dumps(current_definition)[:8000]
    system = (
        "You edit an existing JSON report definition for a report-designer tool, based on a "
        "plain-English instruction. Return ONLY the complete updated JSON object — no prose, "
        "no markdown fences, nothing before or after it.\n\n"
        "Available tables and columns (use these exact names, never invent one):\n"
        f"{_catalog_text(tables)}\n\n{SCHEMA_DOC}\n\n"
        "You are EDITING an existing report, not creating one from scratch:\n"
        "- Apply exactly the change the instruction describes.\n"
        "- Copy every section, box, filter and id the instruction doesn't touch through "
        "completely unchanged — do not rewrite ids, titles or configuration you weren't asked "
        "to change.\n"
        "- Only add, remove or modify what the instruction actually asks about.\n\n"
        f"Current definition:\n{current_json}"
    )
    return _call_claude(system, prompt)


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
