CREATE TABLE IF NOT EXISTS foodrun_order_sessions (
  room_id text PRIMARY KEY,
  state text NOT NULL CHECK (
    state IN (
      'collecting_preferences',
      'confirming_preferences',
      'searching_restaurants',
      'selecting_restaurant',
      'building_cart',
      'editing_cart',
      'confirming_cart',
      'issuing_card',
      'checking_out',
      'order_confirmed',
      'splitting_bill',
      'complete',
      'failed'
    )
  ),
  initiator_phone_number text NOT NULL,
  agent_phone_number text,
  original_prompt text,
  confirmed_preferences jsonb NOT NULL DEFAULT '{}'::jsonb,
  supermemory_context jsonb NOT NULL DEFAULT '[]'::jsonb,
  selected_restaurant jsonb,
  cart jsonb,
  sponge_card jsonb,
  order_confirmation jsonb,
  stripe_payment_links jsonb NOT NULL DEFAULT '[]'::jsonb,
  browser_use_session_id text,
  browser_use_live_url text,
  idempotency_key text,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS foodrun_order_participants (
  participant_id text PRIMARY KEY,
  room_id text NOT NULL REFERENCES foodrun_order_sessions(room_id) ON DELETE CASCADE,
  phone_number text NOT NULL,
  display_name text,
  role text NOT NULL DEFAULT 'participant' CHECK (role IN ('initiator', 'participant')),
  preferences jsonb NOT NULL DEFAULT '{}'::jsonb,
  joined_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (room_id, phone_number)
);

CREATE TABLE IF NOT EXISTS foodrun_cart_items (
  cart_item_id text PRIMARY KEY,
  room_id text NOT NULL REFERENCES foodrun_order_sessions(room_id) ON DELETE CASCADE,
  name text NOT NULL,
  quantity integer NOT NULL CHECK (quantity > 0),
  price_cents integer CHECK (price_cents >= 0),
  notes text,
  raw jsonb NOT NULL DEFAULT '{}'::jsonb,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS foodrun_cart_item_assignments (
  cart_item_id text NOT NULL REFERENCES foodrun_cart_items(cart_item_id) ON DELETE CASCADE,
  participant_id text NOT NULL REFERENCES foodrun_order_participants(participant_id) ON DELETE CASCADE,
  share_quantity numeric(10, 4) NOT NULL DEFAULT 1 CHECK (share_quantity > 0),
  PRIMARY KEY (cart_item_id, participant_id)
);

CREATE TABLE IF NOT EXISTS foodrun_participant_payments (
  payment_id text PRIMARY KEY,
  room_id text NOT NULL REFERENCES foodrun_order_sessions(room_id) ON DELETE CASCADE,
  participant_id text NOT NULL REFERENCES foodrun_order_participants(participant_id) ON DELETE CASCADE,
  phone_number text NOT NULL,
  amount_cents integer NOT NULL CHECK (amount_cents > 0),
  currency text NOT NULL DEFAULT 'usd',
  stripe_payment_link_url text,
  stripe_payment_link_id text,
  status text NOT NULL DEFAULT 'pending' CHECK (
    status IN ('pending', 'sent', 'paid', 'expired', 'failed')
  ),
  metadata jsonb NOT NULL DEFAULT '{}'::jsonb,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (room_id, participant_id)
);

CREATE TABLE IF NOT EXISTS foodrun_jobs (
  job_id text PRIMARY KEY,
  room_id text NOT NULL REFERENCES foodrun_order_sessions(room_id) ON DELETE CASCADE,
  kind text NOT NULL CHECK (
    kind IN (
      'restaurant_search',
      'cart_build',
      'cart_edit',
      'checkout_payment',
      'post_order_split'
    )
  ),
  status text NOT NULL DEFAULT 'queued' CHECK (
    status IN ('queued', 'running', 'succeeded', 'failed')
  ),
  attempts integer NOT NULL DEFAULT 0 CHECK (attempts >= 0),
  run_after timestamptz NOT NULL DEFAULT now(),
  locked_at timestamptz,
  last_error text,
  payload jsonb NOT NULL DEFAULT '{}'::jsonb,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS foodrun_jobs_ready_idx
  ON foodrun_jobs (status, run_after, created_at);

CREATE TABLE IF NOT EXISTS foodrun_order_events (
  event_id bigserial PRIMARY KEY,
  room_id text REFERENCES foodrun_order_sessions(room_id) ON DELETE SET NULL,
  event_type text NOT NULL,
  actor_phone_number text,
  payload jsonb NOT NULL DEFAULT '{}'::jsonb,
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS agentphone_webhook_deliveries (
  webhook_id text PRIMARY KEY,
  event_type text NOT NULL,
  room_id text,
  payload jsonb NOT NULL DEFAULT '{}'::jsonb,
  processed_at timestamptz NOT NULL DEFAULT now()
);

CREATE OR REPLACE FUNCTION foodrun_set_updated_at()
RETURNS trigger AS $$
BEGIN
  NEW.updated_at = now();
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS foodrun_order_sessions_updated_at ON foodrun_order_sessions;
CREATE TRIGGER foodrun_order_sessions_updated_at
  BEFORE UPDATE ON foodrun_order_sessions
  FOR EACH ROW EXECUTE FUNCTION foodrun_set_updated_at();

DROP TRIGGER IF EXISTS foodrun_cart_items_updated_at ON foodrun_cart_items;
CREATE TRIGGER foodrun_cart_items_updated_at
  BEFORE UPDATE ON foodrun_cart_items
  FOR EACH ROW EXECUTE FUNCTION foodrun_set_updated_at();

DROP TRIGGER IF EXISTS foodrun_participant_payments_updated_at ON foodrun_participant_payments;
CREATE TRIGGER foodrun_participant_payments_updated_at
  BEFORE UPDATE ON foodrun_participant_payments
  FOR EACH ROW EXECUTE FUNCTION foodrun_set_updated_at();

DROP TRIGGER IF EXISTS foodrun_jobs_updated_at ON foodrun_jobs;
CREATE TRIGGER foodrun_jobs_updated_at
  BEFORE UPDATE ON foodrun_jobs
  FOR EACH ROW EXECUTE FUNCTION foodrun_set_updated_at();
