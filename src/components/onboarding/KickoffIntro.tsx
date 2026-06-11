import { useState, useEffect } from 'react';
import { CheckCircle2, Circle, PlayCircle } from 'lucide-react';

function linkify(text: string): React.ReactNode[] {
  const urlRegex = /(https?:\/\/[^\s]+)/g;
  const parts = text.split(urlRegex);
  const matches = text.match(urlRegex) || [];
  const result: React.ReactNode[] = [];
  parts.forEach((part, i) => {
    result.push(part);
    if (matches[i]) {
      result.push(
        <a
          key={i}
          href={matches[i]}
          target="_blank"
          rel="noopener noreferrer"
          className="text-[#3CAB7A] underline hover:text-[#2D8F63] break-all"
          onClick={(e) => e.stopPropagation()}
        >
          {matches[i]}
        </a>
      );
    }
  });
  return result;
}

interface ActionItem {
  id: string;
  label: string;
  owner?: string;
  status?: string;
}

interface KickoffIntroProps {
  clientName: string;
  videoUrl?: string | null;
  intro?: string | null;
  actionItems?: ActionItem[];
  /** Optional CTA appended at end of "what we need from you" — usually "Create your account". */
  ctaItem?: { label: string; targetId: string; done?: boolean };
}

// Convert a YouTube watch/shorts/youtu.be URL into an embed URL
function toYouTubeEmbed(url: string): string | null {
  try {
    const u = new URL(url);
    if (u.hostname.includes('youtu.be')) {
      const id = u.pathname.replace(/^\//, '');
      return id ? `https://www.youtube.com/embed/${id}` : null;
    }
    if (u.hostname.includes('youtube.com')) {
      if (u.pathname.startsWith('/embed/')) return url;
      const v = u.searchParams.get('v');
      if (v) return `https://www.youtube.com/embed/${v}`;
      if (u.pathname.startsWith('/shorts/')) {
        return `https://www.youtube.com/embed/${u.pathname.split('/')[2]}`;
      }
    }
    return null;
  } catch {
    return null;
  }
}

export function KickoffIntro({ clientName, videoUrl, intro, actionItems, ctaItem }: KickoffIntroProps) {
  const items = actionItems || [];
  const [checked, setChecked] = useState<Record<string, boolean>>({});

  // Persist locally per-client so it survives page refreshes during onboarding
  const storageKey = `cpm.kickoff.checks.${clientName}`;
  useEffect(() => {
    try { setChecked(JSON.parse(localStorage.getItem(storageKey) || '{}')); } catch { /* ignore */ }
  }, [storageKey]);
  const toggle = (id: string) => {
    setChecked(prev => {
      const next = { ...prev, [id]: !prev[id] };
      try { localStorage.setItem(storageKey, JSON.stringify(next)); } catch { /* ignore */ }
      return next;
    });
  };

  const embed = videoUrl ? toYouTubeEmbed(videoUrl) : null;

  if (!embed && !intro && items.length === 0) return null;

  const evolveItems = items.filter(i => (i.owner || '').toLowerCase() !== 'cpm');
  const cpmItems = items.filter(i => (i.owner || '').toLowerCase() === 'cpm');

  return (
    <div className="bg-white rounded-xl shadow-[0_4px_24px_rgba(0,0,0,0.08)] overflow-hidden mb-6">
      <div className="bg-[#3CAB7A] px-8 py-6">
        <h2 className="text-xl font-bold text-white flex items-center gap-2">
          <PlayCircle className="w-6 h-6" />
          Welcome, {clientName}
        </h2>
        {intro && <p className="mt-1.5 text-sm text-white/85 leading-relaxed">{intro}</p>}
      </div>

      {embed && (
        <div className="px-8 pt-6">
          <div className="relative w-full overflow-hidden rounded-lg bg-black" style={{ paddingTop: '56.25%' }}>
            <iframe
              src={embed}
              title={`Welcome from Charles — ${clientName}`}
              className="absolute inset-0 w-full h-full"
              allow="accelerated-2d-canvas; autoplay; clipboard-write; encrypted-media; gyroscope; picture-in-picture"
              allowFullScreen
            />
          </div>
        </div>
      )}

      {(items.length > 0 || ctaItem) && (
        <div className="px-8 py-6">
          <h3 className="text-sm font-bold text-gray-900 uppercase tracking-wider mb-3">
            Action items from our kickoff
          </h3>

          {(evolveItems.length > 0 || ctaItem) && (
            <div className="mb-4">
              <div className="text-[11px] font-semibold text-[#3CAB7A] uppercase tracking-wider mb-2">
                What we need from you
              </div>
              <ul className="space-y-2">
                {evolveItems.map(item => {
                  const done = !!checked[item.id];
                  return (
                    <li key={item.id}>
                      <button
                        type="button"
                        onClick={() => toggle(item.id)}
                        className="w-full flex items-start gap-3 text-left p-2.5 rounded-md hover:bg-gray-50 transition-colors"
                      >
                        {done
                          ? <CheckCircle2 className="w-5 h-5 text-[#3CAB7A] flex-shrink-0 mt-0.5" />
                          : <Circle className="w-5 h-5 text-gray-300 flex-shrink-0 mt-0.5" />
                        }
                        <span className={`text-sm leading-snug ${done ? 'text-gray-400 line-through' : 'text-gray-800'}`}>
                          {linkify(item.label)}
                        </span>
                      </button>
                    </li>
                  );
                })}
                {ctaItem && (
                  <li>
                    <button
                      type="button"
                      onClick={() => {
                        const el = document.getElementById(ctaItem.targetId);
                        if (el) el.scrollIntoView({ behavior: 'smooth', block: 'start' });
                      }}
                      className={`w-full flex items-center gap-3 text-left p-3 rounded-lg border-2 transition-all ${
                        ctaItem.done
                          ? 'border-[#3CAB7A] bg-[#3CAB7A]/5'
                          : 'border-[#3CAB7A] bg-[#3CAB7A] hover:bg-[#2D8F63] shadow-md'
                      }`}
                    >
                      {ctaItem.done
                        ? <CheckCircle2 className="w-5 h-5 text-[#3CAB7A] flex-shrink-0" />
                        : <Circle className="w-5 h-5 text-white flex-shrink-0" strokeWidth={2.5} />
                      }
                      <span className={`text-sm font-semibold leading-snug flex-1 ${
                        ctaItem.done ? 'text-[#2D8F63]' : 'text-white'
                      }`}>
                        {ctaItem.label}
                      </span>
                      {!ctaItem.done && (
                        <span className="text-xs font-bold uppercase tracking-wider text-white/90">
                          Start →
                        </span>
                      )}
                    </button>
                  </li>
                )}
              </ul>
            </div>
          )}

          {cpmItems.length > 0 && (
            <div>
              <div className="text-[11px] font-semibold text-gray-500 uppercase tracking-wider mb-2">
                What CPM is handling
              </div>
              <ul className="space-y-1.5">
                {cpmItems.map(item => (
                  <li key={item.id} className="flex items-start gap-3 p-2 text-sm text-gray-600">
                    <CheckCircle2 className="w-4 h-4 text-gray-300 flex-shrink-0 mt-0.5" />
                    <span>{item.label}</span>
                  </li>
                ))}
              </ul>
            </div>
          )}
        </div>
      )}
    </div>
  );
}
