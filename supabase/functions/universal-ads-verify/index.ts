import { createClient } from "https://esm.sh/@supabase/supabase-js@2.49.1";
import { corsHeaders } from "npm:@supabase/supabase-js@2/cors";
import { KJUR, KEYUTIL, hextob64 } from "npm:jsrsasign@11.0";

const BASE_URL = "https://api.universalads.com/v1";

function json(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { ...corsHeaders, "Content-Type": "application/json" },
  });
}

function signCanonicalRequest(privateKeyPem: string, canonicalRequest: string): string {
  const key = KEYUTIL.getKey(privateKeyPem);
  const sig = new KJUR.crypto.Signature({ alg: "SHA256withECDSA" });
  sig.init(key);
  sig.updateString(canonicalRequest);
  const hexSig = sig.sign();
  // jsrsasign ECDSA signature is DER-encoded; base64 encode it.
  return hextob64(hexSig);
}

async function getAuthHeaders(
  apiKey: string,
  privateKeyPem: string,
  method: string,
  path: string,
  query: string,
  body: string
) {
  const timestamp = String(Math.floor(Date.now() / 1000));
  const canonicalHeaders = `x-api-key:${apiKey}\nx-timestamp:${timestamp}`;
  const signedHeaders = "x-api-key;x-timestamp";
  // Universal Ads backend expects lowercase HTTP method in the canonical request.
  const canonicalRequest = `${method.toUpperCase()}\n${path}\n${query}\n${canonicalHeaders}\n${body}\n${signedHeaders}`;

  const signatureB64 = signCanonicalRequest(privateKeyPem, canonicalRequest);

  return {
    headers: {
      "x-api-key": apiKey,
      "x-timestamp": timestamp,
      "x-signature": signatureB64,
    },
    canonicalRequest,
  };
}

async function signedFetch(
  apiKey: string,
  privateKeyPem: string,
  method: string,
  endpoint: string,
  query: Record<string, string> = {},
  body?: unknown
) {
  const url = new URL(`${BASE_URL}${endpoint}`);
  for (const [k, v] of Object.entries(query)) url.searchParams.set(k, v);
  const bodyStr = body ? JSON.stringify(body) : "";
  const { headers, canonicalRequest } = await getAuthHeaders(
    apiKey,
    privateKeyPem,
    method,
    url.pathname,
    url.searchParams.toString(),
    bodyStr
  );
  const res = await fetch(url.toString(), {
    method,
    headers,
    body: bodyStr || undefined,
  });
  const text = await res.text();
  let parsed: unknown = null;
  try { parsed = JSON.parse(text); } catch { /* ignore */ }
  if (res.status >= 400) {
    console.error(`Universal Ads ${method} ${endpoint} failed [${res.status}]: ${text}`);
  }
  return { status: res.status, text, parsed };
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: corsHeaders });

  try {
    const SUPABASE_URL = Deno.env.get("SUPABASE_URL")!;
    const SERVICE_KEY = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
    const API_KEY = Deno.env.get("UNIVERSAL_ADS_APP_KEY");
    const PRIVATE_KEY = Deno.env.get("UNIVERSAL_ADS_PRIVATE_KEY");

    const admin = createClient(SUPABASE_URL, SERVICE_KEY);

    const authHeader = req.headers.get("Authorization") ?? "";
    const token = authHeader.replace("Bearer ", "");
    if (!token) return json({ error: "Not authenticated" }, 401);
    const { data: userData, error: userErr } = await admin.auth.getUser(token);
    if (userErr || !userData?.user) return json({ error: "Not authenticated" }, 401);
    const { data: isAdmin } = await admin.rpc("is_admin", { check_user_id: userData.user.id });
    if (!isAdmin) return json({ error: "Admin access required" }, 403);

    if (!API_KEY || !PRIVATE_KEY) {
      return json({ error: "Universal Ads credentials are not configured (UNIVERSAL_ADS_APP_KEY / UNIVERSAL_ADS_PRIVATE_KEY)." }, 400);
    }

    const body = await req.json().catch(() => ({}));
    const action = typeof body.action === "string" ? body.action : "verify";
    const adaccountId = typeof body.adaccount_id === "string" ? body.adaccount_id : "";

    if (action === "authorization_url") {
      const APP_ID = Deno.env.get("UNIVERSAL_ADS_APP_ID");
      if (!APP_ID) return json({ error: "UNIVERSAL_ADS_APP_ID is not configured." }, 400);
      return json({ success: true, url: `https://manage.universalads.com/apps/${APP_ID}/authorize` });
    }

    if (action === "list_adaccounts") {
      const { status, parsed, text } = await signedFetch(API_KEY, PRIVATE_KEY, "GET", "/me/adaccounts");
      if (status >= 400) {
        return json({ error: "Failed to list ad accounts", status, details: parsed || text }, status);
      }
      return json({ success: true, adaccounts: (parsed as any)?.data ?? parsed });
    }

    if (action === "test_adaccount") {
      if (!adaccountId) return json({ error: "Missing adaccount_id" }, 400);
      const { status, parsed, text } = await signedFetch(
        API_KEY,
        PRIVATE_KEY,
        "GET",
        "/campaign",
        { adaccount_id: adaccountId, limit: "1" }
      );
      if (status >= 400) {
        return json({ error: "Ad account test failed", status, details: parsed || text }, status);
      }
      return json({ success: true, adaccount_id: adaccountId, campaigns: (parsed as any)?.data ?? parsed });
    }

    // Default verify: call /me/adaccounts and /me/organizations
    const orgs = await signedFetch(API_KEY, PRIVATE_KEY, "GET", "/me/organizations");
    const adaccounts = await signedFetch(API_KEY, PRIVATE_KEY, "GET", "/me/adaccounts");

    return json({
      success: true,
      organizations: orgs.status < 400 ? orgs.parsed : { error: orgs.text, status: orgs.status },
      adaccounts: adaccounts.status < 400 ? adaccounts.parsed : { error: adaccounts.text, status: adaccounts.status },
    });
  } catch (e) {
    console.error("universal-ads-verify error:", e);
    return json({ error: (e as Error).message }, 500);
  }
});
