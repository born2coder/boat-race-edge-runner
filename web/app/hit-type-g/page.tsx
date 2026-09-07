import Link from "next/link";
import { ArrowLeft, ArrowRight, Beaker, CircleHelp, ShieldCheck } from "lucide-react";
import { getTypeGDashboard, type TypeGPair } from "@/db/live-repository";
import { formatYen } from "@/lib/poc";
import { TypeGLedger } from "./type-g-ledger";

export const metadata = {
  title: "HIT type-G検証",
  description: "現行HITとtype-Gを同じ条件で並走比較する検証ページです。",
  alternates: { canonical: "/hit-type-g" },
};
export const dynamic = "force-dynamic";

function picks(pair: TypeGPair) {
  const control = pair.control?.tickets.slice(0, 3).map((ticket) => ticket.combination) ?? [];
  const typeG = pair.typeG.tickets.slice(0, 3).map((ticket) => ticket.combination);
  return { control, typeG };
}

function LiveCard({ pair, next }: { pair: TypeGPair; next: boolean }) {
  const { control, typeG } = picks(pair);
  return <article className={`type-g-live-card ${next ? "next" : ""}`}>
    <header><span>{next ? "NEXT" : "締切"}</span><strong>{pair.typeG.race.start_time_jst}</strong><b>{pair.typeG.race.venue} {pair.typeG.race.race_no}R</b>{pair.changedTop3 && <em>買い目変更</em>}</header>
    <div className="type-g-pair">
      <div><span>現行HIT</span><div>{control.map((combination) => <b className={!typeG.includes(combination) ? "removed" : ""} key={combination}>{combination}</b>)}</div></div>
      <div><span>type-G</span><div>{typeG.map((combination) => <b className={!control.includes(combination) ? "added" : ""} key={combination}>{combination}</b>)}</div></div>
    </div>
    <details className="type-g-more"><summary>Top5・Top8と評価順位</summary><div className="type-g-top8">{pair.typeG.tickets.map((ticket, index) => <span key={ticket.combination}><small>{index + 1}</small>{ticket.combination}</span>)}</div><ol>{pair.typeG.ranking.map((entry) => <li key={entry.lane_no}><span>{entry.rank}位</span><strong>{entry.lane_no}号艇 {entry.racer_name}</strong></li>)}</ol></details>
  </article>;
}

export default async function TypeGPage() {
  const { live, history, summary, topK } = await getTypeGDashboard();
  return <>
    <div className="type-g-page-head">
      <Link href="/" className="back-link"><ArrowLeft aria-hidden="true" /> 今日の予想へ</Link>
      <div className="type-g-title-line"><div><p className="section-kicker">HIT MODEL / PARALLEL TEST</p><h1>HIT type-G検証</h1></div><span><Beaker aria-hidden="true" />検証中</span></div>
      <p>現行HITを変えず、同じ朝データ・同じ購入点数でtype-Gを並走させています。通常予想と公式成績には加算しません。</p>
    </div>

    <section className="type-g-live" aria-labelledby="type-g-live-title">
      <div className="section-heading split"><div><h2 id="type-g-live-title">これからのtype-G予想</h2><p>開始時刻が近い順。各レース3点・合計¥300で比較します。</p></div><span className="type-g-count">{live.length}レース</span></div>
      {live.length ? <div className="type-g-live-list">{live.map((pair, index) => <LiveCard pair={pair} next={index === 0} key={pair.raceId} />)}</div> : <div className="edge-empty"><CircleHelp aria-hidden="true" /><div><h3>現在、締切前のtype-G予想はありません</h3><p>朝の予測が固定されると、ここに最大10レースを表示します。</p></div></div>}
    </section>

    <section className="type-g-history" aria-labelledby="type-g-history-title">
      <div className="section-heading split"><div><p className="section-kicker">VERIFICATION LEDGER</p><h2 id="type-g-history-title">終了したレース・検証結果</h2><p>現行HITとtype-Gを、Top1・Top3・Top5・Top8の同じ点数で比較します。</p></div><span className="type-g-count">記録 {summary.races}レース</span></div>
      <div className="type-g-summary">
        <div><span>結果確定</span><strong>{summary.settled}R</strong></div>
        <div><span>買い目変更</span><strong>{summary.changed}R</strong></div>
        <div><span>購入点数</span><strong>{summary.races * 3}点</strong><small>{formatYen(summary.purchaseStake)}</small></div>
        <div><span>type-G的中</span><strong>{summary.typeGHits}R</strong></div>
        <div><span>的中払戻合計</span><strong>{formatYen(summary.typeGReturned)}</strong></div>
        <div><span>検証回収率</span><strong>{summary.typeGReturnRate == null ? "—" : `${summary.typeGReturnRate.toFixed(1)}%`}</strong></div>
      </div>

      {topK.length > 0 && <div className="type-g-topk-wrap"><table className="type-g-topk"><thead><tr><th>購入点数</th><th>現行HIT</th><th>type-G</th><th>差</th></tr></thead><tbody>{topK.map((stat) => <tr key={stat.k}><th>Top{stat.k}</th><td>{stat.controlHitRate?.toFixed(1) ?? "—"}% <small>{stat.controlHits}/{stat.settled}</small></td><td>{stat.typeGHitRate?.toFixed(1) ?? "—"}% <small>{stat.typeGHits}/{stat.settled}</small></td><td className={(stat.typeGHitRate ?? 0) >= (stat.controlHitRate ?? 0) ? "plus" : "minus"}>{stat.typeGHitRate == null || stat.controlHitRate == null ? "—" : `${(stat.typeGHitRate - stat.controlHitRate).toFixed(1)}pt`}</td></tr>)}</tbody></table></div>}

      {history.length ? <TypeGLedger pairs={history} /> : <div className="edge-empty"><CircleHelp aria-hidden="true" /><div><h3>検証結果はまだありません</h3><p>type-Gのレース終了後、的中・不的中・払戻をここへ蓄積します。</p></div></div>}
    </section>

    <aside className="type-g-note"><ShieldCheck aria-hidden="true" /><div><strong>検証期間中のモデルです</strong><p>type-Gの買い目は検証用です。現行HITの公開予想・成績、EDGEの検証結果とは完全に分けて集計します。オッズと払戻は予測に使用しません。</p></div></aside>
    <Link href="/edge" className="type-g-edge-link">EDGE期待値検証を見る <ArrowRight aria-hidden="true" /></Link>
  </>;
}
