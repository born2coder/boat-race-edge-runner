begin;
-- One durable admission/CPU ledger per JST day. Defaults never activate recording.
create table public.four_page_flow_budget (
 race_date date primary key,
 requests integer not null default 0 check(requests>=0),
 cpu_ms bigint not null default 0 check(cpu_ms>=0),
 lease_id uuid,
 lease_until timestamptz,
 last_started_at timestamptz,
 stopped_reason text
);
alter table public.four_page_flow_budget enable row level security;
revoke all on public.four_page_flow_budget from public,anon,authenticated;
grant select,insert,update on public.four_page_flow_budget to service_role;

create function public.four_page_flow_begin(p_lease uuid) returns text
language plpgsql security invoker set search_path='' as $$
declare c public.four_page_recording_control; b public.four_page_flow_budget;
 d date:=(now() at time zone 'Asia/Tokyo')::date;
begin
 -- Both RPCs lock control before budget to prevent lock-order inversion.
 select * into c from public.four_page_recording_control where rule_version='four-page-v1' for update;
 if c.rule_version is null or not c.recording_enabled or c.approved_since is null then return 'paused'; end if;
 insert into public.four_page_flow_budget(race_date) values(d) on conflict do nothing;
 select * into b from public.four_page_flow_budget where race_date=d for update;
 if b.lease_id is not null then
  if b.lease_until>now() then return 'busy'; end if;
  -- An unfinished request stops the flow; never retry a timeout blindly.
  update public.four_page_flow_budget set cpu_ms=cpu_ms+30000,stopped_reason='unfinished_request' where race_date=d;
  update public.four_page_recording_control set recording_enabled=false where rule_version=c.rule_version;
  return 'paused';
 end if;
 if b.cpu_ms>=60000 or b.requests>=1000 or b.stopped_reason is not null then
  update public.four_page_recording_control set recording_enabled=false where rule_version=c.rule_version;
  return 'paused';
 end if;
 if b.last_started_at>now()-interval '40 seconds' then return 'rate_limited'; end if;
 update public.four_page_flow_budget set requests=requests+1,lease_id=p_lease,lease_until=now()+interval '90 seconds',last_started_at=now() where race_date=d;
 return 'accepted';
end $$;

create function public.four_page_flow_end(p_lease uuid,p_cpu_ms bigint,p_failed boolean) returns boolean
language plpgsql security invoker set search_path='' as $$
declare c public.four_page_recording_control; b public.four_page_flow_budget; stop boolean;
begin
 select * into c from public.four_page_recording_control where rule_version='four-page-v1' for update;
 select * into b from public.four_page_flow_budget where lease_id=p_lease for update;
 if b.race_date is null then raise exception 'Unknown flow lease'; end if;
 stop:=p_failed or b.cpu_ms+greatest(0,p_cpu_ms)>=60000 or b.requests>=1000;
 update public.four_page_flow_budget set cpu_ms=cpu_ms+greatest(0,p_cpu_ms),lease_id=null,lease_until=null,
 stopped_reason=case when p_failed then 'request_failed' when stop then 'daily_budget' else null end where race_date=b.race_date;
 if stop then update public.four_page_recording_control set recording_enabled=false where rule_version=c.rule_version; end if;
 return not stop;
end $$;
revoke all on function public.four_page_flow_begin(uuid),public.four_page_flow_end(uuid,bigint,boolean) from public,anon,authenticated;
grant execute on function public.four_page_flow_begin(uuid),public.four_page_flow_end(uuid,bigint,boolean) to service_role;

-- Only active windows, compact observations and no assessments in a page read.
create view public.four_page_active_observations with(security_invoker=true) as
 select race_date,rule_version,model_version,jsonb_build_object('observations',data->'observations') data
 from public.four_page_latest_observations
 where (data->'observations'->0->>'closeAt')::timestamptz>now()
 and (data->'observations'->0->>'closeAt')::timestamptz<=now()+interval '20 minutes';
revoke all on public.four_page_active_observations from public,anon,authenticated;
grant select on public.four_page_active_observations to service_role;
commit;
