import { auth, defineMcp } from "@lovable.dev/mcp-js";
import listClients from "./tools/list-clients";
import listTasks from "./tools/list-tasks";
import listCreativeBriefs from "./tools/list-creative-briefs";

const projectRef = import.meta.env.VITE_SUPABASE_PROJECT_ID ?? "project-ref-unset";

export default defineMcp({
  name: "client-hub-os",
  title: "Client Hub OS",
  version: "0.1.0",
  instructions:
    "Read-only tools for the Connect Paid Media hub. Use list_clients to find client ids, then list_tasks or list_creative_briefs to see work for a client. Results respect the signed-in user's access.",
  auth: auth.oauth.issuer({
    issuer: `https://${projectRef}.supabase.co/auth/v1`,
    acceptedAudiences: "authenticated",
  }),
  tools: [listClients, listTasks, listCreativeBriefs],
});
