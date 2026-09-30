import {getForwardDetails,committedCandidates} from "@/db/research-repository";
import Link from "next/link";
import {getEdgeV2Day} from "@/db/edge-v2-repository";
import {todayJst} from "@/db/live-repository";
import {activeResearchStrategy} from "@/db/research-strategies";
export const dynamic = "force-dynamic";
export default async function Watch() {
 const [day,ledger,strategy]=await Promise.all([getEdgeV2Day(todayJst()),getForwardDetails(todayJst()),activeResearchStrategy()]);
 const signals = committedCandidates(day,ledger,Date.now(),strategy.strategy_version,strategy.settings).filter(s=>s.status==="WATCH")
   .sort((a,b)=>Date.parse(a.race.start_at)-Date.parse(b.race.start_at));
 return <div className="research-terminal"><p className="section-kicker">CONDITION WAIT</p><h1>WATCH</h1><p>現在の観測でBUY条件に届かない候補。展示後の確率が欠けたレースは候補に含めません。</p>
  {!signals.length && <p>条件待ちの候補はありません。</p>}
  {signals.map(s => <article className="research-card" key={s.id}><h2>{s.race.venue} {s.race.race_no}R · {s.combination}</h2>
   <div className="research-pick"><span>確率 {(s.probability*100).toFixed(2)}%</span><span>現在 {s.odds.toFixed(1)}倍</span>
   <strong>BUY必要 {s.minimumOdds.toFixed(1)}倍</strong><span>差 {((s.minimumOdds/s.odds-1)*100).toFixed(1)}%</span>
   <span>Raw EV {s.rawEv.toFixed(2)} / 保守EV {s.conservativeEv.toFixed(2)}</span>
   <span>保守確率 {(s.conservativeProbability*100).toFixed(2)}% / Calibrated 未校正</span>
   <span>Data Updated {new Date(s.observedAt).toLocaleTimeString("ja-JP",{timeZone:"Asia/Tokyo"})}</span>
   <span>締切 {new Date(s.race.start_at).toLocaleTimeString("ja-JP",{timeZone:"Asia/Tokyo",hour:"2-digit",minute:"2-digit"})}</span></div>
   <p>Odds trend {ledger.snapshots.filter(x=>x.signal_id===s.id&&x.snapshot_kind!=="FINAL").map(x=>
    new Date(x.source_observed_at).toLocaleTimeString("ja-JP",{timeZone:"Asia/Tokyo",hour:"2-digit",minute:"2-digit"})+" "+x.odds.toFixed(1)+"倍").join(" → ")}</p>
   <p>{s.events.map(e => new Date(e.at).toLocaleTimeString("ja-JP",{timeZone:"Asia/Tokyo",hour:"2-digit",minute:"2-digit"})+" "+e.status).join(" → ")}</p></article>)}
  <Link href="/today">TODAYへ戻る</Link></div>;
}
