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

  console.log("[sync-google-ads] Starting sync...");
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
  let bodyClientId: string | null = null;
  let bodyDaysBack: number | null = null;
  try {
    const body = await req.json();
    bodyClientId = body?.client_id || body?.clientId || null;
    bodyDaysBack = body?.days_back || null;
  } catch { /* no body */ }

  console.log(`[sync-google-ads] userId=${userId}, clientId=${bodyClientId}, daysBack=${bodyDaysBack}`);
  if (userId) {
    let query = supabaseAdmin
      .from("platform_connections")
      .select("user_id, access_token, refresh_token, metadata, token_expires_at, client_id")
      .eq("user_id", userId)
      .eq("platform", "google");
    if (bodyClientId) {
      query = query.eq("client_id", bodyClientId);
    }
    const { data: conns } = await query;
    if (!conns || conns.length === 0) {
      return new Response(JSON.stringify({ success: true, records_synced: 0, message: "No Google connection found" }), {
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }
    targetConnections = conns;
  } else {
    const { data: connections } = await supabaseAdmin
      .from("platform_connections")
      .select("user_id, access_token, refresh_token, metadata, token_expires_at, client_id")
      .eq("platform", "google");
    if (!connections || connections.length === 0) {
      return new Response(JSON.stringify({ message: "No google connections found" }), {
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }
    targetConnections = connections;
  }

  console.log(`[sync-google-ads] Found ${targetConnections.length} connections, starting sync loop`);
  const results = [];
  for (const conn of targetConnections) {
    let accessToken = conn.access_token;
    if (conn.token_expires_at && new Date(conn.token_expires_at) < new Date()) {
      accessToken = await refreshGoogleToken(supabaseAdmin, conn.user_id, conn.refresh_token, conn.client_id);
      if (!accessToken) {
        results.push({ user_id: conn.user_id, error: "Token refresh failed" });
        continue;
      }
    }
    const daysBack = bodyDaysBack || 30;
    const result = await syncGoogleForUser(supabaseAdmin, conn.user_id, accessToken, conn.metadata, conn.client_id, daysBack);
    results.push(result);
  }

  const totalSynced = results.reduce((sum: number, r: any) => sum + (r.records_synced || 0), 0);
  const errors = results.filter((r: any) => r.error);
  const responseBody = errors.length === results.length
    ? { error: errors[0]?.error || "All connections failed" }
    : { success: true, records_synced: totalSynced, connections: results.length, results };
  return new Response(JSON.stringify(responseBody), {
    headers: { ...corsHeaders, "Content-Type": "application/json" },
  });
});

async function refreshGoogleToken(supabase: any, userId: string, refreshToken: string, clientId: string | null = null): Promise<string | null> {
  if (!refreshToken) return null;
  try {
    const res = await fetch("https://oauth2.googleapis.com/token", {
      method: "POST",
      headers: { "Content-Type": "application/x-www-form-urlencoded" },
      body: new URLSearchParams({
        client_id: Deno.env.get("GOOGLE_CLIENT_ID")!,
        client_secret: Deno.env.get("GOOGLE_CLIENT_SECRET")!,
        refresh_token: refreshToken,
        grant_type: "refresh_token",
      }),
    });
    const data = await res.json();
    if (data.access_token) {
      const tokenExpiresAt = data.expires_in
        ? new Date(Date.now() + data.expires_in * 1000).toISOString()
        : null;
      let updateQuery = supabase
        .from("platform_connections")
        .update({ access_token: data.access_token, token_expires_at: tokenExpiresAt })
        .eq("user_id", userId)
        .eq("platform", "google");
      if (clientId) updateQuery = updateQuery.eq("client_id", clientId);
      await updateQuery;
      return data.access_token;
    }
    console.error("Token refresh failed:", data);
    return null;
  } catch (err) {
    console.error("Token refresh error:", err);
    return null;
  }
}

async function syncGoogleForUser(supabase: any, userId: string, accessToken: string, metadata: any, clientId: string | null = null, daysBack: number = 30) {
  const startTime = Date.now();
  const TIME_BUDGET_MS = 50_000;

  function hasTimeBudget() {
    return (Date.now() - startTime) < TIME_BUDGET_MS;
  }

  try {
    const developerToken = Deno.env.get("GOOGLE_DEVELOPER_TOKEN")!;
    let customers = metadata?.customers || [];

    if (customers.length === 0) {
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
          await supabase
            .from("platform_connections")
            .update({ metadata: { customers } })
            .eq("user_id", userId)
            .eq("platform", "google");
        }
      } catch (err) {
        console.error("Failed to fetch customers:", err);
      }
    }

    if (customers.length === 0) {
      return { error: "No customer accounts found." };
    }

    const endDate = new Date();
    const startDate = new Date();
    startDate.setDate(startDate.getDate() - daysBack);
    const chunks = buildDateChunks(startDate, endDate, 7);

    let totalRecords = 0;
    let timedOut = false;

    for (const customerResource of customers) {
      if (!hasTimeBudget()) { timedOut = true; break; }
      const customerId = customerResource.replace("customers/", "");
      const resolved = await getAccessibleCustomerIds(customerId, accessToken, developerToken);
      let customerIds = resolved.childIds;
      const loginCustomerId = resolved.mccId || customerId;

      for (const cid of customerIds) {
        if (!hasTimeBudget()) { timedOut = true; break; }
        for (const { since, until } of chunks) {
          if (!hasTimeBudget()) { timedOut = true; break; }

          // Daily account metrics → ad_daily_metrics
          try {
            const dailyRows = await queryGoogleAds(cid, accessToken, developerToken, `
              SELECT
                segments.date,
                metrics.cost_micros,
                metrics.impressions,
                metrics.clicks,
                metrics.conversions,
                metrics.conversions_value
              FROM customer
              WHERE segments.date BETWEEN '${since}' AND '${until}'
            `, loginCustomerId);

            if (dailyRows.length > 0) {
              const batch = dailyRows.map((row: any) => {
                const spend = (row.metrics?.costMicros || 0) / 1_000_000;
                const revenue = row.metrics?.conversionsValue || 0;
                const impressions = parseInt(row.metrics?.impressions || "0");
                const clicks = parseInt(row.metrics?.clicks || "0");
                const conversions = Math.round(row.metrics?.conversions || 0);
                return {
                  client_id: clientId,
                  platform: "google",
                  date: row.segments?.date,
                  spend, revenue, impressions, clicks, conversions,
                  add_to_cart: 0,
                  cost_per_conversion: conversions > 0 ? spend / conversions : null,
                };
              });
              await supabase.from("ad_daily_metrics").upsert(batch, { onConflict: "client_id,platform,date" });
              totalRecords += batch.length;
            }
          } catch (err) {
            console.error(`Daily metrics error for ${cid} ${since}-${until}:`, err);
          }

          // Campaign metrics → ad_campaigns
          try {
            const campaignRows = await queryGoogleAds(cid, accessToken, developerToken, `
              SELECT
                campaign.id,
                campaign.name,
                campaign.status,
                campaign.bidding_strategy_type,
                campaign.advertising_channel_type,
                campaign.campaign_budget,
                segments.date,
                metrics.cost_micros,
                metrics.impressions,
                metrics.clicks,
                metrics.conversions,
                metrics.conversions_value,
                metrics.search_impression_share
              FROM campaign
              WHERE segments.date BETWEEN '${since}' AND '${until}'
            `, loginCustomerId);

            let budgetMap = new Map();
            try {
              const budgetRows = await queryGoogleAds(cid, accessToken, developerToken, `
                SELECT campaign.id, campaign_budget.amount_micros
                FROM campaign WHERE campaign.status IN ('ENABLED', 'PAUSED')
              `, loginCustomerId);
              for (const br of budgetRows) {
                const campId = String(br.campaign?.id);
                const amountMicros = br.campaignBudget?.amountMicros;
                if (amountMicros && amountMicros !== "0") {
                  budgetMap.set(campId, Number(amountMicros) / 1_000_000);
                }
              }
            } catch (budgetErr) {
              console.error(`Budget query error (non-fatal):`, budgetErr);
            }

            if (campaignRows.length > 0) {
              const batch = campaignRows.map((row: any) => {
                const spend = (row.metrics?.costMicros || 0) / 1_000_000;
                const revenue = row.metrics?.conversionsValue || 0;
                const campaignId = String(row.campaign?.id);
                return {
                  client_id: clientId,
                  platform: "google",
                  campaign_name: row.campaign?.name || "Unknown",
                  status: (row.campaign?.status || "UNKNOWN").toLowerCase(),
                  date: row.segments?.date,
                  spend, revenue,
                  impressions: parseInt(row.metrics?.impressions || "0"),
                  clicks: parseInt(row.metrics?.clicks || "0"),
                  conversions: Math.round(row.metrics?.conversions || 0),
                  roas: spend > 0 ? revenue / spend : null,
                  impression_share: row.metrics?.searchImpressionShare ?? null,
                  bidding_strategy_type: row.campaign?.biddingStrategyType
                    ? formatBiddingStrategy(row.campaign.biddingStrategyType)
                    : null,
                  campaign_type: row.campaign?.advertisingChannelType
                    ? formatChannelType(row.campaign.advertisingChannelType)
                    : null,
                  daily_budget: budgetMap.get(campaignId) ?? null,
                };
              });
              await supabase.from("ad_campaigns").upsert(batch, { onConflict: "client_id,platform,campaign_name,date" });
              totalRecords += batch.length;
            }
          } catch (err) {
            console.error(`Campaign metrics error for ${cid} ${since}-${until}:`, err);
          }
        }

        // === Ad-level data for search ads ===
        if (hasTimeBudget()) {
          try {
            const adRecords = await syncGoogleAdCreatives(supabase, cid, accessToken, developerToken, loginCustomerId, clientId, formatDate(startDate), formatDate(endDate));
            totalRecords += adRecords;
          } catch (err) {
            console.error(`Ad creative sync error for ${cid}:`, err);
          }
        }

        // === Ad Groups → ad_sets ===
        if (hasTimeBudget()) {
          for (const { since, until } of chunks) {
            if (!hasTimeBudget()) { timedOut = true; break; }
            try {
              const agRows = await queryGoogleAds(cid, accessToken, developerToken, `
                SELECT
                  ad_group.id,
                  ad_group.name,
                  ad_group.status,
                  campaign.name,
                  campaign.id,
                  segments.date,
                  metrics.cost_micros,
                  metrics.impressions,
                  metrics.clicks,
                  metrics.conversions,
                  metrics.conversions_value
                FROM ad_group
                WHERE segments.date BETWEEN '${since}' AND '${until}'
                  AND campaign.status IN ('ENABLED', 'PAUSED')
              `, loginCustomerId);

              if (agRows.length > 0) {
                const batch = agRows.map((row: any) => {
                  const spend = (row.metrics?.costMicros || 0) / 1_000_000;
                  const clicks = parseInt(row.metrics?.clicks || "0");
                  const impressions = parseInt(row.metrics?.impressions || "0");
                  const conversions = Math.round(row.metrics?.conversions || 0);
                  return {
                    client_id: clientId,
                    platform: "google",
                    campaign_name: row.campaign?.name || "Unknown",
                    platform_campaign_id: String(row.campaign?.id || ""),
                    adset_name: row.adGroup?.name || "Unknown",
                    platform_adset_id: String(row.adGroup?.id || ""),
                    status: (row.adGroup?.status || "UNKNOWN").toLowerCase(),
                    date: row.segments?.date,
                    spend,
                    revenue: row.metrics?.conversionsValue || 0,
                    impressions,
                    clicks,
                    conversions,
                    cpc: clicks > 0 ? Math.round((spend / clicks) * 100) / 100 : null,
                    ctr: impressions > 0 ? Math.round((clicks / impressions) * 10000) / 100 : null,
                    cpa: conversions > 0 ? Math.round((spend / conversions) * 100) / 100 : null,
                    account_id: cid,
                  };
                });
                await batchUpsert(supabase, "ad_sets", batch, "client_id,platform,campaign_name,adset_name,date");
                totalRecords += batch.length;
                console.log(`[sync] ${batch.length} ad group rows for ${cid} ${since}-${until}`);
              }
            } catch (err) {
              console.error(`Ad group sync error for ${cid} ${since}-${until}:`, err);
            }
          }
        }

        // === Keywords → campaign_keywords ===
        if (hasTimeBudget()) {
          for (const { since, until } of chunks) {
            if (!hasTimeBudget()) { timedOut = true; break; }
            try {
              const kwRows = await queryGoogleAds(cid, accessToken, developerToken, `
                SELECT
                  ad_group.id,
                  ad_group.name,
                  campaign.name,
                  ad_group_criterion.keyword.text,
                  ad_group_criterion.keyword.match_type,
                  ad_group_criterion.quality_info.quality_score,
                  ad_group_criterion.negative,
                  segments.date,
                  metrics.cost_micros,
                  metrics.impressions,
                  metrics.clicks,
                  metrics.conversions,
                  metrics.conversions_value,
                  metrics.search_impression_share
                FROM keyword_view
                WHERE segments.date BETWEEN '${since}' AND '${until}'
                  AND campaign.status IN ('ENABLED', 'PAUSED')
              `, loginCustomerId);

              if (kwRows.length > 0) {
                const batch = kwRows.filter((row: any) => row.adGroupCriterion?.keyword?.text).map((row: any) => {
                  const spend = (row.metrics?.costMicros || 0) / 1_000_000;
                  const clicks = parseInt(row.metrics?.clicks || "0");
                  const impressions = parseInt(row.metrics?.impressions || "0");
                  const conversions = Math.round(row.metrics?.conversions || 0);
                  return {
                    client_id: clientId,
                    platform: "google",
                    campaign_name: row.campaign?.name || "Unknown",
                    ad_group: row.adGroup?.name || "Unknown",
                    platform_adset_id: String(row.adGroup?.id || ""),
                    keyword: row.adGroupCriterion.keyword.text,
                    match_type: (row.adGroupCriterion.keyword.matchType || "").replace("_", " ").toLowerCase(),
                    quality_score: row.adGroupCriterion?.qualityInfo?.qualityScore ?? null,
                    is_negative: row.adGroupCriterion?.negative ?? false,
                    date: row.segments?.date,
                    spend,
                    revenue: row.metrics?.conversionsValue || 0,
                    impressions,
                    clicks,
                    conversions,
                    cpc: clicks > 0 ? Math.round((spend / clicks) * 100) / 100 : null,
                    ctr: impressions > 0 ? Math.round((clicks / impressions) * 10000) / 100 : null,
                    cpa: conversions > 0 ? Math.round((spend / conversions) * 100) / 100 : null,
                    impression_share: row.metrics?.searchImpressionShare ?? null,
                  };
                });
                await batchUpsert(supabase, "campaign_keywords", batch, "client_id,platform_adset_id,keyword,date");
                totalRecords += batch.length;
                console.log(`[sync] ${batch.length} keyword rows for ${cid} ${since}-${until}`);
              }
            } catch (err) {
              console.error(`Keyword sync error for ${cid} ${since}-${until}:`, err);
            }
          }
        }

        // === Search Terms → search_terms ===
        if (hasTimeBudget()) {
          for (const { since, until } of chunks) {
            if (!hasTimeBudget()) { timedOut = true; break; }
            try {
              const stRows = await queryGoogleAds(cid, accessToken, developerToken, `
                SELECT
                  search_term_view.search_term,
                  ad_group.id,
                  ad_group.name,
                  campaign.name,
                  campaign.id,
                  segments.keyword.info.text,
                  segments.keyword.info.match_type,
                  segments.date,
                  metrics.cost_micros,
                  metrics.impressions,
                  metrics.clicks,
                  metrics.conversions,
                  metrics.conversions_value
                FROM search_term_view
                WHERE segments.date BETWEEN '${since}' AND '${until}'
                  AND campaign.status IN ('ENABLED', 'PAUSED')
              `, loginCustomerId);

              if (stRows.length > 0) {
                const batch = stRows.filter((row: any) => row.searchTermView?.searchTerm).map((row: any) => {
                  const spend = (row.metrics?.costMicros || 0) / 1_000_000;
                  const clicks = parseInt(row.metrics?.clicks || "0");
                  const impressions = parseInt(row.metrics?.impressions || "0");
                  const conversions = Math.round(row.metrics?.conversions || 0);
                  return {
                    client_id: clientId,
                    platform_adset_id: String(row.adGroup?.id || ""),
                    platform_campaign_id: String(row.campaign?.id || ""),
                    campaign_name: row.campaign?.name || "Unknown",
                    search_term: row.searchTermView.searchTerm,
                    keyword_text: row.segments?.keyword?.info?.text || null,
                    match_type: (row.segments?.keyword?.info?.matchType || "").replace("_", " ").toLowerCase(),
                    date: row.segments?.date,
                    spend,
                    revenue: row.metrics?.conversionsValue || 0,
                    impressions,
                    clicks,
                    conversions,
                    cpc: clicks > 0 ? Math.round((spend / clicks) * 100) / 100 : null,
                    ctr: impressions > 0 ? Math.round((clicks / impressions) * 10000) / 100 : null,
                    cpa: conversions > 0 ? Math.round((spend / conversions) * 100) / 100 : null,
                  };
                });
                await batchUpsert(supabase, "search_terms", batch, "client_id,platform_adset_id,search_term,date");
                totalRecords += batch.length;
                console.log(`[sync] ${batch.length} search term rows for ${cid} ${since}-${until}`);
              }
            } catch (err) {
              console.error(`Search term sync error for ${cid} ${since}-${until}:`, err);
            }
          }
        }
      }
    }

    return { success: true, records_synced: totalRecords, partial: timedOut };
  } catch (err) {
    console.error("Google sync error:", err);
    return { error: err.message };
  }
}

async function syncGoogleAdCreatives(supabase: any, customerId: string, accessToken: string, developerToken: string, loginCustomerId: string, clientId: string | null, since: string, until: string): Promise<number> {
  // Query ad-level data with ad text assets and performance
  const adRows = await queryGoogleAds(customerId, accessToken, developerToken, `
    SELECT
      ad_group_ad.ad.id,
      ad_group_ad.ad.name,
      ad_group_ad.ad.type,
      ad_group_ad.ad.final_urls,
      ad_group_ad.ad.responsive_search_ad.headlines,
      ad_group_ad.ad.responsive_search_ad.descriptions,
      ad_group_ad.status,
      ad_group.id,
      ad_group.name,
      campaign.id,
      campaign.name,
      campaign.status,
      metrics.cost_micros,
      metrics.impressions,
      metrics.clicks,
      metrics.conversions,
      metrics.conversions_value
    FROM ad_group_ad
    WHERE segments.date BETWEEN '${since}' AND '${until}'
      AND campaign.status IN ('ENABLED', 'PAUSED')
      AND ad_group_ad.status IN ('ENABLED', 'PAUSED')
  `, loginCustomerId);

  if (adRows.length === 0) return 0;

  // Aggregate by ad ID
  const adMap = new Map<string, any>();
  for (const row of adRows) {
    const adId = String(row.adGroupAd?.ad?.id);
    if (!adId || adId === "undefined") continue;

    const spend = (row.metrics?.costMicros || 0) / 1_000_000;
    const revenue = row.metrics?.conversionsValue || 0;
    const impressions = parseInt(row.metrics?.impressions || "0");
    const clicks = parseInt(row.metrics?.clicks || "0");
    const conversions = Math.round(row.metrics?.conversions || 0);

    if (adMap.has(adId)) {
      const existing = adMap.get(adId);
      existing.spend += spend;
      existing.revenue += revenue;
      existing.impressions += impressions;
      existing.clicks += clicks;
      existing.conversions += conversions;
    } else {
      // Extract RSA headlines and descriptions
      const rsa = row.adGroupAd?.ad?.responsiveSearchAd;
      const headlines: string[] = [];
      const descriptions: string[] = [];
      if (rsa?.headlines) {
        for (const h of rsa.headlines) {
          if (h.text) headlines.push(h.text);
        }
      }
      if (rsa?.descriptions) {
        for (const d of rsa.descriptions) {
          if (d.text) descriptions.push(d.text);
        }
      }

      const finalUrls = row.adGroupAd?.ad?.finalUrls || [];
      const campaignName = row.campaign?.name || "Unknown";

      adMap.set(adId, {
        client_id: clientId,
        platform: "google",
        campaign_name: campaignName,
        ad_name: row.adGroupAd?.ad?.name || `RSA ${adId}`,
        platform_ad_id: adId,
        platform_campaign_id: String(row.campaign?.id || ""),
        platform_adset_id: String(row.adGroup?.id || ""),
        adset_name: row.adGroup?.name || null,
        creative_type: "search",
        headlines: headlines.length > 0 ? headlines : null,
        descriptions: descriptions.length > 0 ? descriptions : null,
        final_url: finalUrls[0] || null,
        display_url: finalUrls[0] ? new URL(finalUrls[0]).hostname : null,
        vertical: classifyVertical(campaignName),
        spend, impressions, clicks, conversions, revenue,
        status: (row.adGroupAd?.status || row.campaign?.status || "UNKNOWN").toLowerCase(),
        date_from: since,
        date_to: until,
      });
    }
  }

  // Build batch and compute derived metrics
  const batch = Array.from(adMap.values()).map(ad => ({
    ...ad,
    ctr: ad.impressions > 0 ? (ad.clicks / ad.impressions) * 100 : null,
    cpa: ad.conversions > 0 ? ad.spend / ad.conversions : null,
    roas: ad.spend > 0 ? ad.revenue / ad.spend : null,
  }));

  if (batch.length > 0) {
    await batchUpsert(supabase, "ad_creatives", batch, "client_id,platform,platform_ad_id");
  }

  return batch.length;
}

function classifyVertical(campaignName: string): string {
  const name = campaignName.toLowerCase();
  if (name.includes("pest") || name.includes("bug") || name.includes("roach") || name.includes("termite") || name.includes("rodent") || name.includes("ant control") || name.includes("bed bug") || name.includes("cockroach")) return "pest_control";
  if (name.includes("flight") || name.includes("premflight")) return "flights";
  if (name.includes("porta potty") || name.includes("portapotty")) return "porta_potty";
  if (name.includes("siding")) return "siding";
  if (name.includes("bath")) return "bathroom";
  if (name.includes("moving") || name.includes("movers")) return "moving";
  if (name.includes("home service")) return "home_services";
  return "other";
}

function buildDateChunks(start: Date, end: Date, chunkDays: number): { since: string; until: string }[] {
  const chunks: { since: string; until: string }[] = [];
  let current = new Date(start);
  while (current <= end) {
    const chunkEnd = new Date(current);
    chunkEnd.setDate(chunkEnd.getDate() + chunkDays - 1);
    if (chunkEnd > end) chunkEnd.setTime(end.getTime());
    chunks.push({ since: formatDate(current), until: formatDate(chunkEnd) });
    current = new Date(chunkEnd);
    current.setDate(current.getDate() + 1);
  }
  return chunks;
}

interface ResolvedAccounts {
  mccId: string | null;
  childIds: string[];
}

async function getAccessibleCustomerIds(customerId: string, accessToken: string, developerToken: string): Promise<ResolvedAccounts> {
  try {
    const childRows = await queryGoogleAds(customerId, accessToken, developerToken, `
      SELECT customer_client.id, customer_client.manager, customer_client.descriptive_name
      FROM customer_client WHERE customer_client.status = 'ENABLED'
    `, customerId);

    const nonManagerChildren = childRows
      .filter((r: any) => !r.customerClient?.manager)
      .map((r: any) => String(r.customerClient?.id));
    if (nonManagerChildren.length > 0) {
      return { mccId: customerId, childIds: nonManagerChildren };
    }
    const allIds = childRows.map((r: any) => String(r.customerClient?.id));
    if (allIds.includes(customerId)) {
      return { mccId: null, childIds: [customerId] };
    }
  } catch {
    // not an MCC
  }
  return { mccId: null, childIds: [customerId] };
}

async function queryGoogleAds(customerId: string, accessToken: string, developerToken: string, query: string, loginCustomerId?: string): Promise<any[]> {
  const headers: Record<string, string> = {
    Authorization: `Bearer ${accessToken}`,
    "developer-token": developerToken,
    "Content-Type": "application/json",
  };
  if (loginCustomerId && loginCustomerId !== customerId) {
    headers["login-customer-id"] = loginCustomerId;
  }
  const res = await fetch(
    `https://googleads.googleapis.com/v23/customers/${customerId}/googleAds:searchStream`,
    { method: "POST", headers, body: JSON.stringify({ query }) }
  );
  const data = await res.json();
  if (data.error) throw new Error(data.error.message || JSON.stringify(data.error));
  const results: any[] = [];
  if (Array.isArray(data)) {
    for (const batch of data) {
      if (batch.results) results.push(...batch.results);
    }
  }
  return results;
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

function formatBiddingStrategy(type: string): string {
  const map: Record<string, string> = {
    TARGET_CPA: "Target CPA",
    TARGET_ROAS: "Target ROAS",
    MAXIMIZE_CONVERSIONS: "Max Conversions",
    MAXIMIZE_CONVERSION_VALUE: "Max Conv. Value",
    MANUAL_CPC: "Manual CPC",
    ENHANCED_CPC: "Enhanced CPC",
    TARGET_SPEND: "Max Clicks",
    MAXIMIZE_CLICKS: "Max Clicks",
    TARGET_IMPRESSION_SHARE: "Target Imp. Share",
  };
  return map[type] || type.replace(/_/g, " ").toLowerCase().replace(/\b\w/g, l => l.toUpperCase());
}

function formatChannelType(type: string): string {
  const map: Record<string, string> = {
    SEARCH: "Search",
    DISPLAY: "Display",
    SHOPPING: "Shopping",
    VIDEO: "Video",
    MULTI_CHANNEL: "Performance Max",
    PERFORMANCE_MAX: "Performance Max",
    SMART: "Smart",
    LOCAL: "Local",
    DISCOVERY: "Discovery",
    DEMAND_GEN: "Demand Gen",
  };
  return map[type] || type.replace(/_/g, " ").toLowerCase().replace(/\b\w/g, l => l.toUpperCase());
}
