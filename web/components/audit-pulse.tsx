"use client";

import { useEffect, useState } from "react";
import { CheckCircle2, LoaderCircle, TriangleAlert } from "lucide-react";

type Status = {
  status: "loading" | "ready" | "unavailable";
  artifacts?: number;
  decisions?: number;
  settlements?: number;
  stake_errors?: number;
  latest_ingestion?: null | { received_at?: string; service_date?: string };
};

export function AuditPulse() {
  const [status, setStatus] = useState<Status>({ status: "loading" });

  useEffect(() => {
    fetch("/api/poc/status", { cache: "no-store" })
      .then(async (response) => {
        if (!response.ok) throw new Error("unavailable");
        return response.json();
      })
      .then((payload) => setStatus(payload))
      .catch(() => setStatus({ status: "unavailable" }));
  }, []);

  if (status.status === "loading") {
    return (
      <div className="audit-pulse" aria-live="polite">
        <LoaderCircle aria-hidden="true" /> 最新データを確認しています。
      </div>
    );
  }
  if (status.status === "unavailable") {
    return (
      <div className="audit-pulse is-warning" role="status">
        <TriangleAlert aria-hidden="true" /> 現在、一部データを確認中です。
      </div>
    );
  }
  return (
    <div className="audit-pulse is-ready" role="status">
      <CheckCircle2 aria-hidden="true" /> データ更新完了
      {status.latest_ingestion?.received_at && <small>最終更新 {new Intl.DateTimeFormat("ja-JP", { timeZone: "Asia/Tokyo", month: "2-digit", day: "2-digit", hour: "2-digit", minute: "2-digit", hour12: false }).format(new Date(status.latest_ingestion.received_at))}</small>}
    </div>
  );
}
