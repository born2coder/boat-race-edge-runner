"use client";

import { useTransition } from "react";
import { useRouter } from "next/navigation";

export function LiveRefresh() {
  const router = useRouter();
  const [pending, startTransition] = useTransition();
  return <div className="live-refresh"><span>研究用・表示は自動更新しません</span><button type="button" disabled={pending} onClick={() => startTransition(() => router.refresh())}>{pending ? "更新中…" : "保存済みデータを再読込"}</button></div>;
}
