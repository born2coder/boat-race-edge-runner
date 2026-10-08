import Link from "next/link";
import {
  filtersFrom,
  selectEntries,
  groupRaces,
  linkFilters,
} from "@/lib/four-page";
import {
  loadEntries,
  loadRules,
  loadModels,
  detailsFor,
  isolatedFixture,
} from "@/db/four-page-repository";
import { venueNames } from "@/lib/venues";
import {
  PageTitle,
  FiltersForm,
  ErrorPanel,
  EmptyState,
  SelectionNote,
  ProbabilityNote,
} from "@/components/four-page-common";
import { HistoryRaces } from "@/components/history-races";
export const dynamic = "force-dynamic";
export default async function HistoryPage({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  const query = await searchParams;
  let f;
  try {
    f = filtersFrom(query, true);
  } catch (error) {
    return (
      <div className="fp-page">
        <PageTitle
          title="判断履歴"
          subtitle="買い目ごとの判断と精算をたどります。"
        />
        <ErrorPanel message={(error as Error).message} />
        <Link href="/signal-log" prefetch={false}>
          期間を選び直す
        </Link>
      </div>
    );
  }
  const [data, rules, models] = await Promise.all([
    loadEntries(f),
    loadRules(),
    loadModels(),
  ]);
  const selected = selectEntries(data.entries, f, venueNames),
    groups = groupRaces(selected),
    pageGroups = groups.slice((f.page - 1) * 20, f.page * 20);
  let detailed = pageGroups;
  let detailError: string | null = null;
  try {
    const entries = await detailsFor(pageGroups.flat());
    detailed = groupRaces(entries);
  } catch {
    detailError =
      "判断の詳細履歴を取得できませんでした。初回仮想購入値と精算は保持しています。";
  }
  return (
    <div className="fp-page">
      <PageTitle
        title="判断履歴"
        subtitle="買い目ごとの判断と、仮想購入・精算をたどります。"
        test={isolatedFixture()}
      />
      <FiltersForm f={f} rules={rules} models={models} history />
      <SelectionNote f={f} rules={rules} />
      <ProbabilityNote />
      <ErrorPanel message={data.error ?? detailError} />
      <div className="fp-list-heading">
        <span>
          表示対象{" "}
          {data.available
            ? `${groups.length}レース・${selected.length}点`
            : "—"}
        </span>
        <span>開催日が新しい順・記録時期待回収率順</span>
      </div>
      {detailed.length ? (
        <HistoryRaces groups={detailed} />
      ) : (
        !data.error && (
          <EmptyState
            text={
              f.cohort === "live"
                ? "実購入記録はありません。"
                : rules.find((r) => r.version === f.rule)?.legacy &&
                    f.mode !== "recommended"
                  ? "この旧戦略では選択した運用方法を算出できません。"
                  : "この条件の保存記録はありません。"
            }
          />
        )
      )}
      <nav className="fp-pagination" aria-label="履歴のページ">
        {f.page > 1 && (
          <Link href={linkFilters(f, { page: f.page - 1 })} prefetch={false}>
            前の20レース
          </Link>
        )}
        <span>{f.page}ページ</span>
        {groups.length > f.page * 20 && (
          <Link href={linkFilters(f, { page: f.page + 1 })} prefetch={false}>
            次の20レース
          </Link>
        )}
      </nav>
      <details className="fp-details">
        <summary>3つの仮想運用方法について</summary>
        <p>
          購入推奨のみは初めて120％以上、買ってもよいのみは初めて100％超〜120％未満、両方は初めて100％を超えた時点に各100円を記録します。「両方」は前2つの金額の合計ではありません。推奨解除後も購入記録を精算します。
        </p>
      </details>
    </div>
  );
}
