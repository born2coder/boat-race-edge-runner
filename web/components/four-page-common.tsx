import Link from "next/link";
import { venueNames } from "@/lib/venues";
import {
  MODE_LABELS,
  expectedReturnText,
  linkFilters,
  type Filters,
  type Entry,
  type Rule,
  DEFAULT_RULE,
} from "@/lib/four-page";
import type { RuleRecord } from "@/db/four-page-repository";
export const number = (v: number | null, decimals = 0) =>
  v === null
    ? "—"
    : v.toLocaleString("ja-JP", {
        maximumFractionDigits: decimals,
        minimumFractionDigits: decimals,
      });
export const yen = (v: number | null) => (v === null ? "—" : number(v) + "円");
export const signedYen = (v: number | null) =>
  v === null ? "—" : (v > 0 ? "＋" : v < 0 ? "−" : "±") + yen(Math.abs(v));
export const percent = (v: number | null) =>
  v === null ? "—" : number(v * 100, 2) + "％";
export const evText = expectedReturnText;
export const oddsText = (v: number | null) =>
  v === null
    ? "—"
    : v.toLocaleString("ja-JP", {
        minimumFractionDigits: 1,
        maximumFractionDigits: 8,
      }) + "倍";
export const stamp = (v: string | null) =>
  !v || !Number.isFinite(Date.parse(v))
    ? "—"
    : new Intl.DateTimeFormat("ja-JP", {
        timeZone: "Asia/Tokyo",
        year: "numeric",
        month: "2-digit",
        day: "2-digit",
        hour: "2-digit",
        minute: "2-digit",
        second: "2-digit",
      }).format(new Date(v));
export const outcomeLabels: Record<Entry["outcome"], string> = {
  pending: "結果待ち",
  checking: "確認中",
  hit: "的中",
  miss: "不的中",
  refunded: "返還",
};
export function ProbabilityNote() {
  return (
    <p className="fp-note">
      保守確率は暫定係数による計算です。統計的な下限ではありません
    </p>
  );
}
export function ErrorPanel({ message }: { message: string | null }) {
  return message ? (
    <div className="fp-notice error" role="alert">
      <strong>データ確認中</strong>
      <p>{message}</p>
    </div>
  ) : null;
}
export function PageTitle({
  title,
  subtitle,
  test = false,
}: {
  title: string;
  subtitle: string;
  test?: boolean;
}) {
  return (
    <header className="fp-heading">
      {test && <span className="fp-test">テストデータ・隔離環境</span>}
      <h1>{title}</h1>
      <p>{subtitle}</p>
    </header>
  );
}
export function FiltersForm({
  f,
  rules,
  models,
  history = false,
}: {
  f: Filters;
  rules: RuleRecord[];
  models: string[];
  history?: boolean;
}) {
  const periods = history
    ? [
        ["today", "今日"],
        ["week", "直近7日"],
        ["custom", "期間指定"],
        ["month", "月指定"],
        ["year", "年指定"],
        ["all", "通算"],
      ]
    : [
        ["today", "今日"],
        ["month", "今月・月指定"],
        ["year", "今年・年指定"],
        ["all", "通算"],
        ["custom", "期間指定"],
      ];
  return (
    <form method="get" className="fp-filters" aria-label="表示条件">
      <label>
        期間
        <select aria-label="期間" name="period" defaultValue={f.period}>
          {periods.map(([v, l]) => (
            <option key={v} value={v}>
              {l}
            </option>
          ))}
        </select>
      </label>
      <label>
        判定区分
        <select aria-label="判定区分" name="mode" defaultValue={f.mode}>
          {Object.entries(MODE_LABELS).map(([v, l]) => (
            <option key={v} value={v}>
              {l}
            </option>
          ))}
        </select>
      </label>
      <label>
        会場
        <select aria-label="会場" name="venue" defaultValue={f.venue}>
          <option value="">すべて</option>
          {Object.entries(venueNames).map(([v, l]) => (
            <option key={v} value={v}>
              {l}
            </option>
          ))}
        </select>
      </label>
      {history && (
        <>
          <label>
            記録時判定
            <select
              aria-label="記録時判定"
              name="category"
              defaultValue={f.category}
            >
              <option value="">すべて</option>
              <option value="recommended">購入推奨</option>
              <option value="optional">買ってもよい</option>
            </select>
          </label>
          <label>
            結果
            <select aria-label="結果" name="result" defaultValue={f.result}>
              <option value="">すべて</option>
              {Object.entries(outcomeLabels).map(([v, l]) => (
                <option key={v} value={v}>
                  {l}
                </option>
              ))}
            </select>
          </label>
          <label className="fp-filter-search">
            レース・買い目検索
            <input
              name="search"
              defaultValue={f.search}
              placeholder="会場名・10R・3-1-4"
            />
          </label>
        </>
      )}
      <details className="fp-filter-details">
        <summary>期間・実績の種類・版を指定</summary>
        <div>
          <label>
            対象月
            <input type="month" name="month" defaultValue={f.month} />
          </label>
          <label>
            対象年
            <input
              name="year"
              type="number"
              min="2000"
              max="2099"
              defaultValue={f.year}
            />
          </label>
          <label>
            開始日
            <input type="date" name="from" defaultValue={f.from} />
          </label>
          <label>
            終了日
            <input type="date" name="to" defaultValue={f.to} />
          </label>
          <label>
            実績の種類
            <select
              aria-label="実績の種類"
              name="cohort"
              defaultValue={f.cohort}
            >
              <option value="forward">事前記録の仮想運用</option>
              <option value="backtest">過去データ試算</option>
              <option disabled value="live">
                実購入（記録なし）
              </option>
            </select>
          </label>
          <label>
            判定ルール版
            <select aria-label="判定ルール版" name="rule" defaultValue={f.rule}>
              {rules.map((r) => (
                <option key={r.version} value={r.version}>
                  {r.legacy ? "旧戦略：" : "新基準："}
                  {r.version}
                </option>
              ))}
            </select>
          </label>
          <label>
            予想ロジック版
            <select
              aria-label="予想ロジック版"
              name="model"
              defaultValue={f.model}
            >
              {[...new Set([...models, f.model])].map((version) => (
                <option key={version} value={version}>
                  {version}
                </option>
              ))}
            </select>
          </label>
          {(["evBand", "probabilityBand", "timeBand"] as const).map(
            (key) =>
              f[key] && (
                <label key={key}>
                  {key === "evBand"
                    ? "期待回収率帯"
                    : key === "probabilityBand"
                      ? "保守確率帯"
                      : "締切時間帯"}
                  <input name={key} defaultValue={f[key]} />
                </label>
              ),
          )}
        </div>
      </details>
      {!history &&
        (["result", "category", "search"] as const).map(
          (key) =>
            f[key] && (
              <input key={key} name={key} type="hidden" value={f[key]} />
            ),
        )}
      <button className="fp-button" type="submit">
        条件を適用
      </button>
      <Link
        href={history ? "/signal-log" : "/performance"}
        prefetch={false}
        className="fp-text-button"
      >
        条件をリセット
      </Link>
    </form>
  );
}
export function SelectionNote({
  f,
  rules,
}: {
  f: Filters;
  rules: RuleRecord[];
}) {
  const selected = rules.find((r) => r.version === f.rule);
  return (
    <div className="fp-selection">
      <strong>
        {f.from}〜{f.to}（日本時間）
      </strong>
      <span>
        {MODE_LABELS[f.mode]} ·{" "}
        {f.cohort === "forward"
          ? "事前記録"
          : f.cohort === "backtest"
            ? "過去データ試算"
            : "実購入"}
      </span>
      {selected?.legacy && (
        <p>
          旧戦略の初回BUYを保持しています。新しい120％基準の実績には含めません。旧記録の「買ってもよいのみ」「両方」は算出不可です。
        </p>
      )}
      {!selected?.legacy && f.cohort === "forward" && (
        <p>
          新ルールは未運転です。承認後、実際に保存を始めた時点から記録します。
        </p>
      )}
    </div>
  );
}
export function EmptyState({
  text = "この条件の保存記録はありません。",
}: {
  text?: string;
}) {
  return (
    <div className="fp-empty">
      <strong>{text}</strong>
      <p>閲覧・設定保存では収集や監視の運転状態を変更しません。</p>
    </div>
  );
}
export function CalculationDetails({
  rule = DEFAULT_RULE,
  version,
}: {
  rule?: Rule;
  version: string;
}) {
  return (
    <details className="fp-details">
      <summary>表示条件・確率の算出方法</summary>
      <p>
        締切まで0秒超〜{number(rule.windowSeconds / 60)}分以内、推定確率
        {percent(rule.minimumProbability)}以上。期待回収率
        {evText(rule.recommendedEv)}以上は購入推奨、{evText(rule.optionalEv)}
        超〜{evText(rule.recommendedEv)}未満は買ってもよい。
      </p>
      <p>
        期待回収率＝保守確率 × 記録時または現在のオッズ ×
        100。保守確率＝モデル推定確率 × {rule.conservativeFactor}
        （既存の暫定係数）。過去データ補正は未導入。
      </p>
      <p>
        オッズ有効時間：{rule.maxOddsAgeSeconds}秒（
        {rule.maxOddsAgeSeconds / 60}分）。判定ルール版：{version}
        。表示更新・オッズ取得・予想生成の時刻は別々です。
      </p>
    </details>
  );
}
export function HistoryLink({
  f,
  overrides,
  label,
}: {
  f: Filters;
  overrides?: Partial<Filters>;
  label: string;
}) {
  return (
    <Link href={linkFilters(f, overrides)} prefetch={false}>
      {label}
    </Link>
  );
}
