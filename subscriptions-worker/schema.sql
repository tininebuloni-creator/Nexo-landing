PRAGMA foreign_keys = ON;

CREATE TABLE IF NOT EXISTS customers (
  id TEXT PRIMARY KEY,
  name TEXT NOT NULL,
  email TEXT,
  whatsapp TEXT,
  created_at TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS subscriptions (
  id TEXT PRIMARY KEY,
  customer_id TEXT NOT NULL REFERENCES customers(id),
  license_id TEXT NOT NULL UNIQUE,
  product TEXT NOT NULL DEFAULT 'pampa-agro',
  plan TEXT NOT NULL CHECK (plan IN ('basica', 'profesional', 'premium')),
  status TEXT NOT NULL CHECK (status IN ('active', 'past_due', 'suspended', 'cancelled')),
  device_limit INTEGER NOT NULL DEFAULT 1,
  starts_at TEXT NOT NULL,
  paid_until TEXT NOT NULL,
  grace_until TEXT NOT NULL,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS payments (
  id TEXT PRIMARY KEY,
  subscription_id TEXT NOT NULL REFERENCES subscriptions(id),
  provider TEXT NOT NULL,
  provider_payment_id TEXT,
  method TEXT NOT NULL,
  amount_cents INTEGER,
  currency TEXT NOT NULL DEFAULT 'ARS',
  paid_at TEXT NOT NULL,
  period_days INTEGER NOT NULL,
  reference TEXT,
  created_at TEXT NOT NULL,
  UNIQUE(provider, provider_payment_id)
);

CREATE TABLE IF NOT EXISTS devices (
  subscription_id TEXT NOT NULL REFERENCES subscriptions(id),
  device_id TEXT NOT NULL,
  first_seen_at TEXT NOT NULL,
  last_seen_at TEXT NOT NULL,
  PRIMARY KEY (subscription_id, device_id)
);

CREATE TABLE IF NOT EXISTS notifications (
  id TEXT PRIMARY KEY,
  subscription_id TEXT NOT NULL REFERENCES subscriptions(id),
  recipient TEXT NOT NULL,
  kind TEXT NOT NULL,
  scheduled_for TEXT NOT NULL,
  sent_at TEXT NOT NULL,
  UNIQUE (subscription_id, recipient, kind, scheduled_for)
);

CREATE INDEX IF NOT EXISTS subscriptions_due_idx ON subscriptions(status, paid_until);
CREATE INDEX IF NOT EXISTS payments_subscription_idx ON payments(subscription_id, paid_at);