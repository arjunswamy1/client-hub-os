import { defineTool, ToolError } from "@lovable.dev/mcp-js";
import { z } from "zod";
import { supabaseForUser } from "../supabase";

export default defineTool({
  name: "list_creative_briefs",
  title: "List creative briefs",
  description: "List creative briefs the signed-in user can see, optionally filtered by client and status.",
  inputSchema: {
    client_id: z.string().uuid().optional().describe("Only briefs for this client id."),
    status: z.string().optional().describe("Only briefs with this status, e.g. submitted, in_design."),
    limit: z.number().int().min(1).max(200).optional().describe("Max rows (default 50)."),
  },
  annotations: { readOnlyHint: true, idempotentHint: true, openWorldHint: false },
  handler: async ({ client_id, status, limit }, ctx) => {
    if (!ctx.isAuthenticated()) throw new ToolError("Not authenticated");
    let q = supabaseForUser(ctx)
      .from("creative_briefs")
      .select("id,client_id,title,status,priority,due_date,assigned_to_id,accepted_at,created_at")
      .is("deleted_at", null)
      .order("created_at", { ascending: false })
      .limit(limit ?? 50);
    if (client_id) q = q.eq("client_id", client_id);
    if (status) q = q.eq("status", status);
    const { data, error } = await q;
    if (error) throw new ToolError(error.message);
    const briefs = (data ?? []).map((b) => ({
      id: b.id, client_id: b.client_id ?? null, title: b.title, status: b.status ?? null,
      priority: b.priority ?? null, due_date: b.due_date ?? null, assigned_to_id: b.assigned_to_id ?? null,
      accepted_at: b.accepted_at ?? null, created_at: b.created_at,
    }));
    return { content: [{ type: "text", text: JSON.stringify(briefs) }], structuredContent: { briefs } };
  },
});
