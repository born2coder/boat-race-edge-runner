import Link from "next/link";
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
const money = (value: number) => `${value.toLocaleString("ja-JP")}円`;
export default async function CalibrationPage() {
  const report = await loadCalibration();
  return <div className="fp-page">
    <PageTitle title="確率とオッズの補正検証" subtitle="「どれくらい当たるか」「最後に何倍になるか」の見積もりを、実際の結果と比べます。" />
    <Link href="/performance" prefetch={false}>← 運用成績</Link>
    <p>現在は比較検証中です。HITモデルはそのままです。ここで試す補正は、購入推奨や既存の成績には反映していません。</p>
    {!report ? <p role="status">検証結果をまだ表示できません。集計が未作成か、読み込みに失敗しています。改善したかどうかは未確認です。</p> : <>
      <p>集計基準：{report.asOf} 日本時間0時より前に確認できた記録</p>
      {report.asOf !== jstDate() && <p role="status">最新営業日の集計ではありません。表示中の日付をご確認ください。</p>}
      <dl><dt>補正のしかたを決めるために使った期間</dt><dd>{period(report.trainDates)}</dd><dt>効果を確かめるために使った別の期間</dt><dd>{period(report.testDates)}</dd></dl>
      <p>補正を作ったときと同じレースで採点すると、よく見えすぎることがあります。そのため、別の日の結果で効果を確かめます。</p>
      <p>判断には、補正を作る記録が{report.minTrainDays}日以上、効果を確かめる記録が{report.minTestDays}日以上、それぞれ{report.minRaces}レース以上必要です。</p>
      {Object.entries(report.phases).map(([key, phase]) => <section key={key} style={{ marginBlock: 28 }}>
        <h2>締切の約{key.slice(1)}分前 — {phase.status === "collecting" ? "データ蓄積中" : phase.status === "review_ready" ? "改善の条件を満たしました・まだ未採用" : "改善の確認はまだできていません"}</h2>
        <h3>① 「当たる確率」は、実際に近づいた？</h3>
        <p>例えば「10％当たる」と予測した買い目が、実際にも約10％当たっているかを確かめます。</p>
        <p><strong>{verdict(phase.probabilityPass, Boolean(phase.rawProbability && phase.adjustedProbability), phase.status === "collecting")}</strong></p>
        <p>補正を作る記録：{phase.trainRaces}レース ／ 効果を確かめる記録：{phase.testRaces}レース</p>
        <details><summary>確率ごとの「予測」と「実際」を見る</summary>
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
        <h3>補正して選ぶと、戻ってくる金額は増えた？</h3>
        <p>実際には購入せず、1点100円で買ったと仮定して比べます。回収率100％なら収支ゼロ、100％未満なら赤字です。</p>
        {!phase.policyComparison.baseline.tickets && !phase.policyComparison.adjusted.tickets && <p>まだ購入成績を比較できません。下の0点は、比較できた購入がないことを表します。</p>}
        <div style={{ overflowX: "auto" }}><table>
          <thead><tr><th scope="col">比較するもの</th><th scope="col">これまでの計算</th><th scope="col">補正した計算</th></tr></thead>
          <tbody>
            <tr><th scope="row">回収率</th><td>{percent(phase.policyComparison.baseline.roi)}</td><td>{percent(phase.policyComparison.adjusted.roi)}</td></tr>
            <tr><th scope="row">買ったと仮定した点数／当たった点数</th><td>{phase.policyComparison.baseline.tickets}／{phase.policyComparison.baseline.hits}</td><td>{phase.policyComparison.adjusted.tickets}／{phase.policyComparison.adjusted.hits}</td></tr>
            <tr><th scope="row">使った金額</th><td>{money(phase.policyComparison.baseline.stake)}</td><td>{money(phase.policyComparison.adjusted.stake)}</td></tr>
            <tr><th scope="row">戻った金額</th><td>{money(phase.policyComparison.baseline.payout)}</td><td>{money(phase.policyComparison.adjusted.payout)}</td></tr>
            <tr><th scope="row">差し引きの収支</th><td>{money(phase.policyComparison.baseline.payout - phase.policyComparison.baseline.stake)}</td><td>{money(phase.policyComparison.adjusted.payout - phase.policyComparison.adjusted.stake)}</td></tr>
          </tbody>
        </table></div>
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
        <p>1点100円・期待値120％以上で計算。補正前は従来の確率×0.8×観測オッズ、補正後は補正確率×控えめな確定オッズ見積もりです。比較対象は確定オッズと補正係数が揃う同じ買い目の集合に限定しています。</p>
        <p>控えめなオッズには、過去の倍率変化の下位25％点を使います。最低払戻の保証ではありません。検証通過も将来の利益を保証するものではありません。</p>
        <small>補正バージョン：{report.artifactId}</small>
      </details>
    </>}
  </div>;
}
