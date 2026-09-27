import Link from "next/link";
import {getEdgeV2Day} from "@/db/edge-v2-repository";
import {todayJst} from "@/db/live-repository";
import {daySignals} from "@/lib/research-terminal";
export const dynamic = "force-dynamic";
export default async function Watch() {
 const day = await getEdgeV2Day(todayJst());
 const signals = daySignals(day).filter(s => s.status === "WATCH" && Date.parse(s.race.start_at) > Date.now())
   .sort((a,b) => Date.parse(a.race.start_at)-Date.parse(b.race.start_at));
 return <div className="research-terminal"><p className="section-kicker">CONDITION WAIT</p><h1>WATCH</h1><p>現在の観測でBUY条件に届かない候補。展示後の確率が欠けたレースは候補に含めません。</p>
  {!signals.length && <p>条件待ちの候補はありません。</p>}
  {signals.map(s => <article className="research-card" key={s.id}><h2>{s.race.venue} {s.race.race_no}R · {s.combination}</h2>
   <div className="research-pick"><span>確率 {(s.probability*100).toFixed(2)}%</span><span>現在 {s.odds.toFixed(1)}倍</span>
   <strong>BUY必要 {s.minimumOdds.toFixed(1)}倍</strong><span>差 {((s.minimumOdds/s.odds-1)*100).toFixed(1)}%</span>
   <span>保守EV {s.conservativeEv.toFixed(2)}</span>
   <span>締切 {new Date(s.race.start_at).toLocaleTimeString("ja-JP",{timeZone:"Asia/Tokyo",hour:"2-digit",minute:"2-digit"})}</span></div>
   <p>{s.events.map(e => new Date(e.at).toLocaleTimeString("ja-JP",{timeZone:"Asia/Tokyo",hour:"2-digit",minute:"2-digit"})+" "+e.status).join(" → ")}</p></article>)}
  <Link href="/today">TODAYへ戻る</Link></div>;
}
