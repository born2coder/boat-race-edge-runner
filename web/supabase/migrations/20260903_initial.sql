create table if not exists public.races (
  race_id text primary key,
  race_date date not null,
  venue_code text not null,
  venue_name text not null,
  race_no integer not null check (race_no between 1 and 12),
  race_name text,
  start_at timestamptz not null,
  start_time_jst text not null,
  entries jsonb not null check (jsonb_typeof(entries) = 'array' and jsonb_array_length(entries) = 6),
  source_observed_at timestamptz not null,
  status text not null default 'scheduled'
);

create index if not exists races_date_start_idx on public.races (race_date, start_at);

create table if not exists public.predictions (
  prediction_id text primary key,
  race_id text not null references public.races(race_id) on delete cascade,
  model_version text not null,
  strategy_version text not null,
  selection_score integer not null check (selection_score between 0 and 100),
  selection_reasons jsonb not null check (jsonb_typeof(selection_reasons) = 'array'),
  ranking jsonb not null check (jsonb_typeof(ranking) = 'array'),
  tickets jsonb not null check (jsonb_typeof(tickets) = 'array' and jsonb_array_length(tickets) between 3 and 8),
  virtual_stake_yen integer not null check (virtual_stake_yen = 300),
  published_at timestamptz not null,
  publication_mode text not null,
  official_performance_eligible boolean not null,
  publication_hash text not null check (publication_hash ~ '^[a-f0-9]{64}$'),
  unique (race_id, model_version, strategy_version)
);

create index if not exists predictions_published_idx on public.predictions (published_at desc);
create index if not exists predictions_mode_idx on public.predictions (publication_mode, published_at desc);

create table if not exists public.results (
  race_id text primary key references public.races(race_id) on delete cascade,
  finishers jsonb not null check (jsonb_typeof(finishers) = 'array'),
  combination text not null check (combination ~ '^[1-6]-[1-6]-[1-6]$'),
  payout_per_100_yen integer not null check (payout_per_100_yen >= 0),
  weather text,
  wind_direction text,
  wind_speed_m integer,
  wave_height_cm integer,
  observed_at timestamptz not null
);

create table if not exists public.daily_runs (
  service_date date primary key,
  status text not null,
  analyzed_count integer not null check (analyzed_count >= 0),
  recommended_count integer not null check (recommended_count between 0 and 10),
  skipped_count integer not null check (skipped_count >= 0),
  incomplete_count integer not null check (incomplete_count >= 0),
  coverage_percent integer not null check (coverage_percent between 0 and 100),
  finalized_at timestamptz not null,
  run_sha256 text not null
);

create table if not exists public.ingestion_runs (
  ingestion_id text primary key,
  service_date date not null,
  dataset text not null,
  content_sha256 text not null unique,
  status text not null,
  received_at timestamptz not null,
  race_count integer not null,
  prediction_count integer not null,
  result_count integer not null
);

create index if not exists ingestion_runs_received_idx on public.ingestion_runs (received_at desc);

create table if not exists public.ingestion_nonces (
  nonce text primary key,
  used_at timestamptz not null
);

alter table public.races enable row level security;
alter table public.predictions enable row level security;
alter table public.results enable row level security;
alter table public.daily_runs enable row level security;
alter table public.ingestion_runs enable row level security;
alter table public.ingestion_nonces enable row level security;

drop policy if exists "Public can read races" on public.races;
create policy "Public can read races" on public.races for select to anon, authenticated using (true);
drop policy if exists "Public can read predictions" on public.predictions;
create policy "Public can read predictions" on public.predictions for select to anon, authenticated using (true);
drop policy if exists "Public can read results" on public.results;
create policy "Public can read results" on public.results for select to anon, authenticated using (true);
drop policy if exists "Public can read daily runs" on public.daily_runs;
create policy "Public can read daily runs" on public.daily_runs for select to anon, authenticated using (true);

grant select on public.races, public.predictions, public.results, public.daily_runs to anon, authenticated;
revoke all on public.ingestion_runs, public.ingestion_nonces from anon, authenticated;

