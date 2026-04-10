import { useState, useMemo } from 'react';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { Input } from '@/components/ui/input';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { Textarea } from '@/components/ui/textarea';
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter } from '@/components/ui/dialog';
import { Plus, ChevronLeft, ChevronRight } from 'lucide-react';
import { format, startOfMonth, endOfMonth, addMonths, subMonths, startOfWeek, addWeeks, isBefore } from 'date-fns';
import { useContentCalendar, useContentCalendarMutations } from '@/hooks/useTrafficking';
import { useAuth } from '@/contexts/AuthContext';

const STATUS_OPTIONS = [
  { value: 'planning', label: 'Planning', color: 'bg-muted text-muted-foreground' },
  { value: 'creative_in_progress', label: 'Creative In Progress', color: 'bg-yellow-100 text-yellow-800' },
  { value: 'copy_writing', label: 'Copy Writing', color: 'bg-blue-100 text-blue-800' },
  { value: 'ready_to_launch', label: 'Ready to Launch', color: 'bg-green-100 text-green-800' },
  { value: 'live', label: 'Live', color: 'bg-emerald-600 text-white' },
];

interface Props {
  clientId: string;
}

export function ContentCalendar({ clientId }: Props) {
  const [currentMonth, setCurrentMonth] = useState(new Date());
  const [editEntry, setEditEntry] = useState<any>(null);
  const [isDialogOpen, setIsDialogOpen] = useState(false);
  const { teamMember } = useAuth();
  const { data: entries = [] } = useContentCalendar(clientId);
  const { upsertEntry } = useContentCalendarMutations(clientId);

  const weeks = useMemo(() => {
    const monthStart = startOfMonth(currentMonth);
    const monthEnd = endOfMonth(currentMonth);
    const result: Date[] = [];
    let weekStart = startOfWeek(monthStart, { weekStartsOn: 1 });
    while (isBefore(weekStart, monthEnd) || weekStart <= monthEnd) {
      result.push(weekStart);
      weekStart = addWeeks(weekStart, 1);
      if (result.length > 6) break;
    }
    return result;
  }, [currentMonth]);

  const getEntryForWeek = (weekOf: Date) => {
    const dateStr = format(weekOf, 'yyyy-MM-dd');
    return (entries as any[]).find((e: any) => e.week_of === dateStr);
  };

  const handleNewEntry = (weekOf: Date) => {
    setEditEntry({
      client_id: clientId,
      week_of: format(weekOf, 'yyyy-MM-dd'),
      product_focus: '',
      creative_theme: '',
      ad_formats_planned: [],
      delivery_deadline: null,
      launch_target: null,
      status: 'planning',
      notes: '',
      created_by_id: teamMember?.id || null,
    });
    setIsDialogOpen(true);
  };

  const handleEditEntry = (entry: any) => {
    setEditEntry(entry);
    setIsDialogOpen(true);
  };

  const handleSave = () => {
    upsertEntry.mutate(editEntry, {
      onSuccess: () => setIsDialogOpen(false),
    });
  };

  const statusBadge = (status: string) => {
    const opt = STATUS_OPTIONS.find(s => s.value === status);
    return opt ? <Badge className={`${opt.color} text-[10px]`}>{opt.label}</Badge> : null;
  };

  return (
    <Card>
      <CardHeader className="flex flex-row items-center justify-between pb-3">
        <CardTitle className="text-base">Content Calendar</CardTitle>
        <div className="flex items-center gap-2">
          <Button variant="ghost" size="icon" onClick={() => setCurrentMonth(m => subMonths(m, 1))}>
            <ChevronLeft className="h-4 w-4" />
          </Button>
          <span className="text-sm font-medium min-w-[120px] text-center">
            {format(currentMonth, 'MMMM yyyy')}
          </span>
          <Button variant="ghost" size="icon" onClick={() => setCurrentMonth(m => addMonths(m, 1))}>
            <ChevronRight className="h-4 w-4" />
          </Button>
        </div>
      </CardHeader>
      <CardContent>
        <div className="space-y-2">
          {/* Header */}
          <div className="grid grid-cols-7 gap-2 text-xs font-medium text-muted-foreground border-b pb-2">
            <div>Week Of</div>
            <div>Product Focus</div>
            <div>Creative Theme</div>
            <div>Formats</div>
            <div>Deadline</div>
            <div>Launch</div>
            <div>Status</div>
          </div>

          {weeks.map(weekDate => {
            const entry = getEntryForWeek(weekDate);
            return (
              <div
                key={weekDate.toISOString()}
                className="grid grid-cols-7 gap-2 items-center py-2 px-1 rounded hover:bg-muted/50 cursor-pointer text-sm border-b border-border/30"
                onClick={() => entry ? handleEditEntry(entry) : handleNewEntry(weekDate)}
              >
                <div className="font-medium text-xs">{format(weekDate, 'MMM d')}</div>
                <div className="text-xs truncate">{entry?.product_focus || <span className="text-muted-foreground italic">—</span>}</div>
                <div className="text-xs truncate">{entry?.creative_theme || <span className="text-muted-foreground italic">—</span>}</div>
                <div className="flex flex-wrap gap-0.5">
                  {(entry?.ad_formats_planned || []).slice(0, 2).map((f: string) => (
                    <Badge key={f} variant="outline" className="text-[9px] px-1">{f}</Badge>
                  ))}
                  {(entry?.ad_formats_planned?.length || 0) > 2 && (
                    <Badge variant="outline" className="text-[9px] px-1">+{entry.ad_formats_planned.length - 2}</Badge>
                  )}
                </div>
                <div className="text-xs">{entry?.delivery_deadline ? format(new Date(entry.delivery_deadline), 'MMM d') : '—'}</div>
                <div className="text-xs">{entry?.launch_target ? format(new Date(entry.launch_target), 'MMM d') : '—'}</div>
                <div>{entry ? statusBadge(entry.status) : <Button size="sm" variant="ghost" className="h-6 text-xs"><Plus className="h-3 w-3 mr-1" /> Add</Button>}</div>
              </div>
            );
          })}
        </div>

        {/* Edit/Create Dialog */}
        <Dialog open={isDialogOpen} onOpenChange={setIsDialogOpen}>
          <DialogContent className="max-w-lg">
            <DialogHeader>
              <DialogTitle>{editEntry?.id ? 'Edit' : 'New'} Calendar Entry — Week of {editEntry?.week_of ? format(new Date(editEntry.week_of + 'T00:00'), 'MMM d, yyyy') : ''}</DialogTitle>
            </DialogHeader>
            <div className="space-y-3">
              <div>
                <label className="text-xs font-medium">Product Focus</label>
                <Input value={editEntry?.product_focus || ''} onChange={e => setEditEntry((p: any) => ({ ...p, product_focus: e.target.value }))} placeholder="e.g. Spring Collection, Mother's Day Gifting" />
              </div>
              <div>
                <label className="text-xs font-medium">Creative Theme</label>
                <Input value={editEntry?.creative_theme || ''} onChange={e => setEditEntry((p: any) => ({ ...p, creative_theme: e.target.value }))} placeholder="e.g. Spring Sale, Mother's Day" />
              </div>
              <div>
                <label className="text-xs font-medium">Ad Formats</label>
                <Input
                  value={(editEntry?.ad_formats_planned || []).join(', ')}
                  onChange={e => setEditEntry((p: any) => ({ ...p, ad_formats_planned: e.target.value.split(',').map((s: string) => s.trim()).filter(Boolean) }))}
                  placeholder="Static 4:5, Video 9:16, Carousel"
                />
              </div>
              <div className="grid grid-cols-2 gap-3">
                <div>
                  <label className="text-xs font-medium">Delivery Deadline</label>
                  <Input type="date" value={editEntry?.delivery_deadline || ''} onChange={e => setEditEntry((p: any) => ({ ...p, delivery_deadline: e.target.value || null }))} />
                </div>
                <div>
                  <label className="text-xs font-medium">Launch Target</label>
                  <Input type="date" value={editEntry?.launch_target || ''} onChange={e => setEditEntry((p: any) => ({ ...p, launch_target: e.target.value || null }))} />
                </div>
              </div>
              <div>
                <label className="text-xs font-medium">Status</label>
                <Select value={editEntry?.status || 'planning'} onValueChange={v => setEditEntry((p: any) => ({ ...p, status: v }))}>
                  <SelectTrigger><SelectValue /></SelectTrigger>
                  <SelectContent>
                    {STATUS_OPTIONS.map(s => <SelectItem key={s.value} value={s.value}>{s.label}</SelectItem>)}
                  </SelectContent>
                </Select>
              </div>
              <div>
                <label className="text-xs font-medium">Notes</label>
                <Textarea value={editEntry?.notes || ''} onChange={e => setEditEntry((p: any) => ({ ...p, notes: e.target.value }))} rows={2} />
              </div>
            </div>
            <DialogFooter>
              <Button variant="outline" onClick={() => setIsDialogOpen(false)}>Cancel</Button>
              <Button onClick={handleSave} disabled={upsertEntry.isPending}>Save</Button>
            </DialogFooter>
          </DialogContent>
        </Dialog>
      </CardContent>
    </Card>
  );
}
