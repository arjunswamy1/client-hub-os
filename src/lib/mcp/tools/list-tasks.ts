import { defineTool, ToolError } from "@lovable.dev/mcp-js";
import { z } from "zod";
import { supabaseForUser } from "../supabase";

export default defineTool({
  name: "list_tasks",
  title: "List tasks",
  description: "List tasks the signed-in user can see, optionally filtered by client and status.",
  inputSchema: {
    client_id: z.string().uuid().optional().describe("Only tasks for this client id."),
    status: z.string().optional().describe("Only tasks with this status, e.g. todo, in_progress, done."),
    limit: z.number().int().min(1).max(200).optional().describe("Max rows (default 50)."),
  },
  annotations: { readOnlyHint: true, idempotentHint: true, openWorldHint: false },
  handler: async ({ client_id, status, limit }, ctx) => {
    if (!ctx.isAuthenticated()) throw new ToolError("Not authenticated");
    let q = supabaseForUser(ctx)
      .from("tasks")
      .select("id,client_id,title,status,priority,assignee_id,due_date,completed_at,created_at")
      .order("created_at", { ascending: false })
      .limit(limit ?? 50);
    if (client_id) q = q.eq("client_id", client_id);
    if (status) q = q.eq("status", status);
    const { data, error } = await q;
    if (error) throw new ToolError(error.message);
    const tasks = (data ?? []).map((t) => ({
      id: t.id, client_id: t.client_id ?? null, title: t.title, status: t.status ?? null,
      priority: t.priority ?? null, assignee_id: t.assignee_id ?? null, due_date: t.due_date ?? null,
      completed_at: t.completed_at ?? null, created_at: t.created_at,
    }));
    return { content: [{ type: "text", text: JSON.stringify(tasks) }], structuredContent: { tasks } };
  },
});
