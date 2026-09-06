-- Isolated shadow-operation storage for odds-based EDGE verification.
create table if not exists public.edge_candidates (
  edge_id text primary key, race_id text not null references public.races(race_id) on delete cascade,
  race_date date not null, venue_name text not null, venue_code text not null,
  race_no integer not null check (race_no between 1 and 12), start_at timestamptz not null,
  combination text not null check (combination ~ '^[1-6]-[1-6]-[1-6]$'),
  predicted_probability numeric not null check (predicted_probability between 0 and 1),
  odds_decimal numeric not null check (odds_decimal > 0), expected_value_percent numeric not null check (expected_value_percent >= 0),
  threshold_percent numeric not null default 150 check (threshold_percent >= 0), observed_at timestamptz not null,
  status text not null default 'open' check (status in ('open','settled','excluded')),
  result_combination text, payout_per_100_yen integer, hit boolean
);
create index if not exists edge_candidates_date_idx on public.edge_candidates (race_date, expected_value_percent desc);
alter table public.edge_candidates enable row level security;
drop policy if exists "Public can read edge candidates" on public.edge_candidates;
create policy "Public can read edge candidates" on public.edge_candidates for select to anon, authenticated using (true);
grant select on public.edge_candidates to anon, authenticated;
