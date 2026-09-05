import { load } from "cheerio";
import type { Prediction } from "@/lib/poc";

export type OfficialResult = {
  race_id: string;
  finishers: NonNullable<Prediction["result"]>["finishers"];
  combination: string;
  payout_per_100_yen: number;
  observed_at: string;
};

// Fail closed on cancellation, refunds, dead heats, incomplete/mismatched pages.
// These cases need the full refund-aware settlement process, not a false "miss".
export function parseOfficialResult(html: string, raceId: string, roster: Array<{ lane_no: number; racer_id: string }>, observedAt: string): OfficialResult | null {
  const match = /^BR:(\d{8}):(\d{2}):(\d{2})$/.exec(raceId);
  if (!match || roster.length !== 6 || !Number.isFinite(Date.parse(observedAt))) return null;
  const $ = load(html);
  const text = (value: string) => value.normalize("NFKC").replace(/\s/g, "");
  const selected = $("thead th").filter((_, th) => {
    const href = $(th).find("a").attr("href");
    if (!href || $(th).attr("class")) return false;
    const url = new URL(href, "https://www.boatrace.jp");
    return url.pathname === "/owpc/pc/race/raceresult"
      && url.searchParams.get("hd") === match[1] && url.searchParams.get("jcd") === match[2]
      && Number(url.searchParams.get("rno")) === Number(match[3]);
  });
  if (selected.length !== 1) return null;
  const tables = $("table");
  const refundTable = tables.filter((_, table) => text($(table).find("thead").text()) === "返還");
  if (refundTable.length !== 1 || text(refundTable.find("tbody").text())) return null;
  const finishTable = tables.filter((_, table) => text($(table).find("thead").text()) === "着枠ボートレーサーレースタイム");
  if (finishTable.length !== 1) return null;
  const finishers = finishTable.find("tbody tr").toArray().map((row) => {
    const cells = $(row).children("td");
    return {
      finish_position: Number(text(cells.eq(0).text())), result_code: null,
      lane_no: Number(text(cells.eq(1).text())), racer_id: text(cells.eq(2).find(".is-fs12").text()),
    };
  });
  if (finishers.length !== 6 || new Set(finishers.map((f) => f.lane_no)).size !== 6
    || new Set(finishers.map((f) => f.finish_position)).size !== 6
    || finishers.some((f) => !Number.isInteger(f.finish_position) || f.finish_position < 1 || f.finish_position > 6
      || !roster.some((r) => r.lane_no === f.lane_no && String(r.racer_id) === f.racer_id))) return null;
  const trifecta = $("tbody").filter((_, tbody) => $(tbody).find("td").toArray().some((td) => text($(td).text()) === "3連単"));
  const numbers = trifecta.find(".numberSet1_number").toArray().map((el) => text($(el).text()));
  const payouts = trifecta.find(".is-payout1").toArray().map((el) => text($(el).text())).filter(Boolean);
  if (trifecta.length !== 1 || numbers.length !== 3 || payouts.length !== 1 || !/^[¥￥][\d,]+$/.test(payouts[0])) return null;
  const combination = numbers.join("-");
  const sorted = [...finishers].sort((a, b) => a.finish_position - b.finish_position);
  const payout = Number(payouts[0].replace(/[^\d]/g, ""));
  if (combination !== sorted.slice(0, 3).map((f) => f.lane_no).join("-") || !Number.isSafeInteger(payout) || payout <= 0) return null;
  return { race_id: raceId, finishers: sorted, combination, payout_per_100_yen: payout, observed_at: observedAt };
}
