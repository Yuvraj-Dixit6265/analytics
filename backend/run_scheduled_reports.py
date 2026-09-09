"""
Fires any due report_schedules row: renders the same PDF the public report
link shows and emails it via WorkFlow's AR01 template, exactly like a human
clicking "Email report" would (both paths go through
app._generate_and_send_report).

Deliberately NOT an in-process scheduler (no APScheduler here) — this app
runs under `gunicorn -w 4`, so a scheduler started inside the Flask process
would run once per worker and fire every send 4 times. Instead this is a
plain script invoked on an interval by a systemd timer
(nexd-scheduled-reports.timer) — one process, one pass, exits when done.

Run manually to test: .venv/bin/python run_scheduled_reports.py
"""
import json
import logging
import sys

logging.basicConfig(level=logging.INFO, format="%(asctime)s %(levelname)s %(message)s")
logger = logging.getLogger("run_scheduled_reports")

import db
from app import _generate_and_send_report, _resolve_pub


def due_schedules():
    return db.qall(
        "SELECT rs.id, rs.recipients, rs.message, rs.interval_hours, "
        "       p.process_key, pub.token "
        "FROM report_schedules rs "
        "JOIN publications pub ON pub.id = rs.publication_id "
        "JOIN processes p ON p.id = pub.process_id "
        "WHERE rs.is_active = 1 AND pub.is_active = 1 "
        "  AND (rs.last_sent_at IS NULL "
        "       OR rs.last_sent_at <= DATE_SUB(NOW(), INTERVAL rs.interval_hours HOUR))"
    )


def run_one(sched):
    key, token = sched["process_key"], sched["token"]
    pub = _resolve_pub(key, token)
    if not pub:
        logger.warning("schedule %s: publication %s/%s is no longer live — skipping", sched["id"], key, token)
        db.execute(
            "UPDATE report_schedules SET last_error=%s WHERE id=%s",
            ("publication is no longer live", sched["id"]),
        )
        return

    recipients = sched["recipients"]
    if isinstance(recipients, str):
        recipients = json.loads(recipients)

    errors = []
    for email in recipients:
        ok, error, info = _generate_and_send_report(pub, key, token, email, sched["message"] or "")
        if ok:
            logger.info("schedule %s: sent to %s (%s)", sched["id"], email, info.get("filename"))
        else:
            logger.error("schedule %s: failed for %s — %s", sched["id"], email, error)
            errors.append(f"{email}: {error}")

    # Mark it sent (advances last_sent_at, so a schedule that's failing for
    # one bad recipient doesn't retry every run and spam the working ones) —
    # last_error records what happened for the admin to see, even on a
    # partial success.
    db.execute(
        "UPDATE report_schedules SET last_sent_at=NOW(), last_error=%s WHERE id=%s",
        ("; ".join(errors) if errors else None, sched["id"]),
    )


def main():
    schedules = due_schedules()
    logger.info("found %d due schedule(s)", len(schedules))
    for sched in schedules:
        try:
            run_one(sched)
        except Exception:
            logger.exception("schedule %s: unhandled error", sched["id"])


if __name__ == "__main__":
    main()
    sys.exit(0)
