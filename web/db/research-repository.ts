import "server-only";
import { supabaseRequest, queryString } from "@/db/supabase";
import { getEdgeV2Day } from "@/db/edge-v2-repository";
import { isPublicBeforeDeadline, type EdgeRaceV2, type Snapshot } from "@/lib/edge-v2";
import { SETTINGS, STRATEGY_VERSION, minimumOdds } from "@/lib/research-terminal";

type State = "WATCH" | "BUY" | "CANCEL" | "PASS" | "SETTLED";
type Signal = { signal_id:string; race_id:string; combination:string; status:State; buy_at:string|null; buy_odds:number|null; buy_ev:number|null; created_at:string; fixed_stake_yen:number; payout_yen:number|null; hit:boolean|null };
const post = <T>(table:string, body:unknown, conflict:string) =>
  supabaseRequest<T>(table+"?on_conflict="+conflict,{method:"POST",headers:{"Prefer":"resolution=merge-duplicates,return=representation"},body:JSON.stringify(body)},"service");
const read = <T>(table:string, query:Record<string,string|number|undefined>) =>
  supabaseRequest<T>(table+"?"+queryString(query),{},"service");
const valid = (n:number) => Number.isFinite(n) && n>0;
const phaseOrder = ["t20","t15","t10"] as const;
const candidates = (race:EdgeRaceV2) => phaseOrder.flatMap(p=>race.snapshots[p]?[race.snapshots[p]!]:[])
  .filter(s=>s.combinations.length===120 && s.odds.length===120 && s.exhibition?.length===120 &&
    isPublicBeforeDeadline(race,s)).sort((a,b)=>Date.parse(a.observed_at)-Date.parse(b.observed_at));
const isCurrent = (s:Snapshot, now:number) => now>=Date.parse(s.observed_at) && now-Date.parse(s.observed_at)<=SETTINGS.maxOddsAgeMinutes*60000;
const id = (race:string, combo:string) => [race,combo,STRATEGY_VERSION].join(":");
export async function observeResearchDay(date:string) {
  const now = new Date(), at=now.toISOString();
  let strategy=await read<Array<{effective_at:string}>>("research_strategies",
    {select:"effective_at",strategy_version:"eq."+STRATEGY_VERSION,limit:1});
  if(!strategy.length) {
    await post("research_strategies",[{strategy_version:STRATEGY_VERSION,effective_at:at,settings:SETTINGS}],"strategy_version");
    strategy=await read<Array<{effective_at:string}>>("research_strategies",
      {select:"effective_at",strategy_version:"eq."+STRATEGY_VERSION,limit:1});
  }
  const inception=Date.parse(strategy[0]?.effective_at ?? at);
  const day=await getEdgeV2Day(date);
  if(!day) throw new Error("EDGE observation feed unavailable");
  const previous=await read<Signal[]>("research_signals",{select:"*",strategy_version:"eq."+STRATEGY_VERSION,
    cohort:"eq.SHADOW_FORWARD",race_id:"like.BR:"+date.replaceAll("-","")+":*",limit:1000});
  const byId=new Map(previous.map(s=>[s.signal_id,s]));
  let created=0, changed=0, settled=0;
  for(const race of Object.values(day.races)) {
    const old=previous.filter(s=>s.race_id===race.race_id);
    const observed=candidates(race).filter(s=>Date.parse(race.receipts?.[s.snapshot_id]??"")>=inception &&
      Date.parse(s.observed_at)>=inception);
    const latest=observed.at(-1);
    if(latest && Date.parse(race.start_at)>Date.now() && isCurrent(latest,Date.now())) {
      const eligible=latest.combinations.map((combination,i)=>({combination,p:latest.exhibition?.[i]??0,odds:latest.odds[i]}))
        .filter(x=>valid(x.p)&&x.p<=1&&valid(x.odds)&&x.p*x.odds>=SETTINGS.watchEv)
        .sort((a,b)=>b.p*b.odds-a.p*a.odds).slice(0,SETTINGS.maxCombinationsPerRace);
      const selected=new Set(eligible.map(x=>x.combination));
      const targets=[...eligible,...old.filter(x=>!selected.has(x.combination)&&x.status!=="SETTLED")
        .map(x=>({combination:x.combination,p:latest.exhibition?.[latest.combinations.indexOf(x.combination)]??0,
          odds:latest.odds[latest.combinations.indexOf(x.combination)]}))];
      for(const x of targets) {
        const signalId=id(race.race_id,x.combination), prior=byId.get(signalId);
        const good=valid(x.p)&&x.p<=1&&valid(x.odds);
        const raw=good?x.p*x.odds:0, conservative=raw*SETTINGS.conservativeFactor;
        const buy=selected.has(x.combination)&&raw>=SETTINGS.minimumRawEv&&conservative>=SETTINGS.minimumConservativeEv;
        const next:State=buy?"BUY":selected.has(x.combination)?"WATCH":prior?.status==="BUY"?"CANCEL":"PASS";
        const signal:Signal={signal_id:signalId,race_id:race.race_id,combination:x.combination,status:next,
          buy_at:prior?.buy_at??(buy?at:null),buy_odds:prior?.buy_odds??(buy?x.odds:null),
          buy_ev:prior?.buy_ev??(buy?conservative:null),created_at:prior?.created_at??at,
          fixed_stake_yen:100,payout_yen:prior?.payout_yen??null,hit:prior?.hit??null};
        await post("research_signals",[{...signal,model_version:"edge-full120-v2",edge_version:"edge-full120-v2",
          strategy_version:STRATEGY_VERSION,cohort:"SHADOW_FORWARD",
          watch_at:prior?undefined:next==="WATCH"?at:null,cancel_at:next==="CANCEL"?at:null}],
          "signal_id");
        if(!prior) created++; if(prior?.status!==next) changed++;
        byId.set(signalId,signal);
        const snapshotId=signalId+":"+latest.snapshot_id;
        await post("research_signal_snapshots",[{snapshot_id:snapshotId,signal_id:signalId,captured_at:at,
          source_observed_at:latest.observed_at,minutes_to_close:(Date.parse(race.start_at)-Date.parse(latest.observed_at))/60000,
          raw_probability:good?x.p:null,calibrated_probability:null,
          conservative_probability:good?x.p*SETTINGS.conservativeFactor:null,odds:valid(x.odds)?x.odds:null,
          implied_probability:valid(x.odds)?1/x.odds:null,raw_ev:good?raw:null,conservative_ev:good?conservative:null,
          minimum_buy_odds:good?minimumOdds(x.p*SETTINGS.conservativeFactor):null,
          edge_score:good?conservative-1:null,snapshot_kind:next==="BUY"?"BUY":"OBSERVED"}],"snapshot_id");
        if(prior?.status!==next) await post("research_signal_events",[{event_id:signalId+":"+latest.snapshot_id+":"+next,
          signal_id:signalId,event_at:at,old_status:prior?.status??"UNSEEN",new_status:next,
          reason:prior?.status==="BUY"?"Odds threshold lost":"Observed eligible odds",snapshot_id:snapshotId}],"event_id");
      }
    }
    if(race.result) for(const prior of old) {
      if(prior.status==="SETTLED"||!prior.buy_at) continue;
      const refunded=race.result.cancelled||race.result.refunded_lanes.some(l=>prior.combination.split("-").includes(String(l)));
      if(refunded) continue;
      const hit=prior.combination===race.result.combination, payout=hit?race.result.payout_per_100_yen:0;
      await post("research_signals",[{...prior,status:"SETTLED",settled_at:at,payout_yen:payout,hit,
        model_version:"edge-full120-v2",edge_version:"edge-full120-v2",
        strategy_version:STRATEGY_VERSION,cohort:"SHADOW_FORWARD"}],"signal_id");
      await post("research_signal_events",[{event_id:prior.signal_id+":settled",signal_id:prior.signal_id,
        event_at:at,old_status:prior.status,new_status:"SETTLED",reason:"Official result",
        snapshot_id:null}],"event_id");
      if(race.final?.odds[prior.combination]) await post("research_signal_snapshots",[{snapshot_id:prior.signal_id+":final",
        signal_id:prior.signal_id,captured_at:race.final.observed_at,source_observed_at:race.final.observed_at,
        odds:race.final.odds[prior.combination],implied_probability:1/race.final.odds[prior.combination],
        raw_probability:null,calibrated_probability:null,conservative_probability:null,
        raw_ev:null,conservative_ev:null,minimum_buy_odds:null,edge_score:null,snapshot_kind:"FINAL"}],"snapshot_id");
      settled++;
    }
  }
  return {created,changed,settled,observed_at:at};
}
export async function getForwardSignals(date?:string) {
 const rows=await read<Signal[]>("research_signals",{select:"*",strategy_version:"eq."+STRATEGY_VERSION,
   cohort:"eq.SHADOW_FORWARD",race_id:date?"like.BR:"+date.replaceAll("-","")+":*":undefined,
   order:"created_at.desc",limit:1000});
 return rows;
}
