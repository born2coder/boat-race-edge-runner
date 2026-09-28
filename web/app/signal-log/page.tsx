import {getForwardDetails} from "@/db/research-repository";
import Link from "next/link";
import {getEdgeV2Day, getEdgeV2Index, validDate} from "@/db/edge-v2-repository";
import {todayJst} from "@/db/live-repository";
import {historicalDaySignals} from "@/lib/research-terminal";
export const dynamic = "force-dynamic";
export default async function SignalLog({searchParams}: {searchParams: Promise<Record<string,string|undefined>>}) {
 const q = await searchParams, date = q.date && validDate(q.date) ? q.date : todayJst();
 const [day,index,ledger] = await Promise.all([getEdgeV2Day(date),getEdgeV2Index(),getForwardDetails(date)]);
 const committed=ledger.signals.filter(s=>(!q.status||q.status==='ALL'||s.status===q.status||(q.status==='BUY'&&!!s.buy_at))&&(!q.result||(q.result==='HIT'?s.hit===true:s.hit===false))&&
  (!q.venue||day?.races[s.race_id]?.venue===q.venue)&&(!q.model_version||s.model_version===q.model_version)&&
  (!q.ev||((s.buy_ev??0)>=Number(q.ev))));
 const clock=(value:string)=>new Date(value).toLocaleTimeString('ja-JP',{timeZone:'Asia/Tokyo',hour:'2-digit',minute:'2-digit'});
 const all = historicalDaySignals(day), filtered = all.filter(s =>
  (!q.status || q.status === "ALL" || s.status === q.status || (q.status === "BUY" && Boolean(s.buyAt))) &&
  (!q.venue || s.race.venue === q.venue) &&
  (!q.result || (q.result === "HIT" ? s.hit === true : s.hit === false)));
 const venues = [...new Set(all.map(s => s.race.venue))].sort();
 return <div className="research-terminal"><p className="section-kicker">IMMUTABLE SOURCE SNAPSHOTS</p><h1>SIGNAL LOG</h1>
  <p>未来に記録したSHADOW FORWARDを先に表示します。既存のHIT・EDGE履歴は<Link href="/history">旧履歴</Link>にも残しています。</p>
  <form className="research-filters" action="/signal-log"><label>日付 <input type="date" name="date" defaultValue={date}/></label>
   <label>状態 <select name="status" defaultValue={q.status ?? "ALL"}>{["ALL","BUY","WATCH","CANCEL","PASS","SETTLED"].map(v=><option key={v}>{v}</option>)}</select></label>
   <label>会場 <select name="venue" defaultValue={q.venue ?? ""}><option value="">全会場</option>{venues.map(v=><option key={v}>{v}</option>)}</select></label>
   <label>モデル <select name="model_version" defaultValue={q.model_version??""}><option value="">全モデル</option><option>edge-full120-v2</option></select></label>
   <label>BUY EV下限 <input type="number" name="ev" step="0.05" min="0" defaultValue={q.ev??""}/></label>
   <label>結果 <select name="result" defaultValue={q.result ?? ""}><option value="">すべて</option><option>HIT</option><option>MISS</option></select></label><button type="submit">絞り込む</button></form>
  <h2>SHADOW FORWARD · {committed.length}件</h2>
  {committed.map(s=>{const snaps=ledger.snapshots.filter(x=>x.signal_id===s.signal_id),events=ledger.events.filter(x=>x.signal_id===s.signal_id);
   const buy=snaps.find(x=>x.snapshot_kind==='BUY'),final=snaps.find(x=>x.snapshot_kind==='FINAL');
   return <details className="research-card" key={s.signal_id}><summary><b>{s.race_id}</b> · {s.combination} · {s.status} · {s.refunded?"REFUNDED":s.hit===null?"結果待ち":s.hit?"HIT":"MISS"}</summary>
    <div className="research-pick"><span>初回 {clock(s.created_at)}</span><span>BUY {s.buy_at?clock(s.buy_at):"—"}</span>
    <span>BUY Odds {s.buy_odds??"—"}</span><span>BUY EV {s.buy_ev?.toFixed(2)??"—"}</span>
    <span>最低 {buy?.minimum_buy_odds?.toFixed(1)??"—"}</span><span>確定 Odds {final?.odds??"未取得"}</span><span>確定 EV {final?.conservative_ev?.toFixed(2)??"—"}</span>
    <span>投資 ¥{s.buy_at?s.fixed_stake_yen:0}</span><span>払戻 ¥{s.payout_yen??"未確定"}</span><span>収支 {s.payout_yen===null?"—":"¥"+(s.payout_yen-(s.buy_at?s.fixed_stake_yen:0))}</span><span>{s.model_version}</span></div>
    <p>{events.map(e=>clock(e.event_at)+" "+e.new_status+(e.reason.includes("refund")?" 返還":"")).join(" → ")}</p>
    <p>{snaps.map(x=>clock(x.source_observed_at)+" "+(x.odds??"—")+"倍 / EV "+(x.conservative_ev?.toFixed(2)??"—")).join(" → ")}</p>
   </details>})}
  <h2>BACKTEST · 既存観測の再計算</h2><p>{date} · {filtered.length}件 / 全{all.length}件</p>
  {all.length > 0 && committed.length === 0 ? <p className="research-note">締切前に保存された観測から復元した研究記録です。SHADOW FORWARD実績には加算しません。</p> : null}
  {filtered.map(s => <details className="research-card" key={s.id}><summary><b>{s.race.venue} {s.race.race_no}R</b> · {s.combination} · {s.status} · {s.hit === undefined ? "結果待ち" : s.hit ? "HIT" : "MISS"}</summary>
    <div className="research-pick"><span>初回観測 {s.events[0]?.at ? new Date(s.events[0].at).toLocaleTimeString("ja-JP",{timeZone:"Asia/Tokyo"}) : "—"}</span>
     <span>BUY {s.buyAt ? new Date(s.buyAt).toLocaleTimeString("ja-JP",{timeZone:"Asia/Tokyo"}) : "—"}</span>
     <span>BUY Odds {s.buyOdds?.toFixed(1) ?? "—"}</span><span>BUY EV {s.buyEv?.toFixed(2) ?? "—"}</span>
     <span>Minimum Odds {s.minimumOdds.toFixed(1)}</span><span>Final Odds {s.finalOdds?.toFixed(1) ?? "未取得"}</span>
     <span>Final EV {s.finalOdds ? (s.conservativeProbability*s.finalOdds).toFixed(2) : "—"}</span>
     <span>投資 ¥{s.stakeYen ?? 0}</span><span>払戻 ¥{s.payoutYen ?? "未確定"}</span></div>
    <p>{s.events.map(e => new Date(e.at).toLocaleTimeString("ja-JP",{timeZone:"Asia/Tokyo",hour:"2-digit",minute:"2-digit"})+" "+e.status+" "+e.odds.toFixed(1)+"倍").join(" → ")}</p>
   </details>)}
  <nav className="edge-v2-dates">{index?.days.slice(0,30).map(d=><Link href={"/signal-log?date="+d.date} key={d.date}>{d.date}</Link>)}</nav></div>;
}
