import { createClient } from "https://esm.sh/@supabase/supabase-js@2.45.0";
import { CALLS } from "./data.ts";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
};

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: corsHeaders });

  const supabase = createClient(
    Deno.env.get("SUPABASE_URL")!,
    Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!,
  );

  const { data: client, error: clientErr } = await supabase
    .from("clients")
    .select("id, name")
    .ilike("name", "%buyology%")
    .limit(1)
    .maybeSingle();

  if (clientErr || !client) {
    return new Response(JSON.stringify({ error: "buyologyiq client not found", clientErr }), {
      status: 400,
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  }

  const rows = (CALLS as unknown as Record<string, unknown>[]).map((c) => ({
    ...c,
    client_id: client.id,
  }));

  let inserted = 0;
  for (let i = 0; i < rows.length; i += 200) {
    const chunk = rows.slice(i, i + 200);
    const { error } = await supabase
      .from("ringba_calls")
      .upsert(chunk, { onConflict: "client_id,call_id" });
    if (error) {
      return new Response(JSON.stringify({ error: error.message, inserted }), {
        status: 500,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }
    inserted += chunk.length;
  }

  return new Response(JSON.stringify({ client: client.name, inserted }), {
    headers: { ...corsHeaders, "Content-Type": "application/json" },
  });
});
