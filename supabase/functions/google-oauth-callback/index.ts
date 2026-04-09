import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

Deno.serve(async (req) => {
  try {
    const url = new URL(req.url);
    const code = url.searchParams.get("code");
    const stateParam = url.searchParams.get("state");
    const errorParam = url.searchParams.get("error");

    const frontendUrl = Deno.env.get("FRONTEND_URL") || Deno.env.get("SUPABASE_URL")?.replace(".supabase.co", "") || "";
    const redirect = (path: string) =>
      new Response(null, {
        status: 302,
        headers: { Location: `${frontendUrl}${path}` },
      });

    if (errorParam) {
      return redirect(`/settings?error=${encodeURIComponent(errorParam)}`);
    }

    if (!code || !stateParam) {
      return redirect("/settings?error=missing_params");
    }

    let state: { user_id: string; client_id?: string };
    try {
      state = JSON.parse(atob(stateParam));
    } catch {
      return redirect("/settings?error=invalid_state");
    }

    const clientId = Deno.env.get("GOOGLE_CLIENT_ID")!;
    const clientSecret = Deno.env.get("GOOGLE_CLIENT_SECRET")!;
    const redirectUri = `${Deno.env.get("SUPABASE_URL")}/functions/v1/google-oauth-callback`;

    // Exchange code for tokens
    const tokenRes = await fetch("https://oauth2.googleapis.com/token", {
      method: "POST",
      headers: { "Content-Type": "application/x-www-form-urlencoded" },
      body: new URLSearchParams({
        code,
        client_id: clientId,
        client_secret: clientSecret,
        redirect_uri: redirectUri,
        grant_type: "authorization_code",
      }),
    });

    const tokenData = await tokenRes.json();

    if (tokenData.error) {
      return redirect(
        `/settings?error=${encodeURIComponent(tokenData.error_description || tokenData.error)}`
      );
    }

    const accessToken = tokenData.access_token;
    const refreshToken = tokenData.refresh_token;
    const expiresIn = tokenData.expires_in;

    // Fetch accessible Google Ads customer accounts
    const developerToken = Deno.env.get("GOOGLE_DEVELOPER_TOKEN");
    let customers: any[] = [];
    let accountName = "Google Ads";

    if (developerToken) {
      try {
        const customersRes = await fetch(
          "https://googleads.googleapis.com/v23/customers:listAccessibleCustomers",
          {
            headers: {
              Authorization: `Bearer ${accessToken}`,
              "developer-token": developerToken,
            },
          }
        );
        const customersData = await customersRes.json();
        customers = customersData.resourceNames || [];
        if (customers.length > 0) {
          const firstCustomerId = customers[0].replace("customers/", "");
          accountName = `Google Ads (${firstCustomerId})`;
        }
      } catch (err) {
        console.error("Failed to fetch Google Ads customers:", err);
      }
    }

    // Store connection
    const supabase = createClient(
      Deno.env.get("SUPABASE_URL")!,
      Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!
    );

    const tokenExpiresAt = expiresIn
      ? new Date(Date.now() + expiresIn * 1000).toISOString()
      : null;

    const { error: upsertError } = await supabase
      .from("platform_connections")
      .upsert(
        {
          user_id: state.user_id,
          platform: "google",
          access_token: accessToken,
          refresh_token: refreshToken || null,
          account_name: accountName,
          token_expires_at: tokenExpiresAt,
          metadata: { customers },
          client_id: state.client_id || null,
          status: "active",
        },
        { onConflict: "user_id,platform,client_id" }
      );

    if (upsertError) {
      console.error("Upsert error:", upsertError);
      return redirect("/settings?error=db_error");
    }

    const clientParam = state.client_id ? `&client_id=${state.client_id}` : "";
    return redirect(`/settings?connected=google${clientParam}`);
  } catch (err) {
    console.error("Callback error:", err);
    return new Response(null, {
      status: 302,
      headers: { Location: `/settings?error=server_error` },
    });
  }
});
