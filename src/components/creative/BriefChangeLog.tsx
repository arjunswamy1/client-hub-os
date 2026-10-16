import { useQuery } from '@tanstack/react-query';
import { format } from 'date-fns';
import { Bot, User, Cog } from 'lucide-react';
import { supabase } from '@/integrations/supabase/client';
import { actorLabel, fieldLabel, formatChangeValue, sortChangesNewestFirst, type BriefChange } from '@/lib/briefChangeLog';

export function BriefChangeLog({ briefId }: { briefId: string }) {
  const { data, isLoading } = useQuery({
    queryKey: ['brief_change_log', briefId],
    queryFn: async () => {
      const [{ data: rows, error }, { data: members }] = await Promise.all([
        supabase.from('creative_brief_change_log')
          .select('id, field, old_value, new_value, actor_kind, via, created_at, changed_by:team_members!creative_brief_change_log_changed_by_id_fkey(name)')
          .eq('brief_id', briefId).order('created_at', { ascending: false }).limit(500),
        supabase.from('team_members').select('id, name'),
      ]);
      if (error) throw error;
      return { rows: sortChangesNewestFirst((rows ?? []) as unknown as BriefChange[]), names: new Map((members ?? []).map((m) => [m.id, m.name])) };
    },
  });
  if (isLoading) return <p className="text-sm text-muted-foreground">Loading history…</p>;
  const rows = data?.rows ?? [];
  if (rows.length === 0) return <p className="text-sm text-muted-foreground">No changes recorded yet.</p>;
  const name = (id: string) => data?.names.get(id) ?? undefined;
  return (
    <ol className="space-y-3">
      {rows.map((c) => {
        const Icon = c.actor_kind === 'bot' ? Bot : c.actor_kind === 'system' ? Cog : User;
        const isComment = c.field.startsWith('comment_');
        return (
          <li key={c.id} className="flex gap-2 text-sm">
            <Icon className="h-4 w-4 mt-0.5 shrink-0 text-muted-foreground" />
            <div className="min-w-0">
              <div className="flex flex-wrap items-center gap-x-2 text-xs">
                <span className="font-medium">{actorLabel(c)}</span>
                <span className="text-muted-foreground">{format(new Date(c.created_at), 'MMM d, yyyy HH:mm')}</span>
              </div>
              <p className="break-words">
                <span className="font-medium">{fieldLabel(c.field)}</span>
                {isComment
                  ? <>: <span className="text-muted-foreground">{formatChangeValue(c.field, c.new_value ?? c.old_value, name)}</span></>
                  : <>: <span className="text-muted-foreground line-through">{formatChangeValue(c.field, c.old_value, name)}</span> → {formatChangeValue(c.field, c.new_value, name)}</>}
              </p>
            </div>
          </li>
        );
      })}
    </ol>
  );
}
