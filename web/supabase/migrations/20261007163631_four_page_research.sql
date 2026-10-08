-- Additive only. No activation, scheduling, alteration of Phase 2 BUY records.
begin;
create table public.four_page_rule_drafts (
 draft_id text primary key,
 rule_version text not null unique,
 created_at timestamptz not null default now(),
 effective_at timestamptz not null,
 before_values jsonb not null,
 after_values jsonb not null,
 status text not null default 'draft' check(status='draft'),
 check(effective_at>created_at)
);
create table public.four_page_recording_control (
 rule_version text primary key,
 model_version text not null,
 approved_since timestamptz,
 recording_enabled boolean not null default false,
 settings jsonb not null,
 check(not recording_enabled or approved_since is not null)
);
insert into public.four_page_recording_control(rule_version,model_version,settings) values
 ('four-page-v1','edge-full120-v2','{"windowSeconds":1200,"minimumProbability":0.01,"recommendedEv":1.2,"optionalEv":1,"stakeYen":100,"maxOddsAgeSeconds":300,"conservativeFactor":0.8}');
create table public.four_page_observations (
 snapshot_id text primary key,
 race_id text not null,
 race_date date not null,
 rule_version text not null,
 model_version text not null,
 received_at timestamptz not null,
 data jsonb not null,
 check(jsonb_array_length(data->'observations')=120)
);
create index four_page_observation_race_time on public.four_page_observations(rule_version,model_version,race_date,race_id,received_at desc);
create table public.four_page_entries (
 id text primary key,
 race_id text not null,
 race_date date not null,
 rule_version text not null,
 model_version text not null,
 mode text not null check(mode in ('recommended','optional','both')),
 cohort text not null check(cohort in ('forward','backtest')),
 data jsonb not null,
 check((data->>'stakeYen')::numeric=100),
 check(data->>'outcome' in ('pending','checking','hit','miss','refunded'))
);
-- Expression uniqueness uses an index rather than a table constraint.
create unique index four_page_purchase_once on public.four_page_entries(rule_version,model_version,mode,cohort,race_id,(data->>'combination'));
create index four_page_entries_filter on public.four_page_entries(rule_version,model_version,mode,cohort,race_date,race_id);
create table public.four_page_feed_status (
 race_date date primary key,
 updated_at timestamptz not null,
 data jsonb not null
);
-- Service-only, even when default REST table grants change. No client policies.
alter table public.four_page_rule_drafts enable row level security;
alter table public.four_page_recording_control enable row level security;
alter table public.four_page_observations enable row level security;
alter table public.four_page_entries enable row level security;
alter table public.four_page_feed_status enable row level security;
revoke all on public.four_page_rule_drafts,public.four_page_recording_control,public.four_page_observations,public.four_page_entries,public.four_page_feed_status from public,anon,authenticated;
grant select,insert on public.four_page_rule_drafts to service_role;
grant select,insert,update on public.four_page_recording_control,public.four_page_observations,public.four_page_entries,public.four_page_feed_status to service_role;

create or replace function public.four_page_commit_observation(p_snapshot jsonb,p_entries jsonb) returns integer
language plpgsql security invoker set search_path='' as $$
declare c public.four_page_recording_control; e jsonb; inserted_count integer:=0; n integer; receipt timestamptz; prior_receipt timestamptz;
begin
 select * into c from public.four_page_recording_control where rule_version=p_snapshot->>'ruleVersion' and model_version=p_snapshot->>'modelVersion' for share;
 receipt:=(p_snapshot->>'receivedAt')::timestamptz;
 if c.rule_version is null or not c.recording_enabled or receipt<c.approved_since or receipt>now()+interval '5 seconds' then raise exception 'Recording is paused or not approved'; end if;
 if jsonb_array_length(p_snapshot->'observations')<>120 then raise exception 'Full 120 observations required'; end if;
 perform pg_advisory_xact_lock(hashtextextended(c.rule_version||':'||(p_snapshot->>'raceId'),0));
 if exists(select 1 from public.four_page_observations where snapshot_id=p_snapshot->>'snapshotId') then return 0; end if;
 select max(coalesce((data->>'sourceReceivedAt')::timestamptz,received_at)) into prior_receipt from public.four_page_observations where race_id=p_snapshot->>'raceId' and rule_version=c.rule_version and model_version=c.model_version;
 if coalesce((p_snapshot->>'sourceReceivedAt')::timestamptz,receipt)<prior_receipt then raise exception 'Out-of-order observation; cannot reconstruct first purchase'; end if;
 insert into public.four_page_observations(snapshot_id,race_id,race_date,rule_version,model_version,received_at,data)
 values(p_snapshot->>'snapshotId',p_snapshot->>'raceId',(p_snapshot->>'raceDate')::date,c.rule_version,c.model_version,receipt,p_snapshot);
 for e in select value from jsonb_array_elements(p_entries) loop
  if e->>'raceId'<>p_snapshot->>'raceId' or e->>'ruleVersion'<>c.rule_version or e->>'modelVersion'<>c.model_version or e->>'cohort'<>'forward' or (e->>'recordedAt')::timestamptz<>receipt or (e->>'sourceObservedAt')::timestamptz<c.approved_since or (e->>'sourceObservedAt')::timestamptz>receipt or receipt>=(e->>'closeAt')::timestamptz or (e->>'closeAt')::timestamptz-make_interval(secs=>(c.settings->>'windowSeconds')::integer)<c.approved_since or (e->>'minutesToClose')::numeric<=0 or (e->>'minutesToClose')::numeric*60>(c.settings->>'windowSeconds')::numeric or (e->>'probability')::numeric<(c.settings->>'minimumProbability')::numeric or (e->>'stakeYen')::numeric<>100 or e->>'outcome'<>'pending' or e->>'payoutYen' is not null then raise exception 'Invalid prospective purchase'; end if;
  if e->>'mode'='recommended' and (e->>'ev')::numeric<(c.settings->>'recommendedEv')::numeric then raise exception 'Invalid recommendation'; end if;
  if e->>'mode'='optional' and ((e->>'ev')::numeric<=(c.settings->>'optionalEv')::numeric or (e->>'ev')::numeric>=(c.settings->>'recommendedEv')::numeric) then raise exception 'Invalid optional purchase'; end if;
  if e->>'mode'='both' and (e->>'ev')::numeric<=(c.settings->>'optionalEv')::numeric then raise exception 'Invalid combined purchase'; end if;
  insert into public.four_page_entries(id,race_id,race_date,rule_version,model_version,mode,cohort,data)
  values(e->>'id',e->>'raceId',(e->>'raceDate')::date,c.rule_version,c.model_version,e->>'mode','forward',e)
  on conflict do nothing;
  get diagnostics n=row_count;inserted_count:=inserted_count+n;
 end loop;
 return inserted_count;
end $$;

create or replace function public.four_page_settle(p_race_id text,p_result jsonb) returns integer
language plpgsql security invoker set search_path='' as $$
declare e public.four_page_entries; refund boolean; hit boolean; new_data jsonb; n integer:=0; combo text; valid_result boolean; confirmed_at timestamptz;
begin
 begin
  confirmed_at:=(p_result->>'confirmedAt')::timestamptz;
 exception when invalid_datetime_format or datetime_field_overflow then
  confirmed_at:=null;
 end;
 combo:=p_result->>'combination';
 valid_result:=confirmed_at is not null and not coalesce((p_result->>'unsupported')::boolean,true) and combo~'^[1-6]-[1-6]-[1-6]$' and (select count(distinct x) from unnest(string_to_array(combo,'-')) x)=3 and (p_result->>'payoutPer100Yen')::numeric>0;
 for e in select * from public.four_page_entries where race_id=p_race_id and data->>'outcome' in ('pending','checking') for update loop
  refund:=confirmed_at is not null and (coalesce((p_result->>'cancelled')::boolean,false) or exists(select 1 from jsonb_array_elements_text(p_result->'refundedLanes') lane where lane=any(string_to_array(e.data->>'combination','-'))));
  if refund then new_data:=jsonb_build_object('outcome','refunded','payoutYen',(e.data->>'stakeYen')::numeric,'hit',null,'settledAt',p_result->>'confirmedAt','resultCombination',combo);
  elsif valid_result then
   hit:=e.data->>'combination'=combo;
   new_data:=jsonb_build_object('outcome',case when hit then 'hit' else 'miss' end,'hit',hit,'payoutYen',case when hit then (p_result->>'payoutPer100Yen')::numeric*(e.data->>'stakeYen')::numeric/100 else 0 end,'settledAt',p_result->>'confirmedAt','resultCombination',combo);
  else new_data:=jsonb_build_object('outcome','checking'); end if;
  update public.four_page_entries set data=data||new_data where id=e.id;n:=n+1;
 end loop;
 return n;
end $$;
revoke all on function public.four_page_commit_observation(jsonb,jsonb),public.four_page_settle(text,jsonb) from public,anon,authenticated;
grant execute on function public.four_page_commit_observation(jsonb,jsonb),public.four_page_settle(text,jsonb) to service_role;

-- Frozen first BUY values from legacy records. No new-mode reconstruction.
create view public.four_page_ledger with (security_invoker=true) as
select id,race_id,race_date,rule_version,model_version,mode,cohort,data from public.four_page_entries
union all
select s.signal_id,s.race_id,to_date(split_part(s.race_id,':',2),'YYYYMMDD'),s.strategy_version,s.model_version,'recommended','forward',
 jsonb_build_object('id',s.signal_id,'raceId',s.race_id,'raceDate',to_char(to_date(split_part(s.race_id,':',2),'YYYYMMDD'),'YYYY-MM-DD'),'venueCode',split_part(s.race_id,':',3),'raceNo',split_part(s.race_id,':',4)::integer,'combination',s.combination,'modelVersion',s.model_version,'ruleVersion',s.strategy_version,'cohort','forward','mode','recommended','recordedAt',s.buy_at,'closeAt',null,'category','recommended','probability',b.raw_probability,'calibratedProbability',b.calibrated_probability,'conservativeProbability',coalesce(b.conservative_probability,s.buy_ev/nullif(s.buy_odds,0)),'odds',s.buy_odds,'ev',s.buy_ev,'minutesToClose',b.minutes_to_close,'stakeYen',s.fixed_stake_yen,'payoutYen',s.payout_yen,'hit',s.hit,'outcome',case when s.refunded then 'refunded' when s.status='SETTLED' and s.payout_yen is not null and s.hit is not null then case when s.hit then 'hit' else 'miss' end else 'pending' end,'settledAt',s.settled_at,'finalOdds',f.odds,'resultCombination',null,'sourceObservedAt',b.source_observed_at)
from public.research_signals s
left join lateral (select raw_probability,calibrated_probability,conservative_probability,minutes_to_close,source_observed_at from public.research_signal_snapshots where signal_id=s.signal_id and snapshot_kind='BUY' order by captured_at asc,snapshot_id asc limit 1) b on true
left join lateral (select odds from public.research_signal_snapshots where signal_id=s.signal_id and snapshot_kind='FINAL' order by captured_at desc,snapshot_id desc limit 1) f on true
where s.buy_at is not null and s.cohort='SHADOW_FORWARD';
revoke all on public.four_page_ledger from public,anon,authenticated;
grant select on public.four_page_ledger to service_role;
create index if not exists research_snapshot_first_buy on public.research_signal_snapshots(signal_id,captured_at,snapshot_id) where snapshot_kind='BUY';
create index if not exists research_snapshot_final_odds on public.research_signal_snapshots(signal_id,captured_at desc,snapshot_id desc) where snapshot_kind='FINAL';
create view public.four_page_latest_observations with (security_invoker=true) as
select distinct on (rule_version,model_version,race_date,race_id) race_date,race_id,rule_version,model_version,data
from public.four_page_observations order by rule_version,model_version,race_date,race_id,received_at desc;
revoke all on public.four_page_latest_observations from public,anon,authenticated;
grant select on public.four_page_latest_observations to service_role;
create index if not exists research_signals_four_page_period on public.research_signals(strategy_version,model_version,race_id) where buy_at is not null and cohort='SHADOW_FORWARD';
-- Compact per-entry audit data. Never send all 120 combinations to a history browser.
create or replace function public.four_page_entry_events(p_ids text[]) returns table(id text,events jsonb)
language sql stable security invoker set search_path='' as $$
 select e.id,coalesce((select jsonb_agg(jsonb_build_object('at',o.received_at,'label',case a->>'category' when 'recommended' then '購入推奨' when 'optional' then '買ってもよい' else '非掲載・推奨解除' end,'odds',v->'odds','ev',a->'ev') order by o.received_at,o.snapshot_id)
 from public.four_page_observations o
 cross join lateral jsonb_array_elements(o.data->'assessments') a
 cross join lateral jsonb_array_elements(o.data->'observations') v
 where o.race_id=e.race_id and o.rule_version=e.rule_version and o.model_version=e.model_version and a->>'combination'=e.data->>'combination' and v->>'combination'=e.data->>'combination'),'[]'::jsonb)
 from public.four_page_entries e where e.id=any(p_ids);
$$;
revoke all on function public.four_page_entry_events(text[]) from public,anon,authenticated;
grant execute on function public.four_page_entry_events(text[]) to service_role;
create view public.four_page_model_versions with (security_invoker=true) as
select distinct model_version from public.four_page_entries
union select distinct model_version from public.research_signals where buy_at is not null and cohort='SHADOW_FORWARD';
revoke all on public.four_page_model_versions from public,anon,authenticated;
grant select on public.four_page_model_versions to service_role;
commit;
