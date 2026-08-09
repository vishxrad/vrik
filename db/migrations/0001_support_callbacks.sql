CREATE TABLE IF NOT EXISTS support_callbacks (
  id uuid PRIMARY KEY,
  idempotency_key varchar(128) NOT NULL UNIQUE,
  provider varchar(32) NOT NULL DEFAULT 'sarvam_on_end',
  provider_interaction_id varchar(160),
  rider_id varchar(64) NOT NULL,
  order_id varchar(64) NOT NULL,
  issue_type varchar(64) NOT NULL DEFAULT 'other',
  priority varchar(16) NOT NULL DEFAULT 'normal'
    CHECK (priority IN ('normal', 'high', 'urgent')),
  summary varchar(1000) NOT NULL DEFAULT '',
  rider_language varchar(16) NOT NULL DEFAULT 'hi-IN',
  support_language varchar(16) NOT NULL DEFAULT 'en-IN',
  status varchar(24) NOT NULL DEFAULT 'requested'
    CHECK (status IN (
      'requested',
      'ringing',
      'connected',
      'completed',
      'missed',
      'declined',
      'cancelled',
      'failed'
    )),
  failure_code varchar(64),
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  connected_at timestamptz,
  ended_at timestamptz
);

CREATE UNIQUE INDEX IF NOT EXISTS support_callbacks_provider_interaction_uidx
  ON support_callbacks(provider, provider_interaction_id)
  WHERE provider_interaction_id IS NOT NULL;

CREATE INDEX IF NOT EXISTS support_callbacks_open_rider_idx
  ON support_callbacks(rider_id, created_at DESC)
  WHERE status IN ('requested', 'ringing', 'connected');

