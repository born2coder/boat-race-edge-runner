import Link from "next/link";
import { ArrowLeft, CircleHelp, Clock3, FlaskConical, ShieldCheck } from "lucide-react";
import { getEdgeDashboard, type EdgeCandidate } from "@/db/live-repository";
import { formatYen } from "@/lib/poc";

export const metadata = { title: "EDGE検証｜オッズと予測の比較", description: "舟の理のHIT予測と締切前オッズを比較し、期待値を検証するページです。", alternates: { canonical: "/edge" } };
export const dynamic = "force-dynamic";

const dateLabel = (value: string) => new Intl.DateTimeFormat("ja-JP", { timeZone: "Asia/Tokyo", dateStyle: "short" }).format(new Date(value));
const timeLabel = (value: string) => new Intl.DateTimeFormat("ja-JP", { timeZone: "Asia/Tokyo", hour: "2-digit", minute: "2-digit" }).format(new Date(value));

type EdgeRaceGroup = { race_id: string; venue_name: string; race_no: number; start_at: string; candidates: EdgeCandidate[] };

function groupByRace(candidates: EdgeCandidate[]): EdgeRaceGroup[] {
  const groups = new Map<string, EdgeRaceGroup>();
  for (const candidate of candidates) {
    const group = groups.get(candidate.race_id) ?? {
      race_id: candidate.race_id,
      venue_name: candidate.venue_name,
      race_no: candidate.race_no,
      start_at: candidate.start_at,
      candidates: [],
    };
    group.candidates.push(candidate);
    groups.set(candidate.race_id, group);
  }
  return Array.from(groups.values());
}

function sortByStart(groups: EdgeRaceGroup[], direction: "asc" | "desc" = "asc") {
  return [...groups].sort((left, right) => direction === "asc"
    ? Date.parse(left.start_at) - Date.parse(right.start_at)
    : Date.parse(right.start_at) - Date.parse(left.start_at));
}

function uniqueRaces(groups: EdgeRaceGroup[]) {
  return Array.from(new Map(groups.map((group) => [group.race_id, group])).values());
}

function PickList({ candidates }: { candidates: EdgeCandidate[] }) {
  return <div className="edge-pick-list">{candidates.map((candidate) => <section className={`edge-pick ${candidate.hit ? "hit" : ""}`} key={candidate.edge_id}>
    <div className="edge-pick-heading"><strong>{candidate.combination}</strong>{candidate.hit && <span>的中</span>}</div>
    <dl>
      <div><dt>確率</dt><dd>{(candidate.predicted_probability * 100).toFixed(1)}%</dd></div>
      <div><dt>オッズ</dt><dd>{candidate.odds_decimal.toFixed(1)}倍</dd></div>
      <div><dt>期待値</dt><dd>{candidate.expected_value_percent.toFixed(0)}%</dd></div>
    </dl>
  </section>)}</div>;
}

function LiveRaceCard({ group, isNext }: { group: EdgeRaceGroup; isNext: boolean }) {
  const strongest = Math.max(...group.candidates.map((candidate) => candidate.expected_value_percent));
  return <article className={`edge-live-card ${isNext ? "next" : ""}`}>
    <header>
      <div className="edge-live-time"><span>{isNext ? "NEXT" : "締切"}</span><strong>{timeLabel(group.start_at)}</strong></div>
      <div className="edge-live-race"><strong>{group.venue_name} {group.race_no}R</strong><span>{group.candidates.length}点</span></div>
      {strongest >= 300 && <b>強いEDGE</b>}
    </header>
    <PickList candidates={group.candidates} />
  </article>;
}

function HistoryRaceRow({ group, now }: { group: EdgeRaceGroup; now: string }) {
  const settled = group.candidates.every((candidate) => candidate.status === "settled");
  const hit = group.candidates.some((candidate) => candidate.hit);
  const pending = !settled && Date.parse(group.start_at) <= Date.parse(now);
  const result = group.candidates.find((candidate) => candidate.status === "settled");
  return <details className={`edge-history-row ${hit ? "hit" : ""}`}>
    <summary>
      <span className="edge-history-date">{dateLabel(group.start_at)} {timeLabel(group.start_at)}</span>
      <strong>{group.venue_name} {group.race_no}R</strong>
      <b>{settled ? (hit ? "的中" : "不的中") : pending ? "結果確認中" : "記録中"}</b>
      <span className="edge-history-result">{settled ? `結果 ${result?.result_combination ?? "—"}` : "公式結果待ち"}</span>
      <span>{group.candidates.length}点</span>
    </summary>
    <div className="edge-history-detail">
      <PickList candidates={group.candidates} />
      {settled && <p className="edge-settlement">3連単払戻 <strong>{result?.payout_per_100_yen == null ? "—" : formatYen(result.payout_per_100_yen)}</strong></p>}
      {pending && <p className="edge-settlement pending">公式結果を確認しています。取得でき次第、反映します。</p>}
      <small>判定 {new Date(group.candidates[0].observed_at).toLocaleString("ja-JP", { timeZone: "Asia/Tokyo" })}</small>
    </div>
  </details>;
}

export default async function EdgePage() {
  const { today, history, progress } = await getEdgeDashboard();
  const now = new Date().toISOString();
  const nowMs = Date.parse(now);
  const todayGroups = groupByRace(today);
  const historyGroups = groupByRace(history);
  const liveGroups = sortByStart(todayGroups.filter((group) => Date.parse(group.start_at) > nowMs
    && !group.candidates.every((candidate) => candidate.status === "settled")));
  const finishedGroups = sortByStart(uniqueRaces([
    ...todayGroups.filter((group) => Date.parse(group.start_at) <= nowMs),
    ...historyGroups,
  ]), "desc");
  const finishedCandidates = finishedGroups.flatMap((group) => group.candidates);
  const settledHistoryGroups = finishedGroups.filter((group) => group.candidates.every((candidate) => candidate.status === "settled"));
  const settledHistory = settledHistoryGroups.flatMap((group) => group.candidates);
  const historyHits = settledHistory.filter((candidate) => candidate.hit);
  const historyReturn = historyHits.reduce((sum, candidate) => sum + (candidate.payout_per_100_yen ?? 0), 0);
  const historyReturnRate = settledHistory.length ? historyReturn / (settledHistory.length * 100) * 100 : null;
  const currentHourJst = Number(new Intl.DateTimeFormat("en-GB", { timeZone: "Asia/Tokyo", hour: "2-digit", hour12: false }).format(new Date()));
  const monitoringEnded = currentHourJst >= 22;

  return <>
    <div className="edge-page-head compact">
      <Link href="/" className="back-link"><ArrowLeft aria-hidden="true" /> 今日の予想へ</Link>
      <p className="section-kicker">LIVE EDGE / {dateLabel(now)}</p>
      <h1>いま買えるEDGE</h1>
      <p className="edge-lead">締切が近い順に表示しています。終了したレースは下の検証履歴へ移動します。</p>
    </div>

    <section className="edge-live" aria-labelledby="edge-live-title">
      <div className="section-heading split">
        <div><h2 id="edge-live-title">これからのレース</h2><p>期待値150%以上の買い目</p></div>
        <span className="edge-count">{liveGroups.length}レース・{liveGroups.reduce((sum, group) => sum + group.candidates.length, 0)}点</span>
      </div>
      {liveGroups.length === 0 ? <div className="edge-empty"><CircleHelp aria-hidden="true" /><div><h3>現在、購入できるEDGE候補はありません</h3><p>新しい候補は、各レースの締切20分前前後に追加されます。</p></div></div> : <div className="edge-live-list">{liveGroups.map((group, index) => <LiveRaceCard group={group} isNext={index === 0} key={group.race_id} />)}</div>}
    </section>

    <section className="edge-progress compact" aria-label="本日の確認状況">
      <div><span>本日の対象</span><strong>{progress.scheduled || "—"}<small>R</small></strong></div>
      <div><span>確認済み</span><strong>{progress.observed}<small>R</small></strong></div>
      <div><span>{monitoringEnded ? "未確認" : "これから確認"}</span><strong>{progress.scheduled ? progress.remaining : "—"}<small>R</small></strong></div>
      <p>{monitoringEnded && progress.remaining > 0 ? "本日の監視は終了しました。未確認数もそのまま公開しています。" : "締切25〜17分前に順次判定します。"} {progress.lastObservedAt ? `最終確認 ${new Date(progress.lastObservedAt).toLocaleTimeString("ja-JP", { timeZone: "Asia/Tokyo", hour: "2-digit", minute: "2-digit" })}` : "まだ本日の判定は始まっていません。"}</p>
    </section>

    <section className="edge-history" aria-labelledby="edge-history-title">
      <div className="section-heading split">
        <div><p className="section-kicker">VERIFICATION LEDGER</p><h2 id="edge-history-title">終了したレース・検証結果</h2><p>レースを選ぶと、記録した買い目の詳細を確認できます。</p></div>
        <span className="edge-count">記録 {finishedGroups.length}レース・{finishedCandidates.length}点</span>
      </div>
      <div className="edge-history-summary">
        <div><span>結果確定</span><strong>{settledHistoryGroups.length}R</strong></div>
        <div><span>的中</span><strong>{historyHits.length}点</strong></div>
        <div><span>検証回収率</span><strong>{historyReturnRate == null ? "—" : `${historyReturnRate.toFixed(1)}%`}</strong></div>
      </div>
      {finishedGroups.length === 0 ? <div className="edge-empty"><CircleHelp aria-hidden="true" /><div><h3>終了したレースはまだありません</h3><p>レース終了後、結果とともにここへ移動します。</p></div></div> : <div className="edge-history-list">{finishedGroups.slice(0, 80).map((group) => <HistoryRaceRow group={group} now={now} key={group.race_id} />)}</div>}
    </section>

    <details className="edge-method">
      <summary>EDGEの判定方法について</summary>
      <section className="edge-explain" aria-labelledby="edge-about-title">
        <div className="edge-explain-main"><p className="section-kicker">HOW IT WORKS</p><h2 id="edge-about-title">「当たりそうなのに、オッズが高い」買い目を探します</h2><p>締切20分前前後にオッズを一度だけ確認し、予測確率と掛け合わせて期待値を計算します。朝の3点予想を変更したり、通常の成績に混ぜたりはしません。</p></div>
        <div className="edge-rule-list"><div><Clock3 aria-hidden="true" /><strong>締切20分前前後</strong><span>オッズ取得時刻を記録</span></div><div><FlaskConical aria-hidden="true" /><strong>150%以上を検証</strong><span>期待値と実結果を比較</span></div><div><ShieldCheck aria-hidden="true" /><strong>通常予想と分離</strong><span>HIT成績には影響なし</span></div></div>
      </section>
    </details>

    <aside className="edge-disclaimer"><strong>検証中の表示です</strong><p>期待値は利益を保証する数字ではありません。オッズは締切まで変動し、予測確率にも誤差があります。このページの候補は通常予想・成績集計とは別管理です。</p></aside>
  </>;
}
