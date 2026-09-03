import "server-only";

export class SupabaseError extends Error {
  constructor(
    message: string,
    public readonly status: number,
    public readonly responseText: string,
  ) {
    super(message);
  }
}

type Access = "anon" | "service";

function configuration(access: Access) {
  const url = process.env.SUPABASE_URL?.replace(/\/$/, "");
  const key = access === "service"
    ? process.env.SUPABASE_SERVICE_ROLE_KEY
    : process.env.SUPABASE_ANON_KEY;
  if (!url || !key) throw new Error(`Supabase ${access} configuration is unavailable`);
  return { url, key };
}

export function hasSupabaseReadConfiguration() {
  return Boolean(process.env.SUPABASE_URL && process.env.SUPABASE_ANON_KEY);
}

export async function supabaseRequest<T>(
  path: string,
  init: RequestInit = {},
  access: Access = "anon",
): Promise<T> {
  const { url, key } = configuration(access);
  const headers = new Headers(init.headers);
  headers.set("apikey", key);
  headers.set("Authorization", `Bearer ${key}`);
  if (init.body && !headers.has("Content-Type")) headers.set("Content-Type", "application/json");

  const response = await fetch(`${url}/rest/v1/${path}`, {
    ...init,
    headers,
    cache: "no-store",
  });
  const text = await response.text();
  if (!response.ok) {
    throw new SupabaseError(`Supabase request failed (${response.status})`, response.status, text.slice(0, 1000));
  }
  return (text ? JSON.parse(text) : null) as T;
}

export function queryString(values: Record<string, string | number | undefined>) {
  const params = new URLSearchParams();
  for (const [key, value] of Object.entries(values)) {
    if (value !== undefined) params.set(key, String(value));
  }
  return params.toString();
}

