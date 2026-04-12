import { useState } from "react";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Switch } from "@/components/ui/switch";
import { Plus, Sparkles } from "lucide-react";
import { NewVerticalInput, useClientVerticals } from "@/hooks/useClientVerticals";

const EMOJI_OPTIONS = ["📋", "🏠", "🔧", "🚿", "💡", "🏗️", "🪟", "🌿", "🚗", "🧹", "🔌", "🎯", "📱", "💊", "⚖️", "🦷", "🐾", "🔒", "☀️", "❄️"];

export function AddVerticalDialog() {
  const { addVertical } = useClientVerticals();
  const [open, setOpen] = useState(false);
  const [label, setLabel] = useState("");
  const [emoji, setEmoji] = useState("📋");
  const [metaPatterns, setMetaPatterns] = useState("");
  const [metaAccountIds, setMetaAccountIds] = useState("");
  const [googlePatterns, setGooglePatterns] = useState("");
  const [googleAccountIds, setGoogleAccountIds] = useState("");
  const [ringbaPatterns, setRingbaPatterns] = useState("");
  const [ringbaExactMatch, setRingbaExactMatch] = useState(false);

  const reset = () => {
    setLabel("");
    setEmoji("📋");
    setMetaPatterns("");
    setMetaAccountIds("");
    setGooglePatterns("");
    setGoogleAccountIds("");
    setRingbaPatterns("");
    setRingbaExactMatch(false);
  };

  const handleSubmit = () => {
    if (!label.trim()) return;

    const split = (s: string) => s.split(",").map(v => v.trim()).filter(Boolean);

    const input: NewVerticalInput = {
      label: label.trim(),
      emoji,
      metaPatterns: split(metaPatterns),
      metaAccountIds: split(metaAccountIds),
      googlePatterns: split(googlePatterns),
      googleAccountIds: split(googleAccountIds),
      ringbaPatterns: split(ringbaPatterns),
      ringbaExactMatch,
    };

    addVertical.mutate(input, {
      onSuccess: () => {
        reset();
        setOpen(false);
      },
    });
  };

  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogTrigger asChild>
        <button
          className="flex items-center justify-center rounded-md px-2 py-1.5 text-xs text-muted-foreground hover:text-foreground hover:bg-background transition-colors"
          title="Add vertical"
        >
          <Plus className="h-3.5 w-3.5" />
        </button>
      </DialogTrigger>
      <DialogContent className="max-w-lg">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            <Sparkles className="h-4 w-4 text-primary" />
            Add New Vertical
          </DialogTitle>
        </DialogHeader>

        <div className="space-y-4 pt-2">
          {/* Name & Emoji */}
          <div className="flex gap-3">
            <div className="flex-1 space-y-1.5">
              <Label className="text-xs">Vertical Name</Label>
              <Input
                placeholder="e.g. Bathroom Remodel"
                value={label}
                onChange={e => setLabel(e.target.value)}
              />
            </div>
            <div className="space-y-1.5">
              <Label className="text-xs">Emoji</Label>
              <div className="flex flex-wrap gap-1 max-w-[160px] rounded-md border p-1.5">
                {EMOJI_OPTIONS.map(e => (
                  <button
                    key={e}
                    onClick={() => setEmoji(e)}
                    className={`text-sm p-0.5 rounded ${emoji === e ? "bg-primary/20 ring-1 ring-primary" : "hover:bg-muted"}`}
                  >
                    {e}
                  </button>
                ))}
              </div>
            </div>
          </div>

          {/* Meta Ads */}
          <div className="space-y-2 rounded-md border p-3">
            <p className="text-xs font-semibold text-muted-foreground uppercase tracking-wider">Meta Ads</p>
            <div className="space-y-1.5">
              <Label className="text-xs">Campaign Name Patterns <span className="text-muted-foreground">(comma-separated)</span></Label>
              <Input
                placeholder="e.g. Bathroom, Bath Remodel"
                value={metaPatterns}
                onChange={e => setMetaPatterns(e.target.value)}
              />
            </div>
            <div className="space-y-1.5">
              <Label className="text-xs">Account IDs <span className="text-muted-foreground">(optional, comma-separated)</span></Label>
              <Input
                placeholder="e.g. 123456789"
                value={metaAccountIds}
                onChange={e => setMetaAccountIds(e.target.value)}
              />
            </div>
          </div>

          {/* Google Ads */}
          <div className="space-y-2 rounded-md border p-3">
            <p className="text-xs font-semibold text-muted-foreground uppercase tracking-wider">Google Ads</p>
            <div className="space-y-1.5">
              <Label className="text-xs">Campaign Name Patterns <span className="text-muted-foreground">(comma-separated)</span></Label>
              <Input
                placeholder="e.g. Bathroom, Bath Remodel"
                value={googlePatterns}
                onChange={e => setGooglePatterns(e.target.value)}
              />
            </div>
            <div className="space-y-1.5">
              <Label className="text-xs">Account IDs <span className="text-muted-foreground">(optional, comma-separated)</span></Label>
              <Input
                placeholder="e.g. 1939246766"
                value={googleAccountIds}
                onChange={e => setGoogleAccountIds(e.target.value)}
              />
            </div>
          </div>

          {/* Ringba */}
          <div className="space-y-2 rounded-md border p-3">
            <p className="text-xs font-semibold text-muted-foreground uppercase tracking-wider">Ringba</p>
            <div className="space-y-1.5">
              <Label className="text-xs">Campaign Name Patterns <span className="text-muted-foreground">(comma-separated)</span></Label>
              <Input
                placeholder="e.g. Bathroom Remodel US Call Flow"
                value={ringbaPatterns}
                onChange={e => setRingbaPatterns(e.target.value)}
              />
            </div>
            <div className="flex items-center gap-2">
              <Switch
                checked={ringbaExactMatch}
                onCheckedChange={setRingbaExactMatch}
              />
              <Label className="text-xs">Exact match only</Label>
            </div>
          </div>

          <Button
            onClick={handleSubmit}
            disabled={!label.trim() || addVertical.isPending}
            className="w-full"
          >
            {addVertical.isPending ? "Adding..." : "Add Vertical"}
          </Button>
        </div>
      </DialogContent>
    </Dialog>
  );
}
