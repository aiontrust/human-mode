-- Off-site copy of the archive. Run once on the Neon database.
-- The archive holds the machine's own state only. No codes, hashes, paths, or sensor data.
-- The venue runner (server/persist.js, NeonSync) inserts rows in order and skips ones already there.
-- run_id names one run at one venue, so several venues can share this table.

CREATE TABLE IF NOT EXISTS archive_entries (
  run_id text NOT NULL,
  seq bigint NOT NULL,
  t double precision NOT NULL,
  day integer NOT NULL,
  kind text NOT NULL CHECK (kind IN ('line','revision','hidden_revision','gesture','recognition','day','forgot_all')),
  data jsonb NOT NULL DEFAULT '{}'::jsonb,
  PRIMARY KEY (run_id, seq)
);

CREATE INDEX IF NOT EXISTS archive_entries_run_day_kind ON archive_entries (run_id, day, kind);

COMMENT ON TABLE archive_entries IS 'The machine''s own state only. Nothing derived from visitors: no codes, hashes, paths, or sensor data.';
