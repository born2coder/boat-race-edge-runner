"use client";

import { useState } from "react";
import Link from "next/link";
import { ArrowUpRight } from "lucide-react";
import { Tabs, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { formatDateTime, formatYen, type Prediction } from "@/lib/poc";
import { racePhase } from "@/lib/race-lifecycle";

export function HistoryTable({ predictions }: { predictions: Prediction[] }) {
  const [filter, setFilter] = useState("all");
  const shown = predictions.filter((prediction) => {
    if (filter === "all") return true;
    if (filter === "hit") return prediction.result?.settlement.hit;
    if (filter === "miss") return prediction.result && !prediction.result.settlement.hit;
    return prediction.result === null;
  });

  return (
    <>
      <div className="history-controls">
        <Tabs value={filter} onValueChange={setFilter}>
          <TabsList>
            <TabsTrigger value="all">全件</TabsTrigger>
            <TabsTrigger value="hit">的中</TabsTrigger>
            <TabsTrigger value="miss">不的中</TabsTrigger>
            <TabsTrigger value="pending">未確定</TabsTrigger>
          </TabsList>
        </Tabs>
        <span>表示中 {shown.length} / {predictions.length}件</span>
      </div>
      <div className="history-table-wrap">
        <table className="history-table">
          <thead>
            <tr>
              <th>レース</th>
              <th>記録日時</th>
              <th>予想買い目</th>
              <th>結果</th>
              <th>収支</th>
              <th><span className="sr-only">詳細</span></th>
            </tr>
          </thead>
          <tbody>
            {shown.map((prediction) => {
              const settlement = prediction.result?.settlement;
              return (
                <tr key={prediction.prediction_id}>
                  <td data-label="レース">
                    <strong>{prediction.race.venue} {prediction.race.race_no}R</strong>
                    <small>{prediction.race.race_date}</small>
                  </td>
                  <td data-label="記録日時">{formatDateTime(prediction.published_at)}</td>
                  <td data-label="予想買い目">{prediction.tickets.slice(0, 3).map((ticket) => ticket.combination).join(" / ")}</td>
                  <td data-label="結果">
                    {settlement ? (
                      <span className={settlement.hit ? "result-hit" : "result-miss"}>
                        {settlement.hit ? "的中" : "不的中"}・{settlement.result_combination}
                      </span>
                    ) : racePhase(prediction) === "upcoming" ? "締切前" : "締切済み・結果確認中"}
                  </td>
                  <td data-label="収支" className={settlement && settlement.profit_yen >= 0 ? "positive" : "negative"}>
                    {settlement ? formatYen(settlement.profit_yen) : "—"}
                  </td>
                  <td data-label="詳細">
                    <Link href={`/prediction/${prediction.prediction_id}`} aria-label={`${prediction.race.venue}${prediction.race.race_no}Rの詳細`}>
                      <ArrowUpRight aria-hidden="true" />
                    </Link>
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>
      {shown.length === 0 && <div className="empty-filter">この条件に該当する記録はありません。</div>}
    </>
  );
}
