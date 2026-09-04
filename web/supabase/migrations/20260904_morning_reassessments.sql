create table if not exists public.prediction_reassessments (
  prediction_id text primary key references public.predictions(prediction_id) on delete cascade,
  race_id text not null references public.races(race_id) on delete cascade,
  status text not null check (status in ('supported', 'confirmed', 'cautious')),
  top3_overlap integer not null check (top3_overlap between 0 and 3),
  morning_percentile double precision not null check (morning_percentile between 0 and 1),
  exhibition_percentile double precision not null check (exhibition_percentile between 0 and 1),
  percentile_uplift double precision not null check (percentile_uplift between -1 and 1),
  rule_version text not null,
  observed_at timestamptz not null,
  reassessment_hash text not null check (reassessment_hash ~ '^[a-f0-9]{64}$')
);

create index if not exists prediction_reassessments_race_idx
  on public.prediction_reassessments (race_id);

alter table public.prediction_reassessments enable row level security;

drop policy if exists "Public can read prediction reassessments" on public.prediction_reassessments;
create policy "Public can read prediction reassessments"
  on public.prediction_reassessments for select to anon, authenticated using (true);

grant select on public.prediction_reassessments to anon, authenticated;
