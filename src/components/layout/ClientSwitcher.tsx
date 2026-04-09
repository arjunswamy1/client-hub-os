import { useState } from 'react';
import { Check, ChevronDown, Circle } from 'lucide-react';
import { Popover, PopoverContent, PopoverTrigger } from '@/components/ui/popover';
import { useClient } from '@/contexts/ClientContext';

export function ClientSwitcher() {
  const { clients, activeClient, setActiveClient } = useClient();
  const [open, setOpen] = useState(false);

  if (clients.length === 0) {
    return (
      <div className="rounded-md border border-sidebar-border bg-sidebar-accent/50 px-3 py-2 text-xs text-sidebar-muted">
        No clients assigned
      </div>
    );
  }

  return (
    <Popover open={open} onOpenChange={setOpen}>
      <PopoverTrigger asChild>
        <button className="flex w-full items-center justify-between rounded-md border border-sidebar-border bg-sidebar-accent/50 px-3 py-2 text-left text-sm transition-colors hover:bg-sidebar-accent">
          <div className="flex items-center gap-2 truncate">
            <Circle
              className="h-2.5 w-2.5 shrink-0 fill-current"
              style={{ color: activeClient?.color || 'hsl(220, 70%, 50%)' }}
            />
            <span className="truncate text-sidebar-accent-foreground">
              {activeClient?.name || 'Select client'}
            </span>
          </div>
          <ChevronDown className="h-3.5 w-3.5 shrink-0 text-sidebar-muted" />
        </button>
      </PopoverTrigger>
      <PopoverContent className="w-56 p-1" align="start" side="bottom">
        {clients.map((client) => (
          <button
            key={client.id}
            className="flex w-full items-center gap-2 rounded-sm px-2.5 py-1.5 text-sm transition-colors hover:bg-accent"
            onClick={() => {
              setActiveClient(client);
              setOpen(false);
            }}
          >
            <Circle
              className="h-2.5 w-2.5 shrink-0 fill-current"
              style={{ color: client.color || 'hsl(220, 70%, 50%)' }}
            />
            <span className="flex-1 truncate">{client.name}</span>
            {activeClient?.id === client.id && (
              <Check className="h-3.5 w-3.5 text-primary" />
            )}
          </button>
        ))}
      </PopoverContent>
    </Popover>
  );
}
