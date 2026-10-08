import Link from "next/link";
import { randomUUID } from "node:crypto";
import { DEFAULT_RULE, RULE_VERSION } from "@/lib/four-page";
import {
  loadDrafts,
  loadRules,
  isolatedFixture,
  requestNow,
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
  const [{ drafts, error }, rules] = await Promise.all([
    loadDrafts(),
    loadRules(),
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
        <strong>取得停止中・自動更新オフ</strong>
        <p>
          設定保存で収集・監視・本番処理は開始しません。新ルールの事前記録は未開始です。
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
            <strong>オフ（停止指示を維持）</strong>
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
          表示更新間隔は再開後に通常3分、締切10分前以内1分を候補とする設計です。現在は未稼働です。外部オッズ収集と表示更新の間隔は別です。
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
