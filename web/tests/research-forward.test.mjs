import test from "node:test";
import assert from "node:assert/strict";
import ts from "typescript";
import { readFile } from "node:fs/promises";
import { createRequire } from "node:module";
import { createHmac } from "node:crypto";
import { policy as p } from "./four-page/load-policy.mjs";
const require = createRequire(import.meta.url);
const compile=async path=>ts.transpileModule(await readFile(new URL(path,import.meta.url),"utf8"),{
  compilerOptions:{module:ts.ModuleKind.CommonJS,target:ts.ScriptTarget.ES2022}}).outputText;
const routeJs=await compile("../app/api/internal/research-forward/route.ts"),payloadJs=await compile("../lib/research-forward-payload.ts");
function route(handler,writer={recordObservation:async()=>0,settleRecordedRace:async()=>0}) {
  const out={}; const resolve=name=> {
    if(name==="@/lib/four-page"||name==="./four-page")return p;
    if(name==="@/db/supabase")return {supabaseRequest:handler,SupabaseError:class extends Error{}};
    if(name==="@/db/four-page-writer")return writer;
    if(name==="@/lib/four-page-source")return {observationsFromSavedRace:()=>[]};
    if(name==="@/lib/research-forward-payload"){const v={};new Function("exports","require",payloadJs)(v,resolve);return v;}
    return require(name);
  };new Function("exports","require",routeJs)(out,resolve);return out;
}
const body=()=>({date:p.jstDate(),observations:[],results:[],progress:{ended:0,remaining:0,confirming:0,cancelled:0}});
function request(value,wrong=false) {
  const raw=JSON.stringify(value),timestamp=String(Math.floor(Date.now()/1000)),nonce="1".repeat(32);
  const signature=createHmac("sha256","test-only").update(`${timestamp}.${nonce}.${raw}`).digest("hex");
  return new Request("http://localhost/api/internal/research-forward",{method:"POST",body:raw,headers:{
    "x-edge-timestamp":timestamp,"x-edge-nonce":nonce,"x-edge-signature":wrong ? "0".repeat(64):signature}});
}
test("forward admission authenticates, validates current date and caps before DB",async()=>{
  const old={secret:process.env.INGEST_SECRET,gate:process.env.RESEARCH_FOUR_PAGE_RECORDING};
  process.env.INGEST_SECRET="test-only";process.env.RESEARCH_FOUR_PAGE_RECORDING="1";
  try {
    let calls=0;const r=route(async()=>{calls++;throw Error("unexpected DB");});
    assert.equal((await r.POST(request(body(),true))).status,401);
    assert.equal((await r.POST(request({...body(),date:"2000-01-01"}))).status,400);
    assert.equal((await r.POST(request({...body(),observations:Array(25).fill({})}))).status,400);
    assert.equal(calls,0);
    process.env.RESEARCH_FOUR_PAGE_RECORDING="0";
    assert.equal((await r.POST(request(body()))).status,503);assert.equal(calls,0);
  } finally {for(const [key,value] of [["INGEST_SECRET",old.secret],["RESEARCH_FOUR_PAGE_RECORDING",old.gate]])value===undefined?delete process.env[key]:process.env[key]=value;}
});
test("forward success meters CPU and failure permanently completes lease as failed",async()=>{
  const old={secret:process.env.INGEST_SECRET,gate:process.env.RESEARCH_FOUR_PAGE_RECORDING};
  process.env.INGEST_SECRET="test-only";process.env.RESEARCH_FOUR_PAGE_RECORDING="1";
  try {
    const calls=[];let fail=false;
    const r=route(async(path,init)=>{
      calls.push({path,body:JSON.parse(init.body)});
      if(path==="rpc/four_page_flow_begin")return "accepted";
      if(path.startsWith("four_page_feed_status")&&fail)throw Error("DB unavailable");
      if(path==="rpc/four_page_flow_end")return !JSON.parse(init.body).p_failed;
      return null;
    });
    const response=await r.POST(request(body()));assert.equal(response.status,200);
    assert.equal(calls.at(-1).body.p_failed,false);assert.ok(calls.at(-1).body.p_cpu_ms>=0);
    fail=true;assert.equal((await r.POST(request(body()))).status,503);
    assert.equal(calls.at(-1).path,"rpc/four_page_flow_end");assert.equal(calls.at(-1).body.p_failed,true);
  } finally {for(const [key,value] of [["INGEST_SECRET",old.secret],["RESEARCH_FOUR_PAGE_RECORDING",old.gate]])value===undefined?delete process.env[key]:process.env[key]=value;}
});
