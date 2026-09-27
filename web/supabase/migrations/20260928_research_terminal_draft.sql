-- Research Terminal Phase 2: additive schema only.
-- Apply only after a verified production database backup and row-count baseline.
-- Existing races, predictions, results and edge_candidates are untouched.
create table if not exists public.research_strategies (
  strategy_version text primary key,
  effective_at timestamptz not null,
  settings jsonb not null,
  created_at timestamptz not null default now()
);
create table if not exists public.research_signals (
  signal_id text primary key,
  race_id text not null references public.races(race_id),
  combination text not null check (combination ~ '^[1-6]-[1-6]-[1-6]$'),
  model_version text not null,
  edge_version text not null,
  strategy_version text not null references public.research_strategies(strategy_version),
  cohort text not null check (cohort in ('BACKTEST','SHADOW_FORWARD','LIVE','LEGACY')),
  status text not null check (status in ('UNSEEN','WATCH','BUY','CANCEL','PASS','SETTLED')),
  created_at timestamptz not null,
  watch_at timestamptz,
  buy_at timestamptz,
  cancel_at timestamptz,
  settled_at timestamptz,
  buy_odds numeric check (buy_odds > 0),
  buy_ev numeric,
  fixed_stake_yen integer not null default 100 check (fixed_stake_yen > 0),
  payout_yen integer check (payout_yen >= 0),
  hit boolean,
  unique (race_id, combination, model_version, edge_version, strategy_version, cohort)
);
create index if not exists research_signals_created_idx on public.research_signals (created_at desc);
create index if not exists research_signals_status_idx on public.research_signals (status, created_at desc);
create table if not exists public.research_signal_snapshots (
  snapshot_id text primary key,
  signal_id text not null references public.research_signals(signal_id),
  captured_at timestamptz not null,
  minutes_to_close numeric,
  source_observed_at timestamptz,
  raw_probability numeric check (raw_probability between 0 and 1),
  calibrated_probability numeric check (calibrated_probability between 0 and 1),
  conservative_probability numeric check (conservative_probability between 0 and 1),
  odds numeric check (odds > 0),
  implied_probability numeric check (implied_probability between 0 and 1),
  raw_ev numeric,
  conservative_ev numeric,
  minimum_buy_odds numeric,
  edge_score numeric,
  snapshot_kind text not null check (snapshot_kind in ('OBSERVED','WATCH','BUY','FINAL')),
  unique (signal_id, captured_at, snapshot_kind)
);
create index if not exists research_snapshots_signal_time_idx on public.research_signal_snapshots (signal_id, captured_at);
create table if not exists public.research_signal_events (
  event_id text primary key,
  signal_id text not null references public.research_signals(signal_id),
  event_at timestamptz not null,
  old_status text,
  new_status text not null check (new_status in ('UNSEEN','WATCH','BUY','CANCEL','PASS','SETTLED')),
  reason text not null,
  snapshot_id text references public.research_signal_snapshots(snapshot_id)
);
create index if not exists research_events_signal_time_idx on public.research_signal_events (signal_id, event_at);
create table if not exists public.research_feed_health (
  feed_name text primary key,
  observed_at timestamptz not null,
  status text not null check (status in ('OK','STALE','ERROR')),
  details jsonb not null default '{}'::jsonb
);
alter table public.research_strategies enable row level security;
alter table public.research_signals enable row level security;
alter table public.research_signal_snapshots enable row level security;
alter table public.research_signal_events enable row level security;
alter table public.research_feed_health enable row level security;
-- No anon/authenticated grants: research records remain server-only until access control is configured.
