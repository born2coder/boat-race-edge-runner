import { claimIngestionNonce, ingestLivePayload } from "@/db/ingest-repository";
import { ingestPayloadSchema } from "@/lib/ingest-schema";

export const dynamic = "force-dynamic";

const MAX_BODY_BYTES = 2_500_000;
const MAX_CLOCK_SKEW_SECONDS = 300;

function hex(bytes: ArrayBuffer) {
  return Array.from(new Uint8Array(bytes), (byte) => byte.toString(16).padStart(2, "0")).join("");
}

function equalHex(left: string, right: string) {
  if (left.length !== right.length) return false;
  let difference = 0;
  for (let index = 0; index < left.length; index += 1) difference |= left.charCodeAt(index) ^ right.charCodeAt(index);
  return difference === 0;
}

async function expectedSignature(secret: string, signedValue: string) {
  const key = await crypto.subtle.importKey("raw", new TextEncoder().encode(secret), { name: "HMAC", hash: "SHA-256" }, false, ["sign"]);
  return hex(await crypto.subtle.sign("HMAC", key, new TextEncoder().encode(signedValue)));
}

export async function POST(request: Request) {
  const secret = process.env.INGEST_SECRET;
  if (!secret) return Response.json({ status: "unavailable" }, { status: 503 });

  const timestamp = request.headers.get("x-edge-timestamp") ?? "";
  const nonce = request.headers.get("x-edge-nonce") ?? "";
  const signature = request.headers.get("x-edge-signature") ?? "";
  const timestampSeconds = Number(timestamp);
  if (!Number.isInteger(timestampSeconds) || Math.abs(Date.now() / 1000 - timestampSeconds) > MAX_CLOCK_SKEW_SECONDS) {
    return Response.json({ status: "unauthorized" }, { status: 401 });
  }
  if (!/^[a-f0-9]{32}$/.test(nonce) || !/^[a-f0-9]{64}$/.test(signature)) {
    return Response.json({ status: "unauthorized" }, { status: 401 });
  }

  const rawBody = await request.text();
  if (new TextEncoder().encode(rawBody).byteLength > MAX_BODY_BYTES) {
    return Response.json({ status: "payload_too_large" }, { status: 413 });
  }
  const expected = await expectedSignature(secret, `${timestamp}.${nonce}.${rawBody}`);
  if (!equalHex(expected, signature)) return Response.json({ status: "unauthorized" }, { status: 401 });
  if (!(await claimIngestionNonce(nonce, new Date().toISOString()))) {
    return Response.json({ status: "replay_rejected" }, { status: 409 });
  }

  let json: unknown;
  try {
    json = JSON.parse(rawBody);
  } catch {
    return Response.json({ status: "invalid_json" }, { status: 400 });
  }
  const parsed = ingestPayloadSchema.safeParse(json);
  if (!parsed.success) {
    return Response.json({ status: "invalid_payload", issues: parsed.error.issues.slice(0, 8) }, { status: 400 });
  }

  const bodyHash = hex(await crypto.subtle.digest("SHA-256", new TextEncoder().encode(rawBody)));
  try {
    return Response.json(await ingestLivePayload(parsed.data, bodyHash), {
      headers: { "Cache-Control": "no-store" },
    });
  } catch (error) {
    return Response.json(
      { status: "failed", message: error instanceof Error ? error.message : "ingestion failed" },
      { status: 500, headers: { "Cache-Control": "no-store" } },
    );
  }
}

export async function GET() {
  return Response.json({ status: "method_not_allowed" }, { status: 405, headers: { Allow: "POST" } });
}
