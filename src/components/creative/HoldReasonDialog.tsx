import { useState } from 'react';
import { Dialog, DialogContent, DialogFooter, DialogHeader, DialogTitle, DialogDescription } from '@/components/ui/dialog';
import { Button } from '@/components/ui/button';
import { Textarea } from '@/components/ui/textarea';

/** Asks why a request is going on hold. A reason is required. */
export function HoldReasonDialog({ open, onCancel, onConfirm }: { open: boolean; onCancel: () => void; onConfirm: (reason: string) => void }) {
  const [reason, setReason] = useState('');
  const ok = reason.trim().length > 0;
  return (
    <Dialog open={open} onOpenChange={(o) => { if (!o) { setReason(''); onCancel(); } }}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>Put this request on hold</DialogTitle>
          <DialogDescription>While on hold it is not counted as late and is left out of designers' lists for today. The original due date is kept.</DialogDescription>
        </DialogHeader>
        <Textarea autoFocus placeholder="Why is it on hold?" value={reason} onChange={(e) => setReason(e.target.value)} aria-label="Hold reason" />
        <DialogFooter>
          <Button variant="outline" onClick={() => { setReason(''); onCancel(); }}>Cancel</Button>
          <Button disabled={!ok} onClick={() => { onConfirm(reason.trim()); setReason(''); }}>Put on hold</Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
