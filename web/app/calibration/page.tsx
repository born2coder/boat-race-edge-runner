import Link from "next/link";
import { FactorialComparison, MarketComparison, StrategyComparison } from "./strategy-comparison";
import styles from "./calibration.module.css";
import { loadCalibration } from "@/db/calibration-repository";
import { PageTitle } from "@/components/four-page-common";
import { jstDate } from "@/lib/four-page";

export const dynamic = "force-dynamic";
export const metadata = { title: "確率とオッズの補正検証｜BOAT RACE EDGE" };
const format = (value: number | null | undefined) => value == null ? "未評価" : value.toFixed(4);
const percent = (value: number | null | undefined) => value == null ? "未評価" : `${(value * 100).toFixed(2)}％`;
const period = (dates: string[]) => dates.length ? `${dates[0]}〜${dates.at(-1)}（${dates.length}日）` : "データ待ち";
const verdict = (passed: boolean, hasData: boolean, collecting: boolean) =>
  !hasData ? "比較に必要なデータを集めています" : collecting ? "まだデータが少なく、判断待ちです" :
    passed ? "今回の検証では、改善の条件を満たしました" : "今回の検証では、改善の条件を満たしていません";
function ComparisonBars({ title, before, after, percentage = false }: { title: string; before: number | null | undefined; after: number | null | undefined; percentage?: boolean }) {
  const max = Math.max(before ?? 0, after ?? 0, .000001);
  return <figure className={styles.chart}><figcaption>{title}</figcaption>
    {before == null || after == null ? <p className={styles.empty}>比較用のデータが揃うと、ここにグラフが表示されます。</p> : <>
      {[["補正前", before], ["補正後", after]].map(([label, value], index) => <div className={styles.barRow} key={String(label)}>
        <span>{label}</span><div className={styles.track}><div className={index ? styles.after : styles.before} style={{ width: `${Number(value) / max * 100}%` }} /></div><strong>{percentage ? percent(Number(value)) : format(Number(value))}</strong>
      </div>)}
      <small>{percentage ? "回収率100％が収支ゼロの目安です。" : "棒が短いほど、予測と実際のズレが小さいことを表します。"}</small>
    </>}
  </figure>;
}
function ReliabilityChart({ result }: { result: { reliability: { upper: number; predicted: number; actual: number; tickets: number }[] } | null }) {
  if (!result) return <p className={styles.empty}>的中結果が揃うとグラフが表示されます。</p>;
  const rows = result.reliability.filter(row => row.tickets > 0);
  const max = Math.max(...rows.flatMap(row => [row.predicted, row.actual]), .000001);
  return <figure className={styles.chart}>
    <figcaption>予測した確率と、実際の的中率</figcaption>
    <p className={styles.legend}><span>━ 予測</span><span>━ 実際</span>　2本の長さが近いほど、見積もりが実際に近い</p>
    {rows.map(row => <div className={styles.reliabilityRow} key={row.upper}>
      <span>予測平均 {percent(row.predicted)}<small>{row.tickets.toLocaleString("ja-JP")}点</small></span>
      <div><div className={styles.barRow}><div className={styles.track}><div className={styles.before} style={{ width: `${row.predicted / max * 100}%` }} /></div><strong>{percent(row.predicted)}</strong></div>
      <div className={styles.barRow}><div className={styles.track}><div className={styles.after} style={{ width: `${row.actual / max * 100}%` }} /></div><strong>{percent(row.actual)}</strong></div></div>
    </div>)}
    <small>確率の範囲ごとに集計しています。各棒は0％から始まり、このグラフ内で同じ目盛りです。</small>
  </figure>;
}
export default async function CalibrationPage() {
  const report = await loadCalibration();
  return <div className={`fp-page ${styles.page}`}>
    <PageTitle title="確率とオッズの補正検証" subtitle="「どれくらい当たるか」「最後に何倍になるか」の見積もりを、実際の結果と比べます。" />
    <Link href="/performance" prefetch={false}>← 運用成績</Link>
    <p className={styles.notice}>現在は比較検証中です。HITモデルはそのままです。ここで試す補正は、購入推奨や既存の成績には反映していません。</p>
    {!report ? <p role="status">検証結果をまだ表示できません。集計が未作成か、読み込みに失敗しています。改善したかどうかは未確認です。</p> : <>
      <p>集計基準：{report.asOf} 日本時間0時より前に確認できた記録</p>
      {report.asOf !== jstDate() && <p role="status">最新営業日の集計ではありません。表示中の日付をご確認ください。</p>}
      <dl className={styles.periods}><dt>補正のしかたを決めるために使った期間</dt><dd>{period(report.trainDates)}</dd><dt>効果を確かめるために使った別の期間</dt><dd>{period(report.testDates)}</dd></dl>
      <p>補正を作ったときと同じレースで採点すると、よく見えすぎることがあります。そのため、別の日の結果で効果を確かめます。</p>
      <p>判断には、補正を作る記録が{report.minTrainDays}日以上、効果を確かめる記録が{report.minTestDays}日以上、それぞれ{report.minRaces}レース以上必要です。</p>
      <section className={styles.overview} aria-labelledby="overview-title">
        <h2 id="overview-title">まずは全体の状況</h2>
        <p>見たい時刻を押すと、詳しい比較へ移動できます。件数は効果を確かめるための記録です。</p>
        <div className={styles.tableScroll} tabIndex={0} role="region" aria-label="時刻ごとの検証状況"><table>
          <thead><tr><th scope="col">締切まで</th><th scope="col">確率の記録</th><th scope="col">確定オッズの記録</th><th scope="col">検証状況</th></tr></thead>
          <tbody>{Object.entries(report.phases).map(([key, phase]) => <tr key={key}>
            <th scope="row"><a href={`#phase-${key}`}>{key.slice(1)}分前 ↓</a></th><td>{phase.testRaces}レース</td><td>{phase.finalGridTestRaces}レース</td>
            <td><span className={styles.badge}>{phase.status === "collecting" ? "データ蓄積中" : phase.status === "review_ready" ? "改善条件を達成・未採用" : "改善を確認できず"}</span></td>
          </tr>)}</tbody>
        </table></div>
      </section>
      {report.version === "edge-calibration-v1" && <p role="status">表示中は旧方式の集計です。新しい3方式の比較は、次の日次集計が完了すると表示されます。</p>}
      <section className={styles.phase}>
        <h2>市場の予想を、買い目の絞り込みに使う</h2>
        <p>高配当の買い目や、市場より極端に高く見積もった買い目を外すと、収支は変わるでしょうか。現行方式を基準に、4つの条件を並行して試します。</p>
        <ul><li>判定時のオッズが20倍未満</li><li>モデルの確率が、市場から推定した確率の3倍未満</li><li>20倍未満と、乖離3倍未満の両方を満たす</li><li>モデルと市場の確率を半分ずつ混ぜる</li></ul>
        <p>5方式とも元の確率1％以上・係数×0.8・期待回収率120％以上・1点100円です。混合方式だけは、期待回収率の計算に混合した確率を使います。条件を満たす全点を対象とし、点数の上限や順位による絞り込みは加えません。本番の累積購入成績とは別の比較です。</p>
        <details><summary>市場の確率と、乖離の計算方法</summary><p>同じ時刻に取得した全120通りの「1÷オッズ」を、合計が100％になるようにそろえます。これを市場の推定確率とし、モデルの確率を割った値を乖離と呼びます。例えばモデル6％・市場2％なら3倍です。3倍ちょうど、20倍ちょうどは、それぞれの限定条件に含めません。市場の確率も実際の的中率を保証するものではありません。</p></details>
        {!report.marketForwardComparison ? <p role="status">市場比較の新しい購入条件は、まだ集計されていません。次の通常起動から判断を記録し、その後の日次集計で表示します。</p> : <>
          <h3>新しい購入条件を固定した後の成績</h3>
          <p>実装後に締切前の判断を保存し、受領を確認できた確定レースだけを採点します。直近60日分を時刻別に集計し、時刻の違う成績は合算しません。購入点数が減るため、回収率だけでなく収支と的中件数も比べます。</p>
          {Object.entries(report.marketForwardComparison).map(([key, group]) => <details key={key}><summary>約{key.slice(1)}分前：{group.recordedRaces}レースの記録</summary>
            <MarketComparison data={group.policies} title="市場比較：ルール固定後の成績" />
          </details>)}
          <h3>過去データでの参考試算</h3>
          <p>日次レポートの検証期間を使った再計算です。今回の条件は過去の市場比較を見て選んでいるため、この試算だけでは有効性を判定できません。採用の判断には、上のルール固定後の成績を使います。確定オッズの推定や確率補正の学習を使わず、公式の確定払戻で精算します。</p>
          {Object.entries(report.phases).map(([key, phase]) => phase.marketComparison ? <details key={key}><summary>約{key.slice(1)}分前の参考試算</summary>
            <MarketComparison data={phase.marketComparison} title="市場比較：過去の参考試算" />
          </details> : null)}
          <small>比較実験：{report.marketExperimentId}</small>
        </>}
      </section>
      <section className={styles.phase}>
        <h2>確率補正と「×0.8を外す」効果を分けて調べる</h2>
        <p>A：元確率×0.8、B：元確率×1.0、C：補正確率×0.8、D：補正確率×1.0の4方式を比べます。すべて同じ観測オッズを使い、元確率1％以上・期待回収率120％以上・1点100円を共通条件にします。確定オッズの見積もりは、この比較には使いません。</p>
        <p>AとC、BとDで確率補正の効果を、AとB、CとDで×0.8を外す効果を確認できます。各時刻と「全件」「20倍未満」は別々の比較です。</p>
        {!report.factorialForwardComparison ? <p role="status">4方式の集計はまだありません。次の日次集計から表示します。以前の3方式の成績を、新しい4方式の実績として扱うことはありません。</p> : <>
          <h3>実装後に締切前の判断を保存した成績</h3>
          <p>新しい実験の判断を締切前に保存し、受領が確認できた記録だけを採点します。過去の判断を後から作り足すことはありません。</p>
          {Object.entries(report.factorialForwardComparison).map(([key, group]) => <details key={key}><summary>約{key.slice(1)}分前：{group.recordedRaces}レースの記録</summary>
            <FactorialComparison data={group.all} title="4方式の前向き成績：全件" />
            <FactorialComparison data={group.under20} title="4方式の前向き成績：判定時20倍未満" />
          </details>)}
          <h3>過去データでの試算</h3>
          <p>学習に使わなかった検証期間で再計算した参考値です。実装後の成績とは分けて表示します。確率補正用の学習が7日・100レースに満たない場合、4方式とも未評価にします。</p>
          {Object.entries(report.phases).map(([key, phase]) => phase.factorialComparison ? <details key={key}><summary>約{key.slice(1)}分前の試算</summary>
            <FactorialComparison data={phase.factorialComparison.all} title="4方式の過去試算：全件" />
            <FactorialComparison data={phase.factorialComparison.under20} title="4方式の過去試算：判定時20倍未満" />
          </details> : null)}
          <small>比較実験：{report.factorialExperimentId}</small>
        </>}
      </section>
      {report.forwardComparison && <section className={styles.phase}>
        <h2>ルールを決めた後の実績</h2>
        <p>締切前に保存した新方式の判断を、そのまま採点します。結果を見てから買い目を選び直すことはありません。直近{60}日以内の確定分です。各時刻は合算しません。</p>
        {Object.entries(report.forwardComparison).map(([key, group]) => <details key={key}><summary>約{key.slice(1)}分前：{group.recordedRaces}レースの記録</summary>
          <StrategyComparison data={group.all} title="新方式の判断を保存した後の成績" />
          <StrategyComparison data={group.under20} title="判定時20倍未満に絞った成績" />
        </details>)}
      </section>}
      {report.matchedTiming && <section className={styles.phase}>
        <h2>同じレースで、判断する時刻を比べる</h2>
        <p>15・10・5分前すべての記録と確定オッズがある{report.matchedTiming.races}レースを対象にした、過去データでの試算です。各時刻で同じ買い目の集合を評価しますが、購入条件を満たす買い目は変わります。</p>
        {Object.entries(report.matchedTiming.phases).map(([key,group]) => <details key={key}><summary>約{key.slice(1)}分前の判断</summary>
          <StrategyComparison data={group.all} title={`約${key.slice(1)}分前：同じレースで比較`} />
          <StrategyComparison data={group.under20} title="その時点で20倍未満の買い目" />
        </details>)}
      </section>}
      {Object.entries(report.phases).map(([key, phase]) => <section key={key} id={`phase-${key}`} className={styles.phase}>
        <header className={styles.phaseHeader}><h2>締切の約{key.slice(1)}分前</h2><a href="#overview-title">一覧に戻る ↑</a></header>
        <h3>① 「当たる確率」は、実際に近づいた？</h3>
        <p>例えば「10％当たる」と予測した買い目が、実際にも約10％当たっているかを確かめます。</p>
        <p><strong>{verdict(phase.probabilityPass, Boolean(phase.rawProbability && phase.adjustedProbability), phase.status === "collecting")}</strong></p>
        <p>補正を作る記録：{phase.trainRaces}レース ／ 効果を確かめる記録：{phase.testRaces}レース</p>
        <div className={styles.chartGrid}><div><h4>補正前</h4><ReliabilityChart result={phase.rawProbability} /></div><div><h4>補正後</h4><ReliabilityChart result={phase.adjustedProbability} /></div></div>
        <p className={styles.note}>補正前後では、各範囲に入る買い目やグラフの最大値が変わります。それぞれのグラフ内で「予測」と「実際」を比べてください。データ蓄積中の数値は参考値です。</p>
        <details><summary>グラフの元になった数値を見る</summary>
          {([['補正前', phase.rawProbability], ['補正後', phase.adjustedProbability]] as const).map(([label, result]) => <div key={label}>
            <h4>{label}</h4>
            {!result ? <p>まだ比較できるデータがありません。</p> : <div style={{ overflowX: "auto" }}><table>
              <thead><tr><th scope="col">予測した確率の範囲</th><th scope="col">調べた買い目</th><th scope="col">平均の予測</th><th scope="col">実際の的中率</th></tr></thead>
              <tbody>{result.reliability.map(row => {
                const bounds = [0, .005, .01, .02, .05, .1, .2, 1.01];
                const lower = bounds[bounds.indexOf(row.upper) - 1] ?? 0;
                return <tr key={row.upper}><th scope="row">{percent(lower)}〜{percent(Math.min(row.upper, 1))}{row.upper <= 1 ? '未満' : ''}</th><td>{row.tickets.toLocaleString('ja-JP')}点</td><td>{percent(row.predicted)}</td><td>{percent(row.actual)}</td></tr>;
              })}</tbody>
            </table></div>}
          </div>)}
          <p>補正によって確率が変わるため、補正前後で各範囲に入る買い目も変わります。</p>
        </details>
        <h3>② 「最後のオッズ」は、見積もりに近かった？</h3>
        <p>途中で100倍だったオッズが、締切後には何倍になったかを調べ、下がる分も織り込んだ見積もりを試します。</p>
        <p><strong>{verdict(phase.oddsPass, phase.oddsValidation.tickets > 0, phase.status === "collecting")}</strong></p>
        <p>全120通りの確定オッズがある記録：補正用{phase.finalGridTrainRaces}レース ／ 検証用{phase.finalGridTestRaces}レース</p>
        <ComparisonBars title="最後のオッズの見積もりのズレ" before={phase.oddsValidation.rawLogError} after={phase.oddsValidation.adjustedLogError} />
        <p className={styles.note}>ズレは平均対数誤差で比較しています。オッズの倍率そのものではありません。</p>
        <h3>補正して選ぶと、戻ってくる金額は増えた？</h3>
        <p>実際には購入せず、1点100円で買ったと仮定して比べます。回収率100％なら収支ゼロ、100％未満なら赤字です。</p>
        <StrategyComparison data={phase.policyComparison} title={report.version !== "edge-calibration-v1" ? "過去データでの試算：従来の3つの計算方法" : "旧方式の試算：補正前と補正後"} />
        {phase.under20Comparison && <details><summary>判定時20倍未満に絞った場合</summary><StrategyComparison data={phase.under20Comparison} title="過去データでの試算：20倍未満" /></details>}
        <details><summary>詳しい採点方法と数値（専門指標）</summary>
          <p>以下の誤差の点数は、小さいほど実際の結果に近いことを表します。的中率や金額そのものではありません。</p>
          <div style={{ overflowX: "auto" }}><table>
          <thead><tr><th scope="col">指標</th><th scope="col">補正前</th><th scope="col">補正後</th></tr></thead>
          <tbody>
            <tr><th scope="row">確率の対数損失</th><td>{format(phase.rawProbability?.logLoss)}</td><td>{format(phase.adjustedProbability?.logLoss)}</td></tr>
            <tr><th scope="row">確率のBrierスコア</th><td>{format(phase.rawProbability?.brier)}</td><td>{format(phase.adjustedProbability?.brier)}</td></tr>
            <tr><th scope="row">確定オッズの平均対数誤差</th><td>{format(phase.oddsValidation.rawLogError)}</td><td>{format(phase.oddsValidation.adjustedLogError)}</td></tr>
          </tbody>
        </table></div></details>
      </section>)}
      <p>各時刻の成績は別々の試算です。同じ買い目が含まれるため、20分前・15分前などの成績は合算しないでください。改善の条件を満たしても、自動で購入推奨に切り替わることはありません。</p>
      <details><summary>比較条件・計算方法を確認する</summary>
        <p>1点100円・期待値120％以上で計算。現行は元の確率×0.8×観測オッズ、確率だけ補正は補正確率×観測オッズ、両方の補正は補正確率×控えめな確定オッズ見積もりです。新方式では3方式とも元の確率1％以上を条件にします。比較対象は確定オッズと補正係数が揃う同じ買い目の集合に限定しています。</p>
        <p>控えめなオッズには、過去の倍率変化の下位25％点を使います。最低払戻の保証ではありません。検証通過も将来の利益を保証するものではありません。</p>
        <small>補正バージョン：{report.artifactId}</small>
      </details>
    </>}
  </div>;
}

