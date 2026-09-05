export const metadata = { title: "舟の理について・予想と成績の公開方針", description: "競艇の理をデータで紐解き、予想を導く。舟の理の無料競艇予想と、公開した買い目・結果を記録する方針について。", alternates: { canonical: "/about" } };

export default function AboutPage() {
  return (
    <section className="page-section">
      <div className="page-intro">
        <p className="section-kicker">ABOUT</p>
        <h1>舟の理について</h1>
        <p>舟の理（ふねのことわり）は、データ分析による無料競艇予想サイトです。全国のボートレースから狙い目を選び、3連単3点予想を公開します。</p>
      </div>

      <section className="about-block">
        <h2>競艇の理をデータで紐解き、予想を導く。</h2>
        <p>選手の成績や機力、同じレースを走る6艇の力関係。その記録から、着順につながる傾向を読み解く。「舟の理」という名前には、データを丁寧に分析し、予想につなげる姿勢を込めています。</p>
      </section>

      <section className="about-lead-grid">
        <article>
          <span>01</span>
          <h2>狙いやすいレースだけ</h2>
          <p>全レースを無理に予想せず、狙い目と判断したレースを1日最大10レースまで公開します。</p>
        </article>
        <article>
          <span>02</span>
          <h2>3連単は3点に固定</h2>
          <p>買い目を増やして的中率を高く見せず、3点を各100円として同じ条件で結果を残します。</p>
        </article>
      </section>

      <section className="about-block current-status-block">
        <div className="section-heading">
          <div>
            <p className="section-kicker">OUR PROMISE</p>
            <h2>出した予想は、結果まで公開します</h2>
          </div>
        </div>
        <p><strong>的中した予想だけを選んで見せることはしません。</strong></p>
        <ul>
          <li>公開した買い目を後から変えません</li>
          <li>不的中も履歴に残します</li>
          <li>購入額と払戻額を同じ条件で集計します</li>
        </ul>
        <p>現在の予想は無料でご覧いただけます。</p>
      </section>

      <section className="responsible-note">
        <h2>注意</h2>
        <p>本サイトの予想は、的中や利益を保証するものではありません。</p>
        <p>舟券の購入は20歳以上が対象です。購入する場合は無理のない範囲でお楽しみください。出走・締切・結果・払戻は必ず公式情報を確認してください。</p>
      </section>
    </section>
  );
}
