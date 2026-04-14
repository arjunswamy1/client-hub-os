import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

Deno.serve(async (req) => {
  try {
    const url = new URL(req.url);
    const code = url.searchParams.get("code");
    const stateParam = url.searchParams.get("state");
    const errorParam = url.searchParams.get("error");

    const frontendUrl = Deno.env.get("FRONTEND_URL") || "https://connectpaidmedia.lovable.app";
    const redirect = (path: string) =>
      new Response(null, {
        status: 302,
        headers: { Location: `${frontendUrl}${path}` },
      });

    if (errorParam) {
      return redirect(`/settings?error=${encodeURIComponent(errorParam)}`);
    }

    if (!code) {
      return redirect("/settings?error=missing_code");
    }

    // Exchange code for access token
    const clientId = Deno.env.get("SLACK_CLIENT_ID");
    const clientSecret = Deno.env.get("SLACK_CLIENT_SECRET");

    if (!clientId || !clientSecret) {
      console.error("Missing SLACK_CLIENT_ID or SLACK_CLIENT_SECRET");
      return redirect("/settings?error=missing_slack_credentials");
    }

    const tokenRes = await fetch("https://slack.com/api/oauth.v2.access", {
      method: "POST",
      headers: { "Content-Type": "application/x-www-form-urlencoded" },
      body: new URLSearchParams({
        code,
        client_id: clientId,
        client_secret: clientSecret,
        redirect_uri: `${Deno.env.get("SUPABASE_URL")}/functions/v1/slack-oauth-callback`,
      }),
    });

    const tokenData = await tokenRes.json();

    if (!tokenData.ok) {
      console.error("Slack OAuth error:", tokenData.error);
      return redirect(`/settings?error=${encodeURIComponent(tokenData.error || "slack_oauth_failed")}`);
    }

    // Store the bot token and team info
    const supabase = createClient(
      Deno.env.get("SUPABASE_URL")!,
      Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!
    );

    // Parse state for user_id if provided
    let userId: string | null = null;
    let clientId_db: string | null = null;
    if (stateParam) {
      try {
        const state = JSON.parse(atob(stateParam));
        userId = state.user_id || null;
        clientId_db = state.client_id || null;
      } catch { /* ignore */ }
    }

    // Store as platform connection
    const { error: upsertError } = await supabase
      .from("platform_connections")
      .upsert(
        {
          user_id: userId,
          platform: "slack",
          access_token: tokenData.access_token,
          account_id: tokenData.team?.id || null,
          account_name: tokenData.team?.name || "Slack Workspace",
          client_id: clientId_db,
          status: "active",
          metadata: {
            bot_user_id: tokenData.bot_user_id,
            scope: tokenData.scope,
            team: tokenData.team,
            authed_user: tokenData.authed_user,
          },
        },
        { onConflict: "user_id,platform,client_id" }
      );

    if (upsertError) {
      console.error("Upsert error:", upsertError);
      return redirect("/settings?error=db_error");
    }

    return redirect("/settings?connected=slack");
  } catch (err) {
    console.error("Slack callback error:", err);
    return new Response(null, {
      status: 302,
      headers: { Location: "/settings?error=server_error" },
    });
  }
});
