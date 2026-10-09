import {
  loadFeed,
  isolatedFixture,
  requestNow,
} from "@/db/four-page-repository";
import { classify, RULE_VERSION } from "@/lib/four-page";
import {
  PageTitle,
  ProbabilityNote,
  ErrorPanel,
  CalculationDetails,
  stamp,
} from "@/components/four-page-common";
import { UpcomingRaces } from "@/components/upcoming-races";
export const dynamic = "force-dynamic";
export default async function TodayPage() {
  const feed = await loadFeed(),
    now = await requestNow();
  const observations = feed.stopped
    ? []
    : feed.observations.filter(
        (o) => classify(o, now, false).category !== "excluded",
      );
  const qualityError =
    !feed.stopped &&
    feed.observations.length > 0 &&
    !observations.length &&
    feed.observations.some(
      (o) =>
        Date.parse(o.closeAt ?? "") > now &&
        classify(o, now).reasons.some(
          (r) =>
            r.includes("未取得") ||
            r.includes("未確認") ||
            r.includes("範囲外"),
        ),
    )
      ? "必要なデータが不足しているか、オッズが古いため、買い目を表示していません。"
      : null;
  return (
    <div className="fp-page">
      <PageTitle
        title="今後の買い目"
        subtitle="締切が近いレースから、保存済みの判断を確認します。"
        test={isolatedFixture()}
      />
      <div className="fp-progress">
        <span>
          終了レース <strong>{feed.ended ?? "—"}</strong>
        </span>
        <span>
          残りレース <strong>{feed.remaining ?? "—"}</strong>
        </span>
        <span>
          最終更新 <strong>{stamp(feed.updatedAt)}</strong>
        </span>
        <span>
          次回画面更新 <strong>オフ</strong>
        </span>
      </div>
      {feed.confirming !== null && feed.confirming > 0 && (
        <p className="fp-note">残りのうち競走終了を確認中 {feed.confirming}R</p>
      )}
      {feed.cancelled !== null && feed.cancelled > 0 && (
        <p className="fp-note">中止 {feed.cancelled}R（終了・残りから除外）</p>
      )}
      <ErrorPanel message={feed.error} />
      {!feed.error && qualityError && (
        <div className="fp-notice error" role="alert">
          <strong>現在表示できる買い目がありません</strong>
          <p>{qualityError}</p>
          <p>
            この表示は、データ収集の停止を示すものではありません。
            最新の保存内容を見るには「保存済みデータを再読込」を押してください。
          </p>
        </div>
      )}
      <ProbabilityNote />
      <CalculationDetails version={RULE_VERSION} />
      <UpcomingRaces
        observations={observations}
        stopped={feed.stopped}
        error={feed.error ?? qualityError}
      />
    </div>
  );
}
