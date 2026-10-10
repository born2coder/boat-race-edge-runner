import test from 'node:test';
import assert from 'node:assert/strict';
import { check } from './worker.mjs';
const now = Date.parse('2026-10-11T08:30:00+09:00');
const env = { WATCHDOG_ENABLED: '1', GITHUB_ACTIONS_TOKEN: 'test-only' };
const files = [{name:'days',type:'dir'}];
const good = {id:1,status:'completed',conclusion:'success',event:'schedule',created_at:'2026-10-10T07:00:00+09:00',updated_at:'2026-10-10T12:15:00+09:00'};
function fixture(overrides = {}) {
  const calls = [];
  return {calls, request: async (url, init) => {
    calls.push({url,init});
    if (overrides.http) return new Response('',{status:overrides.http});
    if (init.method === 'POST') return new Response(null,{status:204});
    let body;
    if (url.includes('/contents/')) body = overrides.files ?? files;
    else if (url.includes('/jobs?')) body = overrides.jobs ?? {total_count:1,jobs:[{conclusion:'success',steps:[{name:'Observe and record new research only',conclusion:'success'}]}]};
    else if (url.includes('/runs?')) body = {workflow_runs: overrides.runs ?? [good]};
    else body = {state:overrides.state ?? 'active'};
    return Response.json(body);
  }};
}
for (const [name,overrides,status] of [
  ['persistent stop',{files:[...files,{name:'forward-paused.json'}]},'persistent_stop'],
  ['active job',{runs:[{...good,status:'in_progress'}]},'already_running'],
  ['failed run',{runs:[{...good,conclusion:'failure'}]},'previous_run_stopped'],
  ['cancelled run',{runs:[{...good,conclusion:'cancelled'}]},'previous_run_stopped'],
  ['disabled workflow',{state:'disabled_manually'},'workflow_disabled'],
  ['skipped job',{jobs:{total_count:1,jobs:[{conclusion:'skipped'}]}},'previous_job_not_successful'],
  ['cooldown',{runs:[{...good,updated_at:new Date(now-60000).toISOString()}]},'cooldown'],
  ['missing state',{files:[]},'invalid_state_directory'],
  ['dispatch cap',{runs:Array.from({length:4},(_,i)=>({...good,id:i,event:'workflow_dispatch',created_at:new Date(now-3600000).toISOString()}))},'daily_dispatch_limit'],
  ['truncated history',{runs:Array.from({length:20},(_,i)=>({...good,id:i,created_at:new Date(now-3600000).toISOString()}))},'history_limit'],
]) test(name,async()=>{const f=fixture(overrides);assert.equal((await check(env,now,f.request)).status,status);assert.ok(f.calls.every(c=>c.init.method!=='POST'));});
test('healthy missed start dispatches bounded runner once',async()=>{
  const f=fixture();assert.equal((await check(env,now,f.request)).status,'dispatched');
  const posts=f.calls.filter(c=>c.init.method==='POST');assert.equal(posts.length,1);
  assert.deepEqual(JSON.parse(posts[0].init.body),{ref:'main',inputs:{once:false}});
});
test('disabled, absent secret and night make no network calls',async()=>{
  const f=fixture();assert.equal((await check({},now,f.request)).status,'disabled');
  assert.equal((await check({WATCHDOG_ENABLED:'1'},now,f.request)).status,'missing_secret');
  assert.equal((await check(env,Date.parse('2026-10-11T02:00:00+09:00'),f.request)).status,'outside_hours');
  assert.equal(f.calls.length,0);
});
test('21:30 JST and later are outside monitoring hours',async()=>{
  const f=fixture();
  for(const time of ['21:30:00','21:45:00','23:59:00'])
    assert.equal((await check(env,Date.parse(`2026-10-11T${time}+09:00`),f.request)).status,'outside_hours');
  assert.equal(f.calls.length,0);
});
test('HTTP failures never retry or dispatch',async()=>{
  for(const http of [401,403,429,500]){const f=fixture({http});await assert.rejects(check(env,now,f.request),new RegExp(`github_http_${http}`));assert.equal(f.calls.length,1);}
});
