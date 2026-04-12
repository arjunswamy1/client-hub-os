import { useState } from "react";
import { Dialog, DialogContent, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Badge } from "@/components/ui/badge";
import { ExternalLink, Copy, Check } from "lucide-react";

interface AdData {
  adName: string;
  format?: string | null;
  headlines: string[];
  descriptions: string[];
  displayUrl?: string | null;
  finalUrl?: string | null;
  status?: string | null;
}

interface GoogleAdPreviewModalProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  ad: AdData | null;
}

function CopyBtn({ text }: { text: string }) {
  const [copied, setCopied] = useState(false);
  return (
    <button
      className="inline-flex items-center justify-center h-5 w-5 rounded hover:bg-muted shrink-0"
      onClick={() => { navigator.clipboard.writeText(text); setCopied(true); setTimeout(() => setCopied(false), 1200); }}
    >
      {copied ? <Check className="h-3 w-3 text-green-500" /> : <Copy className="h-3 w-3 text-muted-foreground" />}
    </button>
  );
}

export default function GoogleAdPreviewModal({ open, onOpenChange, ad }: GoogleAdPreviewModalProps) {
  if (!ad) return null;

  const displayUrl = ad.displayUrl || ad.finalUrl || "example.com";
  // Build a realistic RSA preview: Google shows up to 3 headlines separated by " | "
  const previewHeadlines = ad.headlines.slice(0, 3);
  const previewDescs = ad.descriptions.slice(0, 2);

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-2xl">
        <DialogHeader>
          <DialogTitle className="text-sm flex items-center gap-2">
            Google Ad Preview — {ad.adName}
            {ad.format && <Badge variant="secondary" className="text-[10px]">{ad.format}</Badge>}
            {ad.status && <Badge variant="outline" className="text-[10px]">{ad.status}</Badge>}
          </DialogTitle>
        </DialogHeader>

        {/* Google SERP-style preview */}
        <div className="space-y-6">
          <div className="rounded-lg border p-5 bg-background space-y-1.5">
            {/* Sponsored label */}
            <div className="flex items-center gap-1.5 text-xs">
              <span className="font-semibold text-foreground">Sponsored</span>
            </div>
            {/* Display URL */}
            <div className="flex items-center gap-1 text-xs text-foreground">
              <svg viewBox="0 0 16 16" className="h-3.5 w-3.5 shrink-0" fill="none">
                <circle cx="8" cy="8" r="7" stroke="currentColor" strokeWidth="1.5" />
                <path d="M5 8h6M8 5v6" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" />
              </svg>
              <span className="truncate">{displayUrl}</span>
            </div>
            {/* Headlines */}
            <p className="text-xl text-[#1a0dab] leading-tight cursor-pointer hover:underline">
              {previewHeadlines.join(" | ")}
            </p>
            {/* Descriptions */}
            <p className="text-sm text-muted-foreground leading-snug">
              {previewDescs.join(" ")}
            </p>
          </div>

          {/* All Headlines */}
          <div>
            <p className="text-xs font-semibold mb-2">All Headlines ({ad.headlines.length})</p>
            <div className="grid grid-cols-2 gap-1">
              {ad.headlines.map((h, i) => (
                <div key={i} className="flex items-center gap-1.5 rounded border px-2.5 py-1.5 text-xs">
                  <span className="text-muted-foreground shrink-0 w-4">{i + 1}.</span>
                  <span className="flex-1 break-words">{h}</span>
                  <span className={`text-[10px] tabular-nums shrink-0 ${h.length <= 30 ? "text-muted-foreground" : "text-destructive"}`}>{h.length}/30</span>
                  <CopyBtn text={h} />
                </div>
              ))}
            </div>
          </div>

          {/* All Descriptions */}
          <div>
            <p className="text-xs font-semibold mb-2">All Descriptions ({ad.descriptions.length})</p>
            <div className="space-y-1">
              {ad.descriptions.map((d, i) => (
                <div key={i} className="flex items-center gap-1.5 rounded border px-2.5 py-1.5 text-xs">
                  <span className="text-muted-foreground shrink-0 w-4">{i + 1}.</span>
                  <span className="flex-1 break-words">{d}</span>
                  <span className={`text-[10px] tabular-nums shrink-0 ${d.length <= 90 ? "text-muted-foreground" : "text-destructive"}`}>{d.length}/90</span>
                  <CopyBtn text={d} />
                </div>
              ))}
            </div>
          </div>

          {/* Final URL */}
          {ad.finalUrl && (
            <div className="flex items-center gap-2 text-xs text-muted-foreground">
              <span className="font-medium">Final URL:</span>
              <a href={ad.finalUrl} target="_blank" rel="noopener noreferrer" className="text-primary hover:underline flex items-center gap-1 truncate">
                {ad.finalUrl}
                <ExternalLink className="h-3 w-3 shrink-0" />
              </a>
            </div>
          )}
        </div>
      </DialogContent>
    </Dialog>
  );
}
