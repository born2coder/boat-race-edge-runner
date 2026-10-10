import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {Miniflare,convertV4MiniflareOptions} from 'miniflare';
const source=readFileSync(new URL('./worker.mjs',import.meta.url),'utf8');
const script=source.replace("fetch() { return new Response('Not found', { status: 404 }); }",`async fetch(request,env) {try {return Response.json(await check(env,Date.parse('2026-10-11T08:30:00+09:00')));}catch(e){return Response.json({error:e.message});}}`);
assert.notEqual(script,source);
for(const mode of ['healthy','paused','redirect','unauthorized']) test(`workerd fetch: ${mode}`,async()=>{
 const calls=[];
 const mf=new Miniflare(convertV4MiniflareOptions({modules:true,script,compatibilityDate:'2026-10-10',compatibilityFlags:['nodejs_compat'],bindings:{WATCHDOG_ENABLED:'1',GITHUB_ACTIONS_TOKEN:'test-only'},outboundService:async req=>{
  calls.push({url:req.url,method:req.method});
  if(mode==='redirect') return new Response(null,{status:302,headers:{Location:'https://unexpected.example/'}});
  if(mode==='unauthorized') return new Response(null,{status:401});
  if(req.method==='POST') {assert.deepEqual(await req.json(),{ref:'main',inputs:{once:false}});return new Response(null,{status:204});}
  if(req.url.includes('/contents/'))return Response.json([{name:'days',type:'dir'},...(mode==='paused'?[{name:'forward-paused.json'}]:[])]);
  if(req.url.includes('/jobs?'))return Response.json({total_count:1,jobs:[{conclusion:'success',steps:[{name:'Observe and record new research only',conclusion:'success'}]}]});
  if(req.url.includes('/runs?'))return Response.json({workflow_runs:[{id:1,status:'completed',conclusion:'success',event:'schedule',created_at:'2026-10-10T07:00:00+09:00',updated_at:'2026-10-10T12:15:00+09:00'}]});
  return Response.json({state:'active'});
 }}));
 try {
  const body=await (await mf.dispatchFetch('http://localhost/')).json();
  assert.deepEqual(body,mode==='healthy'?{status:'dispatched'}:mode==='paused'?{status:'persistent_stop'}:{error:`github_http_${mode==='redirect'?302:401}`});
  assert.equal(calls.filter(c=>c.method==='POST').length,mode==='healthy'?1:0);
  if(mode!=='healthy')assert.equal(calls.length,1);
  assert.ok(calls.every(c=>c.url.startsWith('https://api.github.com/repos/born2coder/boat-race-edge-runner/')));
 }finally{await mf.dispose();}
});
