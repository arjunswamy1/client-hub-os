import { KJUR, KEYUTIL, hextob64 } from "npm:jsrsasign@11.0";

export const UA_BASE_URL = "https://api.universalads.com/v1";

function sign(privateKeyPem: string, canonicalRequest: string): string {
  const key = KEYUTIL.getKey(privateKeyPem);
  const sig = new KJUR.crypto.Signature({ alg: "SHA256withECDSA" });
  sig.init(key);
  sig.updateString(canonicalRequest);
  return hextob64(sig.sign());
}

/** Signed request against the Universal Ads Third Party API. */
export async function uaFetch(
  apiKey: string,
  privateKeyPem: string,
  method: "GET" | "POST",
  endpoint: string,
  query: Record<string, string> = {},
  body?: unknown,
) {
  const url = new URL(`${UA_BASE_URL}${endpoint}`);
  for (const [k, v] of Object.entries(query)) url.searchParams.set(k, v);
  const bodyStr = body ? JSON.stringify(body) : "";
  const timestamp = String(Math.floor(Date.now() / 1000));
  const canonicalHeaders = `x-api-key:${apiKey}\nx-timestamp:${timestamp}`;
  const canonicalRequest = `${method}\n${url.pathname}\n${url.searchParams.toString()}\n${canonicalHeaders}\n${bodyStr}\nx-api-key;x-timestamp`;

  const res = await fetch(url.toString(), {
    method,
    headers: {
      "x-api-key": apiKey,
      "x-timestamp": timestamp,
      "x-signature": sign(privateKeyPem, canonicalRequest),
      ...(bodyStr ? { "Content-Type": "application/json" } : {}),
    },
    body: bodyStr || undefined,
  });
  const text = await res.text();
  let parsed: any = null;
  try { parsed = JSON.parse(text); } catch { /* non-json */ }
  if (res.status >= 400) {
    console.error(`Universal Ads ${method} ${endpoint} [${res.status}]: ${text.slice(0, 800)}`);
  }
  return { status: res.status, parsed, text };
}

export function pickNum(row: Record<string, any>, keys: string[]): number {
  for (const k of keys) {
    const v = row?.[k] ?? row?.metrics?.[k];
    if (v !== undefined && v !== null && v !== "") {
      const n = Number(v);
      if (!Number.isNaN(n)) return n;
    }
  }
  return 0;
}

export function pickStr(row: Record<string, any>, keys: string[]): string | null {
  for (const k of keys) {
    const v = row?.[k] ?? row?.dimensions?.[k];
    if (typeof v === "string" && v.trim()) return v.trim();
  }
  return null;
}
