import { createClient } from "https://esm.sh/@supabase/supabase-js@2";
import * as XLSX from "https://esm.sh/xlsx@0.18.5";
import US_ZIP_GEOTARGETS from "../_shared/us-zip-geotargets.json" with { type: "json" };

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type, x-supabase-client-platform, x-supabase-client-platform-version, x-supabase-client-runtime, x-supabase-client-runtime-version",
};

const SUPABASE_URL = Deno.env.get("SUPABASE_URL")!;
const SUPABASE_SERVICE_ROLE_KEY = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
const LOVABLE_API_KEY = Deno.env.get("LOVABLE_API_KEY")!;
const supabase = createClient(SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY);

// ───────────────────────────────────────────────────────────
// Platform-aware system prompts
// ───────────────────────────────────────────────────────────
const GOOGLE_PROMPT = `You are an expert Google Ads campaign architect working inside the CPM Client Hub. You build production-ready campaign structures for media buyers.

YOUR CAPABILITIES:
- Build complete Google Ads campaign structures (Search, PMax, Display, YouTube, Remarketing)
- Generate keyword lists with intent classification (High/Medium/Low)
- Write RSA ad copy (headlines ≤30 chars, descriptions ≤90 chars)
- Create negative keyword lists, extensions (sitelinks, callouts, structured snippets)
- Analyze landing pages for copy alignment
- Provide optimization guidance with industry benchmarks

CONVERSATION FLOW:
1. Greet with client context. Ask about: vertical, goal, audience, landing page, budget, schedule
2. If a landing page URL is provided, analyze it (you'll receive parsed content)
3. Ask 3-5 targeted follow-up questions to fill gaps
4. Generate the full campaign structure as a JSON tool call

GOOGLE ADS CHARACTER LIMITS (STRICTLY ENFORCED — COUNT EVERY CHARACTER):
- RSA Headlines: MAX 30 characters each. No exceptions.
- RSA Descriptions: MAX 90 characters each. No exceptions.
- Display Path 1 / Path 2: MAX 15 characters
- Sitelink text: MAX 25 characters; Description lines: MAX 35 characters
- Callout text: MAX 25 characters
- Structured Snippet values: MAX 25 characters per value
- Campaign name: MAX 128 characters; Ad Group name: MAX 255 characters

RULES:
- Every keyword must be tagged with intent: "high", "medium", or "low"
- VALIDATE ALL CHARACTER LIMITS ABOVE before outputting. Count characters carefully.
- Generate 15 headlines per RSA (the max Google allows) and 4 descriptions
- Include match types: Exact (high-intent), Phrase (medium), Broad (sparingly)
- Always generate campaign-level negative keywords (jobs, DIY, how-to, educational, free)
- Include optimization notes with every build

When the user approves the structure or asks you to generate/finalize, call the "generate_campaign_structure" tool.`;

const BING_PROMPT = `You are an expert Microsoft Advertising (Bing Ads) campaign architect working inside the CPM Client Hub. You build production-ready campaign structures for media buyers who upload via Bing Ads Editor (Microsoft Advertising Editor).

YOUR CAPABILITIES:
- Build Microsoft Advertising Search campaigns with RSAs ready for Bing Ads Editor bulk import
- Generate keyword lists with intent classification (High/Medium/Low)
- Write RSA ad copy that matches Microsoft Ads' Responsive Search Ad format
- Create negative keyword lists and ad extensions (sitelinks, callouts, structured snippets)
- Analyze landing pages and tailor copy for Bing's audience (older, higher-income, desktop-heavy vs. Google)
- Provide Bing-specific optimization guidance (Bing's lower CPCs, LinkedIn targeting overlays, Audience Network)

CONVERSATION FLOW:
1. Greet with client context. Ask about: vertical, goal, audience, landing page, budget, schedule
2. If a landing page URL is provided, analyze it (you'll receive parsed content)
3. Ask 3-5 targeted follow-up questions (including any Bing-specific asks like LinkedIn targeting, MSN Audience Network inclusion)
4. Generate the full campaign structure as a JSON tool call

MICROSOFT ADVERTISING CHARACTER LIMITS (STRICTLY ENFORCED — COUNT EVERY CHARACTER):
- RSA Headlines: MAX 30 characters each (15 headlines total)
- RSA Descriptions: MAX 90 characters each (4 descriptions total)
- Path 1 / Path 2: MAX 15 characters each
- Sitelink text: MAX 25 characters; Description 1 / Description 2: MAX 35 characters each
- Callout text: MAX 25 characters
- Structured Snippet values: MAX 25 characters per value
- Campaign name: MAX 128 characters; Ad Group name: MAX 255 characters
- Business Name (optional on RSAs in Bing): MAX 25 characters

BING-SPECIFIC RULES:
- Match types: Exact, Phrase, Broad — Bing supports same 3 as Google (Broad Match Modifier was retired)
- Include "Bing Ads Audience Network" strategy notes — this is opt-in and often gets low-intent traffic, recommend whether to include/exclude
- Prefer Enhanced CPC or Maximize Conversions bid strategies for most verticals
- Note: Bing imports from Google Ads are common but often require cleanup — build Bing-native where possible
- Every keyword must be tagged with intent: "high", "medium", or "low"
- Always generate campaign-level negatives (jobs, DIY, how-to, educational, free)
- Include Bing-specific optimization notes (device bid adjustments — desktop performs better on Bing, audience insights, LinkedIn overlays for B2B)

When the user approves the structure or asks you to generate/finalize, call the "generate_campaign_structure" tool.`;

const BOTH_PROMPT = `You are an expert paid-search campaign architect building campaigns for BOTH Google Ads AND Microsoft Advertising (Bing) simultaneously inside the CPM Client Hub. The same structure will be exported to both Google Ads Editor CSVs and Bing Ads Editor bulk CSV.

CRITICAL: Character limits are identical across Google and Microsoft Ads for RSAs (30/90), paths (15), sitelinks (25/35), callouts (25), snippets (25). Your structure works on both platforms unchanged.

YOUR CAPABILITIES:
- Build Search campaigns that import cleanly into both Google Ads Editor and Bing Ads Editor
- Generate keyword lists with intent classification (High/Medium/Low)
- Write RSA ad copy (15 headlines ≤30 chars, 4 descriptions ≤90 chars)
- Create negative keyword lists and extensions (sitelinks, callouts, structured snippets)
- Analyze landing pages and tailor copy
- Provide optimization guidance for BOTH platforms (Google's competitiveness, Bing's lower CPCs + older demographic)

CHARACTER LIMITS (SAME FOR BOTH PLATFORMS — STRICTLY ENFORCED):
- Headlines: MAX 30 characters (15 per ad)
- Descriptions: MAX 90 characters (4 per ad)
- Path 1 / Path 2: MAX 15 characters
- Sitelink text: MAX 25 characters; Description lines: MAX 35 characters
- Callout: MAX 25 characters; Snippet value: MAX 25 characters

CROSS-PLATFORM RULES:
- Build Search campaigns only (PMax/Display are Google-only; build those as Google-only if requested)
- Match types: Exact, Phrase, Broad (both platforms support)
- Include both Google-specific AND Bing-specific optimization notes in optimization_notes
- Include campaign-level negatives (jobs, DIY, how-to, educational, free)
- Every keyword tagged with intent: "high", "medium", "low"

When the user approves, call "generate_campaign_structure" once — both platform CSVs will be generated from the same structure.`;

function getSystemPrompt(platform: string): string {
  if (platform === 'bing') return BING_PROMPT;
  if (platform === 'both') return BOTH_PROMPT;
  return GOOGLE_PROMPT;
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") {
    return new Response(null, { headers: corsHeaders });
  }

  try {
    const body = await req.json();
    const {
      messages, build_id, client_context, action, campaign_structure,
      client_name, zipcodes, campaign_names,
      platform = 'google', // 'google' | 'bing' | 'both'
    } = body;

    if (action === "generate_csvs") {
      return await generateCSVs(supabase, campaign_structure, build_id, client_name, platform);
    }

    if (action === "generate_locations") {
      return await generateLocationsCsv(supabase, LOVABLE_API_KEY, zipcodes, campaign_names, build_id, client_name, platform);
    }

    // Build enhanced system prompt with client context
    let systemPrompt = getSystemPrompt(platform);
    if (client_context) {
      systemPrompt += `\n\nCLIENT CONTEXT:\n- Client Name: ${client_context.client_name || 'Unknown'}`;
      if (client_context.verticals?.length) {
        systemPrompt += `\n- Existing Verticals: ${client_context.verticals.join(', ')}`;
      }
      if (client_context.existing_campaigns?.length) {
        systemPrompt += `\n- Existing Campaigns (last 30 days): ${JSON.stringify(client_context.existing_campaigns.slice(0, 10))}`;
      }
      if (client_context.landing_page_content) {
        systemPrompt += `\n\nLANDING PAGE ANALYSIS:\n${client_context.landing_page_content}`;
      }
    }
    systemPrompt += `\n\nTARGET PLATFORM: ${platform.toUpperCase()}${platform === 'both' ? ' (Google + Bing)' : ''}`;

    const campaignTypeEnum = platform === 'bing'
      ? ["Search", "Shopping", "Audience", "Dynamic Search"]
      : platform === 'both'
        ? ["Search"]
        : ["Search", "Performance Max", "Display", "Video", "Discovery"];

    const tools = [
      {
        type: "function",
        function: {
          name: "generate_campaign_structure",
          description: `Generate a complete ${platform === 'bing' ? 'Microsoft Advertising (Bing)' : platform === 'both' ? 'cross-platform (Google + Bing)' : 'Google Ads'} campaign structure ready for CSV export.`,
          parameters: {
            type: "object",
            properties: {
              campaigns: {
                type: "array",
                items: {
                  type: "object",
                  properties: {
                    name: { type: "string" },
                    campaign_type: { type: "string", enum: campaignTypeEnum },
                    daily_budget: { type: "number" },
                    bid_strategy: { type: "string" },
                    location: { type: "string" },
                    language: { type: "string" },
                    schedule: { type: "string" },
                    networks: { type: "string" },
                    status: { type: "string", enum: ["Enabled", "Paused"] },
                    ad_groups: {
                      type: "array",
                      items: {
                        type: "object",
                        properties: {
                          name: { type: "string" },
                          theme: { type: "string" },
                          max_cpc: { type: "number" },
                          keywords: {
                            type: "array",
                            items: {
                              type: "object",
                              properties: {
                                keyword: { type: "string" },
                                match_type: { type: "string", enum: ["Exact", "Phrase", "Broad"] },
                                intent: { type: "string", enum: ["high", "medium", "low"] }
                              },
                              required: ["keyword", "match_type", "intent"]
                            }
                          },
                          negative_keywords: {
                            type: "array",
                            items: {
                              type: "object",
                              properties: {
                                keyword: { type: "string" },
                                match_type: { type: "string", enum: ["Exact", "Phrase", "Broad"] }
                              },
                              required: ["keyword"]
                            }
                          },
                          ads: {
                            type: "array",
                            items: {
                              type: "object",
                              properties: {
                                ad_name: { type: "string" },
                                headlines: { type: "array", items: { type: "string" }, minItems: 3, maxItems: 15 },
                                descriptions: { type: "array", items: { type: "string" }, minItems: 2, maxItems: 4 },
                                final_url: { type: "string" },
                                path1: { type: "string" },
                                path2: { type: "string" },
                                business_name: { type: "string", description: "Optional — Microsoft Advertising RSA business name, max 25 chars" }
                              },
                              required: ["headlines", "descriptions", "final_url"]
                            }
                          }
                        },
                        required: ["name", "keywords", "ads"]
                      }
                    },
                    campaign_negatives: {
                      type: "array",
                      items: {
                        type: "object",
                        properties: {
                          keyword: { type: "string" },
                          match_type: { type: "string", enum: ["Exact", "Phrase", "Broad"] }
                        },
                        required: ["keyword"]
                      }
                    },
                    extensions: {
                      type: "object",
                      properties: {
                        sitelinks: {
                          type: "array",
                          items: {
                            type: "object",
                            properties: {
                              text: { type: "string" },
                              description1: { type: "string" },
                              description2: { type: "string" },
                              final_url: { type: "string" }
                            },
                            required: ["text", "final_url"]
                          }
                        },
                        callouts: { type: "array", items: { type: "string" } },
                        structured_snippets: {
                          type: "array",
                          items: {
                            type: "object",
                            properties: {
                              header: { type: "string" },
                              values: { type: "string" }
                            },
                            required: ["header", "values"]
                          }
                        }
                      }
                    }
                  },
                  required: ["name", "campaign_type", "daily_budget", "ad_groups"]
                }
              },
              optimization_notes: { type: "string" }
            },
            required: ["campaigns"]
          }
        }
      }
    ];

    const response = await fetch("https://ai.gateway.lovable.dev/v1/chat/completions", {
      method: "POST",
      headers: {
        Authorization: `Bearer ${LOVABLE_API_KEY}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        model: "google/gemini-2.5-pro",
        messages: [
          { role: "system", content: systemPrompt },
          ...messages,
        ],
        tools,
        stream: true,
        temperature: 0.3,
      }),
    });

    if (!response.ok) {
      const errText = await response.text();
      console.error("AI gateway error:", response.status, errText);
      if (response.status === 429) {
        return new Response(JSON.stringify({ error: "Rate limited. Please try again in a moment." }), {
          status: 429, headers: { ...corsHeaders, "Content-Type": "application/json" },
        });
      }
      if (response.status === 402) {
        return new Response(JSON.stringify({ error: "AI credits exhausted. Please add funds." }), {
          status: 402, headers: { ...corsHeaders, "Content-Type": "application/json" },
        });
      }
      return new Response(JSON.stringify({ error: "AI gateway error" }), {
        status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    return new Response(response.body, {
      headers: { ...corsHeaders, "Content-Type": "text/event-stream" },
    });
  } catch (e) {
    console.error("campaign-builder error:", e);
    return new Response(JSON.stringify({ error: e instanceof Error ? e.message : "Unknown error" }), {
      status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  }
});

// ───────────────────────────────────────────────────────────
// CSV generation
// ───────────────────────────────────────────────────────────
async function generateCSVs(
  supabase: any,
  structure: any,
  buildId: string,
  clientName?: string,
  platform: string = 'google',
) {
  if (!structure?.campaigns?.length) {
    return new Response(JSON.stringify({ error: "No campaign structure provided" }), {
      status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  }

  const { structure: validatedStructure, warnings } = enforceCharLimits(structure);
  if (warnings.length) console.warn("Character limit warnings:", warnings);
  const campaigns = validatedStructure.campaigns;

  const files: { filename: string; content: string }[] = [];

  // ── Google Ads Editor CSVs ──
  if (platform === 'google' || platform === 'both') {
    files.push(...buildGoogleCsvs(campaigns));
  }

  // ── Microsoft Advertising (Bing Ads Editor) bulk CSV ──
  if (platform === 'bing' || platform === 'both') {
    files.push(buildBingBulkCsv(campaigns));
    files.push(...buildBingIndividualCsvs(campaigns));
  }

  // Master Excel workbook
  const wb = XLSX.utils.book_new();
  for (const file of files) {
    const rows = parseCsv(file.content);
    const ws = XLSX.utils.aoa_to_sheet(rows);
    const sheetName = file.filename.replace('.csv', '').slice(0, 31);
    XLSX.utils.book_append_sheet(wb, ws, sheetName);
  }
  const xlsxBuffer = XLSX.write(wb, { bookType: 'xlsx', type: 'array' });

  // File naming
  const sanitize = (s: string) => (s || '').replace(/[^a-zA-Z0-9._-]/g, '_').replace(/_+/g, '_').replace(/^_|_$/g, '');
  const now = new Date();
  const dateStr = `${now.getMonth() + 1}${now.getDate()}${String(now.getFullYear()).slice(-2)}`;
  const firstCampaignName = campaigns[0]?.name || 'Campaign';
  const campaignLabel = sanitize(firstCampaignName.split(' - ')[0] || firstCampaignName);
  const clientSlug = sanitize(clientName || 'Client');
  const platformLabel = platform === 'bing' ? 'Bing' : platform === 'both' ? 'GoogleBing' : 'Google';
  const prefix = `${clientSlug}_${platformLabel}_${campaignLabel}_${dateStr}`;

  const uploadedFiles: any[] = [];
  const timestamp = now.toISOString().replace(/[:.]/g, '-');
  const folder = `${buildId || 'manual'}/${timestamp}`;

  // Upload master Excel
  const xlsxFilename = `${prefix}_Master.xlsx`;
  const xlsxPath = `${folder}/${xlsxFilename}`;
  const { error: xlsxErr } = await supabase.storage
    .from('campaign-build-files')
    .upload(xlsxPath, new Blob([xlsxBuffer], { type: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet' }), {
      contentType: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
      upsert: true,
    });
  if (!xlsxErr) {
    const { data: xlsxUrl } = supabase.storage.from('campaign-build-files').getPublicUrl(xlsxPath);
    uploadedFiles.push({ filename: xlsxFilename, storage_url: xlsxUrl.publicUrl, file_type: 'xlsx', platform });
  } else {
    console.error('Excel upload error:', xlsxErr);
  }

  // Upload individual CSVs
  for (const file of files) {
    const csvLabel = sanitize(file.filename.replace('.csv', ''));
    const csvFilename = `${prefix}_${csvLabel}.csv`;
    const path = `${folder}/${csvFilename}`;
    const { error } = await supabase.storage
      .from('campaign-build-files')
      .upload(path, new Blob([file.content], { type: 'text/csv' }), { contentType: 'text/csv', upsert: true });
    if (error) { console.error(`Upload error for ${csvFilename}:`, error); continue; }
    const { data: urlData } = supabase.storage.from('campaign-build-files').getPublicUrl(path);
    // Tag Bing bulk file specifically
    const platformTag = file.filename.startsWith('Bing_') ? 'bing' : file.filename.startsWith('Google_') ? 'google' : platform;
    uploadedFiles.push({
      filename: csvFilename,
      storage_url: urlData.publicUrl,
      file_type: 'csv',
      platform: platformTag,
    });
  }

  if (buildId) {
    await supabase.from('campaign_builds')
      .update({
        generated_files: uploadedFiles,
        campaign_structure: structure,
        optimization_notes: structure.optimization_notes || '',
        status: 'generated',
        updated_at: new Date().toISOString(),
      })
      .eq('id', buildId);
  }

  return new Response(JSON.stringify({ success: true, files: uploadedFiles, warnings }), {
    headers: { ...corsHeaders, "Content-Type": "application/json" },
  });
}

// ───────────────────────────────────────────────────────────
// Google Ads Editor CSV builders
// ───────────────────────────────────────────────────────────
function buildGoogleCsvs(campaigns: any[]): { filename: string; content: string }[] {
  const files: { filename: string; content: string }[] = [];

  // 1. Campaigns.csv
  let campaignsCsv = "Campaign,Campaign Type,Campaign Daily Budget,Campaign Status,Networks,Location,Language,Bid Strategy Type\n";
  for (const c of campaigns) {
    campaignsCsv += `"${esc(c.name)}","${c.campaign_type || 'Search'}",${c.daily_budget || ''},"${c.status || 'Enabled'}","${c.networks || 'Search'}","${esc(c.location || 'United States')}","${c.language || 'English'}","${esc(c.bid_strategy || 'Maximize Conversions')}"\n`;
  }
  files.push({ filename: "Google_Campaigns.csv", content: campaignsCsv });

  // 2. Ad Groups.csv
  let adGroupsCsv = "Campaign,Ad Group,Ad Group Status,Max CPC\n";
  for (const c of campaigns) {
    for (const ag of c.ad_groups || []) {
      adGroupsCsv += `"${esc(c.name)}","${esc(ag.name)}","Enabled",${ag.max_cpc || ''}\n`;
    }
  }
  files.push({ filename: "Google_Ad_Groups.csv", content: adGroupsCsv });

  // 3. Keywords.csv
  let keywordsCsv = "Campaign,Ad Group,Keyword,Criterion Type,Status,Final URL\n";
  for (const c of campaigns) {
    for (const ag of c.ad_groups || []) {
      for (const kw of ag.keywords || []) {
        const formatted = formatKeyword(kw.keyword, kw.match_type);
        keywordsCsv += `"${esc(c.name)}","${esc(ag.name)}","${esc(formatted)}","${kw.match_type || 'Broad'}","Enabled","${esc(ag.ads?.[0]?.final_url || '')}"\n`;
      }
    }
  }
  files.push({ filename: "Google_Keywords.csv", content: keywordsCsv });

  // 4. Negative Keywords
  let negCsv = "Campaign,Ad Group,Keyword,Criterion Type\n";
  for (const c of campaigns) {
    for (const nk of c.campaign_negatives || []) {
      negCsv += `"${esc(c.name)}","","${esc(formatKeyword(nk.keyword, nk.match_type))}","${nk.match_type || 'Phrase'}"\n`;
    }
    for (const ag of c.ad_groups || []) {
      for (const nk of ag.negative_keywords || []) {
        negCsv += `"${esc(c.name)}","${esc(ag.name)}","${esc(formatKeyword(nk.keyword, nk.match_type))}","${nk.match_type || 'Phrase'}"\n`;
      }
    }
  }
  files.push({ filename: "Google_Negative_Keywords.csv", content: negCsv });

  // 5. RSAs
  const headlineCols = Array.from({ length: 15 }, (_, i) => `Headline ${i + 1}`).join(",");
  const descCols = Array.from({ length: 4 }, (_, i) => `Description ${i + 1}`).join(",");
  let rsaCsv = `Campaign,Ad Group,${headlineCols},${descCols},Final URL,Path 1,Path 2,Status,Ad Name\n`;
  for (const c of campaigns) {
    for (const ag of c.ad_groups || []) {
      for (const ad of ag.ads || []) {
        const hls = Array.from({ length: 15 }, (_, i) => `"${esc(ad.headlines?.[i] || '')}"`).join(",");
        const dsc = Array.from({ length: 4 }, (_, i) => `"${esc(ad.descriptions?.[i] || '')}"`).join(",");
        rsaCsv += `"${esc(c.name)}","${esc(ag.name)}",${hls},${dsc},"${esc(ad.final_url || '')}","${esc(ad.path1 || '')}","${esc(ad.path2 || '')}","Enabled","${esc(ad.ad_name || '')}"\n`;
      }
    }
  }
  files.push({ filename: "Google_Responsive_Search_Ads.csv", content: rsaCsv });

  // 6. Sitelinks
  let sitelinksCsv = "Campaign,Sitelink text,Description line 1,Description line 2,Final URL\n";
  for (const c of campaigns) {
    const sitelinks = c.extensions?.sitelinks || [];
    sitelinks.forEach((sl: any, idx: number) => {
      const baseUrl = (sl.final_url || '').replace(/#\d+$/, '');
      const sluggedUrl = `${baseUrl}#${idx + 1}`;
      sitelinksCsv += `"${esc(c.name)}","${esc(sl.text)}","${esc(sl.description1 || '')}","${esc(sl.description2 || '')}","${esc(sluggedUrl)}"\n`;
    });
  }
  files.push({ filename: "Google_Sitelinks.csv", content: sitelinksCsv });

  // 7. Callouts
  let calloutsCsv = "Campaign,Callout Text\n";
  for (const c of campaigns) {
    for (const co of c.extensions?.callouts || []) {
      calloutsCsv += `"${esc(c.name)}","${esc(co)}"\n`;
    }
  }
  files.push({ filename: "Google_Callout_Extensions.csv", content: calloutsCsv });

  // 8. Structured Snippets
  let snippetsCsv = "Campaign,Structured Snippet Header,Structured Snippet Values\n";
  for (const c of campaigns) {
    for (const ss of c.extensions?.structured_snippets || []) {
      snippetsCsv += `"${esc(c.name)}","${esc(ss.header)}","${esc(ss.values)}"\n`;
    }
  }
  files.push({ filename: "Google_Structured_Snippets.csv", content: snippetsCsv });

  return files;
}

// ───────────────────────────────────────────────────────────
// Microsoft Advertising (Bing Ads Editor) bulk CSV
// Format: single CSV with a "Type" column — native Bing Ads Editor bulk import
// Ref: Microsoft Advertising bulk upload schema
// ───────────────────────────────────────────────────────────
function buildBingBulkCsv(campaigns: any[]): { filename: string; content: string } {
  // Columns used across multiple record types — superset
  const headers = [
    "Type", "Status", "Parent Id", "Campaign", "Ad Group",
    "Budget", "Budget Type", "Bid Strategy Type",
    "Language", "Location", "Network",
    "Keyword", "Match Type",
    "Ad Title 1", "Ad Title 2", "Ad Title 3", "Ad Title 4", "Ad Title 5",
    "Ad Title 6", "Ad Title 7", "Ad Title 8", "Ad Title 9", "Ad Title 10",
    "Ad Title 11", "Ad Title 12", "Ad Title 13", "Ad Title 14", "Ad Title 15",
    "Text", "Text 2", "Text 3", "Text 4",
    "Path 1", "Path 2", "Final Url", "Business Name",
    "Sitelink Extension Link Text", "Sitelink Extension Description 1", "Sitelink Extension Description 2", "Sitelink Extension Final Url",
    "Callout Text",
    "Structured Snippet Header", "Structured Snippet Values",
    "Ad Name",
  ];
  const lines: string[] = [headers.join(",")];

  const row = (fields: Record<string, any>) => {
    return headers.map(h => `"${esc(fields[h] != null ? String(fields[h]) : '')}"`).join(",");
  };

  for (const c of campaigns) {
    // Campaign record
    lines.push(row({
      Type: "Campaign",
      Status: c.status || "Paused",
      Campaign: c.name,
      Budget: c.daily_budget || '',
      "Budget Type": "DailyBudgetStandard",
      "Bid Strategy Type": mapBidStrategyBing(c.bid_strategy),
      Language: c.language || "English",
      Location: c.location || "United States",
      Network: "OwnedAndOperatedAndSyndicatedSearch",
    }));

    for (const ag of c.ad_groups || []) {
      // Ad Group record
      lines.push(row({
        Type: "Ad Group",
        Status: "Paused",
        Campaign: c.name,
        "Ad Group": ag.name,
        Language: c.language || "English",
      }));

      // Keywords
      for (const kw of ag.keywords || []) {
        lines.push(row({
          Type: "Keyword",
          Status: "Active",
          Campaign: c.name,
          "Ad Group": ag.name,
          Keyword: kw.keyword,
          "Match Type": kw.match_type || "Broad",
        }));
      }

      // Ad group negatives
      for (const nk of ag.negative_keywords || []) {
        lines.push(row({
          Type: "Ad Group Negative Keyword",
          Status: "Active",
          Campaign: c.name,
          "Ad Group": ag.name,
          Keyword: nk.keyword,
          "Match Type": nk.match_type || "Phrase",
        }));
      }

      // Responsive Search Ads
      for (const ad of ag.ads || []) {
        const titles: Record<string, string> = {};
        for (let i = 0; i < 15; i++) {
          titles[`Ad Title ${i + 1}`] = ad.headlines?.[i] || '';
        }
        lines.push(row({
          Type: "Responsive Search Ad",
          Status: "Paused",
          Campaign: c.name,
          "Ad Group": ag.name,
          ...titles,
          Text: ad.descriptions?.[0] || '',
          "Text 2": ad.descriptions?.[1] || '',
          "Text 3": ad.descriptions?.[2] || '',
          "Text 4": ad.descriptions?.[3] || '',
          "Path 1": ad.path1 || '',
          "Path 2": ad.path2 || '',
          "Final Url": ad.final_url || '',
          "Business Name": ad.business_name || '',
          "Ad Name": ad.ad_name || '',
        }));
      }
    }

    // Campaign-level negatives
    for (const nk of c.campaign_negatives || []) {
      lines.push(row({
        Type: "Campaign Negative Keyword",
        Status: "Active",
        Campaign: c.name,
        Keyword: nk.keyword,
        "Match Type": nk.match_type || "Phrase",
      }));
    }

    // Sitelinks
    for (const sl of c.extensions?.sitelinks || []) {
      lines.push(row({
        Type: "Sitelink Ad Extension",
        Status: "Active",
        Campaign: c.name,
        "Sitelink Extension Link Text": sl.text,
        "Sitelink Extension Description 1": sl.description1 || '',
        "Sitelink Extension Description 2": sl.description2 || '',
        "Sitelink Extension Final Url": sl.final_url || '',
      }));
    }

    // Callouts
    for (const co of c.extensions?.callouts || []) {
      lines.push(row({
        Type: "Callout Ad Extension",
        Status: "Active",
        Campaign: c.name,
        "Callout Text": co,
      }));
    }

    // Structured snippets
    for (const ss of c.extensions?.structured_snippets || []) {
      lines.push(row({
        Type: "Structured Snippet Extension",
        Status: "Active",
        Campaign: c.name,
        "Structured Snippet Header": ss.header,
        "Structured Snippet Values": ss.values,
      }));
    }
  }

  return { filename: "Bing_Ads_Editor_Bulk.csv", content: lines.join("\n") + "\n" };
}

// Also export individual Bing-labeled CSVs for audit/reference (same shape as Google CSVs but tagged Bing_)
function buildBingIndividualCsvs(campaigns: any[]): { filename: string; content: string }[] {
  const google = buildGoogleCsvs(campaigns);
  return google.map(f => ({
    filename: f.filename.replace(/^Google_/, 'Bing_Audit_'),
    content: f.content,
  }));
}

function mapBidStrategyBing(strategy?: string): string {
  if (!strategy) return "EnhancedCpc";
  const s = strategy.toLowerCase();
  if (s.includes("max") && s.includes("conv")) return "MaxConversions";
  if (s.includes("target") && s.includes("cpa")) return "TargetCpa";
  if (s.includes("target") && s.includes("roas")) return "TargetRoas";
  if (s.includes("manual")) return "ManualCpc";
  return "EnhancedCpc";
}

// ───────────────────────────────────────────────────────────
// Locations CSV (platform-aware)
// ───────────────────────────────────────────────────────────
async function generateLocationsCsv(
  supabase: any,
  _apiKey: string,
  zipcodes: string[],
  campaignNames: string[],
  buildId: string,
  clientName?: string,
  platform: string = 'google',
) {
  if (!zipcodes?.length || !campaignNames?.length) {
    return new Response(JSON.stringify({ error: "Zip codes and campaign names are required" }), {
      status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  }

  // Normalize + dedupe + validate (5-digit US zip). NO AI CALL — works at any scale.
  const cleanZips = Array.from(new Set(
    (zipcodes || [])
      .map(z => String(z || '').trim())
      .filter(z => /^\d{5}$/.test(z))
  ));

  if (cleanZips.length === 0) {
    return new Response(JSON.stringify({ error: "No valid 5-digit US zip codes provided" }), {
      status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  }

  console.log(`[generate_locations] zips=${cleanZips.length} campaigns=${campaignNames.length} platform=${platform}`);

  try {
    const uploadedFiles: any[] = [];
    const sanitize = (s: string) => (s || '').replace(/[^a-zA-Z0-9._-]/g, '_').replace(/_+/g, '_').replace(/^_|_$/g, '');
    const now = new Date();
    const dateStr = `${now.getMonth() + 1}${now.getDate()}${String(now.getFullYear()).slice(-2)}`;
    const clientSlug = sanitize(clientName || 'Client');
    const timestamp = now.toISOString().replace(/[:.]/g, '-');
    const folder = `${buildId || 'manual'}/${timestamp}`;

    // Build CSV via array.join → far faster than string concatenation for 100K+ rows
    const buildCsv = (header: string, rowFn: (campaign: string, zip: string) => string): string => {
      const rows: string[] = [header];
      for (const cName of campaignNames) {
        for (const zip of cleanZips) {
          rows.push(rowFn(cName, zip));
        }
      }
      return rows.join('\n') + '\n';
    };

    // Google Ads Editor: include Location ID (Criteria ID) so zips upload as targeted
    // postal codes without manual lookup. Unknown zips fall back to blank ID +
    // raw zip in the Location column (Editor will resolve most automatically).
    if (platform === 'google' || platform === 'both') {
      const zipMap = US_ZIP_GEOTARGETS as Record<string, number>;
      let matched = 0;
      const csv = buildCsv(
        "Campaign,Location,Location ID,Reach,Location type,Bid adj.",
        (cName, zip) => {
          const id = zipMap[zip];
          if (id) matched++;
          const locationName = id ? `${zip}, United States` : zip;
          return `"${esc(cName)}","${esc(locationName)}","${id ?? ''}","","Postal code",""`;
        },
      );
      console.log(`[generate_locations] google matched=${matched}/${cleanZips.length} criteria IDs`);
      const fname = `${clientSlug}_Google_Locations_${dateStr}.csv`;
      const path = `${folder}/${fname}`;
      const { error } = await supabase.storage
        .from('campaign-build-files')
        .upload(path, new Blob([csv], { type: 'text/csv' }), { contentType: 'text/csv', upsert: true });
      if (error) {
        console.error('[generate_locations] Google upload error:', error);
      } else {
        const { data } = supabase.storage.from('campaign-build-files').getPublicUrl(path);
        uploadedFiles.push({ filename: fname, storage_url: data.publicUrl, file_type: 'csv', platform: 'google' });
      }
    }

    // Microsoft Advertising (Bing Ads) Bulk file format — full schema so Henry can
    // import directly via Microsoft Advertising Editor → Import → Bulk file.
    // Reference: https://learn.microsoft.com/advertising/bulk-service/campaign-location-criterion
    if (platform === 'bing' || platform === 'both') {
      const BING_HEADER = [
        'Type', 'Status', 'Id', 'Parent Id', 'Campaign', 'Client Id', 'Modified Time',
        'Sub Type', 'Target', 'Physical Intent', 'Bid Adjustment', 'Name',
      ].join(',');
      const csv = buildCsv(
        BING_HEADER,
        (cName, zip) =>
          // Type, Status, Id, ParentId, Campaign, ClientId, ModifiedTime,
          // SubType, Target (zip), PhysicalIntent, BidAdjustment, Name
          `"Campaign Location Criterion","Active","","","${esc(cName)}","","","PostalCode","${zip}","PeopleInOrSearchingForOrViewingPages","0",""`,
      );
      const fname = `${clientSlug}_Bing_Locations_${dateStr}.csv`;
      const path = `${folder}/${fname}`;
      const { error } = await supabase.storage
        .from('campaign-build-files')
        .upload(path, new Blob([csv], { type: 'text/csv' }), { contentType: 'text/csv', upsert: true });
      if (error) {
        console.error('[generate_locations] Bing upload error:', error);
      } else {
        const { data } = supabase.storage.from('campaign-build-files').getPublicUrl(path);
        uploadedFiles.push({ filename: fname, storage_url: data.publicUrl, file_type: 'csv', platform: 'bing' });
      }
    }

    if (uploadedFiles.length === 0) {
      throw new Error('Storage upload failed — no files generated');
    }

    return new Response(JSON.stringify({
      success: true,
      files: uploadedFiles,
      locations_count: cleanZips.length,
      campaigns_count: campaignNames.length,
    }), { headers: { ...corsHeaders, "Content-Type": "application/json" } });
  } catch (e) {
    console.error("generateLocationsCsv error:", e);
    return new Response(JSON.stringify({ error: e instanceof Error ? e.message : "Unknown error" }), {
      status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  }
}

// ───────────────────────────────────────────────────────────
// Helpers
// ───────────────────────────────────────────────────────────
function esc(s: string): string {
  return (s || '').replace(/"/g, '""');
}

function parseCsv(content: string): string[][] {
  return content.split('\n').filter(r => r.trim()).map(row => {
    const cells: string[] = [];
    let current = '';
    let inQuotes = false;
    for (let i = 0; i < row.length; i++) {
      const ch = row[i];
      if (ch === '"') {
        if (inQuotes && row[i + 1] === '"') { current += '"'; i++; }
        else { inQuotes = !inQuotes; }
      } else if (ch === ',' && !inQuotes) {
        cells.push(current); current = '';
      } else { current += ch; }
    }
    cells.push(current);
    return cells;
  });
}

// Character limits — identical for Google Ads & Microsoft Advertising RSAs
const CHAR_LIMITS = {
  headline: 30,
  description: 90,
  path: 15,
  sitelinkText: 25,
  sitelinkDesc: 35,
  callout: 25,
  snippetValue: 25,
  campaignName: 128,
  adGroupName: 255,
  businessName: 25, // Bing RSA business name
};

function truncate(s: string, max: number): string {
  if (!s) return '';
  return s.length > max ? s.slice(0, max) : s;
}

function enforceCharLimits(structure: any): { structure: any; warnings: string[] } {
  const warnings: string[] = [];
  for (const c of structure.campaigns || []) {
    if (c.name?.length > CHAR_LIMITS.campaignName) {
      warnings.push(`Campaign "${c.name}" truncated`);
      c.name = truncate(c.name, CHAR_LIMITS.campaignName);
    }
    for (const ag of c.ad_groups || []) {
      if (ag.name?.length > CHAR_LIMITS.adGroupName) ag.name = truncate(ag.name, CHAR_LIMITS.adGroupName);
      for (const ad of ag.ads || []) {
        ad.headlines = (ad.headlines || []).map((h: string) => {
          if (h.length > CHAR_LIMITS.headline) { warnings.push(`Headline "${h}" (${h.length}c) truncated`); return truncate(h, CHAR_LIMITS.headline); }
          return h;
        });
        ad.descriptions = (ad.descriptions || []).map((d: string) => {
          if (d.length > CHAR_LIMITS.description) { warnings.push(`Description (${d.length}c) truncated`); return truncate(d, CHAR_LIMITS.description); }
          return d;
        });
        ad.path1 = truncate(ad.path1 || '', CHAR_LIMITS.path);
        ad.path2 = truncate(ad.path2 || '', CHAR_LIMITS.path);
        if (ad.business_name) ad.business_name = truncate(ad.business_name, CHAR_LIMITS.businessName);
      }
    }
    for (const sl of c.extensions?.sitelinks || []) {
      sl.text = truncate(sl.text || '', CHAR_LIMITS.sitelinkText);
      sl.description1 = truncate(sl.description1 || '', CHAR_LIMITS.sitelinkDesc);
      sl.description2 = truncate(sl.description2 || '', CHAR_LIMITS.sitelinkDesc);
    }
    (c.extensions?.callouts || []).forEach((co: string, i: number) => {
      if (co.length > CHAR_LIMITS.callout) c.extensions.callouts[i] = truncate(co, CHAR_LIMITS.callout);
    });
    for (const ss of c.extensions?.structured_snippets || []) {
      ss.values = (ss.values || '').split(',').map((v: string) => truncate(v.trim(), CHAR_LIMITS.snippetValue)).join(', ');
    }
  }
  return { structure, warnings };
}

function formatKeyword(keyword: string, matchType: string): string {
  const mt = (matchType || 'broad').toLowerCase();
  if (mt === 'exact') return `[${keyword}]`;
  if (mt === 'phrase') return `"${keyword}"`;
  return keyword;
}
