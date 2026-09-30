import {getForwardSignals,getForwardBuySnapshots} from "@/db/research-repository";
import Link from "next/link";
import {getEdgeV2Day, getEdgeV2Index} from "@/db/edge-v2-repository";
import {daySignals, forwardPerformance, STRATEGY_VERSION} from "@/lib/research-terminal";
import {activeResearchStrategy,researchStrategies} from "@/db/research-strategies";
import {venueNames} from "@/lib/poc";
export const dynamic = "force-dynamic";
export default async function Performance({searchParams}:{searchParams:Promise<Record<string,string|undefined>>}) {
 const [index, allForward, buySnapshots,active,strategies,q] = await Promise.all([getEdgeV2Index(),getForwardSignals(),getForwardBuySnapshots(),activeResearchStrategy(),researchStrategies(),searchParams]);
 const strategyVersion=strategies.some(s=>s.strategy_version===q.strategy_version)?q.strategy_version!:active.strategy_version;
 const forward=allForward.filter(s=>s.strategy_version===strategyVersion);
 const forwardBought=forward.filter(s=>s.buy_at);
 const forwardRefunded=forwardBought.filter(s=>s.status==='SETTLED'&&s.refunded);
 const forwardSettled=forwardBought.filter(s=>s.status==='SETTLED'&&!s.refunded&&s.payout_yen!==null);
 const fStake=forwardSettled.reduce((n,s)=>n+s.fixed_stake_yen,0);
 const fPayout=forwardSettled.reduce((n,s)=>n+(s.payout_yen??0),0);
 const fRoi=fStake?fPayout/fStake:null;
 const fHits=forwardSettled.filter(s=>s.hit).length;
 const ordered=[...forwardSettled].sort((a,b)=>Date.parse(a.buy_at!)-Date.parse(b.buy_at!));
 let equity=0,peak=0,maxDrawdown=0,streak=0,maxLosingStreak=0;
 for(const s of ordered){equity+=(s.payout_yen??0)-s.fixed_stake_yen;peak=Math.max(peak,equity);
  maxDrawdown=Math.max(maxDrawdown,peak-equity);streak=s.hit?0:streak+1;maxLosingStreak=Math.max(maxLosingStreak,streak);}
 const byPeriod=(key:(s:typeof forwardSettled[number])=>string)=>{
  const keys=[...new Set(forwardSettled.map(key))].sort();
  return keys.map(label=>{const rows=forwardSettled.filter(s=>key(s)===label),
   stake=rows.reduce((n,s)=>n+s.fixed_stake_yen,0),payout=rows.reduce((n,s)=>n+(s.payout_yen??0),0);
   return {label,count:rows.length,hits:rows.filter(s=>s.hit).length,stake,payout,roi:stake?payout/stake:null};});
 };
 const forwardDays=byPeriod(s=>s.race_id.slice(3,11));
 const forwardWeeks=byPeriod(s=>{const x=s.race_id.slice(3,11);const d=new Date(Date.UTC(Number(x.slice(0,4)),Number(x.slice(4,6))-1,Number(x.slice(6,8))));d.setUTCDate(d.getUTCDate()-(d.getUTCDay()+6)%7);return d.toISOString().slice(0,10);});
 const forwardMonths=byPeriod(s=>s.race_id.slice(3,9));
 const venueRows=byPeriod(s=>s.race_id.split(':')[2]??'unknown');
 const forwardVenues=Object.entries(venueNames).map(([code,name])=>{
  const row=venueRows.find(r=>r.label===code);return {...(row??{count:0,hits:0,stake:0,payout:0,roi:null}),label:name};});
 const edgeBands=[[1,1.1],[1.1,1.2],[1.2,1.3],[1.3,1.5],[1.5,Infinity]].map(([lo,hi])=>{
  const rows=forwardSettled.filter(s=>(s.buy_ev??0)>=lo&&(s.buy_ev??0)<hi);
  const stake=rows.reduce((n,s)=>n+s.fixed_stake_yen,0),payout=rows.reduce((n,s)=>n+(s.payout_yen??0),0);
  return {label:hi===Infinity?'1.50+':lo.toFixed(2)+'–'+hi.toFixed(2),count:rows.length,
   meanEv:rows.length?rows.reduce((n,s)=>n+(s.buy_ev??0),0)/rows.length:null,
   hits:rows.filter(s=>s.hit).length,roi:stake?payout/stake:null};
 });
 const firstBuy=new Map<string,number>();
 for(const row of buySnapshots)if(!firstBuy.has(row.signal_id))firstBuy.set(row.signal_id,row.minutes_to_close);
 const timeBands=[[27,36,"-30m"],[17,27,"-20m"],[13,17,"-15m"],[8,13,"-10m"],[0,8,"-5m以降"]] as const;
 const forwardTiming=timeBands.map(([lo,hi,label])=>{const rows=forwardSettled.filter(s=>{const t=firstBuy.get(s.signal_id);return t!==undefined&&t>=lo&&t<hi;});
  const stake=rows.reduce((n,s)=>n+s.fixed_stake_yen,0),payout=rows.reduce((n,s)=>n+(s.payout_yen??0),0);
  return {label,count:rows.length,hits:rows.filter(s=>s.hit).length,roi:stake?payout/stake:null};
 });
 const winningDays=forwardDays.filter(d=>d.payout>d.stake).length,losingDays=forwardDays.filter(d=>d.payout<d.stake).length;
 const settledRaces=byPeriod(s=>s.race_id);
 const profitableRaces=settledRaces.filter(r=>r.payout>r.stake).length;

 const dates = index?.days.map(d=>d.date) ?? [];
 const days = await Promise.all(dates.map(getEdgeV2Day));
 const signals = days.flatMap(day => daySignals(day));
 const perf = forwardPerformance(signals);
 const settled = signals.filter(s=>s.stakeYen != null && s.payoutYen != null);
 const dayRows = dates.map((date,i) => ({date, ...forwardPerformance(daySignals(days[i]))})).filter(d=>d.settled);
 const grouped = [...new Set(settled.map(s=>s.race.venue))].map(venue=>({venue,...forwardPerformance(settled.filter(s=>s.race.venue===venue))}));
 const bands = [[1,1.1],[1.1,1.2],[1.2,1.3],[1.3,1.5],[1.5,Infinity]];
 const buckets = bands.map(([low,high])=>({label: high===Infinity ? "1.50+" : low.toFixed(2)+"–"+high.toFixed(2),
  ...forwardPerformance(settled.filter(s=>s.buyEv != null && s.buyEv >= low && s.buyEv < high))}));
 const pct=(n:number|null)=>n == null ? "—" : (n*100).toFixed(1)+"%";
 return <div className="research-terminal"><p className="section-kicker">SHADOW FORWARD · {strategyVersion}</p><h1>PERFORMANCE</h1>
  <form className="research-filters"><label>戦略ごとに独立集計<select name="strategy_version" defaultValue={strategyVersion}>{strategies.map(s=><option key={s.strategy_version}>{s.strategy_version}</option>)}</select></label><button type="submit">表示</button></form>
  <section className="research-hero"><span>FORWARD ROI</span><strong>{forwardSettled.length < 100 ? "INSUFFICIENT SAMPLE" : pct(fRoi)}</strong>
   <p>確定 {forwardSettled.length}点 · 暫定ROI {pct(fRoi)} · 投資 ¥{fStake.toLocaleString()} · 払戻 ¥{fPayout.toLocaleString()} · 的中 {fHits}</p></section>
  <p>新strategyの運用開始前に作られた観測は下段のBACKTESTに分離しています。取消・返還は投資額とROIの計算から除きます。</p>
  <h2>BACKTEST / 既存観測の再計算</h2><div className="research-metrics"><div><span>BUY候補</span><strong>{perf.buys}</strong></div><div><span>精算済み</span><strong>{perf.settled}</strong></div><div><span>的中率</span><strong>{pct(perf.settled ? perf.hits/perf.settled : null)}</strong></div><div><span>ROI</span><strong>{pct(perf.roi)}</strong></div></div>
  <h2>SHADOW FORWARD</h2><p>将来に向けて永続化したBUYイベントだけを計上します。BUY {forwardBought.length}点、精算 {forwardSettled.length}点、返還 {forwardRefunded.length}点。標本が100点未満の場合は参考値です。</p>
  <div className="research-metrics"><div><span>Signals / BUY Signals</span><strong>{forward.length} / {forwardBought.length}</strong></div>
   <div><span>HIT / MISS</span><strong>{fHits} / {forwardSettled.length-fHits}</strong></div>
   <div><span>的中率</span><strong>{pct(forwardSettled.length?fHits/forwardSettled.length:null)}</strong></div>
   <div><span>プラス収支レース率</span><strong>{pct(settledRaces.length?profitableRaces/settledRaces.length:null)}</strong><small>{profitableRaces} / {settledRaces.length} races</small></div>
   <div><span>最大DD</span><strong>¥{maxDrawdown.toLocaleString()}</strong></div>
   <div><span>最大連敗</span><strong>{maxLosingStreak}</strong></div>
   <div><span>Profit / Losing Days</span><strong>{winningDays} / {losingDays}</strong></div></div>
  <h2>SHADOW FORWARD · BUY時EVと実現ROI</h2>
  <div className="edge-v2-table"><table><thead><tr><th>BUY EV帯</th><th>件数</th><th>的中率</th><th>平均予測EV</th><th>実現ROI</th></tr></thead><tbody>{edgeBands.map(b=><tr key={b.label}><th>{b.label}</th><td>{b.count}</td><td>{pct(b.count?b.hits/b.count:null)}</td><td>{b.meanEv?.toFixed(2)??"—"}</td><td>{pct(b.roi)}</td></tr>)}</tbody></table></div>
  <h2>SHADOW FORWARD · 日別 / 月別 / 会場別</h2>
  {([["日別",forwardDays],["週別",forwardWeeks],["月別",forwardMonths],["会場別",forwardVenues]] as const).map(([label,rows])=>
   <section key={label}><h3>{label}</h3><div className="edge-v2-table"><table><thead><tr><th>区分</th><th>BUY</th><th>的中</th><th>投資</th><th>払戻</th><th>ROI</th></tr></thead>
    <tbody>{rows.map(row=><tr key={row.label}><th>{row.label}</th><td>{row.count}</td><td>{row.hits} ({pct(row.count?row.hits/row.count:null)})</td><td>¥{row.stake}</td><td>¥{row.payout}</td><td>{pct(row.roi)}</td></tr>)}</tbody></table></div></section>)}
  <h2>SHADOW FORWARD · 初回BUY締切前時間</h2><div className="edge-v2-table"><table><thead><tr><th>時間帯</th><th>件数</th><th>的中</th><th>ROI</th></tr></thead><tbody>{forwardTiming.map(t=><tr key={t.label}><th>{t.label}</th><td>{t.count}</td><td>{t.hits}</td><td>{pct(t.roi)}</td></tr>)}</tbody></table></div>
  <h2>LIVE</h2><p>実購入記録なし。仮想購入をLIVEに計上しません。</p>
  <h2>BACKTEST · BUY時EV帯</h2><div className="edge-v2-table"><table><thead><tr><th>EV</th><th>確定点数</th><th>的中</th><th>ROI</th></tr></thead><tbody>{buckets.map(b=><tr key={b.label}><th>{b.label}</th><td>{b.settled}</td><td>{b.hits}</td><td>{pct(b.roi)}</td></tr>)}</tbody></table></div>
  <h2>BACKTEST · 日別</h2><div className="edge-v2-table"><table><thead><tr><th>日付</th><th>点数</th><th>投資</th><th>払戻</th><th>ROI</th></tr></thead><tbody>{dayRows.map(d=><tr key={d.date}><th><Link href={"/signal-log?date="+d.date}>{d.date}</Link></th><td>{d.settled}</td><td>¥{d.stake}</td><td>¥{d.payout}</td><td>{pct(d.roi)}</td></tr>)}</tbody></table></div>
  <h2>BACKTEST · 会場別</h2><div className="edge-v2-table"><table><thead><tr><th>会場</th><th>点数</th><th>的中</th><th>ROI</th></tr></thead><tbody>{grouped.map(g=><tr key={g.venue}><th>{g.venue}</th><td>{g.settled}</td><td>{g.hits}</td><td>{pct(g.roi)}</td></tr>)}</tbody></table></div>
  <p><Link href="/edge">従来のEDGE検証値</Link>は異なる条件として保存しています。</p></div>;
}
