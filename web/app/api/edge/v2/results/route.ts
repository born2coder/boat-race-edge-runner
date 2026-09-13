import { getDayResults, validDate } from "@/db/edge-v2-repository";
export const dynamic = "force-dynamic";
export async function GET(request: Request) {
  const date = new URL(request.url).searchParams.get("date") ?? "";
  if (!validDate(date)) return Response.json({error: "invalid_date"}, {status: 400});
  try {
    const results = await getDayResults(date);
    return Response.json({date, results: results ?? []}, {status: results ? 200 : 503, headers: {"Cache-Control": "no-store"}});
  } catch { return Response.json({error: "results_unavailable"}, {status: 503}); }
}
