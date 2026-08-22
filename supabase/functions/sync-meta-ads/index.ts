import { createClient } from "https://esm.sh/@supabase/supabase-js@2";
import { corsHeaders } from "https://esm.sh/@supabase/supabase-js@2/cors";
import { logIntegrationCall } from "../_shared/cost-tracking.ts";

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") {
    return new Response(null, { headers: corsHeaders });
  }

  const supabaseAdmin = createClient(
    Deno.env.get("SUPABASE_URL")!,
    Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!
  );

  let bodyClientId: string | null = null;
  let bodyDaysBack: number | null = null;
  try {
    const body = await req.json();
    bodyClientId = body?.client_id || body?.clientId || null;
    bodyDaysBack = body?.days_back || null;
  } catch { /* no body */ }

  let userId: string | null = null;
  const authHeader = req.headers.get("Authorization");
  if (authHeader?.startsWith("Bearer ")) {
    const supabaseUser = createClient(
      Deno.env.get("SUPABASE_URL")!,
      Deno.env.get("SUPABASE_ANON_KEY")!,
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
    const adAccounts = (conn.metadata as any)?.ad_accounts;
    if (Array.isArray(adAccounts) && adAccounts.length > 0) return true;
    console.warn(`Skipping Meta sync for client ${conn.client_id}: no ad account selected`);
    return false;
  });

  if (validConnections.length === 0) {
    return new Response(JSON.stringify({
      success: false, records_synced: 0,
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
        const metaAccounts = (conn.metadata as any)?.ad_accounts || [];
        adAccountsToSync = metaAccounts.length > 0 ? [metaAccounts[0]] : [];
      }
    }

    if (adAccountsToSync.length === 0) continue;

    const daysBack = bodyDaysBack || 90;
    const result = await syncMetaForUser(supabaseAdmin, conn.user_id, conn.access_token, adAccountsToSync, conn.client_id, daysBack);
    results.push(result);

    // Log integration usage per client sync
    if (conn.client_id) {
      await logIntegrationCall({
        client_id: conn.client_id,
        service: "meta_api",
        surface: "sync-meta-ads",
        calls: 1,
        metadata: {
          days_back: daysBack,
          ad_accounts: adAccountsToSync.length,
          records_synced: result?.records_synced ?? 0,
        },
      });
    }
  }

  return new Response(JSON.stringify({ results }), {
    headers: { ...corsHeaders, "Content-Type": "application/json" },
  });
});

async function syncMetaForUser(supabase: any, userId: string, accessToken: string, adAccounts: any[], clientId: string | null = null, daysBack: number = 90) {
  try {
    const endDate = new Date();
    const startDate = new Date();
    startDate.setDate(startDate.getDate() - daysBack);
    const since = formatDate(startDate);
    const until = formatDate(endDate);

    let totalRecords = 0;

    for (const account of adAccounts) {
      const accountId = account.id || account.account_id;
      if (!accountId) continue;

      // === Existing: daily + campaign metrics ===
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

      // === Ad set level (needed for creative drill-downs) ===
      try {
        const adsetInsights = await fetchInsights(
          accountId, accessToken, since, until, "adset",
          "campaign_id,campaign_name,adset_id,adset_name,",
        );
        if (adsetInsights) {
          const adsetStatusMap = await fetchEntityStatuses(accountId, accessToken, "adsets");
          const batch = adsetInsights.map((a: any) => {
            const m = extractMetrics(a);
            return {
              client_id: clientId,
              platform: "meta",
              campaign_name: a.campaign_name,
              platform_campaign_id: a.campaign_id || null,
              adset_name: a.adset_name || "Unnamed ad set",
              platform_adset_id: a.adset_id || null,
              account_id: accountId,
              status: adsetStatusMap.get(a.adset_id) || "unknown",
              date: a.date_start,
              spend: m.spend, revenue: m.revenue,
              impressions: m.impressions, clicks: m.clicks,
              conversions: m.conversions,
              cpc: m.clicks > 0 ? m.spend / m.clicks : null,
              ctr: m.impressions > 0 ? (m.clicks / m.impressions) * 100 : null,
              cpa: m.conversions > 0 ? m.spend / m.conversions : null,
            };
          });
          await batchUpsert(supabase, "ad_sets", batch, "client_id,platform,campaign_name,adset_name,date");
          totalRecords += batch.length;
        }
      } catch (err) {
        console.error("Meta ad set sync error:", err);
      }



      // === NEW: Ad-level data with creatives ===
      try {
        const adCreativeRecords = await syncAdCreatives(supabase, accountId, accessToken, clientId, since, until);
        totalRecords += adCreativeRecords;
      } catch (err) {
        console.error("Ad creative sync error:", err);
      }
    }

    return { success: true, records_synced: totalRecords };
  } catch (err) {
    console.error("Meta sync error:", err);
    return { error: err.message };
  }
}

async function syncAdCreatives(supabase: any, accountId: string, accessToken: string, clientId: string | null, since: string, until: string): Promise<number> {
  // Step 1: Get all ads with their creative details and performance
  const adFields = "id,name,status,campaign_id,adset_id,creative{id,thumbnail_url,image_url,video_id,object_story_spec,asset_feed_spec,effective_object_story_id,image_hash}";
  let ads: any[] = [];
  let url: string | null = `https://graph.facebook.com/v21.0/${accountId}/ads?fields=${adFields}&effective_status=["ACTIVE","PAUSED","PENDING_REVIEW","IN_PROCESS","WITH_ISSUES"]&limit=200&access_token=${accessToken}`;

  while (url) {
    const res = await fetch(url);
    const data = await res.json();
    if (data.error) {
      console.error("Ads fetch error:", data.error.message);
      break;
    }
    if (data.data) ads = ads.concat(data.data);
    url = data.paging?.next || null;
  }

  if (ads.length === 0) return 0;

  // Step 2: Get campaign names and adset names
  const campaignIds = [...new Set(ads.map((a: any) => a.campaign_id))];
  const adsetIds = [...new Set(ads.map((a: any) => a.adset_id))];

  const campaignNames = new Map<string, string>();
  const adsetNames = new Map<string, string>();

  // Fetch campaign names
  for (const cid of campaignIds) {
    try {
      const res = await fetch(`https://graph.facebook.com/v21.0/${cid}?fields=name&access_token=${accessToken}`);
      const data = await res.json();
      if (data.name) campaignNames.set(cid, data.name);
    } catch { /* skip */ }
  }

  // Fetch adset names
  for (const asid of adsetIds) {
    try {
      const res = await fetch(`https://graph.facebook.com/v21.0/${asid}?fields=name&access_token=${accessToken}`);
      const data = await res.json();
      if (data.name) adsetNames.set(asid, data.name);
    } catch { /* skip */ }
  }

  // Step 3: Get ad-level performance insights
  const adInsights = await fetchInsights(
    accountId, accessToken, since, until, "ad",
    "ad_id,ad_name,campaign_id,campaign_name,adset_id,adset_name,"
  );

  // Aggregate performance by ad_id across dates
  const perfMap = new Map<string, { spend: number; impressions: number; clicks: number; conversions: number; revenue: number; dateFrom: string; dateTo: string }>();
  if (adInsights) {
    for (const row of adInsights) {
      const adId = row.ad_id;
      if (!adId) continue;
      const m = extractMetrics(row);
      const existing = perfMap.get(adId);
      if (existing) {
        existing.spend += m.spend;
        existing.impressions += m.impressions;
        existing.clicks += m.clicks;
        existing.conversions += m.conversions;
        existing.revenue += m.revenue;
        if (row.date_start < existing.dateFrom) existing.dateFrom = row.date_start;
        if (row.date_start > existing.dateTo) existing.dateTo = row.date_start;
      } else {
        perfMap.set(adId, {
          spend: m.spend, impressions: m.impressions, clicks: m.clicks,
          conversions: m.conversions, revenue: m.revenue,
          dateFrom: row.date_start, dateTo: row.date_start,
        });
      }

      // Also update campaign/adset name maps from insights
      if (row.campaign_name) campaignNames.set(row.campaign_id, row.campaign_name);
      if (row.adset_name) adsetNames.set(row.adset_id, row.adset_name);
    }
  }

  // Step 4: Build upsert batch
  const batch = [];
  for (const ad of ads) {
    const creative = ad.creative || {};
    const campaignName = campaignNames.get(ad.campaign_id) || "Unknown Campaign";
    const perf = perfMap.get(ad.id);

    // Extract creative details
    let thumbnailUrl = creative.image_url || creative.thumbnail_url || null;
    let primaryText = "";
    let headlineText = "";
    let descriptionText = "";
    let ctaText = "";
    let linkUrl = "";
    let creativeType = "image";
    let videoUrl = null;

    // Try to get from object_story_spec
    const oss = creative.object_story_spec;
    if (oss) {
      const linkData = oss.link_data || oss.video_data || {};
      primaryText = linkData.message || linkData.description || "";
      headlineText = linkData.name || linkData.title || "";
      descriptionText = linkData.description || "";
      ctaText = linkData.call_to_action?.type || "";
      linkUrl = linkData.link || "";
      if (oss.video_data) {
        creativeType = "video";
        // Store video_id for later batch resolution
        videoUrl = oss.video_data.video_id || null;
      }
    }

    // Try asset_feed_spec for dynamic creative
    if (creative.asset_feed_spec) {
      const afs = creative.asset_feed_spec;
      if (afs.bodies?.[0]?.text) primaryText = afs.bodies[0].text;
      if (afs.titles?.[0]?.text) headlineText = afs.titles[0].text;
      if (afs.descriptions?.[0]?.text) descriptionText = afs.descriptions[0].text;
      if (afs.videos?.length > 0) creativeType = "video";
      if (afs.images?.length > 1) creativeType = "carousel";
    }

    if (creative.video_id && !videoUrl) {
      creativeType = "video";
      videoUrl = creative.video_id;
    }

    const vertical = classifyVertical(campaignName);
    const spend = perf?.spend || 0;
    const impressions = perf?.impressions || 0;
    const clicks = perf?.clicks || 0;
    const conversions = perf?.conversions || 0;
    const revenue = perf?.revenue || 0;

    batch.push({
      client_id: clientId,
      platform: "meta",
      campaign_name: campaignName,
      ad_name: ad.name || "Unnamed Ad",
      platform_ad_id: ad.id,
      platform_campaign_id: ad.campaign_id,
      platform_adset_id: ad.adset_id,
      adset_name: adsetNames.get(ad.adset_id) || null,
      creative_thumbnail_url: thumbnailUrl,
      creative_type: creativeType,
      primary_text: primaryText || null,
      headline: headlineText || null,
      description: descriptionText || null,
      cta: ctaText ? formatCTA(ctaText) : null,
      link_url: linkUrl || null,
      video_url: videoUrl, // temporarily holds video_id, resolved below
      vertical,
      spend, impressions, clicks, conversions, revenue,
      ctr: impressions > 0 ? (clicks / impressions) * 100 : null,
      cpa: conversions > 0 ? spend / conversions : null,
      roas: spend > 0 ? revenue / spend : null,
      status: ad.status?.toLowerCase() || "unknown",
      date_from: perf?.dateFrom || null,
      date_to: perf?.dateTo || null,
    });
  }

  // Resolve full-size thumbnails for creatives that have small/expiring CDN thumbnails
  const creativeIdsForThumbnail = ads
    .filter(ad => ad.creative?.id && (!ad.creative?.image_url || ad.creative?.image_url?.includes('p64x64')))
    .map(ad => ad.creative.id);
  
  const thumbnailMap = new Map<string, string>();
  for (let i = 0; i < creativeIdsForThumbnail.length; i += 10) {
    const chunk = creativeIdsForThumbnail.slice(i, i + 10);
    await Promise.all(chunk.map(async (cid) => {
      try {
        const res = await fetch(`https://graph.facebook.com/v21.0/${cid}?fields=thumbnail_url,image_url&thumbnail_width=400&thumbnail_height=400&access_token=${accessToken}`);
        if (res.ok) {
          const data = await res.json();
          const url = data.image_url || data.thumbnail_url;
          if (url) thumbnailMap.set(cid, url);
        }
      } catch { /* skip */ }
    }));
  }
  
  // Update batch items with better thumbnails
  for (let idx = 0; idx < batch.length; idx++) {
    const ad = ads[idx];
    const creativeId = ad?.creative?.id;
    if (creativeId && thumbnailMap.has(creativeId)) {
      const betterUrl = thumbnailMap.get(creativeId)!;
      // Only replace if current thumbnail is missing or is a tiny CDN URL
      if (!batch[idx].creative_thumbnail_url || batch[idx].creative_thumbnail_url.includes('p64x64')) {
        batch[idx].creative_thumbnail_url = betterUrl;
      }
    }
  }

  // Resolve video_ids to actual playable source URLs
  const videoIds = [...new Set(batch.filter(b => b.creative_type === "video" && b.video_url && !b.video_url.startsWith("http")).map(b => b.video_url))];
  const videoSourceMap = new Map<string, string>();
  for (let i = 0; i < videoIds.length; i += 5) {
    const chunk = videoIds.slice(i, i + 5);
    await Promise.all(chunk.map(async (vid) => {
      try {
        const res = await fetch(`https://graph.facebook.com/v21.0/${vid}?fields=source&access_token=${accessToken}`);
        if (res.ok) {
          const data = await res.json();
          if (data.source) videoSourceMap.set(vid, data.source);
        }
      } catch { /* skip */ }
    }));
  }
  // Replace video_id with actual source URL
  for (const item of batch) {
    if (item.video_url && videoSourceMap.has(item.video_url)) {
      item.video_url = videoSourceMap.get(item.video_url)!;
    } else if (item.video_url && !item.video_url.startsWith("http")) {
      item.video_url = null; // couldn't resolve, clear it
    }
  }

  if (batch.length > 0) {
    await batchUpsert(supabase, "ad_creatives", batch, "client_id,platform,platform_ad_id");
  }

  return batch.length;
}

// Classify campaign into a vertical based on naming patterns
function classifyVertical(campaignName: string): string {
  const name = campaignName.toLowerCase();
  if (name.includes("pest") || name.includes("bug") || name.includes("roach") || name.includes("termite") || name.includes("rodent") || name.includes("ant control") || name.includes("bed bug") || name.includes("cockroach") || name.includes("attila")) return "pest_control";
  if (name.includes("flight") || name.includes("premflight")) return "flights";
  if (name.includes("porta") || name.includes("portapotty")) return "porta_potty";
  if (name.includes("siding")) return "siding";
  if (name.includes("bath")) return "bathroom";
  if (name.includes("moving") || name.includes("movers")) return "moving";
  if (name.includes("home service")) return "home_services";
  return "other";
}

function formatCTA(cta: string): string {
  return cta.replace(/_/g, " ").toLowerCase().replace(/\b\w/g, l => l.toUpperCase());
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

const PURCHASE_ACTIONS = ["purchase", "offsite_conversion.fb_pixel_purchase"];
const ADD_TO_CART_ACTIONS = ["add_to_cart", "omni_add_to_cart", "offsite_conversion.fb_pixel_add_to_cart"];

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
