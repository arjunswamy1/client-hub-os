import { useEffect, useRef, useState, KeyboardEvent } from 'react';
import { Textarea } from '@/components/ui/textarea';

export interface MentionMember {
  id: string;
  name: string;
}

interface Props {
  value: string;
  onChange: (value: string) => void;
  onMentionsChange?: (memberIds: string[]) => void;
  members: MentionMember[];
  placeholder?: string;
  rows?: number;
  className?: string;
}

/**
 * Textarea with @mention autocomplete.
 * - Type "@" to open a popup of team members.
 * - Selecting one inserts "@Name" into the text and tracks the member id.
 * - onMentionsChange fires with the list of unique member ids currently mentioned.
 */
export function MentionTextarea({
  value, onChange, onMentionsChange, members, placeholder, rows = 3, className,
}: Props) {
  const ref = useRef<HTMLTextAreaElement>(null);
  const [open, setOpen] = useState(false);
  const [query, setQuery] = useState('');
  const [activeIdx, setActiveIdx] = useState(0);
  const [anchorPos, setAnchorPos] = useState<{ top: number; left: number } | null>(null);

  // Recompute mentions whenever value changes
  useEffect(() => {
    if (!onMentionsChange) return;
    const ids: string[] = [];
    members.forEach(m => {
      // Match "@Name" tokens (case-insensitive, allow multi-word names)
      const escaped = m.name.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
      const re = new RegExp(`@${escaped}\\b`, 'i');
      if (re.test(value) && !ids.includes(m.id)) ids.push(m.id);
    });
    onMentionsChange(ids);
  }, [value, members, onMentionsChange]);

  const filtered = members
    .filter(m => m.name.toLowerCase().includes(query.toLowerCase()))
    .slice(0, 6);

  const handleChange = (e: React.ChangeEvent<HTMLTextAreaElement>) => {
    const v = e.target.value;
    onChange(v);

    const caret = e.target.selectionStart ?? v.length;
    const before = v.slice(0, caret);
    const m = before.match(/@([\w\s]*)$/);
    if (m) {
      setQuery(m[1]);
      setActiveIdx(0);
      setOpen(true);
      // Position popover at the textarea bottom-left of caret area
      const rect = e.target.getBoundingClientRect();
      setAnchorPos({
        top: rect.bottom + 4,
        left: rect.left + 8,
      });
    } else {
      setOpen(false);
    }
  };

  const insertMention = (member: MentionMember) => {
    const el = ref.current;
    if (!el) return;
    const caret = el.selectionStart ?? value.length;
    const before = value.slice(0, caret);
    const after = value.slice(caret);
    const replaced = before.replace(/@([\w\s]*)$/, `@${member.name} `);
    const next = replaced + after;
    onChange(next);
    setOpen(false);
    requestAnimationFrame(() => {
      el.focus();
      const pos = replaced.length;
      el.setSelectionRange(pos, pos);
    });
  };

  const onKeyDown = (e: KeyboardEvent<HTMLTextAreaElement>) => {
    if (!open || filtered.length === 0) return;
    if (e.key === 'ArrowDown') {
      e.preventDefault();
      setActiveIdx(i => Math.min(i + 1, filtered.length - 1));
    } else if (e.key === 'ArrowUp') {
      e.preventDefault();
      setActiveIdx(i => Math.max(i - 1, 0));
    } else if (e.key === 'Enter' || e.key === 'Tab') {
      e.preventDefault();
      insertMention(filtered[activeIdx]);
    } else if (e.key === 'Escape') {
      setOpen(false);
    }
  };

  return (
    <div className="relative w-full">
      <Textarea
        ref={ref}
        value={value}
        onChange={handleChange}
        onKeyDown={onKeyDown}
        placeholder={placeholder}
        rows={rows}
        className={className}
      />
      {open && filtered.length > 0 && anchorPos && (
        <div
          className="fixed z-[100] w-56 rounded-md border bg-popover text-popover-foreground shadow-md p-1"
          style={{ top: anchorPos.top, left: anchorPos.left }}
        >
          <div className="px-2 py-1 text-[10px] uppercase tracking-wide text-muted-foreground">Mention a teammate</div>
          {filtered.map((m, i) => (
            <button
              key={m.id}
              type="button"
              onMouseDown={(e) => { e.preventDefault(); insertMention(m); }}
              className={`flex w-full items-center gap-2 rounded-sm px-2 py-1.5 text-sm text-left ${i === activeIdx ? 'bg-accent text-accent-foreground' : 'hover:bg-accent/50'}`}
            >
              <span className="inline-flex h-5 w-5 items-center justify-center rounded-full bg-primary/10 text-[10px] text-primary">
                {m.name.split(' ').map(n => n[0]).join('').slice(0, 2).toUpperCase()}
              </span>
              <span className="truncate">{m.name}</span>
            </button>
          ))}
        </div>
      )}
    </div>
  );
}
