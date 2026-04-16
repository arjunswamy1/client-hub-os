import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2.49.1";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers":
    "authorization, x-client-info, apikey, content-type",
};

const SAMPLE_CLIENT_ID = "9cd00cfb-82a3-44ad-8639-342a51944343";

serve(async (req) => {
  if (req.method === "OPTIONS") {
    return new Response(null, { headers: corsHeaders });
  }

  try {
    const { firstName, lastName, email, companyName, monthlyAdSpend, password } =
      await req.json();

    // Validate
    if (!firstName || !lastName || !email || !companyName || !password) {
      return new Response(
        JSON.stringify({ error: "All fields are required" }),
        { status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" } }
      );
    }
    if (password.length < 8) {
      return new Response(
        JSON.stringify({ error: "Password must be at least 8 characters" }),
        { status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" } }
      );
    }

    const supabaseUrl = Deno.env.get("SUPABASE_URL")!;
    const serviceRoleKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
    const admin = createClient(supabaseUrl, serviceRoleKey);

    // 1. Create auth user
    const { data: authData, error: authError } = await admin.auth.admin.createUser({
      email,
      password,
      email_confirm: true,
      user_metadata: {
        first_name: firstName,
        last_name: lastName,
        company_name: companyName,
        is_demo_user: true,
      },
    });

    if (authError) {
      // If user already exists, return friendly error
      if (authError.message?.includes("already been registered")) {
        return new Response(
          JSON.stringify({ error: "An account with this email already exists. Please log in instead." }),
          { status: 409, headers: { ...corsHeaders, "Content-Type": "application/json" } }
        );
      }
      throw authError;
    }

    const userId = authData.user.id;

    // 2. Store lead
    await admin.from("leads").insert({
      first_name: firstName,
      last_name: lastName,
      email,
      company_name: companyName,
      monthly_ad_spend: monthlyAdSpend,
      user_id: userId,
      source: "demo_funnel",
    });

    // 3. Create client_users record for Sample Client
    await admin.from("client_users").insert({
      user_id: userId,
      client_id: SAMPLE_CLIENT_ID,
      display_name: `${firstName} ${lastName}`,
    });

    return new Response(
      JSON.stringify({
        success: true,
        message: "Account created successfully",
        userId,
      }),
      { status: 200, headers: { ...corsHeaders, "Content-Type": "application/json" } }
    );
  } catch (err) {
    console.error("demo-signup error:", err);
    return new Response(
      JSON.stringify({ error: err instanceof Error ? err.message : "Internal error" }),
      { status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" } }
    );
  }
});
