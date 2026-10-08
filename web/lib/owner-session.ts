import "server-only";
import { cookies } from "next/headers";
import { createHmac, timingSafeEqual } from "node:crypto";
export async function requireOwner() {
  const secret = process.env.RESEARCH_OWNER_KEY,
    value = (await cookies()).get("research_owner")?.value ?? "",
    [issued, mac] = value.split("."),
    date = Number(issued);
  if (
    !secret ||
    secret.length < 32 ||
    !Number.isSafeInteger(date) ||
    date > Date.now() ||
    date <= Date.now() - 30 * 86400000 ||
    !/^[a-f0-9]{64}$/.test(mac ?? "")
  )
    throw Error("所有者認証が必要です。再ログインしてください。");
  const expected = createHmac("sha256", secret).update(issued).digest();
  if (!timingSafeEqual(expected, Buffer.from(mac, "hex")))
    throw Error("所有者認証が必要です。再ログインしてください。");
}
