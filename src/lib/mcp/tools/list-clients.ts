import { defineTool, ToolError } from "@lovable.dev/mcp-js";
import { supabaseForUser } from "../supabase";

export default defineTool({
  name: "list_clients",
  title: "List clients",
  description: "List the client accounts the signed-in user can access.",
  inputSchema: {},
  annotations: { readOnlyHint: true, idempotentHint: true, openWorldHint: false },
  handler: async (_args, ctx) => {
    if (!ctx.isAuthenticated()) throw new ToolError("Not authenticated");
    const { data, error } = await supabaseForUser(ctx)
      .from("clients")
      .select("id,name,slug,status,engagement_type,reporting_timezone")
      .order("name");
    if (error) throw new ToolError(error.message);
    const clients = (data ?? []).map((c) => ({
      id: c.id, name: c.name, slug: c.slug, status: c.status ?? null,
      engagement_type: c.engagement_type ?? null, reporting_timezone: c.reporting_timezone ?? null,
    }));
    return { content: [{ type: "text", text: JSON.stringify(clients) }], structuredContent: { clients } };
  },
});
