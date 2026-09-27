-- A cancelled or refunded race must never be counted as a losing bet.
-- Additive change; historical research rows remain untouched.
alter table public.research_signals
  add column if not exists refunded boolean not null default false;
