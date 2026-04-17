// One-time bootstrap: creates initial users with must_change_password flag and links them to clients
const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
};

interface UserSpec {
  email: string;
  password: string;
  display_name: string;
  client_id?: string;
  client_role?: string;
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: corsHeaders });

  const supabaseUrl = Deno.env.get("SUPABASE_URL")!;
  const serviceRoleKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;

  const { users } = (await req.json()) as { users: UserSpec[] };
  const results: any[] = [];

  for (const u of users) {
    // Try create
    let userRes = await fetch(`${supabaseUrl}/auth/v1/admin/users`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${serviceRoleKey}`,
        apikey: serviceRoleKey,
      },
      body: JSON.stringify({
        email: u.email,
        password: u.password,
        email_confirm: true,
        user_metadata: { must_change_password: true, display_name: u.display_name },
      }),
    });
    let userData = await userRes.json();
    let userId = userData?.id;

    // If user already exists, look them up and update password
    if (!userRes.ok && (userData?.msg || userData?.message || "").toString().toLowerCase().includes("already")) {
      const listRes = await fetch(`${supabaseUrl}/auth/v1/admin/users?filter=email.eq.${encodeURIComponent(u.email)}`, {
        headers: { Authorization: `Bearer ${serviceRoleKey}`, apikey: serviceRoleKey },
      });
      const listData = await listRes.json();
      const existing = listData?.users?.find((x: any) => x.email?.toLowerCase() === u.email.toLowerCase());
      if (existing) {
        userId = existing.id;
        await fetch(`${supabaseUrl}/auth/v1/admin/users/${userId}`, {
          method: "PUT",
          headers: {
            "Content-Type": "application/json",
            Authorization: `Bearer ${serviceRoleKey}`,
            apikey: serviceRoleKey,
          },
          body: JSON.stringify({
            password: u.password,
            user_metadata: { must_change_password: true, display_name: u.display_name },
          }),
        });
      }
    }

    // Link to client portal if requested
    if (userId && u.client_id) {
      await fetch(`${supabaseUrl}/rest/v1/client_users`, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Authorization: `Bearer ${serviceRoleKey}`,
          apikey: serviceRoleKey,
          Prefer: "resolution=ignore-duplicates",
        },
        body: JSON.stringify({
          user_id: userId,
          client_id: u.client_id,
          display_name: u.display_name,
          client_role: u.client_role || "viewer",
        }),
      });
    }

    results.push({ email: u.email, user_id: userId, ok: !!userId });
  }

  return new Response(JSON.stringify({ results }), {
    headers: { ...corsHeaders, "Content-Type": "application/json" },
  });
});
