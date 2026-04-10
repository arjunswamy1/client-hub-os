import { useState } from 'react';
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter } from '@/components/ui/dialog';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { CheckCircle2, Image as ImageIcon } from 'lucide-react';
import { useQuery } from '@tanstack/react-query';
import { supabase } from '@/integrations/supabase/client';
import { useTraffickingAdMutations } from '@/hooks/useTrafficking';

interface Props {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  ad: any;
  clientId: string;
}

export function AttachCreativeModal({ open, onOpenChange, ad, clientId }: Props) {
  const { updateAd } = useTraffickingAdMutations(clientId);
  const [selectedIds, setSelectedIds] = useState<string[]>(ad.deliverable_ids || []);

  // Fetch approved deliverables for this client
  const { data: deliverables = [] } = useQuery({
    queryKey: ['approved_deliverables', clientId],
    queryFn: async () => {
      const { data, error } = await supabase
        .from('creative_deliverables')
        .select(`
          *,
          brief:creative_briefs!creative_deliverables_brief_id_fkey(title, client_id)
        `)
        .eq('status', 'approved')
        .order('uploaded_at', { ascending: false });
      if (error) throw error;
      // Filter to this client
      return (data || []).filter((d: any) => d.brief?.client_id === clientId);
    },
    enabled: open,
  });

  const toggleSelect = (id: string) => {
    setSelectedIds(prev => prev.includes(id) ? prev.filter(x => x !== id) : [...prev, id]);
  };

  const handleSave = () => {
    const assets = (deliverables as any[])
      .filter((d: any) => selectedIds.includes(d.id))
      .map((d: any) => ({
        url: d.file_url,
        thumbnail: d.thumbnail_url || d.file_url,
        type: d.file_type,
        drive_url: d.drive_url,
      }));

    updateAd.mutate({
      id: ad.id,
      deliverable_ids: selectedIds,
      asset_urls: assets,
    }, {
      onSuccess: () => onOpenChange(false),
    });
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-2xl max-h-[70vh] overflow-y-auto">
        <DialogHeader>
          <DialogTitle>Attach Creative Assets</DialogTitle>
          <p className="text-xs text-muted-foreground">Select approved deliverables from the Creative Briefing system.</p>
        </DialogHeader>

        {(deliverables as any[]).length === 0 ? (
          <p className="text-sm text-muted-foreground text-center py-8">No approved deliverables found for this client.</p>
        ) : (
          <div className="grid grid-cols-3 gap-3">
            {(deliverables as any[]).map((d: any) => {
              const isSelected = selectedIds.includes(d.id);
              return (
                <div
                  key={d.id}
                  className={`border rounded-lg p-2 cursor-pointer transition-all ${isSelected ? 'border-primary bg-primary/5 ring-1 ring-primary' : 'hover:border-foreground/30'}`}
                  onClick={() => toggleSelect(d.id)}
                >
                  <div className="aspect-square bg-muted rounded flex items-center justify-center mb-2 relative overflow-hidden">
                    {d.thumbnail_url || d.file_url ? (
                      <img src={d.thumbnail_url || d.file_url} alt={d.file_name} className="w-full h-full object-cover" />
                    ) : (
                      <ImageIcon className="h-8 w-8 text-muted-foreground" />
                    )}
                    {isSelected && (
                      <div className="absolute top-1 right-1">
                        <CheckCircle2 className="h-5 w-5 text-primary fill-primary/20" />
                      </div>
                    )}
                  </div>
                  <p className="text-xs font-medium truncate">{d.file_name}</p>
                  <p className="text-[10px] text-muted-foreground truncate">{d.brief?.title || 'Unknown brief'}</p>
                  {d.concept_label && <Badge variant="outline" className="text-[9px] mt-1">{d.concept_label}</Badge>}
                  {d.size_label && <Badge variant="outline" className="text-[9px] mt-1 ml-1">{d.size_label}</Badge>}
                </div>
              );
            })}
          </div>
        )}

        <DialogFooter>
          <p className="text-xs text-muted-foreground flex-1">{selectedIds.length} selected</p>
          <Button variant="outline" onClick={() => onOpenChange(false)}>Cancel</Button>
          <Button onClick={handleSave}>Attach Selected</Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
