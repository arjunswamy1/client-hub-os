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
 * Sends a welcome email to a new prospect signup.
 * Tries Lovable transactional email infra if configured; otherwise just
 * logs the lead so Charles can follow up manually.
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

    const firstName = body.name.split(" ")[0];
    const subject = `Welcome to Connect Paid Media, ${firstName}`;
    const html = `
      <!DOCTYPE html>
      <html>
        <body style="margin:0;padding:0;background:#ffffff;font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,sans-serif;color:#111827;">
          <table width="100%" cellpadding="0" cellspacing="0" style="max-width:560px;margin:0 auto;padding:32px 24px;">
            <tr><td>
              <h1 style="font-size:24px;margin:0 0 16px 0;color:#111827;">Welcome, ${firstName} 👋</h1>
              <p style="font-size:16px;line-height:1.6;color:#374151;margin:0 0 16px 0;">
                Thanks for signing up for the Connect Paid Media Hub${body.company ? ` on behalf of ${body.company}` : ""}.
              </p>
              <p style="font-size:16px;line-height:1.6;color:#374151;margin:0 0 24px 0;">
                We're getting your demo workspace ready. In the meantime, you can book a 30-minute walkthrough with Charles to see exactly how the Hub will surface where your ad spend is leaking — and how to plug it.
              </p>
              <table cellpadding="0" cellspacing="0"><tr><td style="background:#558B2F;border-radius:8px;">
                <a href="https://calendly.com/charles-connectpaidmedia/30min" style="display:inline-block;padding:14px 28px;color:#ffffff;text-decoration:none;font-weight:600;font-size:15px;">
                  Book your walkthrough
                </a>
              </td></tr></table>
              <p style="font-size:14px;line-height:1.6;color:#6b7280;margin:32px 0 0 0;">
                Talk soon,<br/>
                Charles & the CPM team
              </p>
            </td></tr>
          </table>
        </body>
      </html>
    `;

    // Try to enqueue via Lovable transactional email infra (if installed)
    try {
      const supabaseUrl = Deno.env.get("SUPABASE_URL")!;
      const serviceRoleKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
      const admin = createClient(supabaseUrl, serviceRoleKey);

      const { error: enqueueErr } = await admin.rpc("enqueue_email", {
        queue_name: "transactional_emails",
        message: {
          to: body.email,
          subject,
          html,
          template_name: "welcome_prospect",
          purpose: "transactional",
          idempotency_key: `welcome:${body.email}:${new Date().toISOString().split("T")[0]}`,
        },
      });

      if (enqueueErr) {
        console.warn("Email queue not yet configured — lead saved, email skipped:", enqueueErr.message);
        return new Response(
          JSON.stringify({ success: true, queued: false, reason: "email_infra_not_configured" }),
          { status: 200, headers: { ...corsHeaders, "Content-Type": "application/json" } }
        );
      }

      return new Response(JSON.stringify({ success: true, queued: true }), {
        status: 200,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    } catch (innerErr) {
      console.warn("Email infra unavailable, lead captured only:", innerErr);
      return new Response(JSON.stringify({ success: true, queued: false }), {
        status: 200,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }
  } catch (err) {
    console.error("send-welcome-email error:", err);
    return new Response(
      JSON.stringify({ error: err instanceof Error ? err.message : "Internal error" }),
      { status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" } }
    );
  }
});
