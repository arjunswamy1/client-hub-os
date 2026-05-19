import { useEffect, useState } from "react";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter } from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Button } from "@/components/ui/button";
import { Textarea } from "@/components/ui/textarea";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { ClientDID, useUpsertDid, PLATFORM_LABELS } from "@/hooks/useClientDids";

interface Props {
  open: boolean;
  onOpenChange: (o: boolean) => void;
  clientId: string;
  did: ClientDID | null; // null = new
}

export function DIDDialog({ open, onOpenChange, clientId, did }: Props) {
  const isEdit = !!did;
  const upsert = useUpsertDid(clientId);
  const [form, setForm] = useState({
    did: "",
    platform: "",
    creative_name: "",
    audience_cluster: "",
    campaign_name: "",
    ad_length: "30s",
    targeting_notes: "",
    status: "active",
    notes: "",
  });

  useEffect(() => {
    if (open) {
      setForm({
        did: did?.did ?? "",
        platform: did?.platform ?? "",
        creative_name: did?.creative_name ?? "",
        audience_cluster: did?.audience_cluster ?? "",
        campaign_name: did?.campaign_name ?? "",
        ad_length: did?.ad_length ?? "30s",
        targeting_notes: did?.targeting_notes ?? "",
        status: did?.status ?? "active",
        notes: did?.notes ?? "",
      });
    }
  }, [open, did]);

  const handleSave = async () => {
    if (!form.did.trim()) return;
    await upsert.mutateAsync({
      id: did?.id,
      did: form.did.trim(),
      platform: (form.platform || null) as any,
      creative_name: form.creative_name || null,
      audience_cluster: form.audience_cluster || null,
      campaign_name: form.campaign_name || null,
      ad_length: form.ad_length || null,
      targeting_notes: form.targeting_notes || null,
      status: form.status as any,
      notes: form.notes || null,
    });
    onOpenChange(false);
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-lg">
        <DialogHeader>
          <DialogTitle>{isEdit ? "Edit DID" : "Add DID"}</DialogTitle>
        </DialogHeader>
        <div className="grid grid-cols-2 gap-3">
          <div className="col-span-2">
            <Label>Phone Number</Label>
            <Input
              placeholder="1-800-475-8818"
              value={form.did}
              disabled={isEdit}
              onChange={(e) => setForm({ ...form, did: e.target.value })}
            />
            <p className="mt-1 text-[11px] text-muted-foreground">
              Stored as E.164 (+18004758818). Phone number can't be changed once saved.
            </p>
          </div>

          <div>
            <Label>Platform</Label>
            <Select value={form.platform} onValueChange={(v) => setForm({ ...form, platform: v })}>
              <SelectTrigger><SelectValue placeholder="Select platform" /></SelectTrigger>
              <SelectContent>
                {Object.entries(PLATFORM_LABELS).map(([v, l]) => (
                  <SelectItem key={v} value={v}>{l}</SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>

          <div>
            <Label>Status</Label>
            <Select value={form.status} onValueChange={(v) => setForm({ ...form, status: v })}>
              <SelectTrigger><SelectValue /></SelectTrigger>
              <SelectContent>
                <SelectItem value="active">Active</SelectItem>
                <SelectItem value="paused">Paused</SelectItem>
                <SelectItem value="not_in_use">Not in use</SelectItem>
              </SelectContent>
            </Select>
          </div>

          <div className="col-span-2">
            <Label>Creative Name</Label>
            <Input
              placeholder="Malena Video 2"
              value={form.creative_name}
              onChange={(e) => setForm({ ...form, creative_name: e.target.value })}
            />
          </div>

          <div>
            <Label>Audience Cluster</Label>
            <Input
              placeholder="Broad 55+"
              value={form.audience_cluster}
              onChange={(e) => setForm({ ...form, audience_cluster: e.target.value })}
            />
          </div>

          <div>
            <Label>Ad Length</Label>
            <Select value={form.ad_length} onValueChange={(v) => setForm({ ...form, ad_length: v })}>
              <SelectTrigger><SelectValue /></SelectTrigger>
              <SelectContent>
                <SelectItem value="15s">15s</SelectItem>
                <SelectItem value="30s">30s</SelectItem>
                <SelectItem value="60s">60s</SelectItem>
              </SelectContent>
            </Select>
          </div>

          <div className="col-span-2">
            <Label>Campaign Name</Label>
            <Input
              placeholder="Universal 1 - Broad"
              value={form.campaign_name}
              onChange={(e) => setForm({ ...form, campaign_name: e.target.value })}
            />
          </div>

          <div className="col-span-2">
            <Label>Targeting Notes</Label>
            <Textarea
              rows={2}
              placeholder="Age Filter + Economic Filter + Best Genre Filters"
              value={form.targeting_notes}
              onChange={(e) => setForm({ ...form, targeting_notes: e.target.value })}
            />
          </div>

          <div className="col-span-2">
            <Label>Notes</Label>
            <Textarea
              rows={2}
              value={form.notes}
              onChange={(e) => setForm({ ...form, notes: e.target.value })}
            />
          </div>
        </div>
        <DialogFooter>
          <Button variant="outline" onClick={() => onOpenChange(false)}>Cancel</Button>
          <Button onClick={handleSave} disabled={upsert.isPending || !form.did.trim()}>
            {upsert.isPending ? "Saving…" : "Save"}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
