import "server-only";
import { supabaseRequest, queryString } from "@/db/supabase";
import { getEdgeV2Day } from "@/db/edge-v2-repository";
import { isPublicBeforeDeadline, type EdgeDayV2, type EdgeRaceV2, type Snapshot } from "@/lib/edge-v2";
import { SETTINGS, STRATEGY_VERSION, minimumOdds, settlementFor, type ResearchSignal } from "@/lib/research-terminal";

type State = "WATCH" | "BUY" | "CANCEL" | "PASS" | "SETTLED";
export type Signal = { signal_id:string; race_id:string; combination:string; model_version:string; strategy_version:string; status:State; watch_at:string|null; cancel_at:string|null; buy_at:string|null; buy_odds:number|null; buy_ev:number|null; created_at:string; fixed_stake_yen:number; payout_yen:number|null; hit:boolean|null; refunded:boolean }
const post = <T>(table:string, body:unknown, conflict:string) =>
  supabaseRequest<T>(table+"?on_conflict="+conflict,{method:"POST",headers:{"Prefer":"resolution=merge-duplicates,return=representation"},body:JSON.stringify(body)},"service");
const postIgnore = <T>(table:string, body:unknown, conflict:string) =>
  supabaseRequest<T>(table+"?on_conflict="+conflict,{method:"POST",headers:{"Prefer":"resolution=ignore-duplicates,return=minimal"},body:JSON.stringify(body)},"service");
const read = <T>(table:string, query:Record<string,string|number|undefined>) =>
  supabaseRequest<T>(table+"?"+queryString(query),{},"service");
const valid = (n:number) => Number.isFinite(n) && n>0;
const phaseOrder = ["t20","t15","t10"] as const;
const candidates = (race:EdgeRaceV2) => phaseOrder.flatMap(p=>race.snapshots[p]?[race.snapshots[p]!]:[])
  .filter(s=>s.combinations.length===120 && s.odds.length===120 && s.exhibition?.length===120 &&
    isPublicBeforeDeadline(race,s)).sort((a,b)=>Date.parse(a.observed_at)-Date.parse(b.observed_at));
const isCurrent = (s:Snapshot, now:number) => now>=Date.parse(s.observed_at) && now-Date.parse(s.observed_at)<=SETTINGS.maxOddsAgeMinutes*60000;
const id = (race:string, combo:string) => [race,combo,STRATEGY_VERSION].join(":");
// Frozen original implementation retained as a baseline for historical comparison.
// Scheduled ingestion uses the atomic Phase 2 engine exported below.
export async function observeLegacyResearchBaseline(date:string) {
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
        const next:State=buy?"BUY":selected.has(x.combination)?"WATCH":prior?.buy_at?"CANCEL":"PASS";
        const signal:Signal={signal_id:signalId,race_id:race.race_id,combination:x.combination,status:next,
          model_version:"edge-full120-v2",strategy_version:STRATEGY_VERSION,
          watch_at:prior?.watch_at??(next==="WATCH"?at:null),cancel_at:prior?.cancel_at??(next==="CANCEL"?at:null),
          buy_at:prior?.buy_at??(buy?at:null),buy_odds:prior?.buy_odds??(buy?x.odds:null),
          buy_ev:prior?.buy_ev??(buy?conservative:null),created_at:prior?.created_at??at,
          fixed_stake_yen:100,payout_yen:prior?.payout_yen??null,hit:prior?.hit??null,refunded:prior?.refunded??false};
        await post("research_signals",[{...signal,model_version:"edge-full120-v2",edge_version:"edge-full120-v2",
          strategy_version:STRATEGY_VERSION,cohort:"SHADOW_FORWARD"}],
          "signal_id");
        if(!prior) created++; if(prior?.status!==next) changed++;
        byId.set(signalId,signal);
        const snapshotId=signalId+":"+latest.snapshot_id;
        await postIgnore("research_signal_snapshots",[{snapshot_id:snapshotId,signal_id:signalId,captured_at:at,
          source_observed_at:latest.observed_at,minutes_to_close:(Date.parse(race.start_at)-Date.parse(latest.observed_at))/60000,
          raw_probability:good?x.p:null,calibrated_probability:null,
          conservative_probability:good?x.p*SETTINGS.conservativeFactor:null,odds:valid(x.odds)?x.odds:null,
          implied_probability:valid(x.odds)?1/x.odds:null,raw_ev:good?raw:null,conservative_ev:good?conservative:null,
          minimum_buy_odds:good?minimumOdds(x.p*SETTINGS.conservativeFactor):null,
          edge_score:good?conservative-1:null,snapshot_kind:next==="BUY"?"BUY":"OBSERVED"}],"snapshot_id");
        if(prior?.status!==next) await postIgnore("research_signal_events",[{event_id:signalId+":"+latest.snapshot_id+":"+next,
          signal_id:signalId,event_at:at,old_status:prior?.status??"UNSEEN",new_status:next,
          reason:prior?.status==="BUY"?"Odds threshold lost":"Observed eligible odds",snapshot_id:snapshotId}],"event_id");
      }
    }
    if(race.result) for(const prior of old) {
      if(prior.status==="SETTLED"||!prior.buy_at) continue;
      const outcome=settlementFor(prior.combination,race.result,prior.fixed_stake_yen);
      if(outcome.refunded) {
        await post("research_signals",[{...prior,status:"SETTLED",settled_at:at,
          payout_yen:outcome.payoutYen,hit:outcome.hit,refunded:true,
          edge_version:"edge-full120-v2",cohort:"SHADOW_FORWARD"}],"signal_id");
        await postIgnore("research_signal_events",[{event_id:prior.signal_id+":refunded",
          signal_id:prior.signal_id,event_at:at,old_status:prior.status,new_status:"SETTLED",
          reason:"Official cancellation or lane refund",snapshot_id:null}],"event_id");
        settled++;
        continue;
      }
      await post("research_signals",[{...prior,status:"SETTLED",settled_at:at,payout_yen:outcome.payoutYen,hit:outcome.hit,refunded:false,
        model_version:"edge-full120-v2",edge_version:"edge-full120-v2",
        strategy_version:STRATEGY_VERSION,cohort:"SHADOW_FORWARD"}],"signal_id");
      await post("research_signal_events",[{event_id:prior.signal_id+":settled",signal_id:prior.signal_id,
        event_at:at,old_status:prior.status,new_status:"SETTLED",reason:"Official result",
        snapshot_id:null}],"event_id");
      if(race.final?.odds[prior.combination]) await post("research_signal_snapshots",[{snapshot_id:prior.signal_id+":final",
        signal_id:prior.signal_id,captured_at:race.final.observed_at,source_observed_at:race.final.observed_at,
        odds:race.final.odds[prior.combination],implied_probability:1/race.final.odds[prior.combination],
        raw_probability:prior.buy_ev&&prior.buy_odds?prior.buy_ev/prior.buy_odds/SETTINGS.conservativeFactor:null,
        calibrated_probability:null,conservative_probability:prior.buy_ev&&prior.buy_odds?prior.buy_ev/prior.buy_odds:null,
        raw_ev:prior.buy_ev&&prior.buy_odds?prior.buy_ev/prior.buy_odds/SETTINGS.conservativeFactor*race.final.odds[prior.combination]:null,
        conservative_ev:prior.buy_ev&&prior.buy_odds?prior.buy_ev/prior.buy_odds*race.final.odds[prior.combination]:null,
        minimum_buy_odds:prior.buy_ev&&prior.buy_odds?minimumOdds(prior.buy_ev/prior.buy_odds):null,
        edge_score:null,snapshot_kind:"FINAL"}],"snapshot_id");
      settled++;
    }
    if(race.final) for(const prior of old.filter(x=>x.buy_at && x.status==="SETTLED" && !x.refunded)) {
      const finalOdds=race.final.odds[prior.combination];
      if(!valid(finalOdds)) continue;
      const frozenProbability=prior.buy_ev && prior.buy_odds ? prior.buy_ev/prior.buy_odds : null;
      await postIgnore("research_signal_snapshots",[{snapshot_id:prior.signal_id+":final",
        signal_id:prior.signal_id,captured_at:race.final.observed_at,source_observed_at:race.final.observed_at,
        odds:finalOdds,implied_probability:1/finalOdds,
        raw_probability:frozenProbability?frozenProbability/SETTINGS.conservativeFactor:null,
        calibrated_probability:null,conservative_probability:frozenProbability,
        raw_ev:frozenProbability?frozenProbability/SETTINGS.conservativeFactor*finalOdds:null,
        conservative_ev:frozenProbability?frozenProbability*finalOdds:null,
        minimum_buy_odds:frozenProbability?minimumOdds(frozenProbability):null,
        edge_score:null,snapshot_kind:"FINAL"}],"snapshot_id");
    }
  }
  return {created,changed,settled,observed_at:at};
}
export async function getForwardSignals(date?:string,strategyVersion?:string) {
 const result:Signal[]=[];
 for(let offset=0;offset<200000;offset+=1000) {
   const rows=await read<Signal[]>("research_signals",{select:"*",strategy_version:strategyVersion?"eq."+strategyVersion:undefined,
     cohort:"eq.SHADOW_FORWARD",race_id:date?"like.BR:"+date.replaceAll("-","")+":*":undefined,
     order:"created_at.desc",offset,limit:1000});
   result.push(...rows);
   if(rows.length<1000)break;
 }
 return result;
}

export async function getForwardDetails(date:string) {
 const signals=await getForwardSignals(date);
 const ids=signals.map(x=>x.signal_id);
 if(!ids.length)return {signals,events:[],snapshots:[]};
 type Event={signal_id:string;event_at:string;old_status:string;new_status:string;reason:string};
 type Odds={signal_id:string;captured_at:string;source_observed_at:string;minutes_to_close:number;odds:number;raw_probability:number;
   conservative_probability:number;raw_ev:number;conservative_ev:number;minimum_buy_odds:number;snapshot_kind:string};
 const groups=Array.from({length:Math.ceil(ids.length/40)},(_,i)=>ids.slice(i*40,i*40+40));
 const paginate=async<T>(table:string,select:string,order:string,group:string[])=>{
   const filter="in.("+group.map(x=>'"'+x.replaceAll('"','')+'"').join(",")+")";
   const all:T[]=[];
   for(let offset=0;offset<20000;offset+=1000){
     const rows=await read<T[]>(table,{select,signal_id:filter,order,offset,limit:1000});
     all.push(...rows);if(rows.length<1000)break;
   }
   return all;
 };
 const batch=await Promise.all(groups.map(async group=>Promise.all([
   paginate<Event>("research_signal_events","signal_id,event_at,old_status,new_status,reason","event_at.asc",group),
   paginate<Odds>("research_signal_snapshots","signal_id,captured_at,source_observed_at,minutes_to_close,odds,raw_probability,conservative_probability,raw_ev,conservative_ev,minimum_buy_odds,snapshot_kind","source_observed_at.asc",group),
 ])));
 return {signals,events:batch.flatMap(x=>x[0]),snapshots:batch.flatMap(x=>x[1])};
}

export type ForwardDetails=Awaited<ReturnType<typeof getForwardDetails>>;
export function committedCandidates(day:EdgeDayV2|null, ledger:ForwardDetails, now=Date.now(),
 strategyVersion?:string,settings:import("@/lib/research-terminal").ResearchSettings=SETTINGS):ResearchSignal[] {
 if(!day || day.last_error || !Number.isFinite(Date.parse(day.last_tick_at??"")) || now<Date.parse(day.last_tick_at!) || now-Date.parse(day.last_tick_at!)>settings.maxOddsAgeMinutes*60000)return [];
 return ledger.signals.flatMap(s=>{
  const race=day.races[s.race_id];
  const latest=ledger.snapshots.filter(x=>x.signal_id===s.signal_id&&x.snapshot_kind!=="FINAL").at(-1);
  if(!race||!latest||!["BUY","WATCH"].includes(s.status)|| (strategyVersion&&s.strategy_version!==strategyVersion)||
    !Number.isFinite(Date.parse(race.start_at))||Date.parse(race.start_at)<=now||
    !Number.isFinite(Date.parse(latest.source_observed_at))||now<Date.parse(latest.source_observed_at)||now-Date.parse(latest.source_observed_at)>settings.maxOddsAgeMinutes*60000)
    return [];
  return [{id:s.signal_id,race,combination:s.combination,probability:latest.raw_probability,
    conservativeProbability:latest.conservative_probability,odds:latest.odds,rawEv:latest.raw_ev,
    conservativeEv:latest.conservative_ev,minimumOdds:latest.minimum_buy_odds,status:s.status,
    observedAt:latest.source_observed_at,
    events:ledger.events.filter(e=>e.signal_id===s.signal_id).map(e=>({
      status:e.new_status as ResearchSignal["status"],at:e.event_at,reason:e.reason,
      odds:latest.odds,ev:latest.conservative_ev})),
    buyAt:s.buy_at??undefined,buyOdds:s.buy_odds??undefined,buyEv:s.buy_ev??undefined,
    payoutYen:s.payout_yen??undefined,hit:s.hit??undefined,stakeYen:s.buy_at?s.fixed_stake_yen:undefined
  } as ResearchSignal];
 });
}

export async function getForwardBuySnapshots() {
 const result:Array<{signal_id:string;captured_at:string;minutes_to_close:number;source_observed_at:string}>=[];
 for(let offset=0;offset<200000;offset+=1000) {
  const rows=await read<typeof result>("research_signal_snapshots",{
    select:"signal_id,captured_at,minutes_to_close,source_observed_at",snapshot_kind:"eq.BUY",
    order:"captured_at.asc",offset,limit:1000});
  result.push(...rows);
  if(rows.length<1000)break;
 }
 return result;
}

export function getResearchStrategies() {
 return read<Array<{strategy_version:string;effective_at:string;settings:Record<string,unknown>}>>(
  "research_strategies",{select:"strategy_version,effective_at,settings",order:"effective_at.desc",limit:100});
}
export {observeResearchDay} from "@/db/research-engine";
