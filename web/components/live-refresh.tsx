"use client";

import { useEffect, useState, useTransition } from "react";
import { useRouter } from "next/navigation";

export function LiveRefresh() {
  const router = useRouter();
  const [pending, startTransition] = useTransition();
  const [updated, setUpdated] = useState<string | null>(null);
  useEffect(() => {
    const refresh = () => {
      if (document.visibilityState === "visible") startTransition(() => router.refresh());
    };
    const timer = window.setInterval(refresh, 60_000);
    document.addEventListener("visibilitychange", refresh);
    return () => { window.clearInterval(timer); document.removeEventListener("visibilitychange", refresh); };
  }, [router]);
  useEffect(() => {
    if (!pending) setUpdated(new Date().toLocaleTimeString("ja-JP", { timeZone: "Asia/Tokyo", hour: "2-digit", minute: "2-digit" }));
  }, [pending]);
  return <div className="live-refresh"><span>閲覧中は約1分ごとに表示を更新{updated ? `・画面確認 ${updated}` : ""}</span><button type="button" disabled={pending} onClick={() => startTransition(() => router.refresh())}>{pending ? "更新中…" : "今すぐ更新"}</button></div>;
}
