"use client";
import { useActionState } from "react";
import { saveDraftAction } from "@/app/settings/actions";
export function RuleDraftForm({
  requestId,
  effectiveAt,
}: {
  requestId: string;
  effectiveAt: string;
}) {
  const [state, action, pending] = useActionState(saveDraftAction, {
    version: null,
    error: null,
  });
  return (
    <form action={action} className="fp-draft-form">
      <input type="hidden" name="requestId" value={requestId} />
      <div className="fp-settings-grid">
        <label>
          掲載開始（締切何分前）
          <input
            name="windowMinutes"
            type="number"
            defaultValue="20"
            min="1"
            max="20"
            step="1"
            required
          />
          <small>1〜20分</small>
        </label>
        <label>
          最低推定確率（％）
          <input
            name="minimumProbabilityPercent"
            type="number"
            defaultValue="1.0"
            min="0.01"
            max="100"
            step="0.01"
            required
          />
        </label>
        <label>
          購入推奨の境界（％以上）
          <input
            name="recommendedEvPercent"
            type="number"
            defaultValue="120.0"
            min="100.01"
            max="1000"
            step="0.01"
            required
          />
        </label>
        <label>
          買ってもよいの下限（％超）
          <input
            name="optionalEvPercent"
            type="number"
            defaultValue="100.0"
            min="100"
            max="999.99"
            step="0.01"
            required
          />
        </label>
        <label>
          適用予定日時（日本時間）
          <input
            name="effectiveAt"
            type="datetime-local"
            defaultValue={effectiveAt}
            required
          />
          <small>将来日時。下書きの保存だけでは適用されません。</small>
        </label>
      </div>
      {state.error && (
        <div className="fp-notice error" role="alert">
          {state.error}
        </div>
      )}
      {state.version && (
        <div className="fp-notice success" role="status">
          下書きを保存しました：{state.version}
          。運転は停止中で、設定は未適用です。
        </div>
      )}
      <button type="submit" className="fp-button" disabled={pending}>
        {pending ? "下書きを保存中…" : "下書きを保存"}
      </button>
    </form>
  );
}
