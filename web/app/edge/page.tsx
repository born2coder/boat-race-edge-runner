import Link from "next/link";
import { getEdgeV2Day, getEdgeV2Index, getEdgeV2Summary, validDate } from "@/db/edge-v2-repository";
import { todayJst } from "@/db/live-repository";
import { isPublicBeforeDeadline, selectedPicks, thresholds, type EdgeRaceV2, type Snapshot, type Phase, type Model, type Comparison } from "@/lib/edge-v2";

export const dynamic = "force-dynamic";
export const metadata = { title: "EDGE｜全120通りの期待値検証", description: "朝と展示後の全120通りを同じオッズで比較。20・15・10分前の観測と確定結果を記録します。", alternates: { canonical: "/edge" } };
const yen = (n: number) => `¥${n.toLocaleString("ja-JP")}`;
const percent = (n: number | null | undefined) => n == null ? "—" : `${n.toFixed(1)}%`;
const time = (value: string) => new Date(value).toLocaleTimeString("ja-JP", {timeZone: "Asia/Tokyo", hour: "2-digit", minute: "2-digit", second: "2-digit"});
const phaseLabels: Record<Phase, string> = {t20: "20分前", t15: "15分前", t10: "10分前"};
const modelLabels = {morning: "朝の確率", exhibition: "展示後の確率"};

function ComparisonTable({rows, paired = false}: {rows: Comparison[]; paired?: boolean}) {
  return <div className="edge-v2-table"><table><thead><tr><th>基準</th>{paired && <th>確率</th>}<th>確定点数</th><th>的中</th><th>回収率</th><th>表示期待値</th><th>未確定</th></tr></thead>
    <tbody>{rows.map((r) => <tr key={`${r.threshold}-${r.model}`}><th>{r.threshold}%以上</th>{paired && <td>{modelLabels[r.model]}</td>}<td>{r.settled_points}</td><td>{r.hits}</td><td>{percent(r.return_rate)}</td><td>{percent(r.mean_expected_value)}</td><td>{r.pending_points}</td></tr>)}</tbody></table>
    {!rows.length && <p className="edge-v2-empty">新方式の前向き記録を待っています。旧方式の実績は合算しません。</p>}</div>;
}

function RaceCard({race, snapshot, phase, model, threshold}: {race: EdgeRaceV2; snapshot: Snapshot; phase: Phase; model: Model; threshold: number}) {
  const picks = selectedPicks(snapshot, model, threshold);
  const published = race.receipts?.[snapshot.snapshot_id];
  const eligible = isPublicBeforeDeadline(race, snapshot);
  const result = race.result;
  const hits = picks.filter((p) => p.combination === result?.combination);
  const refunded = picks.filter((p) => p.combination.split("-").some((lane) => result?.refunded_lanes?.includes(Number(lane))));
  const closed = Date.parse(race.start_at) <= Date.now();
  const status = !eligible ? published ? "締切前公開の条件外" : "公開確認中" : result ? hits.length ? "的中" : "不的中" : closed ? "結果確認中" : "検証候補";
  return <details className="edge-v2-race">
    <summary><span>{race.venue} {race.race_no}R <small>締切 {time(race.start_at).slice(0, 5)}</small></span><b>{status}</b><span>{picks.length}点 {eligible && result && <small>払戻 {yen(hits.length ? result.payout_per_100_yen : 0)}</small>}</span></summary>
    <div className="edge-v2-race-body"><p>{phaseLabels[phase]}の記録・{modelLabels[model]} ／ 各100円、計{yen(picks.length * 100)}{refunded.length > 0 && `（${refunded.length}点返還・回収率の分母から除外）`}</p>
      <p className="edge-v2-meta">取得 {time(snapshot.observed_at)}（実測{snapshot.minutes_before.toFixed(1)}分前）／ 公式更新 {snapshot.official_update_time} ／ 公開確認 {published ? time(published) : "確認中"}</p>
      {result && <p>結果 <strong>{result.combination}</strong>・100円あたり{yen(result.payout_per_100_yen)}</p>}
      <div className="edge-v2-table"><table><thead><tr><th>買い目</th><th>確率順位</th><th>確率</th><th>選択時オッズ</th><th>期待値</th><th>20分前</th><th>15分前</th><th>10分前</th><th>確定</th></tr></thead>
        <tbody>{picks.map((pick) => <tr key={pick.combination} className={pick.combination === result?.combination ? "edge-v2-hit" : ""}><th>{pick.combination}</th><td>{pick.rank}位</td><td>{percent(pick.probability * 100)}</td><td>{pick.odds.toFixed(1)}倍</td><td>{percent(pick.expected)}</td>
          {(["t20", "t15", "t10"] as Phase[]).map((p) => {const s = race.snapshots[p]; const i = s?.combinations.indexOf(pick.combination) ?? -1;return <td key={p}>{s && i >= 0 ? `${s.odds[i].toFixed(1)}倍 / ${(pick.probability * s.odds[i] * 100).toFixed(0)}%` : closed ? "未取得" : "待機"}</td>;})}
          <td>{race.final?.odds[pick.combination] != null ? `${race.final.odds[pick.combination].toFixed(1)}倍 / ${(pick.probability * race.final.odds[pick.combination] * 100).toFixed(0)}%` : pick.combination === result?.combination ? `${(result.payout_per_100_yen / 100).toFixed(1)}倍（払戻）` : "未取得"}</td></tr>)}</tbody></table></div>
      <p className="edge-v2-meta">各時点は「オッズ / 期待値」。選択時点の確率を固定し、オッズ変動だけで基準を割った時点を確認できます。公開遅延：{published ? `${Math.max(0, (Date.parse(published) - Date.parse(snapshot.observed_at)) / 1000).toFixed(0)}秒` : "未確認"}。</p>
      {!race.final && closed && <p className="edge-v2-meta">全120通りの確定オッズは未取得です。的中買い目の払戻だけで全体のオッズ低下率を推定しません。</p>}
      <p><a href={`https://github.com/born2coder/boat-race-edge-runner/blob/main/state/edge_v2/days/${race.race_date}.json`} target="_blank" rel="noreferrer">この日の全120通りの記録</a></p>
    </div></details>;
}

export default async function EdgePage({searchParams}: {searchParams: Promise<Record<string, string | string[] | undefined>>}) {
  const query = await searchParams;
  const today = todayJst();
  const date = typeof query.date === "string" && validDate(query.date) ? query.date : today;
  const phase: Phase = query.phase === "t15" || query.phase === "t10" ? query.phase : "t20";
  const model: Model = query.model === "exhibition" ? "exhibition" : "morning";
  const threshold = thresholds.find((t) => String(t) === query.threshold) ?? 150;
  const page = Math.max(1, Math.min(100, Number(query.page) || 1));
  const [index, day, dailySummary] = await Promise.all([getEdgeV2Index(), getEdgeV2Day(date), getEdgeV2Summary(date)]);
  const dailyRows = dailySummary?.comparison.filter((r) => !r.paired && r.scope === "all120" && r.model === model && r.phase === phase) ?? [];
  const progress = index?.days.find((d) => d.date === date)?.progress;
  const rows = index?.comparison.filter((r) => !r.paired && r.scope === "all120" && r.model === model && r.phase === phase) ?? [];
  const paired = index?.comparison.filter((r) => r.paired && r.scope === "all120" && r.phase === phase) ?? [];
  const scopeRows = index?.comparison.filter((r) => !r.paired && r.model === model && r.phase === phase && r.threshold === threshold) ?? [];
  const races = Object.values(day?.races ?? {});
  const chosen = races.filter((race) => {const s = race.snapshots[phase];return s && selectedPicks(s, model, threshold).length > 0;});
  const live = chosen.filter((r) => Date.parse(r.start_at) > Date.now()).sort((a,b) => Date.parse(a.start_at) - Date.parse(b.start_at));
  const past = chosen.filter((r) => Date.parse(r.start_at) <= Date.now()).sort((a,b) => Date.parse(b.start_at) - Date.parse(a.start_at));
  const heartbeatAge = progress?.last_tick_at ? (Date.now() - Date.parse(progress.last_tick_at)) / 60000 : null;
  const jstHour = Number(new Intl.DateTimeFormat("en-GB", {timeZone: "Asia/Tokyo", hour: "2-digit", hourCycle: "h23"}).format(new Date()));
  const stale = date === today && jstHour >= 7 && jstHour < 22 && (heartbeatAge == null || heartbeatAge > 5);
  const pages = Math.max(1, Math.ceil(past.length / 20));
  const currentPage = Math.min(page, pages);
  const pageLink = (p: number) => `/edge?${new URLSearchParams({date, phase, model, threshold: String(threshold), page: String(p)})}#edge-history`;
  return <div className="edge-v2">
    <Link className="back-link" href="/">今日のHIT予想へ</Link>
    <p className="section-kicker">EDGE / FULL 120</p><h1>全120通りから、<br/>市場とのずれを探す。</h1>
    <p className="edge-v2-lead">朝・展示後の予測確率と、20・15・10分前のオッズを比較します。新方式は前向き検証中です。</p>
    <p><Link href="/edge/legacy">旧方式（上位8点限定）の履歴を見る →</Link></p>
    <form className="edge-v2-controls" action="/edge">
      <label>開催日<input type="date" name="date" defaultValue={date}/></label>
      <label>確率<select name="model" defaultValue={model}><option value="morning">朝</option><option value="exhibition">展示後</option></select></label>
      <label>観測時点<select name="phase" defaultValue={phase}>{Object.entries(phaseLabels).map(([key,label]) => <option key={key} value={key}>{label}</option>)}</select></label>
      <label>期待値基準<select name="threshold" defaultValue={threshold}>{thresholds.map((t) => <option key={t} value={t}>{t}%以上</option>)}</select></label><button type="submit">表示する</button>
    </form>
    <section className={`edge-v2-health ${stale || progress?.last_error ? "warning" : ""}`}>
      <strong>{stale ? "監視更新を確認できていません" : progress?.last_error ? "取得処理の異常を検出" : "この日の観測状況"}</strong>
      <p>対象 {progress?.scheduled ?? "—"}R ／ 20分前 {progress?.phases.t20 ?? 0}R ／ 15分前 {progress?.phases.t15 ?? 0}R ／ 10分前 {progress?.phases.t10 ?? 0}R ／ 確定オッズ {progress?.final_grids ?? 0}R</p>
      <p>取得窓を過ぎた未取得：20分前 {progress?.missed.t20 ?? "—"}R・15分前 {progress?.missed.t15 ?? "—"}R・10分前 {progress?.missed.t10 ?? "—"}R</p>
      <small>最終監視 {progress?.last_tick_at ? time(progress.last_tick_at) : "未確認"}。候補なしと取得できなかったレースを分けて表示します。</small>
    </section>
    <section><h2>これからのレース <small>{live.length}R</small></h2>
      {!live.length && <p className="edge-v2-empty">選択した条件の候補はありません。{model === "exhibition" && "展示情報が揃わないレースは、朝の確率で代用しません。"}</p>}
      {live.map((race) => <RaceCard key={race.race_id} race={race} snapshot={race.snapshots[phase]!} {...{phase,model,threshold}}/>)}</section>
    <section><h2>{date}の成績</h2><p>{phaseLabels[phase]}・{modelLabels[model]}。各点100円の検証成績です。</p><ComparisonTable rows={dailyRows}/></section>
    <section><h2>固定した閾値の比較</h2><p>新方式の全期間・{phaseLabels[phase]}・{modelLabels[model]}。締切前の公開を確認できた記録のみ、各点100円で集計します。</p><ComparisonTable rows={rows}/></section>
    <section><h2>全120通りに広げた効果</h2><p>同じ時刻・同じ確率・{threshold}%基準で比較します。点数に応じて投資額が変わるため、払戻合計だけで優劣を決めません。</p>
      <div className="edge-v2-table"><table><thead><tr><th>対象順位</th><th>確定点数</th><th>的中</th><th>投資</th><th>払戻</th><th>回収率</th></tr></thead><tbody>{scopeRows.map((r) => <tr key={r.scope}><th>{{all120: "全120通り", top8: "上位8点", rank9plus: "追加9〜120位"}[r.scope]}</th><td>{r.settled_points}</td><td>{r.hits}</td><td>{yen(r.stake_yen)}</td><td>{yen(r.payout_yen)}</td><td>{percent(r.return_rate)}</td></tr>)}</tbody></table>{!scopeRows.length && <p>記録待ち</p>}</div>
    </section>
    <details className="edge-v2-comparison"><summary>朝と展示後を、同じレース・同じオッズで比較</summary><p>{phaseLabels[phase]}に両方の確率が揃い、締切前公開を確認できた共通レースのみです。展示情報の欠測を朝モデルの成績に混ぜません。</p><ComparisonTable rows={paired} paired/>
      {paired.filter((r) => r.threshold === 150).map((r) => <p key={r.model}>{modelLabels[r.model]}：共通 {r.paired_races}R ／ 確率評価 {r.scored_races}R ／ Log loss {r.scored_races ? (r.log_loss_sum/r.scored_races).toFixed(4) : "—"} ／ Brier {r.scored_races ? (r.brier_sum/r.scored_races).toFixed(4) : "—"}</p>)}
      <p className="edge-v2-meta">確率評価は閾値に関係なく全120通りで計算します。どちらも低いほど良く、返還・中止レースは除外します。</p>
    </details>
    <section id="edge-history"><h2>{date}の履歴 <small>{past.length}R</small></h2><p>候補を後から消さず、観測時点ごとに残します。別の時点で基準割れしても元の記録は維持します。</p>
      {!past.length && <p className="edge-v2-empty">選択条件の履歴はありません。</p>}
      {past.slice((currentPage-1)*20, currentPage*20).map((race) => <RaceCard key={race.race_id} race={race} snapshot={race.snapshots[phase]!} {...{phase,model,threshold}}/>)}
      {pages > 1 && <nav className="edge-v2-pagination" aria-label="履歴ページ">{currentPage > 1 && <Link href={pageLink(currentPage-1)}>前へ</Link>}<span>{currentPage} / {pages}</span>{currentPage < pages && <Link href={pageLink(currentPage+1)}>次へ</Link>}</nav>}
      <nav className="edge-v2-dates" aria-label="記録済みの日付">{index?.days.map((d) => <Link key={d.date} href={`/edge?${new URLSearchParams({date:d.date,phase,model,threshold:String(threshold)})}`}>{d.date}</Link>)}</nav>
    </section>
    <aside className="edge-disclaimer"><strong>表示期待値は、利益や信頼度の保証ではありません。</strong><p>予測確率×観測時オッズ×100で計算します。確率の誤差と締切までのオッズ変動は未補正です。300%以上も強い予想とは扱いません。未確定は回収率から除き、返還は投資額から除外します。HITと旧EDGEの成績には合算しません。</p></aside>
  </div>;
}
