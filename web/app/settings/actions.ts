"use server";
import { revalidatePath } from "next/cache";
import { requireOwner } from "@/lib/owner-session";
import { saveRuleDraft } from "@/db/four-page-repository";
import { DEFAULT_RULE, dateValid } from "@/lib/four-page";
export type DraftState = { version: string | null; error: string | null };
export async function saveDraftAction(
  _previous: DraftState,
  form: FormData,
): Promise<DraftState> {
  try {
    await requireOwner();
    const localDate = String(form.get("effectiveAt") ?? "");
    if (
      !/^20\d{2}-\d{2}-\d{2}T(?:[01]\d|2[0-3]):[0-5]\d$/.test(localDate) ||
      !dateValid(localDate.slice(0, 10))
    )
      throw Error("適用予定日時を指定してください。");
    const values = {
      ...DEFAULT_RULE,
      windowSeconds: Number(form.get("windowMinutes")) * 60,
      minimumProbability: Number(form.get("minimumProbabilityPercent")) / 100,
      recommendedEv: Number(form.get("recommendedEvPercent")) / 100,
      optionalEv: Number(form.get("optionalEvPercent")) / 100,
    };
    const version = await saveRuleDraft(
      values,
      new Date(localDate + ":00+09:00").toISOString(),
      String(form.get("requestId") ?? ""),
    );
    revalidatePath("/settings");
    return { version, error: null };
  } catch (error) {
    return {
      version: null,
      error:
        error instanceof Error &&
        /^(所有者認証|適用|1分以上|掲載時間|数値|下書き保存先|テスト環境)/.test(
          error.message,
        )
          ? error.message
          : "下書きを保存できませんでした。",
    };
  }
}
