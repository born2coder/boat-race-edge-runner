import "server-only";
import {supabaseRequest} from "@/db/supabase";
import {getEdgeV2Day} from "@/db/edge-v2-repository";
import {getForwardSignals,type Signal} from "@/db/research-repository";
import {activeResearchStrategy,researchStrategies} from "@/db/research-strategies";
import {isPublicBeforeDeadline,type Snapshot} from "@/lib/edge-v2";
import {SETTINGS,assessCombination,requiredBuyOdds,settlementFor} from "@/lib/research-terminal";
const positive=(n:number)=>Number.isFinite(n)&&n>0;
const phases=["t30","t20","t15","t10","t5"] as const;
const decorate=(s:Signal,at:string)=>({...s,edge_version:"edge-full120-v2",cohort:"SHADOW_FORWARD",
 settled_at:s.status==="SETTLED"?at:null});
const commit=(s:Signal,at:string,snapshot:unknown,event:unknown)=>supabaseRequest(
 "rpc/research_commit_signal",{method:"POST",body:JSON.stringify({p_signal:decorate(s,at),p_snapshot:snapshot,p_event:event})},"service");
export async function observeResearchDay(date:string) {
 const at=new Date().toISOString(),now=Date.parse(at),strategy=await activeResearchStrategy(now),settings=strategy.settings;
 await supabaseRequest("research_strategies?on_conflict=strategy_version",{method:"POST",
  headers:{Prefer:"resolution=ignore-duplicates,return=minimal"},body:JSON.stringify(strategy)},"service");
 const [day,previous,strategies]=await Promise.all([getEdgeV2Day(date),getForwardSignals(date),researchStrategies()]);
 const cancelUnavailable=async(prior:Signal,reason:string)=>{
  if(!["BUY","WATCH"].includes(prior.status))return;
  const status=prior.buy_at?"CANCEL":"PASS";
  await commit({...prior,status,cancel_at:prior.cancel_at??(status==="CANCEL"?at:null)},at,null,
   {event_id:prior.signal_id+":"+reason,signal_id:prior.signal_id,event_at:at,new_status:status,reason,snapshot_id:null});
 };
 if(!day){
  for(const prior of previous)await cancelUnavailable(prior,"EDGE observation feed unavailable");
  throw new Error("EDGE observation feed unavailable");
 }
 for(const prior of previous.filter(s=>!day.races[s.race_id]))await cancelUnavailable(prior,"Race data missing");
 const feedFresh=!!day.last_tick_at && now>=Date.parse(day.last_tick_at) &&
  now-Date.parse(day.last_tick_at)<=settings.maxOddsAgeMinutes*60000 && !day.last_error;
 const byId=new Map(previous.map(s=>[s.signal_id,s]));
 const historicalSnapshots:Record<string,unknown>[]=[];
 let created=0,changed=0,settled=0;
 for(const race of Object.values(day.races)) {
  const old=previous.filter(s=>s.race_id===race.race_id),close=Date.parse(race.start_at);
  const source=phases.flatMap(p=>race.snapshots[p]?[race.snapshots[p]!]:[])
   .filter(s=>s.combinations.length===120 && new Set(s.combinations).size===120 && s.odds.length===120 &&
    s.exhibition?.length===120 && s.exhibition.every(p=>Number.isFinite(p)&&p>=0&&p<=1) &&
    Math.abs(s.exhibition.reduce((n,p)=>n+p,0)-1)<0.01 &&
    s.odds.every(o=>Number.isFinite(o)&&o>=1) &&
    isPublicBeforeDeadline(race,s)).sort((a,b)=>Date.parse(a.observed_at)-Date.parse(b.observed_at));
  const latest=source.at(-1);
  const fresh=feedFresh && !race.result && Number.isFinite(close) && close>now && !!latest &&
   now>=Date.parse(latest.observed_at) && now-Date.parse(latest.observed_at)<=settings.maxOddsAgeMinutes*60000 &&
   Date.parse(latest.observed_at)>=Date.parse(strategy.effective_at);
  if(fresh && latest) {
   const eligible=latest.combinations.map((combination,i)=>({combination,p:latest.exhibition![i],odds:latest.odds[i]}))
    .filter(x=>assessCombination(x.p,x.odds,settings)!=="PASS")
    .sort((a,b)=>b.p*b.odds-a.p*a.odds||a.combination.localeCompare(b.combination)).slice(0,settings.maxCombinationsPerRace);
   const selected=new Set(eligible.map(x=>x.combination));
   const targets=[...eligible,...old.filter(s=>s.strategy_version===strategy.strategy_version &&
    !selected.has(s.combination)&&s.status!=="SETTLED").map(s=>{
     const i=latest.combinations.indexOf(s.combination);return {combination:s.combination,p:latest.exhibition![i],odds:latest.odds[i]};})];
   for(const x of targets) {
    const signal_id=[race.race_id,x.combination,strategy.strategy_version].join(":"),prior=byId.get(signal_id);
    const good=positive(x.p)&&x.p<=1&&positive(x.odds),raw=good?x.p*x.odds:0,ev=raw*settings.conservativeFactor;
    const decision=selected.has(x.combination)?assessCombination(x.p,x.odds,settings):"PASS";
    const next=decision==="PASS"&&prior?.buy_at?"CANCEL":decision;
    const signal:Signal={signal_id,race_id:race.race_id,combination:x.combination,model_version:"edge-full120-v2",
     strategy_version:strategy.strategy_version,status:next,created_at:prior?.created_at??at,
     watch_at:prior?.watch_at??(next==="WATCH"?at:null),buy_at:prior?.buy_at??(next==="BUY"?at:null),
     cancel_at:prior?.cancel_at??(next==="CANCEL"?at:null),buy_odds:prior?.buy_odds??(next==="BUY"?x.odds:null),
     buy_ev:prior?.buy_ev??(next==="BUY"?ev:null),fixed_stake_yen:prior?.fixed_stake_yen??100,
     payout_yen:prior?.payout_yen??null,hit:prior?.hit??null,refunded:prior?.refunded??false};
    const snapshot_id=signal_id+":"+latest.snapshot_id;
    await commit(signal,at,{snapshot_id,signal_id,captured_at:at,source_observed_at:latest.observed_at,
     minutes_to_close:(close-Date.parse(latest.observed_at))/60000,raw_probability:good?x.p:null,
     calibrated_probability:null,conservative_probability:good?x.p*settings.conservativeFactor:null,
     odds:positive(x.odds)?x.odds:null,implied_probability:positive(x.odds)?1/x.odds:null,
     raw_ev:good?raw:null,conservative_ev:good?ev:null,minimum_buy_odds:good?requiredBuyOdds(x.p,settings):null,
     edge_score:good?ev-1:null,snapshot_kind:next==="BUY"?"BUY":next==="WATCH"?"WATCH":"OBSERVED"},
     {event_id:snapshot_id+":"+next,signal_id,event_at:at,new_status:next,
      reason:prior?.status==="BUY"&&next!=="BUY"?"BUY threshold lost":"Prospective observation",snapshot_id});
    if(!prior)created++;if(prior?.status!==next)changed++;byId.set(signal_id,signal);
   }
  }
  // Persist expiry and feed failure, rather than only hiding a stale BUY in UI.
  if(!fresh || old.some(s=>s.strategy_version!==strategy.strategy_version)) {
   for(const prior of old.filter(s=>["BUY","WATCH"].includes(s.status) &&
    (!fresh||s.strategy_version!==strategy.strategy_version))) {
    if(race.result && prior.buy_at)continue;
    const status=prior.buy_at?"CANCEL":"PASS";
    const reason=close<=now?"Race closed":prior.strategy_version!==strategy.strategy_version?"Strategy replaced":
     !feedFresh?"Observation feed stale or failed":"Odds or prediction missing or stale";
    await commit({...prior,status,cancel_at:prior.cancel_at??(status==="CANCEL"?at:null)},at,null,
     {event_id:prior.signal_id+":"+reason+":"+(latest?.snapshot_id??"missing"),signal_id:prior.signal_id,
      event_at:at,new_status:status,reason,snapshot_id:null});changed++;
   }
  }
  const resultReady=race.result && (race.result.cancelled ||
   /^[1-6]-[1-6]-[1-6]$/.test(race.result.combination) && positive(race.result.payout_per_100_yen));
  if(resultReady && race.result) for(const prior of old.filter(s=>s.status!=="SETTLED")) {
   if(!prior.buy_at) {
    await commit({...prior,status:"SETTLED"},at,null,{event_id:prior.signal_id+":no-bet-settled",
     signal_id:prior.signal_id,event_at:at,new_status:"SETTLED",reason:"Official result; no virtual stake",snapshot_id:null});
    continue;
   }
   const outcome=settlementFor(prior.combination,race.result,prior.fixed_stake_yen);
   await commit({...prior,status:"SETTLED",payout_yen:outcome.payoutYen,hit:outcome.hit,refunded:outcome.refunded},at,null,
    {event_id:prior.signal_id+":settled",signal_id:prior.signal_id,event_at:at,new_status:"SETTLED",
     reason:outcome.refunded?"Official cancellation or lane refund":"Official result; first BUY fixed stake",snapshot_id:null});settled++;
  }
  // Complete history even when a candidate was first selected late or final odds arrived after settlement.
  for(const signal of [...byId.values()].filter(s=>s.race_id===race.race_id)) {
   const frozen=strategies.find(s=>s.strategy_version===signal.strategy_version)?.settings??SETTINGS;
   const history:Array<{kind:string;s:Snapshot}> = source.map(s=>({kind:"OBSERVED",s}));
   if(race.final) {
    const p=signal.buy_ev&&signal.buy_odds?signal.buy_ev/signal.buy_odds/frozen.conservativeFactor:null;
    const odds=race.final.odds[signal.combination];
    if(positive(odds)) historicalSnapshots.push({snapshot_id:signal.signal_id+":final",
      signal_id:signal.signal_id,captured_at:race.final.observed_at,source_observed_at:race.final.observed_at,
      minutes_to_close:(close-Date.parse(race.final.observed_at))/60000,odds,implied_probability:1/odds,
      raw_probability:p,calibrated_probability:null,conservative_probability:p?p*frozen.conservativeFactor:null,
      raw_ev:p?p*odds:null,conservative_ev:p?p*frozen.conservativeFactor*odds:null,
      minimum_buy_odds:p?requiredBuyOdds(p,frozen):null,edge_score:null,snapshot_kind:"FINAL"});
   }
   for(const {s} of history) {
    const i=s.combinations.indexOf(signal.combination),p=s.exhibition![i],odds=s.odds[i];
    if(!positive(p)||p>1||!positive(odds))continue;
    historicalSnapshots.push({snapshot_id:signal.signal_id+":"+s.snapshot_id,
      signal_id:signal.signal_id,captured_at:s.observed_at,source_observed_at:s.observed_at,
      minutes_to_close:(close-Date.parse(s.observed_at))/60000,raw_probability:p,calibrated_probability:null,
      conservative_probability:p*frozen.conservativeFactor,odds,implied_probability:1/odds,raw_ev:p*odds,
      conservative_ev:p*frozen.conservativeFactor*odds,minimum_buy_odds:requiredBuyOdds(p,frozen),
      edge_score:p*frozen.conservativeFactor*odds-1,snapshot_kind:"OBSERVED"});
   }
  }
 }
 if(historicalSnapshots.length)await supabaseRequest("research_signal_snapshots?on_conflict=snapshot_id",{method:"POST",
  headers:{Prefer:"resolution=ignore-duplicates,return=minimal"},body:JSON.stringify(historicalSnapshots)},"service");
 return {created,changed,settled,observed_at:at,strategy_version:strategy.strategy_version};
}
