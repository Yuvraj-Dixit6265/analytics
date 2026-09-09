-- NexD Designer — metadata database
-- The report definition itself is stored as JSON, exactly the shape the
-- designer edits, so an export from the single-file build imports unchanged.

CREATE DATABASE IF NOT EXISTS nexd_designer
  CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;
USE nexd_designer;

CREATE TABLE IF NOT EXISTS publications (
  id            INT AUTO_INCREMENT PRIMARY KEY,
  process_id    INT NOT NULL,
  token         VARCHAR(64) NOT NULL UNIQUE,
  role          VARCHAR(32) NOT NULL DEFAULT '',
  pinned_version INT NOT NULL,
  is_active     TINYINT(1) NOT NULL DEFAULT 1,
  published_at  TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT fk_pub_proc FOREIGN KEY (process_id)
    REFERENCES processes(id) ON DELETE CASCADE
) ENGINE=InnoDB;

-- Where report data is read from. The password is Fernet-encrypted with
-- DESIGNER_KEY before it lands here, so this column is bytes, never text.
CREATE TABLE IF NOT EXISTS data_connections (
  id            INT AUTO_INCREMENT PRIMARY KEY,
  name          VARCHAR(120) NOT NULL,
  engine        ENUM('mysql','postgres','mssql','oracle') NOT NULL DEFAULT 'mysql',
  host          VARCHAR(190) NOT NULL,
  port          INT          NOT NULL DEFAULT 3306,
  database_name VARCHAR(190) NOT NULL,
  username      VARCHAR(190) NOT NULL,
  password_enc  VARBINARY(512) NULL,
  use_ssl       TINYINT(1)   NOT NULL DEFAULT 0,
  read_only     TINYINT(1)   NOT NULL DEFAULT 1,
  status        VARCHAR(32)  NOT NULL DEFAULT 'untested',
  status_note   VARCHAR(500) NOT NULL DEFAULT '',
  created_at    TIMESTAMP    NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at    TIMESTAMP    NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP
) ENGINE=InnoDB;

CREATE TABLE IF NOT EXISTS processes (
  id            INT AUTO_INCREMENT PRIMARY KEY,
  process_key   VARCHAR(64)  NOT NULL UNIQUE,
  name          VARCHAR(190) NOT NULL,
  connection_id INT NULL,
  definition    JSON         NOT NULL,
  version       INT          NOT NULL DEFAULT 1,
  created_by    INT NULL,
  created_at    TIMESTAMP    NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at    TIMESTAMP    NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  CONSTRAINT fk_proc_conn FOREIGN KEY (connection_id)
    REFERENCES data_connections(id) ON DELETE SET NULL,
  CONSTRAINT fk_proc_user FOREIGN KEY (created_by)
    REFERENCES users(id) ON DELETE SET NULL
) ENGINE=InnoDB;

-- Every save writes a version, so a published link can be pinned and an edit
-- never silently changes a live report.
CREATE TABLE IF NOT EXISTS process_versions (
  id            INT AUTO_INCREMENT PRIMARY KEY,
  process_id    INT NOT NULL,
  version       INT NOT NULL,
  definition    JSON NOT NULL,
  saved_by      INT NULL,
  saved_at      TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
  UNIQUE KEY uq_proc_version (process_id, version),
  CONSTRAINT fk_ver_proc FOREIGN KEY (process_id)
    REFERENCES processes(id) ON DELETE CASCADE
) ENGINE=InnoDB;

CREATE TABLE IF NOT EXISTS publications (
  id            INT AUTO_INCREMENT PRIMARY KEY,
  process_id    INT NOT NULL,
  token         VARCHAR(64) NOT NULL UNIQUE,
  pinned_version INT NOT NULL,
  is_active     TINYINT(1) NOT NULL DEFAULT 1,
  published_at  TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT fk_pub_proc FOREIGN KEY (process_id)
    REFERENCES processes(id) ON DELETE CASCADE
) ENGINE=InnoDB;

CREATE TABLE IF NOT EXISTS publication_access (
  id             INT AUTO_INCREMENT PRIMARY KEY,
  publication_id INT NOT NULL,
  opened_at      TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
  remote_addr    VARCHAR(64) NOT NULL DEFAULT '',
  role_claimed   VARCHAR(64) NOT NULL DEFAULT '',
  CONSTRAINT fk_acc_pub FOREIGN KEY (publication_id)
    REFERENCES publications(id) ON DELETE CASCADE
) ENGINE=InnoDB;

CREATE INDEX idx_proc_updated ON processes (updated_at);
CREATE INDEX idx_acc_opened  ON publication_access (opened_at);

-- A recurring "email this report" send. interval_hours follows the same
-- convention WorkFlow's own scheduled_message/reminder tables use (a plain
-- hour count rather than a cron string) — 24 for daily, 168 for weekly, etc.
-- run_scheduled_reports.py (a systemd-timer-driven script, not an in-process
-- scheduler — this app runs under multiple gunicorn workers, so an in-process
-- scheduler would fire the same send once per worker) picks up anything due.
CREATE TABLE IF NOT EXISTS report_schedules (
  id             INT AUTO_INCREMENT PRIMARY KEY,
  publication_id INT NOT NULL,
  recipients     JSON NOT NULL,
  interval_hours INT NOT NULL DEFAULT 24,
  message        VARCHAR(500) NOT NULL DEFAULT '',
  is_active      TINYINT(1) NOT NULL DEFAULT 1,
  last_sent_at   TIMESTAMP NULL,
  last_error     VARCHAR(500) NULL,
  created_by     INT NULL,
  created_at     TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT fk_sched_pub FOREIGN KEY (publication_id)
    REFERENCES publications(id) ON DELETE CASCADE,
  CONSTRAINT fk_sched_user FOREIGN KEY (created_by)
    REFERENCES users(id) ON DELETE SET NULL
) ENGINE=InnoDB;
