import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2.49.1";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers":
    "authorization, x-client-info, apikey, content-type",
};

serve(async (req) => {
  if (req.method === "OPTIONS") return new Response(null, { headers: corsHeaders });

  try {
    const { token, name, password } = await req.json();

    if (!token || !name?.trim() || !password) {
      return new Response(JSON.stringify({ error: "Name and password are required" }), {
        status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }
    if (password.length < 8) {
      return new Response(JSON.stringify({ error: "Password must be at least 8 characters" }), {
        status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    const supabaseUrl = Deno.env.get("SUPABASE_URL")!;
    const serviceRoleKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
    const admin = createClient(supabaseUrl, serviceRoleKey);

    // Validate invite
    const { data: invite } = await admin
      .from("team_invites")
      .select("*")
      .eq("token", token)
      .maybeSingle();

    if (!invite) {
      return new Response(JSON.stringify({ error: "This invite link is invalid." }), {
        status: 404, headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }
    if (invite.redeemed_at) {
      return new Response(JSON.stringify({ error: "This invite link has already been used." }), {
        status: 409, headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }
    if (new Date(invite.expires_at) < new Date()) {
      return new Response(JSON.stringify({ error: "This invite link has expired. Ask for a new one." }), {
        status: 410, headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    // Create the auth user, email pre-confirmed (invite went to their inbox)
    const { data: authData, error: authError } = await admin.auth.admin.createUser({
      email: invite.email,
      password,
      email_confirm: true,
      user_metadata: { display_name: name.trim() },
    });

    if (authError) {
      const msg = (authError.message || "").toLowerCase();
      if (msg.includes("already") || (authError as any).status === 422) {
        return new Response(
          JSON.stringify({ error: "An account already exists for this email — sign in instead, or use Forgot password." }),
          { status: 409, headers: { ...corsHeaders, "Content-Type": "application/json" } }
        );
      }
      throw authError;
    }

    const userId = authData.user.id;

    // Team member record (role comes from the invite, never the client)
    const { error: tmError } = await admin.from("team_members").insert({
      user_id: userId,
      name: name.trim(),
      email: invite.email,
      role: invite.role,
      is_active: true,
    });
    if (tmError) throw tmError;

    await admin.from("team_invites").update({ redeemed_at: new Date().toISOString() }).eq("id", invite.id);

    return new Response(JSON.stringify({ success: true, email: invite.email }), {
      status: 200, headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  } catch (err) {
    console.error("redeem-team-invite error:", err);
    return new Response(JSON.stringify({ error: err instanceof Error ? err.message : "Internal error" }), {
      status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  }
});
