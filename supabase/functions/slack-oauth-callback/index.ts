import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

Deno.serve(async (req) => {
  const supabase = createClient(
    Deno.env.get('SUPABASE_URL')!,
    Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!
  );

  const frontendUrl = Deno.env.get("FRONTEND_URL") || "https://connectpaidmedia.lovable.app";

  try {
    const url = new URL(req.url);
    const code = url.searchParams.get("code");
    const errorParam = url.searchParams.get("error");

    if (errorParam) {
      console.error('Slack OAuth error:', errorParam);
      return new Response(null, {
        status: 302,
        headers: { Location: `${frontendUrl}/settings?error=${encodeURIComponent(errorParam)}` },
      });
    }

    if (!code) {
      return new Response('Missing code parameter', { status: 400 });
    }

    const clientId = Deno.env.get('SLACK_CLIENT_ID')!;
    const clientSecret = Deno.env.get('SLACK_CLIENT_SECRET')!;

    // Exchange the auth code for tokens
    const tokenRes = await fetch('https://slack.com/api/oauth.v2.access', {
      method: 'POST',
      headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
      body: new URLSearchParams({
        client_id: clientId,
        client_secret: clientSecret,
        code,
      }),
    });

    const tokenData = await tokenRes.json();
    console.log('OAuth response ok:', tokenData.ok, 'team:', tokenData.team?.id);

    if (!tokenData.ok) {
      console.error('Slack oauth.v2.access failed:', tokenData.error);
      return new Response(null, {
        status: 302,
        headers: { Location: `${frontendUrl}/settings?error=${encodeURIComponent(tokenData.error || 'oauth_failed')}` },
      });
    }

    const workspaceId = tokenData.team?.id || 'default';
    const accessToken = tokenData.access_token;
    const refreshToken = tokenData.refresh_token;
    const expiresIn = tokenData.expires_in || 43200;
    const expiresAt = new Date(Date.now() + expiresIn * 1000);

    if (refreshToken) {
      // Token rotation is active — store rotating tokens
      const { error: upsertError } = await supabase.from('slack_tokens').upsert({
        workspace_id: workspaceId,
        bot_access_token: accessToken,
        refresh_token: refreshToken,
        expires_at: expiresAt.toISOString(),
        updated_at: new Date().toISOString(),
      }, { onConflict: 'workspace_id' });

      if (upsertError) {
        console.error('Failed to store tokens:', upsertError);
      } else {
        console.log('Stored rotating tokens for workspace:', workspaceId, 'expires:', expiresAt.toISOString());
      }
    } else {
      console.log('No refresh token — static token mode. Token starts with:', accessToken?.substring(0, 10));
    }

    return new Response(null, {
      status: 302,
      headers: { Location: `${frontendUrl}/settings?slack=connected` },
    });
  } catch (error) {
    console.error('Slack OAuth callback error:', error);
    return new Response(null, {
      status: 302,
      headers: { Location: `${frontendUrl}/settings?error=callback_error` },
    });
  }
});
