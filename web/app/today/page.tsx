import {getForwardDetails,committedCandidates} from "@/db/research-repository";
import Link from "next/link";
import { getEdgeV2Day, getEdgeV2Index } from "@/db/edge-v2-repository";
import { todayJst } from "@/db/live-repository";
import { dayProgress } from "@/lib/edge-v2";
import { isFresh, STRATEGY_VERSION } from "@/lib/research-terminal";
export const dynamic = "force-dynamic";
const time = (s: string) => new Date(s).toLocaleTimeString("ja-JP", {timeZone:"Asia/Tokyo", hour:"2-digit", minute:"2-digit", second:"2-digit"});
export default async function TodayTerminal() {
  const date = todayJst(), now = Date.now();
  const [day, index, ledger] = await Promise.all([getEdgeV2Day(date), getEdgeV2Index(), getForwardDetails(date)]);
  const signals = committedCandidates(day, ledger, now);
  const progress = day ? dayProgress(day, now) : null;
  const active = signals;
  const buy = active.filter(s => s.status === "BUY"), watch = active.filter(s => s.status === "WATCH");
  const races = Object.values(day?.races ?? {});
  const grouped = new Map<string, typeof signals>();
  for (const s of buy) grouped.set(s.race.race_id, [...(grouped.get(s.race.race_id) ?? []), s]);
  const feedFresh = progress?.last_tick_at ? isFresh(progress.last_tick_at, now) : false;
  const safeBuy=feedFresh?buy:[], safeWatch=feedFresh?watch:[];
  return <div className="research-terminal"><p className="section-kicker">RESEARCH TERMINAL · {STRATEGY_VERSION}</p><h1>TODAY <small>{date}</small></h1>
    <div className="research-metrics"><div><span>分析済み</span><strong>{(progress?.checked ?? 0).toLocaleString()} R</strong><small>{((progress?.checked ?? 0)*120).toLocaleString()} combinations</small></div>
      <div><span>BUY</span><strong>{safeBuy.length}</strong></div><div><span>WATCH</span><strong>{safeWatch.length}</strong></div>
      <div><span>PASS / 未判定</span><strong>{Math.max(0, races.length*120-safeBuy.length-safeWatch.length).toLocaleString()}</strong></div></div>
    <p className={feedFresh ? "research-health" : "research-health warning"}>Last Updated {progress?.last_tick_at ? time(progress.last_tick_at) : "未取得"} · {feedFresh ? "観測中" : "STALE / BUYを停止"} · 次回更新は監視ジョブの実行状況に依存します</p>
    <section><h2>BUY · {safeBuy.length}点</h2>{!safeBuy.length && <p>現在、購入条件を満たす有効なシグナルはありません。取得停止や欠損時もBUYにはしません。</p>}
      {[...grouped.values()].filter(group=>safeBuy.some(s=>s.id===group[0].id)).map(group => <article className="research-card" key={group[0].race.race_id}><h3>{group[0].race.venue} {group[0].race.race_no}R · 締切 {time(group[0].race.start_at)} · 残り {Math.max(0,Math.ceil((Date.parse(group[0].race.start_at)-now)/60000))}分</h3>
        {group.map(s => <div className="research-pick" key={s.id}><strong>{s.combination}</strong><span>HIT確率 {(s.probability*100).toFixed(2)}%</span><span>現在 {s.odds.toFixed(1)}倍</span><span>市場確率 {(100/s.odds).toFixed(2)}%</span><span>Raw EV {s.rawEv.toFixed(2)}</span><span>保守EV {s.conservativeEv.toFixed(2)}</span><b>最低 {s.minimumOdds.toFixed(1)}倍</b><small>取得 {time(s.observedAt)}</small></div>)}</article>)}
    </section>
    <section><h2>WATCH · {safeWatch.length}点</h2><p>必要オッズと現在値は <Link href="/watch">WATCH</Link> で確認できます。</p></section>
    <section className="research-health"><h2>DATA HEALTH</h2><p>Race Feed {races.length ? "OK" : "NO DATA"} · Odds Feed {feedFresh && progress?.checked ? "OK" : "STALE"} · Prediction {active.length ? "OBSERVED" : "NO SIGNAL"} · Results {progress?.result_error ? "ERROR" : "確認中"}</p>
      <p>20分前 {progress?.phases.t20 ?? 0}R · 15分前 {progress?.phases.t15 ?? 0}R · 10分前 {progress?.phases.t10 ?? 0}R · 確定オッズ {progress?.final_grids ?? 0}R</p></section>
    <p><Link href="/edge">既存EDGE検証</Link> · <Link href="/legacy">旧サイト</Link> · 記録対象日 {index?.days.length ?? 0}日</p>
  </div>;
}
