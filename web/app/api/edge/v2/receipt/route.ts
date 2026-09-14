import { getEdgeV2Day, validDate } from "@/db/edge-v2-repository";
export const dynamic = "force-dynamic";
export async function GET(request: Request) {
  const date = new URL(request.url).searchParams.get("date") ?? "";
  if (!validDate(date)) return Response.json({error: "invalid_date"}, {status: 400});
  const day = await getEdgeV2Day(date);
  if (!day) return Response.json({error: "observations_unavailable"}, {status: 503});
  return Response.json({date, version: day.version, storage_branch: "edge-data", served_at: new Date().toISOString(),
    snapshot_ids: Object.values(day.races).flatMap((race) => Object.values(race.snapshots).map((snapshot) => snapshot.snapshot_id))},
    {headers: {"Cache-Control": "no-store"}});
}
