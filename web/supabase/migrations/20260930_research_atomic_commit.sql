-- Additive only. Existing tables, observations and performance are retained.
-- One transaction serializes signal state, source snapshot and state event.
create or replace function public.research_commit_signal(
  p_signal jsonb, p_snapshot jsonb default null, p_event jsonb default null
) returns void language plpgsql security invoker set search_path = public as $$
declare
  incoming public.research_signals;
  previous_status text;
  committed_status text;
begin
  incoming := jsonb_populate_record(null::public.research_signals, p_signal);
  perform pg_advisory_xact_lock(hashtextextended(incoming.signal_id, 0));
  select status into previous_status from public.research_signals where signal_id=incoming.signal_id;
  insert into public.research_signals select incoming.*
  on conflict (signal_id) do update set
    status=case when research_signals.status='SETTLED' then 'SETTLED' else excluded.status end,
    watch_at=coalesce(research_signals.watch_at,excluded.watch_at),
    buy_at=coalesce(research_signals.buy_at,excluded.buy_at),
    buy_odds=coalesce(research_signals.buy_odds,excluded.buy_odds),
    buy_ev=coalesce(research_signals.buy_ev,excluded.buy_ev),
    cancel_at=coalesce(research_signals.cancel_at,excluded.cancel_at),
    settled_at=coalesce(research_signals.settled_at,excluded.settled_at),
    payout_yen=coalesce(research_signals.payout_yen,excluded.payout_yen),
    hit=coalesce(research_signals.hit,excluded.hit),
    refunded=research_signals.refunded or excluded.refunded
  returning status into committed_status;
  if p_snapshot is not null then
    insert into public.research_signal_snapshots
      select (jsonb_populate_record(null::public.research_signal_snapshots,p_snapshot)).*
      on conflict (snapshot_id) do nothing;
  end if;
  if p_event is not null and (previous_status is distinct from committed_status or p_snapshot is not null) then
    p_event := p_event || jsonb_build_object('old_status',coalesce(previous_status,'UNSEEN'),'new_status',committed_status);
    insert into public.research_signal_events
      select (jsonb_populate_record(null::public.research_signal_events,p_event)).*
      on conflict (event_id) do nothing;
  end if;
end $$;
revoke all on function public.research_commit_signal(jsonb,jsonb,jsonb) from public, anon, authenticated;
grant execute on function public.research_commit_signal(jsonb,jsonb,jsonb) to service_role;
