import { HistoryTable } from "@/components/history-table";
import { getDisplayPredictions } from "@/db/live-repository";

export const metadata = { title: "競艇予想の履歴と結果", description: "舟の理で事前に公開した競艇予想と、その結果を確認できます。的中・不的中とも同じ基準で記録しています。", alternates: { canonical: "/history" } };

export const dynamic = "force-dynamic";

export default async function HistoryPage() {
  const predictions = await getDisplayPredictions();
  const sorted = [...predictions].sort((a, b) => b.published_at.localeCompare(a.published_at));
  return (
    <section className="page-section">
      <div className="page-intro">
        <p className="section-kicker">ALL RECORDS</p>
        <h1>過去の予想</h1>
        <p>サイトで実際に公開したおすすめを、的中・不的中とも同じ基準で掲載します。</p>
      </div>
      {sorted.length > 0 ? (
        <HistoryTable predictions={sorted} />
      ) : (
        <div className="official-empty"><div><span>公開履歴</span><h2>公開予想はまだありません</h2><p>最初の予想を公開すると、ここに買い目と結果が順番に残ります。</p></div></div>
      )}
    </section>
  );
}
