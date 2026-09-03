import { HistoryTable } from "@/components/history-table";
import { getDisplayPredictions } from "@/db/live-repository";

export const metadata = { title: "全予想履歴｜BOAT RACE EDGE" };

export const dynamic = "force-dynamic";

export default async function HistoryPage() {
  const predictions = await getDisplayPredictions();
  const sorted = [...predictions].sort((a, b) => b.published_at.localeCompare(a.published_at));
  const observationCount = sorted.filter((item) => item.publication_mode === "frozen_forward_hit_v1").length;
  return (
    <section className="page-section">
      <div className="page-intro">
        <p className="section-kicker">ALL RECORDS</p>
        <h1>過去の予想</h1>
        <p>的中・不的中を同じ基準で掲載します。初期表示は、試算・公開した全件です。</p>
      </div>
      <div className="ledger-warning">{observationCount > 0 ? `実際に公開した予想が${observationCount}件あります。` : "本日の公開予想はまだありません。"} 過去データによる参考表示とは分けて集計しています。</div>
      <HistoryTable predictions={sorted} />
    </section>
  );
}
