import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2.49.1";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
};

interface WelcomePayload {
  email: string;
  name: string;
  company?: string;
}

/**
 * Sends a welcome email to a new prospect signup by invoking the
 * shared `send-transactional-email` Edge Function (queue-backed).
 */
serve(async (req) => {
  if (req.method === "OPTIONS") return new Response(null, { headers: corsHeaders });

  try {
    const body = (await req.json()) as WelcomePayload;
    if (!body.email || !body.name) {
      return new Response(JSON.stringify({ error: "email and name required" }), {
        status: 400,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    const supabaseUrl = Deno.env.get("SUPABASE_URL")!;
    const serviceRoleKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
    const admin = createClient(supabaseUrl, serviceRoleKey);

    const today = new Date().toISOString().split("T")[0];
    const { data, error } = await admin.functions.invoke("send-transactional-email", {
      body: {
        templateName: "welcome-prospect",
        recipientEmail: body.email,
        idempotencyKey: `welcome-prospect:${body.email}:${today}`,
        templateData: { name: body.name, company: body.company ?? null },
      },
    });

    if (error) {
      console.warn("send-transactional-email failed:", error.message);
      return new Response(
        JSON.stringify({ success: true, queued: false, reason: error.message }),
        { status: 200, headers: { ...corsHeaders, "Content-Type": "application/json" } },
      );
    }

    return new Response(JSON.stringify({ success: true, queued: true, data }), {
      status: 200,
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  } catch (err) {
    console.error("send-welcome-email error:", err);
    return new Response(
      JSON.stringify({ error: err instanceof Error ? err.message : "Internal error" }),
      { status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" } },
    );
  }
});
