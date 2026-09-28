import assert from "node:assert/strict";
import test from "node:test";
import {readFile} from "node:fs/promises";
import {createRequire} from "node:module";
import ts from "typescript";
const require=createRequire(import.meta.url);
const source=await readFile(new URL("../lib/research-terminal.ts",import.meta.url),"utf8");
const js=ts.transpileModule(source,{compilerOptions:{module:ts.ModuleKind.CommonJS,target:ts.ScriptTarget.ES2022}}).outputText;
const exports={};
new Function("exports","require",js)(exports,name=>name==="@/lib/edge-v2"?
 {isPublicBeforeDeadline:(race,s)=>Date.parse(race.receipts?.[s.snapshot_id]??"")<Date.parse(race.start_at)}:require(name));
const {raceSignals,historicalDaySignals,minimumOdds,isFresh,forwardPerformance,settlementFor}=exports;
const close=Date.parse("2026-09-29T10:00:00Z");
const combinations=[];
for(let a=1;a<=6;a++)for(let b=1;b<=6;b++)for(let c=1;c<=6;c++)
 if(a!==b&&a!==c&&b!==c)combinations.push(a+"-"+b+"-"+c);
const target="1-2-3",pos=combinations.indexOf(target);
const snap=(phase,m,odds)=>({
 snapshot_id:phase,phase,observed_at:new Date(close-m*60000).toISOString(),
 combinations,odds:combinations.map((_,i)=>i===pos?odds:1),
 morning:combinations.map(()=>.001),exhibition:combinations.map((_,i)=>i===pos?.1:.001)
});
const race={race_id:"BR:20260929:01:01",race_date:"2026-09-29",venue_code:"01",venue:"桐生",race_no:1,
 start_at:new Date(close).toISOString(),snapshots:{t20:snap("t20",20,12),t15:snap("t15",15,17),t10:snap("t10",10,8)},
 receipts:{t20:new Date(close-19*60000).toISOString(),t15:new Date(close-14*60000).toISOString(),
 t10:new Date(close-9*60000).toISOString()}};
test("WATCH to BUY to CANCEL keeps original first BUY odds and event times",()=>{
 const signals=raceSignals(race,close-8*60000);
 const s=signals.find(x=>x.combination===target);
 assert.ok(s);
 assert.deepEqual(s.events.map(x=>x.status),["WATCH","BUY","CANCEL"]);
 assert.equal(s.buyOdds,17);
 assert.ok(Math.abs(s.buyEv-1.36)<1e-9);
 assert.equal(s.status,"PASS");
 assert.equal(s.minimumOdds,15);
});
test("minimum purchase odds and feed freshness fail closed",()=>{
 assert.equal(minimumOdds(.08),15);
 assert.equal(minimumOdds(0),Infinity);
 assert.equal(isFresh("invalid",close),false);
 assert.equal(isFresh(new Date(close-6*60000).toISOString(),close),false);
});
test("historical log reconstructs pre-deadline observations without promoting them to forward signals",()=>{
 const withoutReceipts={...race,receipts:{}};
 assert.equal(raceSignals(withoutReceipts,close).length,0);
 assert.ok(historicalDaySignals({races:{[race.race_id]:withoutReceipts}},close).length>0);
});
test("late result and no payout are excluded from realized ROI",()=>{
 const p=forwardPerformance([{buyAt:"t",stakeYen:100,payoutYen:180,hit:true},{buyAt:"t",stakeYen:100,payoutYen:0,hit:false},{buyAt:"t"}]);
 assert.equal(p.settled,2);assert.equal(p.roi,.9);assert.equal(p.hits,1);
});

test("race cancellation and lane refund return the stake without a hit or loss",()=>{
 const result={cancelled:true,refunded_lanes:[],combination:"1-2-3",payout_per_100_yen:480};
 assert.deepEqual(settlementFor("1-2-3",result),{refunded:true,hit:null,payoutYen:100});
 assert.deepEqual(settlementFor("1-2-3",{...result,cancelled:false,refunded_lanes:[2]}),
  {refunded:true,hit:null,payoutYen:100});
 assert.deepEqual(settlementFor("1-2-3",{...result,cancelled:false}),
  {refunded:false,hit:true,payoutYen:480});
});
