import { createHmac, randomUUID, timingSafeEqual } from "node:crypto";
import { recordObservation, settleRecordedRace } from "@/db/four-page-writer";
import { supabaseRequest, SupabaseError } from "@/db/supabase";
import { forwardPayload } from "@/lib/research-forward-payload";
import { observationsFromSavedRace } from "@/lib/four-page-source";
import { DEFAULT_RULE, RULE_VERSION, MODEL_VERSION, jstDate } from "@/lib/four-page";
export const dynamic = "force-dynamic";
export const preferredRegion = "hnd1";
export const maxDuration = 30;
const rpc = <T>(name: string, body: object) => supabaseRequest<T>("rpc/" + name, {
  method: "POST", body: JSON.stringify(body), signal: AbortSignal.timeout(8000),
}, "service");
export async function POST(request: Request) {
  const cpuStart = process.cpuUsage();
  const secret = process.env.INGEST_SECRET;
  if (!secret || process.env.RESEARCH_FOUR_PAGE_RECORDING !== "1")
    return Response.json({ status: "paused" }, { status: 503 });
  const timestamp = request.headers.get("x-edge-timestamp") ?? "";
  const nonce = request.headers.get("x-edge-nonce") ?? "";
  const signature = request.headers.get("x-edge-signature") ?? "";
  if (!/^\d{10}$/.test(timestamp) || Math.abs(Date.now()/1000-Number(timestamp))>60 ||
      !/^[a-f0-9]{32}$/.test(nonce) || !/^[a-f0-9]{64}$/.test(signature))
    return Response.json({ status: "unauthorized" }, { status: 401 });
  const reader = request.body?.getReader();
  if (!reader) return Response.json({ status: "invalid_payload" }, { status: 400 });
  const chunks: Uint8Array[] = []; let size = 0;
  for (;;) {
    const { done, value } = await reader.read(); if (done) break;
    size += value.byteLength;
    if (size > 512000) { await reader.cancel(); return Response.json({ status: "payload_too_large" }, { status: 413 }); }
    chunks.push(value);
  }
  const raw = Buffer.concat(chunks).toString("utf8");
  const expected = createHmac("sha256", secret).update(`${timestamp}.${nonce}.${raw}`).digest();
  if (!timingSafeEqual(expected, Buffer.from(signature, "hex")))
    return Response.json({ status: "unauthorized" }, { status: 401 });
  let json: unknown; try { json = JSON.parse(raw); } catch { return Response.json({ status: "invalid_payload" }, { status: 400 }); }
  const parsed = forwardPayload.safeParse(json);
  if (!parsed.success || parsed.data.date!==jstDate() || parsed.data.observations.some(o =>
    o.race_date!==parsed.data.date || !o.race_id.startsWith(`BR:${parsed.data.date.replaceAll("-", "")}:`)))
    return Response.json({ status: "invalid_payload" }, { status: 400 });
  const lease = randomUUID(); let admitted = false;
  try {
    try {
      await supabaseRequest("ingestion_nonces", { method: "POST", signal: AbortSignal.timeout(8000),
        headers: { Prefer: "return=minimal" }, body: JSON.stringify({ nonce, used_at: new Date().toISOString() }) }, "service");
    } catch (error) {
      if (error instanceof SupabaseError && error.status===409)
        return Response.json({ status: "replay_rejected" }, { status: 409 });
      throw error;
    }
    const admission = await rpc<string>("four_page_flow_begin", { p_lease: lease });
    if (admission!=="accepted") return Response.json({ status: admission }, { status: admission==="paused" ? 503 : 429 });
    admitted = true; let entries = 0, settled = 0;
    const observations = parsed.data.observations;
    for (let i=0; i<observations.length; i+=4) {
      const counts = await Promise.allSettled(observations.slice(i,i+4).map(async r => {
        const race = { ...r, snapshots: {}, receipts: { [r.snapshot.snapshot_id]: r.receipt } };
        return recordObservation({ snapshotId: r.snapshot.snapshot_id, raceId: r.race_id,
          raceDate: r.race_date, ruleVersion: RULE_VERSION, modelVersion: MODEL_VERSION,
          receivedAt: r.receipt,
          observations: observationsFromSavedRace(race,r.snapshot,RULE_VERSION,DEFAULT_RULE.conservativeFactor) });
      }));
      // Wait for all DB writers before releasing or stopping the lease.
      for (const count of counts) { if (count.status==="rejected") throw count.reason; entries+=count.value; }
    }
    for (const r of parsed.data.results) settled += await settleRecordedRace(r.raceId,r.result);
    await supabaseRequest("four_page_feed_status?on_conflict=race_date", {
      method: "POST", headers: { Prefer: "resolution=merge-duplicates,return=minimal" },
      signal: AbortSignal.timeout(8000),
      body: JSON.stringify({ race_date: parsed.data.date, updated_at: new Date().toISOString(),
        data: { ...parsed.data.progress, stopped: false, error: null } }),
    }, "service");
    const cpu = process.cpuUsage(cpuStart), cpuMs = Math.ceil((cpu.user+cpu.system)/1000);
    const running = await rpc<boolean>("four_page_flow_end", { p_lease: lease, p_cpu_ms: cpuMs, p_failed: false });
    return Response.json({ status: running ? "recorded" : "paused", entries, settled, cpuMs }, { status: running ? 200 : 503 });
  } catch {
    if (admitted) {
      const cpu = process.cpuUsage(cpuStart);
      try { await rpc("four_page_flow_end", { p_lease: lease, p_cpu_ms: Math.ceil((cpu.user+cpu.system)/1000), p_failed: true }); } catch { /* unfinished lease stops the next attempt */ }
    }
    console.error("Research forward flow stopped after an error");
    return Response.json({ status: "flow_failed" }, { status: 503 });
  }
}
