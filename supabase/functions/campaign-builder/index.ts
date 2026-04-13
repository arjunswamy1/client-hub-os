import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type, x-supabase-client-platform, x-supabase-client-platform-version, x-supabase-client-runtime, x-supabase-client-runtime-version",
};

const SYSTEM_PROMPT = `You are an expert Google Ads campaign architect working inside the CPM Client Hub. You build production-ready campaign structures for media buyers.

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

RULES:
- Every keyword must be tagged with intent: "high", "medium", or "low"
- Headlines MUST be ≤30 characters. Descriptions MUST be ≤90 characters. VALIDATE THIS.
- Generate at least 15 headlines per RSA (the max Google allows)
- Generate 4 descriptions per RSA
- Include match types: exact, phrase, broad (use exact for high-intent, phrase for medium, broad sparingly)
- Always generate campaign-level negative keywords (jobs, DIY, how-to, educational, free)
- Include optimization notes with every build

When the user approves the structure or asks you to generate/finalize, call the "generate_campaign_structure" tool with the complete structure.

When having a normal conversation (asking questions, discussing strategy), just respond with text.`;

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") {
    return new Response(null, { headers: corsHeaders });
  }

  try {
    const body = await req.json();
    const { messages, build_id, client_context, action, campaign_structure } = body;

    const LOVABLE_API_KEY = Deno.env.get("LOVABLE_API_KEY");
    if (!LOVABLE_API_KEY) throw new Error("LOVABLE_API_KEY not configured");

    const supabaseUrl = Deno.env.get("SUPABASE_URL")!;
    const supabaseKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
    const supabase = createClient(supabaseUrl, supabaseKey);

    // If action is "generate_csvs", generate CSV files from the structure
    if (action === "generate_csvs") {
      return await generateCSVs(supabase, campaign_structure, build_id);
    }

    // Build enhanced system prompt with client context
    let systemPrompt = SYSTEM_PROMPT;
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

    const tools = [
      {
        type: "function",
        function: {
          name: "generate_campaign_structure",
          description: "Generate a complete Google Ads campaign structure ready for CSV export. Call this when the user approves the campaign plan or asks to generate/finalize it.",
          parameters: {
            type: "object",
            properties: {
              campaigns: {
                type: "array",
                items: {
                  type: "object",
                  properties: {
                    name: { type: "string" },
                    campaign_type: { type: "string", enum: ["Search", "Performance Max", "Display", "Video", "Discovery"] },
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
                                path2: { type: "string" }
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

    // Stream the response
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

async function generateCSVs(
  supabase: any,
  structure: any,
  buildId: string,
) {
  if (!structure?.campaigns?.length) {
    return new Response(JSON.stringify({ error: "No campaign structure provided" }), {
      status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  }

  const files: { filename: string; content: string }[] = [];
  const campaigns = structure.campaigns;

  // 1. Campaigns.csv
  let campaignsCsv = "Campaign,Campaign Type,Campaign Daily Budget,Campaign Status,Networks,Location,Language,Bid Strategy Type\n";
  for (const c of campaigns) {
    campaignsCsv += `"${esc(c.name)}","${c.campaign_type}",${c.daily_budget || ''},"${c.status || 'Enabled'}","${c.networks || 'Search'}","${esc(c.location || 'United States')}","${c.language || 'English'}","${esc(c.bid_strategy || 'Maximize Conversions')}"\n`;
  }
  files.push({ filename: "Campaigns.csv", content: campaignsCsv });

  // 2. Ad Groups.csv
  let adGroupsCsv = "Campaign,Ad Group,Ad Group Status,Max CPC\n";
  for (const c of campaigns) {
    for (const ag of c.ad_groups || []) {
      adGroupsCsv += `"${esc(c.name)}","${esc(ag.name)}","Enabled",${ag.max_cpc || ''}\n`;
    }
  }
  files.push({ filename: "Ad Groups.csv", content: adGroupsCsv });

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
  files.push({ filename: "Keywords.csv", content: keywordsCsv });

  // 4. Negative Keywords.csv
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
  files.push({ filename: "Negative Keywords.csv", content: negCsv });

  // 5. RSAs.csv
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
  files.push({ filename: "Responsive Search Ads.csv", content: rsaCsv });

  // 6. Sitelinks.csv
  let sitelinksCsv = "Campaign,Sitelink Text,Sitelink Description Line 1,Sitelink Description Line 2,Sitelink Final URL\n";
  for (const c of campaigns) {
    for (const sl of c.extensions?.sitelinks || []) {
      sitelinksCsv += `"${esc(c.name)}","${esc(sl.text)}","${esc(sl.description1 || '')}","${esc(sl.description2 || '')}","${esc(sl.final_url)}"\n`;
    }
  }
  files.push({ filename: "Sitelinks.csv", content: sitelinksCsv });

  // 7. Callouts.csv
  let calloutsCsv = "Campaign,Callout Text\n";
  for (const c of campaigns) {
    for (const co of c.extensions?.callouts || []) {
      calloutsCsv += `"${esc(c.name)}","${esc(co)}"\n`;
    }
  }
  files.push({ filename: "Callout Extensions.csv", content: calloutsCsv });

  // 8. Structured Snippets.csv
  let snippetsCsv = "Campaign,Structured Snippet Header,Structured Snippet Values\n";
  for (const c of campaigns) {
    for (const ss of c.extensions?.structured_snippets || []) {
      snippetsCsv += `"${esc(c.name)}","${esc(ss.header)}","${esc(ss.values)}"\n`;
    }
  }
  files.push({ filename: "Structured Snippets.csv", content: snippetsCsv });

  // Upload to storage
  const uploadedFiles = [];
  const timestamp = new Date().toISOString().replace(/[:.]/g, '-');
  const folder = `${buildId || 'manual'}/${timestamp}`;

  for (const file of files) {
    const path = `${folder}/${file.filename}`;
    const { error } = await supabase.storage
      .from('campaign-build-files')
      .upload(path, new Blob([file.content], { type: 'text/csv' }), { contentType: 'text/csv', upsert: true });

    if (error) {
      console.error(`Upload error for ${file.filename}:`, error);
      continue;
    }

    const { data: urlData } = supabase.storage.from('campaign-build-files').getPublicUrl(path);
    uploadedFiles.push({
      filename: file.filename,
      storage_url: urlData.publicUrl,
      file_type: 'csv',
    });
  }

  // Update the build record
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

  return new Response(JSON.stringify({ success: true, files: uploadedFiles }), {
    headers: { ...corsHeaders, "Content-Type": "application/json" },
  });
}

function esc(s: string): string {
  return (s || '').replace(/"/g, '""');
}

function formatKeyword(keyword: string, matchType: string): string {
  const mt = (matchType || 'broad').toLowerCase();
  if (mt === 'exact') return `[${keyword}]`;
  if (mt === 'phrase') return `"${keyword}"`;
  return keyword;
}
