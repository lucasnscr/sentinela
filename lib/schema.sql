CREATE EXTENSION IF NOT EXISTS vector;
CREATE TABLE IF NOT EXISTS incidents (
  id text PRIMARY KEY,
  fingerprint text NOT NULL,
  service text NOT NULL,
  environment text NOT NULL DEFAULT 'laboratory',
  title text NOT NULL,
  severity text NOT NULL DEFAULT 'critical',
  status text NOT NULL DEFAULT 'investigating',
  stage text NOT NULL DEFAULT 'queued',
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  resolved_at timestamptz,
  evidence jsonb NOT NULL DEFAULT '[]',
  diagnosis jsonb,
  attempts integer NOT NULL DEFAULT 0,
  last_error text
);
CREATE UNIQUE INDEX IF NOT EXISTS incidents_active_fingerprint ON incidents(fingerprint) WHERE status <> 'resolved';
CREATE TABLE IF NOT EXISTS metrics (
  id bigserial PRIMARY KEY, service text NOT NULL, at timestamptz NOT NULL,
  error_rate double precision NOT NULL, p95 double precision NOT NULL,
  rpm double precision NOT NULL, saturation double precision NOT NULL,
  requests integer NOT NULL, source text NOT NULL
);
CREATE INDEX IF NOT EXISTS metrics_service_time ON metrics(service,at DESC);
CREATE TABLE IF NOT EXISTS evidence (
  id text PRIMARY KEY, kind text NOT NULL, service text NOT NULL, at timestamptz NOT NULL DEFAULT now(),
  title text NOT NULL, detail text NOT NULL, data jsonb NOT NULL DEFAULT '{}'
);
CREATE INDEX IF NOT EXISTS evidence_service_time ON evidence(service,at DESC);
CREATE TABLE IF NOT EXISTS events (
  id text PRIMARY KEY, incident_id text REFERENCES incidents(id), at timestamptz NOT NULL DEFAULT now(),
  kind text NOT NULL, title text NOT NULL, detail text NOT NULL DEFAULT ''
);
CREATE TABLE IF NOT EXISTS runbooks (
  id text PRIMARY KEY, title text NOT NULL, service text NOT NULL, content text NOT NULL,
  updated_at timestamptz NOT NULL DEFAULT now(), embedding vector,
  embedding_space text, embedding_dimensions integer,
  search_text tsvector GENERATED ALWAYS AS (to_tsvector('portuguese', title || ' ' || content)) STORED
);
CREATE INDEX IF NOT EXISTS runbooks_text_search ON runbooks USING gin(search_text);
-- Preserve legacy vectors while allowing different model dimensions.
ALTER TABLE runbooks ADD COLUMN IF NOT EXISTS embedding_space text;
ALTER TABLE runbooks ADD COLUMN IF NOT EXISTS embedding_dimensions integer;
DO $$ BEGIN
  IF (SELECT atttypmod FROM pg_attribute WHERE attrelid='runbooks'::regclass AND attname='embedding') <> -1 THEN
    ALTER TABLE runbooks ALTER COLUMN embedding TYPE vector USING embedding::vector;
  END IF;
END $$;
CREATE TABLE IF NOT EXISTS commands (
  id text PRIMARY KEY, kind text NOT NULL, payload jsonb NOT NULL DEFAULT '{}',
  status text NOT NULL DEFAULT 'queued', result text, created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(), idempotency_key text UNIQUE
);
CREATE TABLE IF NOT EXISTS actions (
  id text PRIMARY KEY, incident_id text NOT NULL REFERENCES incidents(id), kind text NOT NULL,
  service text NOT NULL, status text NOT NULL DEFAULT 'approved', created_at timestamptz NOT NULL DEFAULT now(),
  executed_at timestamptz, UNIQUE(incident_id,kind)
);
CREATE TABLE IF NOT EXISTS metadata (key text PRIMARY KEY, value jsonb NOT NULL, updated_at timestamptz NOT NULL DEFAULT now());
CREATE TABLE IF NOT EXISTS runtime_observations (
  target_id text PRIMARY KEY, payload jsonb NOT NULL, updated_at timestamptz NOT NULL DEFAULT now()
);
CREATE TABLE IF NOT EXISTS operation_plans (
  id text PRIMARY KEY, target_id text NOT NULL, state text NOT NULL,
  request_id text NOT NULL, payload jsonb NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now(), updated_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE(target_id,request_id)
);
CREATE UNIQUE INDEX IF NOT EXISTS operation_plans_one_active ON operation_plans(target_id)
  WHERE state IN ('pending','executing','verifying','uncertain');
CREATE TABLE IF NOT EXISTS remediation_cases (
  id text PRIMARY KEY, incident_id text NOT NULL UNIQUE REFERENCES incidents(id),
  state text NOT NULL, payload jsonb NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now(), updated_at timestamptz NOT NULL DEFAULT now()
);
CREATE TABLE IF NOT EXISTS sdlc_receipts (
  id text PRIMARY KEY, case_id text NOT NULL REFERENCES remediation_cases(id),
  payload jsonb NOT NULL, accepted_at timestamptz NOT NULL DEFAULT now()
);
ALTER TABLE remediation_cases DROP CONSTRAINT IF EXISTS remediation_cases_incident_id_key;
ALTER TABLE remediation_cases ADD COLUMN IF NOT EXISTS attempt integer NOT NULL DEFAULT 1;
ALTER TABLE remediation_cases ADD COLUMN IF NOT EXISTS previous_case_id text REFERENCES remediation_cases(id);
CREATE UNIQUE INDEX IF NOT EXISTS remediation_cases_attempt ON remediation_cases(incident_id,attempt);
