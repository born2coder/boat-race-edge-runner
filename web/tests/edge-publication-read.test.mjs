import assert from 'node:assert/strict';
import test from 'node:test';
import {readFile} from 'node:fs/promises';
import ts from 'typescript';
const source = await readFile(new URL('../db/edge-v2-repository.ts', import.meta.url), 'utf8');
const code = ts.transpileModule(source, {compilerOptions:{module:ts.ModuleKind.CommonJS,target:ts.ScriptTarget.ES2022}}).outputText;
function repository(fetch) {
  const exports = {};
  const require = (name) => name === 'react' ? {cache: fn => fn} : name === '@/lib/edge-v2' ? {EDGE_VERSION:'edge-full120-v2'} : {};
  new Function('exports','require','fetch',code)(exports,require,fetch);
  return exports;
}
test('day reads use the resolved immutable revision instead of the cached branch URL', async () => {
  const calls=[];const sha='a'.repeat(40);
  const day={version:'edge-full120-v2',date:'2026-09-15',races:{}};
  const repo=repository(async (url,options)=>{calls.push({url,options});return {ok:true,json:async()=>calls.length===1?{object:{sha}}:day};});
  assert.deepEqual(await repo.getEdgeV2Day('2026-09-15'),day);
  assert.match(calls[1].url,new RegExp('/'+sha+'/state/edge_v2/days/'));
  assert.equal(calls[0].options.next.revalidate,120);
});
test('API rate limits retain the existing public data fallback', async()=>{
  const calls=[];
  const repo=repository(async url=>{calls.push(url);return calls.length===1?{ok:false,status:403}:{ok:true,json:async()=>({version:'edge-full120-v2',races:{}})};});
  assert.ok(await repo.getEdgeV2Day('2026-09-15'));
  assert.match(calls[1],/\/edge-data\/state\/edge_v2\//);
});
test('invalid dates do not issue network requests',async()=>{
  const repo=repository(()=>{throw new Error('unexpected network');});
  assert.equal(await repo.getEdgeV2Day('../secrets'),null);
});
