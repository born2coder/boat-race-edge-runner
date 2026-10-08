import Link from "next/link";
import { randomUUID } from "node:crypto";
import { DEFAULT_RULE, RULE_VERSION } from "@/lib/four-page";
import {
  loadDrafts,
  loadRules,
  isolatedFixture,
  requestNow,
  loadRecordingState,
} from "@/db/four-page-repository";
import {
  PageTitle,
  ProbabilityNote,
  CalculationDetails,
  ErrorPanel,
  stamp,
  percent,
  evText,
} from "@/components/four-page-common";
import { RuleDraftForm } from "@/components/rule-draft-form";
export const dynamic = "force-dynamic";
export default async function SettingsPage() {
  const [{ drafts, error }, rules, recording] = await Promise.all([
    loadDrafts(),
    loadRules(),
    loadRecordingState(),
  ]);
  const future = new Date((await requestNow()) + 10 * 3600000)
    .toISOString()
    .slice(0, 16);
  return (
    <div className="fp-page">
      <PageTitle
        title="判定設定"
        subtitle="表示・仮想購入の条件を確認し、変更案を下書きに保存します。"
        test={isolatedFixture()}
      />
      <div className="fp-notice">
        <strong>{recording ? "観測・仮想記録中・画面自動更新オフ" : "取得停止中・自動更新オフ"}</strong>
        <p>
          設定保存で運転状態は変更しません。{recording ? "承認日時以降の新しい観測だけを記録します。" : "新しい観測の記録は停止中です。"}
        </p>
      </div>
      <ProbabilityNote />
      <section className="fp-card fp-settings">
        <h2>基本設定</h2>
        <div className="fp-setting-facts">
          <div>
            <span>仮想購入額</span>
            <strong>1点100円（固定）</strong>
          </div>
          <div>
            <span>自動更新</span>
            <strong>オフ（表示は手動更新）</strong>
          </div>
          <div>
            <span>オッズ有効時間</span>
            <strong>300秒（5分）</strong>
          </div>
          <div>
            <span>判定ルール版</span>
            <strong>{RULE_VERSION}</strong>
          </div>
        </div>
        <ErrorPanel message={error} />
        <RuleDraftForm requestId={randomUUID()} effectiveAt={future} />
      </section>
      <CalculationDetails version={RULE_VERSION} />
      <details className="fp-card fp-settings">
        <summary>詳細設定・旧戦略固有の条件</summary>
        <p>
          モデル版：edge-full120-v2。保守確率の暫定係数は既存の0.8を維持します。補正確率・統計的下限の学習は未導入です。
        </p>
        <p>
          外部観測は開催時間中の1分間隔で確認します。画面は手動更新です。新記録APIは日次1,000回または計測CPU60秒で停止し、エラー後は自動復旧しません。このCPU計測は請求値と同一ではありません。
        </p>
        {rules
          .filter((r) => r.legacy)
          .map((r) => (
            <div className="fp-version-row" key={r.version}>
              <strong>{r.version}</strong>
              <span>適用開始 {stamp(r.effectiveAt)}</span>
              <dl>
                {Object.entries(r.settings).map(([k, v]) => (
                  <div key={k}>
                    <dt>
                      {{
                        minimumRawEv: "推定期待値下限（倍率）",
                        minimumConservativeEv: "保守期待値下限（倍率）",
                        watchEv: "注目候補下限（倍率）",
                        maxCombinationsPerRace: "最大点数（点）",
                        maxOddsAgeMinutes: "オッズ有効時間（分）",
                        stakeYen: "仮想購入額（円）",
                        conservativeFactor: "暫定係数",
                      }[k] ?? k}
                    </dt>
                    <dd>{String(v)}</dd>
                  </div>
                ))}
              </dl>
            </div>
          ))}
      </details>
      <section className="fp-card fp-settings">
        <h2>下書きの変更履歴</h2>
        {!drafts.length ? (
          <p>保存済みの下書きはありません。</p>
        ) : (
          drafts.map((d) => (
            <div className="fp-version-row" key={d.draft_id}>
              <strong>{d.rule_version} · 下書き・未適用</strong>
              <span>
                変更日時 {stamp(d.created_at)} ／ 適用予定{" "}
                {stamp(d.effective_at)}
              </span>
              <span>
                掲載開始 {d.before_values.windowSeconds / 60}→
                {d.after_values.windowSeconds / 60}分 ／ 推定確率{" "}
                {percent(d.before_values.minimumProbability)}→
                {percent(d.after_values.minimumProbability)}
              </span>
              <span>
                購入推奨 {evText(d.before_values.recommendedEv)}→
                {evText(d.after_values.recommendedEv)} ／ 下限{" "}
                {evText(d.before_values.optionalEv)}→
                {evText(d.after_values.optionalEv)}超
              </span>
            </div>
          ))
        )}
      </section>
      <p className="fp-note">
        現在の新基準：{DEFAULT_RULE.windowSeconds / 60}
        分前・推定1％以上・推奨120％以上。過去の判断や精算へ遡及適用しません。
      </p>
      <Link href="/research-archive" prefetch={false}>
        旧研究画面・既存履歴を確認
      </Link>
    </div>
  );
}
