import { useState, useMemo } from "react";
import { Plus, Search, Phone, History, Pencil, Trash2 } from "lucide-react";
import { useClient } from "@/contexts/ClientContext";
import { useAuth } from "@/contexts/AuthContext";
import {
  useClientDids, useDeleteDid, useDidHistory,
  ClientDID, PLATFORM_LABELS,
} from "@/hooks/useClientDids";
import { Tabs, TabsList, TabsTrigger, TabsContent } from "@/components/ui/tabs";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Badge } from "@/components/ui/badge";
import {
  Dialog, DialogContent, DialogHeader, DialogTitle,
} from "@/components/ui/dialog";
import {
  AlertDialog, AlertDialogAction, AlertDialogCancel, AlertDialogContent,
  AlertDialogDescription, AlertDialogFooter, AlertDialogHeader, AlertDialogTitle,
} from "@/components/ui/alert-dialog";
import { DIDDialog } from "@/components/dids/DIDDialog";
import { DIDMatrix } from "@/components/dids/DIDMatrix";
import { formatDistanceToNow } from "date-fns";

const statusBadge: Record<string, string> = {
  active: "bg-emerald-100 text-emerald-900 dark:bg-emerald-950/40 dark:text-emerald-200",
  paused: "bg-amber-100 text-amber-900 dark:bg-amber-950/40 dark:text-amber-200",
  not_in_use: "bg-muted text-muted-foreground",
};

export default function ClientDIDsPage() {
  const { activeClient } = useClient();
  const { isAdmin } = useAuth();
  const { data: dids = [], isLoading } = useClientDids(activeClient?.id);
  const deleteDid = useDeleteDid(activeClient?.id);

  const [editing, setEditing] = useState<ClientDID | null>(null);
  const [creating, setCreating] = useState(false);
  const [historyDid, setHistoryDid] = useState<ClientDID | null>(null);
  const [confirmDelete, setConfirmDelete] = useState<ClientDID | null>(null);
  const [search, setSearch] = useState("");

  const filtered = useMemo(() => {
    const q = search.trim().toLowerCase();
    if (!q) return dids;
    return dids.filter((d) =>
      [d.did, d.did_formatted, d.creative_name, d.audience_cluster, d.campaign_name, d.platform]
        .filter(Boolean)
        .some((v) => v!.toLowerCase().includes(q))
    );
  }, [dids, search]);

  if (!activeClient) {
    return (
      <div className="flex h-full items-center justify-center text-muted-foreground">
        Select a client to manage DIDs.
      </div>
    );
  }

  const counts = {
    total: dids.length,
    active: dids.filter((d) => d.status === "active").length,
    paused: dids.filter((d) => d.status === "paused").length,
    not_in_use: dids.filter((d) => d.status === "not_in_use").length,
  };

  return (
    <div className="space-y-4">
      <div className="flex flex-col gap-2 sm:flex-row sm:items-end sm:justify-between">
        <div>
          <h1 className="text-2xl font-semibold tracking-tight flex items-center gap-2">
            <Phone className="h-5 w-5" /> DID Registry
          </h1>
          <p className="text-sm text-muted-foreground">
            {activeClient.name} · {counts.total} DIDs · {counts.active} active · {counts.paused} paused · {counts.not_in_use} unused
          </p>
        </div>
        <Button onClick={() => setCreating(true)} className="gap-1.5">
          <Plus className="h-4 w-4" /> Add DID
        </Button>
      </div>

      <Tabs defaultValue="registry" className="space-y-4">
        <TabsList>
          <TabsTrigger value="registry">Registry</TabsTrigger>
          <TabsTrigger value="matrix">Assignment Matrix</TabsTrigger>
        </TabsList>

        <TabsContent value="registry" className="space-y-3">
          <div className="relative max-w-sm">
            <Search className="pointer-events-none absolute left-2.5 top-2.5 h-4 w-4 text-muted-foreground" />
            <Input
              placeholder="Search DID, creative, cluster…"
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              className="pl-8"
            />
          </div>

          <div className="overflow-x-auto rounded-lg border bg-card">
            <table className="w-full text-sm">
              <thead className="bg-muted/40">
                <tr className="text-left">
                  <th className="px-3 py-2 font-medium">DID</th>
                  <th className="px-3 py-2 font-medium">Platform</th>
                  <th className="px-3 py-2 font-medium">Creative</th>
                  <th className="px-3 py-2 font-medium">Cluster</th>
                  <th className="px-3 py-2 font-medium">Campaign</th>
                  <th className="px-3 py-2 font-medium">Length</th>
                  <th className="px-3 py-2 font-medium">Status</th>
                  <th className="px-3 py-2 font-medium text-right">Actions</th>
                </tr>
              </thead>
              <tbody>
                {isLoading ? (
                  <tr><td colSpan={8} className="px-3 py-8 text-center text-muted-foreground">Loading…</td></tr>
                ) : filtered.length === 0 ? (
                  <tr><td colSpan={8} className="px-3 py-8 text-center text-muted-foreground">No DIDs match.</td></tr>
                ) : (
                  filtered.map((d) => (
                    <tr key={d.id} className="border-t hover:bg-muted/30">
                      <td className="px-3 py-2 font-mono">{d.did_formatted || d.did}</td>
                      <td className="px-3 py-2">{d.platform ? PLATFORM_LABELS[d.platform] : <span className="text-muted-foreground">—</span>}</td>
                      <td className="px-3 py-2">{d.creative_name || <span className="text-muted-foreground">—</span>}</td>
                      <td className="px-3 py-2">{d.audience_cluster || <span className="text-muted-foreground">—</span>}</td>
                      <td className="px-3 py-2 text-muted-foreground">{d.campaign_name || "—"}</td>
                      <td className="px-3 py-2">{d.ad_length || "—"}</td>
                      <td className="px-3 py-2">
                        <Badge variant="outline" className={statusBadge[d.status]}>
                          {d.status === "not_in_use" ? "Not in use" : d.status}
                        </Badge>
                      </td>
                      <td className="px-3 py-2 text-right">
                        <div className="flex justify-end gap-1">
                          <Button size="icon" variant="ghost" className="h-7 w-7" onClick={() => setHistoryDid(d)} title="History">
                            <History className="h-3.5 w-3.5" />
                          </Button>
                          <Button size="icon" variant="ghost" className="h-7 w-7" onClick={() => setEditing(d)} title="Edit">
                            <Pencil className="h-3.5 w-3.5" />
                          </Button>
                          {isAdmin && (
                            <Button size="icon" variant="ghost" className="h-7 w-7 text-destructive" onClick={() => setConfirmDelete(d)} title="Delete">
                              <Trash2 className="h-3.5 w-3.5" />
                            </Button>
                          )}
                        </div>
                      </td>
                    </tr>
                  ))
                )}
              </tbody>
            </table>
          </div>
        </TabsContent>

        <TabsContent value="matrix">
          <DIDMatrix dids={dids} onCellClick={(d) => setEditing(d)} />
          <p className="mt-2 text-xs text-muted-foreground">
            Click any cell to edit. <span className="inline-block h-2 w-2 rounded-full bg-emerald-500 mx-1" />Active
            <span className="inline-block h-2 w-2 rounded-full bg-amber-500 mx-1 ml-2" />Paused
            <span className="inline-block h-2 w-2 rounded-full bg-muted-foreground mx-1 ml-2" />Not in use
          </p>
        </TabsContent>
      </Tabs>

      {/* Add / Edit */}
      <DIDDialog
        open={creating || !!editing}
        onOpenChange={(o) => { if (!o) { setCreating(false); setEditing(null); } }}
        clientId={activeClient.id}
        did={editing}
      />

      {/* History */}
      <Dialog open={!!historyDid} onOpenChange={(o) => !o && setHistoryDid(null)}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>History — {historyDid?.did_formatted || historyDid?.did}</DialogTitle>
          </DialogHeader>
          {historyDid && <HistoryList didId={historyDid.id} />}
        </DialogContent>
      </Dialog>

      {/* Delete */}
      <AlertDialog open={!!confirmDelete} onOpenChange={(o) => !o && setConfirmDelete(null)}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Delete DID?</AlertDialogTitle>
            <AlertDialogDescription>
              {confirmDelete?.did_formatted || confirmDelete?.did} will be removed from the registry. Call history referencing this DID is not affected.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Cancel</AlertDialogCancel>
            <AlertDialogAction
              className="bg-destructive text-destructive-foreground hover:bg-destructive/90"
              onClick={async () => {
                if (confirmDelete) await deleteDid.mutateAsync(confirmDelete.id);
                setConfirmDelete(null);
              }}
            >Delete</AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </div>
  );
}

function HistoryList({ didId }: { didId: string }) {
  const { data: history = [], isLoading } = useDidHistory(didId);
  if (isLoading) return <p className="text-sm text-muted-foreground">Loading…</p>;
  if (history.length === 0) {
    return <p className="text-sm text-muted-foreground">No assignment changes yet.</p>;
  }
  return (
    <div className="space-y-2 text-sm">
      {history.map((h) => (
        <div key={h.id} className="rounded-md border p-2">
          <div className="text-xs text-muted-foreground">
            {formatDistanceToNow(new Date(h.changed_at), { addSuffix: true })}
          </div>
          <div className="mt-1 grid grid-cols-2 gap-x-3 gap-y-0.5 text-xs">
            <div><span className="text-muted-foreground">Platform:</span> {h.platform || "—"}</div>
            <div><span className="text-muted-foreground">Status:</span> {h.status || "—"}</div>
            <div><span className="text-muted-foreground">Creative:</span> {h.creative_name || "—"}</div>
            <div><span className="text-muted-foreground">Cluster:</span> {h.audience_cluster || "—"}</div>
            <div className="col-span-2"><span className="text-muted-foreground">Campaign:</span> {h.campaign_name || "—"}</div>
          </div>
        </div>
      ))}
    </div>
  );
}
