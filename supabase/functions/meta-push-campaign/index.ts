// Meta Push-to-Draft edge function
// Pushes a CPM Hub trafficking campaign + its ads to Meta as PAUSED drafts.
// Account managers then review and activate inside Meta Ads Manager.

import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const META_API_VERSION = "v21.0";
const META_BASE = `https://graph.facebook.com/${META_API_VERSION}`;

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
};

type ObjectiveKey = "sales" | "leads" | "traffic" | "awareness" | "engagement";

const OBJECTIVE_MAP: Record<ObjectiveKey, { campaign: string; optimization_goal: string }> = {
  sales:      { campaign: "OUTCOME_SALES",      optimization_goal: "OFFSITE_CONVERSIONS" },
  leads:      { campaign: "OUTCOME_LEADS",      optimization_goal: "LEAD_GENERATION" },
  traffic:    { campaign: "OUTCOME_TRAFFIC",    optimization_goal: "LINK_CLICKS" },
  awareness:  { campaign: "OUTCOME_AWARENESS",  optimization_goal: "REACH" },
  engagement: { campaign: "OUTCOME_ENGAGEMENT", optimization_goal: "POST_ENGAGEMENT" },
};

interface PushRequest {
  campaign_id: string;        // trafficking_campaigns.id
  ad_ids?: string[];          // optional subset of trafficking_ads.id to push (default: all in campaign)
  ad_account_id: string;      // Meta ad account, e.g. "act_1234567890"
  page_id: string;
  instagram_actor_id?: string;
  pixel_id?: string;
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: corsHeaders });

  try {
    const body = (await req.json()) as PushRequest;
    if (!body.campaign_id || !body.ad_account_id || !body.page_id) {
      return json({ error: "campaign_id, ad_account_id, and page_id are required" }, 400);
    }

    // Auth: identify the calling user
    const authHeader = req.headers.get("Authorization") ?? "";
    const supabaseUser = createClient(
      Deno.env.get("SUPABASE_URL")!,
      Deno.env.get("SUPABASE_ANON_KEY")!,
      { global: { headers: { Authorization: authHeader } } }
    );
    const { data: userData } = await supabaseUser.auth.getUser();
    if (!userData?.user) return json({ error: "unauthorized" }, 401);
    const userId = userData.user.id;

    // Service role client for DB writes
    const supabase = createClient(
      Deno.env.get("SUPABASE_URL")!,
      Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!
    );

    // Load campaign
    const { data: campaign, error: campErr } = await supabase
      .from("trafficking_campaigns")
      .select("*")
      .eq("id", body.campaign_id)
      .single();
    if (campErr || !campaign) return json({ error: "campaign not found" }, 404);

    // Resolve team_member_id
    const { data: tm } = await supabase
      .from("team_members")
      .select("id")
      .eq("user_id", userId)
      .eq("is_active", true)
      .maybeSingle();
    const teamMemberId = tm?.id ?? null;

    // Get Meta access token for this client
    const { data: conn } = await supabase
      .from("platform_connections")
      .select("access_token")
      .eq("client_id", campaign.client_id)
      .eq("platform", "meta")
      .eq("status", "active")
      .maybeSingle();
    if (!conn?.access_token) return json({ error: "meta connection not found for this client" }, 400);
    const token = conn.access_token;

    // Load ads
    let adsQuery = supabase.from("trafficking_ads").select("*").eq("campaign_id", body.campaign_id);
    if (body.ad_ids?.length) adsQuery = adsQuery.in("id", body.ad_ids);
    const { data: ads = [] } = await adsQuery;

    const log = async (entry: Record<string, unknown>) => {
      await supabase.from("meta_push_log").insert({
        client_id: campaign.client_id,
        trafficking_campaign_id: body.campaign_id,
        pushed_by_id: teamMemberId,
        ...entry,
      });
    };

    // === 1. CREATE CAMPAIGN ===
    const objKey = (campaign.objective || "traffic") as ObjectiveKey;
    const objConfig = OBJECTIVE_MAP[objKey] || OBJECTIVE_MAP.traffic;

    let metaCampaignId = campaign.meta_campaign_id;
    if (!metaCampaignId) {
      const campaignPayload = {
        name: campaign.name,
        objective: objConfig.campaign,
        status: "PAUSED",
        special_ad_categories: JSON.stringify([]),
        access_token: token,
      };
      const campaignRes = await metaPost(`${META_BASE}/${body.ad_account_id}/campaigns`, campaignPayload);
      if (campaignRes.error) {
        await log({ entity_type: "campaign", action: "create", status: "error", request_payload: campaignPayload, response_payload: campaignRes, error_message: campaignRes.error.message });
        await supabase.from("trafficking_campaigns").update({ meta_push_error: campaignRes.error.message }).eq("id", body.campaign_id);
        return json({ error: `Campaign create failed: ${campaignRes.error.message}`, details: campaignRes.error }, 400);
      }
      metaCampaignId = campaignRes.id;
      await log({ entity_type: "campaign", action: "create", status: "success", meta_entity_id: metaCampaignId, request_payload: campaignPayload, response_payload: campaignRes });
    }

    // === 2. CREATE AD SET ===
    const targeting = (campaign.targeting_spec as Record<string, unknown>) || {};
    const minimalTargeting = {
      geo_locations: targeting.geo_locations || { countries: ["US"] },
      age_min: targeting.age_min || 18,
      age_max: targeting.age_max || 65,
      ...(targeting.genders ? { genders: targeting.genders } : {}),
      ...(targeting.custom_audiences ? { custom_audiences: targeting.custom_audiences } : {}),
      ...(targeting.interests ? { interests: targeting.interests } : {}),
      ...(targeting.publisher_platforms ? { publisher_platforms: targeting.publisher_platforms } : {}),
      ...(targeting.facebook_positions ? { facebook_positions: targeting.facebook_positions } : {}),
      ...(targeting.instagram_positions ? { instagram_positions: targeting.instagram_positions } : {}),
      ...(targeting.device_platforms ? { device_platforms: targeting.device_platforms } : {}),
    };

    const dailyBudgetCents = campaign.total_budget && campaign.start_date && campaign.end_date
      ? Math.round((Number(campaign.total_budget) / daysBetween(campaign.start_date, campaign.end_date)) * 100)
      : 5000; // $50 default

    const adsetPayload: Record<string, unknown> = {
      name: `${campaign.name} – Ad Set`,
      campaign_id: metaCampaignId,
      status: "PAUSED",
      daily_budget: dailyBudgetCents,
      billing_event: campaign.billing_event || "IMPRESSIONS",
      optimization_goal: campaign.optimization_goal || objConfig.optimization_goal,
      targeting: JSON.stringify(minimalTargeting),
      access_token: token,
    };
    if (campaign.start_date) adsetPayload.start_time = new Date(campaign.start_date).toISOString();
    if (campaign.end_date) adsetPayload.end_time = new Date(campaign.end_date).toISOString();
    if (objKey === "sales" && body.pixel_id) {
      adsetPayload.promoted_object = JSON.stringify({ pixel_id: body.pixel_id, custom_event_type: "PURCHASE" });
    } else if (objKey === "leads") {
      adsetPayload.promoted_object = JSON.stringify({ page_id: body.page_id });
    }

    let metaAdsetId = campaign.meta_adset_id;
    if (!metaAdsetId) {
      const adsetRes = await metaPost(`${META_BASE}/${body.ad_account_id}/adsets`, adsetPayload);
      if (adsetRes.error) {
        await log({ entity_type: "adset", action: "create", status: "error", request_payload: adsetPayload, response_payload: adsetRes, error_message: adsetRes.error.message });
        return json({ error: `Ad set create failed: ${adsetRes.error.message}`, meta_campaign_id: metaCampaignId, details: adsetRes.error }, 400);
      }
      metaAdsetId = adsetRes.id;
      await log({ entity_type: "adset", action: "create", status: "success", meta_entity_id: metaAdsetId, request_payload: adsetPayload, response_payload: adsetRes });
    }

    // Save campaign-level Meta IDs
    await supabase.from("trafficking_campaigns").update({
      meta_campaign_id: metaCampaignId,
      meta_adset_id: metaAdsetId,
      meta_ad_account_id: body.ad_account_id,
      meta_page_id: body.page_id,
      meta_instagram_actor_id: body.instagram_actor_id,
      meta_pixel_id: body.pixel_id,
      meta_pushed_at: new Date().toISOString(),
      meta_pushed_by_id: teamMemberId,
      meta_push_error: null,
      status: "pushed_to_meta",
    }).eq("id", body.campaign_id);

    // === 3. CREATE EACH AD ===
    const adResults: Array<{ ad_id: string; status: string; meta_ad_id?: string; error?: string }> = [];
    for (const ad of ads) {
      try {
        // 3a. Resolve creative asset (image_hash or video_id)
        let imageHash: string | undefined = ad.meta_image_hash;
        let videoId: string | undefined = ad.meta_video_id;

        if (!imageHash && !videoId) {
          // Try first asset_url
          const assetUrls = (ad.asset_urls as Array<{ url: string; type?: string }>) || [];
          const firstAsset = assetUrls[0];
          if (firstAsset?.url) {
            if (firstAsset.type === "video") {
              const vRes = await metaPost(`${META_BASE}/${body.ad_account_id}/advideos`, {
                file_url: firstAsset.url,
                access_token: token,
              });
              if (vRes.error) throw new Error(`Video upload failed: ${vRes.error.message}`);
              videoId = vRes.id;
              await log({ trafficking_ad_id: ad.id, entity_type: "video", action: "create", status: "success", meta_entity_id: videoId, response_payload: vRes });
            } else {
              const iRes = await metaPost(`${META_BASE}/${body.ad_account_id}/adimages`, {
                url: firstAsset.url,
                access_token: token,
              });
              if (iRes.error) throw new Error(`Image upload failed: ${iRes.error.message}`);
              imageHash = iRes.images?.[Object.keys(iRes.images)[0]]?.hash;
              await log({ trafficking_ad_id: ad.id, entity_type: "image", action: "create", status: "success", meta_entity_id: imageHash, response_payload: iRes });
            }
          }
        }

        // 3b. Create ad creative
        const linkData: Record<string, unknown> = {
          link: ad.final_url || "https://example.com",
          message: ad.primary_text || "",
          name: ad.headline || "",
          description: ad.description || "",
          call_to_action: { type: mapCTA(ad.cta), value: { link: ad.final_url || "https://example.com" } },
        };
        if (imageHash) linkData.image_hash = imageHash;

        const creativePayload: Record<string, unknown> = {
          name: `${ad.ad_name} – Creative`,
          object_story_spec: JSON.stringify({
            page_id: body.page_id,
            ...(body.instagram_actor_id ? { instagram_actor_id: body.instagram_actor_id } : {}),
            ...(videoId
              ? { video_data: { video_id: videoId, message: ad.primary_text || "", call_to_action: linkData.call_to_action } }
              : { link_data: linkData }),
          }),
          access_token: token,
        };
        const creativeRes = await metaPost(`${META_BASE}/${body.ad_account_id}/adcreatives`, creativePayload);
        if (creativeRes.error) throw new Error(`Creative failed: ${creativeRes.error.message}`);
        const creativeId = creativeRes.id;
        await log({ trafficking_ad_id: ad.id, entity_type: "creative", action: "create", status: "success", meta_entity_id: creativeId, request_payload: creativePayload, response_payload: creativeRes });

        // 3c. Create the AD itself
        const adPayload = {
          name: ad.ad_name,
          adset_id: metaAdsetId,
          creative: JSON.stringify({ creative_id: creativeId }),
          status: "PAUSED",
          access_token: token,
        };
        const adRes = await metaPost(`${META_BASE}/${body.ad_account_id}/ads`, adPayload);
        if (adRes.error) throw new Error(`Ad failed: ${adRes.error.message}`);
        const metaAdId = adRes.id;
        await log({ trafficking_ad_id: ad.id, entity_type: "ad", action: "create", status: "success", meta_entity_id: metaAdId, request_payload: adPayload, response_payload: adRes });

        // 3d. Save IDs back to trafficking_ads
        await supabase.from("trafficking_ads").update({
          platform_ad_id: metaAdId,
          platform_campaign_id: metaCampaignId,
          platform_adset_id: metaAdsetId,
          meta_creative_id: creativeId,
          meta_image_hash: imageHash,
          meta_video_id: videoId,
          meta_pushed_at: new Date().toISOString(),
          meta_pushed_by_id: teamMemberId,
          meta_push_error: null,
          status: "live", // your trafficking status — "live in Meta as paused"
        }).eq("id", ad.id);

        adResults.push({ ad_id: ad.id, status: "success", meta_ad_id: metaAdId });
      } catch (err: unknown) {
        const msg = err instanceof Error ? err.message : String(err);
        await log({ trafficking_ad_id: ad.id, entity_type: "ad", action: "create", status: "error", error_message: msg });
        await supabase.from("trafficking_ads").update({ meta_push_error: msg }).eq("id", ad.id);
        adResults.push({ ad_id: ad.id, status: "error", error: msg });
      }
    }

    return json({
      success: true,
      meta_campaign_id: metaCampaignId,
      meta_adset_id: metaAdsetId,
      ads: adResults,
      message: `Pushed ${adResults.filter(r => r.status === "success").length}/${adResults.length} ads to Meta as PAUSED. Review in Ads Manager before launching.`,
    });
  } catch (e: unknown) {
    const msg = e instanceof Error ? e.message : String(e);
    return json({ error: msg }, 500);
  }
});

// === Helpers ===
function json(data: unknown, status = 200) {
  return new Response(JSON.stringify(data), {
    status,
    headers: { ...corsHeaders, "Content-Type": "application/json" },
  });
}

async function metaPost(url: string, payload: Record<string, unknown>) {
  const form = new URLSearchParams();
  for (const [k, v] of Object.entries(payload)) {
    form.append(k, typeof v === "string" ? v : JSON.stringify(v));
  }
  const res = await fetch(url, {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: form.toString(),
  });
  return await res.json();
}

function daysBetween(a: string, b: string): number {
  const ms = new Date(b).getTime() - new Date(a).getTime();
  return Math.max(1, Math.ceil(ms / (1000 * 60 * 60 * 24)));
}

function mapCTA(cta: string | null): string {
  const map: Record<string, string> = {
    "Shop Now": "SHOP_NOW",
    "Learn More": "LEARN_MORE",
    "Sign Up": "SIGN_UP",
    "Subscribe": "SUBSCRIBE",
    "Get Offer": "GET_OFFER",
    "Contact Us": "CONTACT_US",
  };
  return cta ? (map[cta] || "LEARN_MORE") : "LEARN_MORE";
}
