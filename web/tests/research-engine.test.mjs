import assert from "node:assert/strict";
import test from "node:test";
import {readFile} from "node:fs/promises";
import ts from "typescript";
const load=async(path,dependencies)=>{
 const source=await readFile(new URL(path,import.meta.url),"utf8");
 const js=ts.transpileModule(source,{compilerOptions:{module:ts.ModuleKind.CommonJS,target:ts.ScriptTarget.ES2022}}).outputText;
 const exports={};new Function("exports","require",js)(exports,n=>{
  if(n==="server-only")return {};if(n in dependencies)return dependencies[n];throw Error(n);
 });return exports;
};
const policy=await load("../lib/research-terminal.ts",{"@/lib/edge-v2":{isPublicBeforeDeadline:()=>true}});
const {SETTINGS,requiredBuyOdds,assessCombination,validateResearchSettings}=policy;
test("minimum odds respects both raw and conservative thresholds",()=>{
 const settings={...SETTINGS,minimumRawEv:2,minimumConservativeEv:1.2};
 assert.equal(requiredBuyOdds(.1,settings),20);
 assert.equal(assessCombination(.1,19.9,settings),"WATCH");
 assert.equal(assessCombination(.1,20,settings),"BUY");
 assert.equal(assessCombination(NaN,20,settings),"PASS");
 assert.throws(()=>validateResearchSettings({...settings,stakeYen:200}));
 assert.throws(()=>validateResearchSettings({...settings,conservativeFactor:1.1}));
 assert.throws(()=>validateResearchSettings({...settings,maxCombinationsPerRace:2.5}));
});
test("future strategy scheduling appends a version and rejects past application",async()=>{
 const writes=[];
 const strategies=await load("../db/research-strategies.ts",{"@/lib/research-terminal":policy,"@/db/supabase":{
  queryString:()=>"",supabaseRequest:async(path,init)=>{if(init.method){writes.push(JSON.parse(init.body));return null;}
   return [{strategy_version:"future",effective_at:new Date(Date.now()+86400000).toISOString(),settings:SETTINGS},
    {strategy_version:"original",effective_at:"2026-01-01T00:00:00Z",settings:SETTINGS}];}
 }});
 assert.equal((await strategies.activeResearchStrategy()).strategy_version,"original");
 await assert.rejects(strategies.scheduleResearchStrategy(SETTINGS,"2026-01-01"));
 const v=await strategies.scheduleResearchStrategy(SETTINGS,new Date(Date.now()+120000).toISOString());
 assert.match(v,/^research-shadow-/);assert.equal(writes.length,1);assert.equal(writes[0].settings.stakeYen,100);
});
test("atomic ingestion retains WATCH, BUY, CANCEL, settlement, history and idempotent first BUY",async()=>{
 const combinations=[];for(let a=1;a<=6;a++)for(let b=1;b<=6;b++)for(let c=1;c<=6;c++)
  if(a!==b&&a!==c&&b!==c)combinations.push(`${a}-${b}-${c}`);
 const now=Date.now(),close=new Date(now+20*60000).toISOString(),target=combinations[0];
 const strategy={strategy_version:"test-v1",effective_at:new Date(now-86400000).toISOString(),settings:SETTINGS};
 const race={race_id:"BR:20260930:01:01",start_at:close,snapshots:{},receipts:{}};
 let day={last_tick_at:new Date(now).toISOString(),last_error:null,races:{[race.race_id]:race}};
 const signals=new Map(),snapshots=new Map(),events=new Map();
 const request=async(path,init)=>{
  const b=JSON.parse(init.body);
  if(path.startsWith("rpc/")){
   const old=signals.get(b.p_signal.signal_id),s={...b.p_signal};
   if(old){s.buy_at=old.buy_at??s.buy_at;s.buy_odds=old.buy_odds??s.buy_odds;s.buy_ev=old.buy_ev??s.buy_ev;
    if(old.status==="SETTLED")s.status="SETTLED";}
   signals.set(s.signal_id,s);
   if(b.p_snapshot&&!snapshots.has(b.p_snapshot.snapshot_id))snapshots.set(b.p_snapshot.snapshot_id,b.p_snapshot);
   if(b.p_event&&!events.has(b.p_event.event_id))events.set(b.p_event.event_id,b.p_event);
  } else if(path.startsWith("research_signal_snapshots"))for(const s of b)if(!snapshots.has(s.snapshot_id))snapshots.set(s.snapshot_id,s);
  return null;
 };
 const engine=await load("../db/research-engine.ts",{"@/db/supabase":{supabaseRequest:request},
  "@/db/edge-v2-repository":{getEdgeV2Day:async()=>day},
  "@/db/research-repository":{getForwardSignals:async()=>[...signals.values()]},
  "@/db/research-strategies":{activeResearchStrategy:async()=>strategy,researchStrategies:async()=>[strategy]},
  "@/lib/research-terminal":policy,"@/lib/edge-v2":{isPublicBeforeDeadline:(r,s)=>Date.parse(r.receipts[s.snapshot_id])<Date.parse(r.start_at)}});
 let sequence=0;
 const observe=async(phase,odds)=>{
  const observed_at=new Date(now-60000+sequence*1000).toISOString(),snapshot_id=`source-${++sequence}`;
  race.snapshots[phase]={snapshot_id,phase,observed_at,combinations,
   exhibition:combinations.map((_,i)=>i===0?.1:.9/119),odds:combinations.map((_,i)=>i===0?odds:1)};
  race.receipts[snapshot_id]=new Date(now-30000).toISOString();
  return engine.observeResearchDay("2026-09-30");
 };
 await observe("t30",12);assert.equal([...signals.values()][0].status,"WATCH");
 await observe("t20",17);assert.equal([...signals.values()][0].status,"BUY");
 const firstBuy=[...signals.values()][0].buy_at;
 await engine.observeResearchDay("2026-09-30");assert.equal(signals.size,1);
 await observe("t15",8);assert.equal([...signals.values()][0].status,"CANCEL");
 assert.equal([...signals.values()][0].buy_odds,17);assert.equal([...signals.values()][0].buy_at,firstBuy);
 assert.ok([...events.values()].some(e=>e.new_status==="WATCH"));
 assert.ok([...events.values()].some(e=>e.new_status==="BUY"));
 assert.ok([...events.values()].some(e=>e.new_status==="CANCEL"));
 race.result={combination:target,payout_per_100_yen:1800,refunded_lanes:[],cancelled:false};
 await engine.observeResearchDay("2026-09-30");assert.equal([...signals.values()][0].status,"SETTLED");
 assert.equal([...signals.values()][0].payout_yen,1800);
 race.final={observed_at:new Date(now+30*60000).toISOString(),odds:{[target]:18}};
 await engine.observeResearchDay("2026-09-30");
 assert.ok(Math.abs([...snapshots.values()].find(s=>s.snapshot_kind==="FINAL").conservative_ev-1.44)<1e-9);
 assert.equal([...snapshots.values()].filter(s=>s.snapshot_kind!=="FINAL").length,3);
 // Missing feed cancels an active signal while retaining the virtual stake for a later result.
 const s=[...signals.values()][0];signals.set(s.signal_id,{...s,status:"BUY",payout_yen:null});day=null;
 await assert.rejects(engine.observeResearchDay("2026-09-30"));assert.equal(signals.get(s.signal_id).status,"CANCEL");
 day={last_tick_at:new Date(now).toISOString(),last_error:null,races:{[race.race_id]:race}};
 signals.clear();race.result=undefined;race.final=undefined;
 race.snapshots.t15.exhibition[1]=NaN;race.snapshots.t20.exhibition[1]=NaN;race.snapshots.t30.exhibition[1]=NaN;
 await engine.observeResearchDay("2026-09-30");assert.equal(signals.size,0);
 day.last_error="Odds API stopped";await engine.observeResearchDay("2026-09-30");assert.equal(signals.size,0);
});
