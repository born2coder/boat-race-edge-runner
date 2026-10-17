import test from 'node:test';
import assert from 'node:assert/strict';
import { policy as p } from './four-page/load-policy.mjs';
const entry = (id, multiple, patch = {}) => ({id, raceDate:'2026-10-17', venueCode:'01', raceNo:1, outcome:'hit', hit:true, settledAt:'2026-10-17T12:00:00+09:00', stakeYen:100, payoutYen:multiple*100, odds:9999, ...patch});
test('ranks actual return multiples, deduplicates and limits to five without mutating input', () => {
 const rows=[entry('a',10),entry('b',80,{stakeYen:200,payoutYen:16000}),entry('c',30),entry('d',20),entry('e',60),entry('f',40),entry('g',50)];
 const before=rows.slice();
 assert.deepEqual(p.topWinningEntries([...rows,rows[1]]).map(r=>[r.entry.id,r.multiple]),[['b',80],['e',60],['g',50],['f',40],['c',30]]);
 assert.deepEqual(rows,before);
});
test('excludes pending, refunds, misses and invalid settlement values; permits fewer than five', () => {
 const invalid=[{outcome:'pending'},{outcome:'refunded'},{outcome:'miss'},{hit:false},{settledAt:null},{payoutYen:null},{payoutYen:Infinity},{stakeYen:0}];
 const rows=invalid.map((patch,i)=>entry(String(i),100,patch));
 assert.deepEqual(p.topWinningEntries(rows),[]);
 assert.equal(p.topWinningEntries([...rows,entry('ok',12.3)])[0].multiple,12.3);
 assert.deepEqual(p.topWinningEntries([]),[]);
});
