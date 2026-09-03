import { hasSupabaseReadConfiguration, queryString, supabaseRequest } from "@/db/supabase";

export const dynamic = "force-dynamic";

export async function GET() {
  if (!hasSupabaseReadConfiguration()) {
    return Response.json({ status: "configuration_required" }, { status: 503, headers: { "Cache-Control": "no-store" } });
  }
  try {
    const latest = await supabaseRequest<Array<Record<string, unknown>>>(
      `ingestion_runs?${queryString({ select: "service_date,received_at,status,race_count,prediction_count,result_count", order: "received_at.desc", limit: 1 })}`,
      {},
      "service",
    );
    return Response.json({ status: "ready", latest_ingestion: latest[0] ?? null, checked_at: new Date().toISOString() }, {
      headers: { "Cache-Control": "no-store" },
    });
  } catch (error) {
    return Response.json(
      { status: "unavailable", message: error instanceof Error ? error.message : "Unknown database error" },
      { status: 503, headers: { "Cache-Control": "no-store" } },
    );
  }
}
