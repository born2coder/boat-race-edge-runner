import Link from "next/link";
import {getEdgeV2Day, getEdgeV2Index, validDate} from "@/db/edge-v2-repository";
import {todayJst} from "@/db/live-repository";
import {daySignals} from "@/lib/research-terminal";
export const dynamic = "force-dynamic";
export default async function SignalLog({searchParams}: {searchParams: Promise<Record<string,string|undefined>>}) {
 const q = await searchParams, date = q.date && validDate(q.date) ? q.date : todayJst();
 const [day,index] = await Promise.all([getEdgeV2Day(date),getEdgeV2Index()]);
 const all = daySignals(day), filtered = all.filter(s =>
  (!q.status || q.status === "ALL" || s.status === q.status || (q.status === "BUY" && Boolean(s.buyAt))) &&
  (!q.venue || s.race.venue === q.venue) &&
  (!q.result || (q.result === "HIT" ? s.hit === true : s.hit === false)));
 const venues = [...new Set(all.map(s => s.race.venue))].sort();
 return <div className="research-terminal"><p className="section-kicker">IMMUTABLE SOURCE SNAPSHOTS</p><h1>SIGNAL LOG</h1>
  <p>締切前の観測だけで候補と状態遷移を再計算します。既存のHIT・EDGE履歴は<Link href="/history">旧履歴</Link>にも残しています。</p>
  <form className="research-filters" action="/signal-log"><label>日付 <input type="date" name="date" defaultValue={date}/></label>
   <label>状態 <select name="status" defaultValue={q.status ?? "ALL"}>{["ALL","BUY","WATCH","CANCEL","PASS","SETTLED"].map(v=><option key={v}>{v}</option>)}</select></label>
   <label>会場 <select name="venue" defaultValue={q.venue ?? ""}><option value="">全会場</option>{venues.map(v=><option key={v}>{v}</option>)}</select></label>
   <label>結果 <select name="result" defaultValue={q.result ?? ""}><option value="">すべて</option><option>HIT</option><option>MISS</option></select></label><button type="submit">絞り込む</button></form>
  <p>{date} · {filtered.length}件 / 全{all.length}件</p>
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
