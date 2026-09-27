import Link from "next/link";
import {getEdgeV2Day, getEdgeV2Index} from "@/db/edge-v2-repository";
import {daySignals, forwardPerformance, STRATEGY_VERSION} from "@/lib/research-terminal";
export const dynamic = "force-dynamic";
export default async function Performance() {
 const index = await getEdgeV2Index();
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
 return <div className="research-terminal"><p className="section-kicker">SHADOW FORWARD · {STRATEGY_VERSION}</p><h1>PERFORMANCE</h1>
  <section className="research-hero"><span>FORWARD ROI</span><strong>{perf.settled < 100 ? "INSUFFICIENT SAMPLE" : pct(perf.roi)}</strong>
   <p>確定 {perf.settled}点 · 暫定ROI {pct(perf.roi)} · 投資 ¥{perf.stake.toLocaleString()} · 払戻 ¥{perf.payout.toLocaleString()} · 的中 {perf.hits}</p></section>
  <p>この集計は既存の締切前観測を用いた研究用再計算です。新strategyの運用開始前に作られた観測はBACKTESTに相当し、正式なSHADOW FORWARDには含められません。</p>
  <h2>BACKTEST / 既存観測の再計算</h2><div className="research-metrics"><div><span>BUY候補</span><strong>{perf.buys}</strong></div><div><span>精算済み</span><strong>{perf.settled}</strong></div><div><span>的中率</span><strong>{pct(perf.settled ? perf.hits/perf.settled : null)}</strong></div><div><span>ROI</span><strong>{pct(perf.roi)}</strong></div></div>
  <h2>SHADOW FORWARD</h2><p>正式な開始時刻をDBに固定し、以後のBUYイベントを永続化するまで未開始です。BACKTESTの数値を混ぜません。</p>
  <h2>LIVE</h2><p>実購入記録なし。仮想購入をLIVEに計上しません。</p>
  <h2>BUY時EV帯</h2><div className="edge-v2-table"><table><thead><tr><th>EV</th><th>確定点数</th><th>的中</th><th>ROI</th></tr></thead><tbody>{buckets.map(b=><tr key={b.label}><th>{b.label}</th><td>{b.settled}</td><td>{b.hits}</td><td>{pct(b.roi)}</td></tr>)}</tbody></table></div>
  <h2>日別</h2><div className="edge-v2-table"><table><thead><tr><th>日付</th><th>点数</th><th>投資</th><th>払戻</th><th>ROI</th></tr></thead><tbody>{dayRows.map(d=><tr key={d.date}><th><Link href={"/signal-log?date="+d.date}>{d.date}</Link></th><td>{d.settled}</td><td>¥{d.stake}</td><td>¥{d.payout}</td><td>{pct(d.roi)}</td></tr>)}</tbody></table></div>
  <h2>会場別</h2><div className="edge-v2-table"><table><thead><tr><th>会場</th><th>点数</th><th>的中</th><th>ROI</th></tr></thead><tbody>{grouped.map(g=><tr key={g.venue}><th>{g.venue}</th><td>{g.settled}</td><td>{g.hits}</td><td>{pct(g.roi)}</td></tr>)}</tbody></table></div>
  <p><Link href="/edge">従来のEDGE検証値</Link>は異なる条件として保存しています。</p></div>;
}
