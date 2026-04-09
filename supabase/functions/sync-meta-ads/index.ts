import { createClient } from "https://esm.sh/@supabase/supabase-js@2";
import { corsHeaders } from "https://esm.sh/@supabase/supabase-js@2/cors";

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") {
    return new Response(null, { headers: corsHeaders });
  }

  const supabaseAdmin = createClient(
    Deno.env.get("SUPABASE_URL")!,
    Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!
  );

  let bodyClientId: string | null = null;
  try {
    const body = await req.json();
    bodyClientId = body?.client_id || body?.clientId || null;
  } catch { /* no body */ }

  let userId: string | null = null;
  const authHeader = req.headers.get("Authorization");
  if (authHeader?.startsWith("Bearer ")) {
    const supabaseUser = createClient(
      Deno.env.get("SUPABASE_URL")!,
      Deno.env.get("SUPABASE_PUBLISHABLE_KEY")!,
      { global: { headers: { Authorization: authHeader } } }
    );
    const { data: { user } } = await supabaseUser.auth.getUser();
    userId = user?.id || null;
  }

  let targetConnections: any[] = [];

  if (userId) {
    let query = supabaseAdmin
      .from("platform_connections")
      .select("user_id, access_token, metadata, selected_ad_account, client_id")
      .eq("user_id", userId)
      .eq("platform", "meta");
    if (bodyClientId) {
      query = query.eq("client_id", bodyClientId);
    }
    const { data: conns } = await query;
    if (!conns || conns.length === 0) {
      return new Response(JSON.stringify({ success: true, records_synced: 0, message: "No Meta connection found" }), {
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }
    targetConnections = conns;
  } else {
    // Cron mode
    const { data: connections } = await supabaseAdmin
      .from("platform_connections")
      .select("user_id, access_token, metadata, selected_ad_account, client_id")
      .eq("platform", "meta");
    if (!connections || connections.length === 0) {
      return new Response(JSON.stringify({ success: true, records_synced: 0, message: "No meta connections found" }), {
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }
    targetConnections = connections;
  }

  // Filter connections with a selected ad account
  const validConnections = targetConnections.filter(conn => {
    const sel = conn.selected_ad_account as any;
    const syncAccounts = (conn.metadata as any)?.sync_ad_accounts;
    if (sel?.id || (Array.isArray(syncAccounts) && syncAccounts.length > 0)) return true;
    // Also allow if ad_accounts are in metadata (first one will be used)
    const adAccounts = (conn.metadata as any)?.ad_accounts;
    if (Array.isArray(adAccounts) && adAccounts.length > 0) return true;
    console.warn(`Skipping Meta sync for client ${conn.client_id}: no ad account selected`);
    return false;
  });

  if (validConnections.length === 0) {
    return new Response(JSON.stringify({
      success: false,
      records_synced: 0,
      message: "No Meta connections have a selected ad account."
    }), {
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  }

  const results = [];
  for (const conn of validConnections) {
    const syncAccounts = (conn.metadata as any)?.sync_ad_accounts;
    let adAccountsToSync: any[];

    if (Array.isArray(syncAccounts) && syncAccounts.length > 0) {
      adAccountsToSync = syncAccounts;
    } else {
      const selectedAccount = conn.selected_ad_account as any;
      if (selectedAccount?.id) {
        adAccountsToSync = [selectedAccount];
      } else {
        // Fall back to first ad account from metadata
        const metaAccounts = (conn.metadata as any)?.ad_accounts || [];
        adAccountsToSync = metaAccounts.length > 0 ? [metaAccounts[0]] : [];
      }
    }

    if (adAccountsToSync.length === 0) continue;

    const result = await syncMetaForUser(supabaseAdmin, conn.user_id, conn.access_token, adAccountsToSync, conn.client_id);
    results.push(result);
  }

  return new Response(JSON.stringify({ results }), {
    headers: { ...corsHeaders, "Content-Type": "application/json" },
  });
});

async function syncMetaForUser(supabase: any, userId: string, accessToken: string, adAccounts: any[], clientId: string | null = null) {
  try {
    const endDate = new Date();
    const startDate = new Date();
    startDate.setDate(startDate.getDate() - 90);
    const since = formatDate(startDate);
    const until = formatDate(endDate);

    let totalRecords = 0;

    for (const account of adAccounts) {
      const accountId = account.id || account.account_id;
      if (!accountId) continue;

      const [dailyInsights, campaignInsights] = await Promise.all([
        fetchInsights(accountId, accessToken, since, until, "account"),
        fetchInsights(accountId, accessToken, since, until, "campaign", "campaign_id,campaign_name,objective,buying_type,"),
      ]);

      if (dailyInsights) {
        const batch = dailyInsights.map((day: any) => {
          const m = extractMetrics(day);
          return {
            client_id: clientId,
            platform: "meta",
            date: day.date_start,
            spend: m.spend, revenue: m.revenue,
            impressions: m.impressions, clicks: m.clicks,
            conversions: m.conversions,
            add_to_cart: m.addToCart,
            cost_per_conversion: m.conversions > 0 ? m.spend / m.conversions : null,
          };
        });
        await batchUpsert(supabase, "ad_daily_metrics", batch, "client_id,platform,date");
        totalRecords += batch.length;
      }

      // Fetch real statuses
      const campaignStatusMap = await fetchEntityStatuses(accountId, accessToken, "campaigns");

      if (campaignInsights) {
        const batch = campaignInsights.map((c: any) => {
          const m = extractMetrics(c);
          return {
            client_id: clientId,
            platform: "meta",
            campaign_name: c.campaign_name,
            status: campaignStatusMap.get(c.campaign_id) || "unknown",
            date: c.date_start,
            spend: m.spend, revenue: m.revenue,
            impressions: m.impressions, clicks: m.clicks,
            conversions: m.conversions,
            roas: m.spend > 0 ? m.revenue / m.spend : null,
            bidding_strategy_type: c.objective ? formatMetaObjective(c.objective) : null,
            campaign_type: c.buying_type || null,
          };
        });
        await batchUpsert(supabase, "ad_campaigns", batch, "client_id,platform,campaign_name,date");
        totalRecords += batch.length;
      }
    }

    return { success: true, records_synced: totalRecords };
  } catch (err) {
    console.error("Meta sync error:", err);
    return { error: err.message };
  }
}

async function fetchInsights(accountId: string, accessToken: string, since: string, until: string, level: string, extraFields = "") {
  const fields = `${extraFields}spend,impressions,clicks,actions,action_values`;
  let allData: any[] = [];
  let url: string | null = `https://graph.facebook.com/v21.0/${accountId}/insights?fields=${fields}&time_range={"since":"${since}","until":"${until}"}&time_increment=1&level=${level}&access_token=${accessToken}&limit=500`;

  while (url) {
    const res = await fetch(url);
    const data = await res.json();
    if (data.error) {
      console.error(`${level} error ${accountId}: ${data.error.message}`);
      break;
    }
    if (data.data) allData = allData.concat(data.data);
    url = data.paging?.next || null;
  }

  return allData.length > 0 ? allData : null;
}

async function fetchEntityStatuses(accountId: string, accessToken: string, entityType: "campaigns" | "adsets"): Promise<Map<string, string>> {
  const map = new Map<string, string>();
  let url: string | null = `https://graph.facebook.com/v21.0/${accountId}/${entityType}?fields=id,effective_status&limit=500&access_token=${accessToken}`;

  try {
    while (url) {
      const res = await fetch(url);
      const data = await res.json();
      if (data.error) break;
      if (data.data) {
        for (const entity of data.data) {
          map.set(entity.id, entity.effective_status?.toLowerCase() || "unknown");
        }
      }
      url = data.paging?.next || null;
    }
  } catch (err) {
    console.error(`Failed to fetch ${entityType} statuses:`, err);
  }
  return map;
}

async function batchUpsert(supabase: any, table: string, rows: any[], onConflict: string, batchSize = 200) {
  for (let i = 0; i < rows.length; i += batchSize) {
    const chunk = rows.slice(i, i + batchSize);
    const { error } = await supabase.from(table).upsert(chunk, { onConflict });
    if (error) console.error(`Batch upsert error on ${table}:`, error.message);
  }
}

function formatDate(d: Date): string {
  return d.toISOString().split("T")[0];
}

function formatMetaObjective(objective: string): string {
  const map: Record<string, string> = {
    OUTCOME_SALES: "Sales",
    OUTCOME_LEADS: "Leads",
    OUTCOME_ENGAGEMENT: "Engagement",
    OUTCOME_AWARENESS: "Awareness",
    OUTCOME_TRAFFIC: "Traffic",
    CONVERSIONS: "Conversions",
    LINK_CLICKS: "Traffic",
    LEAD_GENERATION: "Lead Gen",
  };
  return map[objective] || objective.replace(/_/g, " ").toLowerCase().replace(/\b\w/g, l => l.toUpperCase());
}

const PURCHASE_ACTIONS = [
  "purchase",
  "offsite_conversion.fb_pixel_purchase",
];

const ADD_TO_CART_ACTIONS = [
  "add_to_cart", "omni_add_to_cart",
  "offsite_conversion.fb_pixel_add_to_cart",
];

function extractMetrics(row: any) {
  const spend = parseFloat(row.spend || "0");
  const impressions = parseInt(row.impressions || "0");
  const clicks = parseInt(row.clicks || "0");
  let conversions = 0, revenue = 0, addToCart = 0;

  if (row.actions) {
    for (const a of row.actions) {
      if (conversions === 0 && PURCHASE_ACTIONS.includes(a.action_type)) {
        conversions = parseInt(a.value || "0");
      }
      if (addToCart === 0 && ADD_TO_CART_ACTIONS.includes(a.action_type)) {
        addToCart = parseInt(a.value || "0");
      }
    }
  }
  if (row.action_values) {
    for (const a of row.action_values) {
      if (PURCHASE_ACTIONS.includes(a.action_type)) {
        revenue += parseFloat(a.value || "0");
        break;
      }
    }
  }

  return { spend, impressions, clicks, conversions, revenue, addToCart };
}
