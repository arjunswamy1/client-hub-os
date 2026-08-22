import { useEffect, useState } from "react";
import { Card } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Switch } from "@/components/ui/switch";
import { Textarea } from "@/components/ui/textarea";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { toast } from "@/hooks/use-toast";
import { AlertTriangle, Hash, Loader2, Save, Send, Slack } from "lucide-react";
import {
  ReportScope,
  useSaveSlackReport,
  useSendSlackReportNow,
  useSlackChannels,
  useSlackReport,
} from "@/hooks/useSlackReports";

const DAYS = ["Monday", "Tuesday", "Wednesday", "Thursday", "Friday", "Saturday", "Sunday"];

/** Local-time hint for a UTC hour so the user can sanity-check the send time. */
function localHint(hourUtc: number) {
  const d = new Date();
  d.setUTCHours(hourUtc, 0, 0, 0);
  return d.toLocaleTimeString(undefined, { hour: "numeric", minute: "2-digit" });
}

export default function SlackReportCard({
  clientId,
  scope,
  clientLabel,
}: {
  clientId: string;
  scope: ReportScope;
  clientLabel: string;
}) {
  const { data: report, isLoading } = useSlackReport(clientId, scope);
  const { data: channels = [], isLoading: channelsLoading, error: channelsError } = useSlackChannels();
  const save = useSaveSlackReport(clientId, scope);
  const sendNow = useSendSlackReportNow(clientId, scope);

  const [enabled, setEnabled] = useState(true);
  const [channelId, setChannelId] = useState("");
  const [day, setDay] = useState(1);
  const [hour, setHour] = useState(13);
  const [notes, setNotes] = useState("");

  useEffect(() => {
    if (!report) return;
    setEnabled(report.enabled);
    setChannelId(report.slack_channel_id || "");
    setDay(report.day_of_week ?? 1);
    setHour(report.run_hour_utc ?? 13);
    setNotes(report.notes || "");
  }, [report]);

  const onSave = async () => {
    if (!channelId) {
      toast({ title: "Pick a Slack channel first", variant: "destructive" });
      return;
    }
    const channel = channels.find((c) => c.id === channelId);
    try {
      await save.mutateAsync({
        enabled,
        slack_channel_id: channelId,
        slack_channel_name: channel?.name || null,
        day_of_week: day,
        run_hour_utc: hour,
        notes: notes.trim() || null,
      });
      toast({
        title: enabled
          ? `Brief will post to #${channel?.name} every ${DAYS[day - 1]} at ${String(hour).padStart(2, "0")}:00 UTC`
          : "Automatic Slack delivery turned off",
      });
    } catch (e: any) {
      toast({ title: "Could not save", description: String(e?.message || e).slice(0, 200), variant: "destructive" });
    }
  };

  const onSendNow = async () => {
    try {
      const res = await sendNow.mutateAsync();
      toast({ title: `Posted ${res?.sent ?? 0} brief${res?.sent === 1 ? "" : "s"} to Slack` });
    } catch (e: any) {
      toast({ title: "Send failed", description: String(e?.message || e).slice(0, 300), variant: "destructive" });
    }
  };

  return (
    <Card className="p-5">
      <div className="flex flex-wrap items-start justify-between gap-4">
        <div className="max-w-xl">
          <h3 className="flex items-center gap-2 text-sm font-semibold">
            <Slack className="h-4 w-4 text-primary" /> Weekly brief to Slack
          </h3>
          <p className="mt-1 text-xs text-muted-foreground">
            Generates the {clientLabel} AI optimization brief on a schedule and posts it to a Slack channel — one
            message per campaign line, with the top five actions and the headline metrics.
          </p>
        </div>
        <div className="flex items-center gap-2">
          <span className="text-xs text-muted-foreground">{enabled ? "On" : "Off"}</span>
          <Switch checked={enabled} onCheckedChange={setEnabled} disabled={isLoading} />
        </div>
      </div>

      {channelsError && (
        <div className="mt-4 rounded-lg border border-destructive/30 bg-destructive/5 p-3 text-[11px] text-destructive">
          <AlertTriangle className="mr-1 inline h-3.5 w-3.5" /> Could not load Slack channels — check the Slack
          connection in Settings.
        </div>
      )}

      <div className="mt-4 grid gap-3 sm:grid-cols-3">
        <div>
          <label className="text-xs font-medium">Slack channel</label>
          <Select value={channelId} onValueChange={setChannelId} disabled={channelsLoading}>
            <SelectTrigger className="mt-1 h-9 text-xs">
              <SelectValue placeholder={channelsLoading ? "Loading channels…" : "Choose a channel"} />
            </SelectTrigger>
            <SelectContent>
              {channels.map((c) => (
                <SelectItem key={c.id} value={c.id}>
                  <span className="flex items-center gap-1.5">
                    <Hash className="h-3 w-3" /> {c.name}
                  </span>
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        </div>
        <div>
          <label className="text-xs font-medium">Day</label>
          <Select value={String(day)} onValueChange={(v) => setDay(Number(v))}>
            <SelectTrigger className="mt-1 h-9 text-xs"><SelectValue /></SelectTrigger>
            <SelectContent>
              {DAYS.map((d, i) => (
                <SelectItem key={d} value={String(i + 1)}>{d}</SelectItem>
              ))}
            </SelectContent>
          </Select>
        </div>
        <div>
          <label className="text-xs font-medium">Time (UTC)</label>
          <Select value={String(hour)} onValueChange={(v) => setHour(Number(v))}>
            <SelectTrigger className="mt-1 h-9 text-xs"><SelectValue /></SelectTrigger>
            <SelectContent>
              {Array.from({ length: 24 }, (_, h) => (
                <SelectItem key={h} value={String(h)}>
                  {String(h).padStart(2, "0")}:00 UTC · {localHint(h)} local
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        </div>
      </div>

      <div className="mt-4">
        <label className="text-xs font-medium">Standing context for the buyer (optional)</label>
        <Textarea
          value={notes}
          onChange={(e) => setNotes(e.target.value)}
          placeholder="e.g. keep daily budgets under $500 per campaign, Belu reviews briefs Monday mornings…"
          className="mt-1 min-h-[56px] text-xs"
        />
      </div>

      <div className="mt-4 flex flex-wrap items-center justify-between gap-3">
        <div className="text-[11px] text-muted-foreground">
          {report?.slack_channel_name ? <>Posting to #{report.slack_channel_name}</> : <>Not configured yet</>}
          {report?.last_sent_at && <> · Last sent {new Date(report.last_sent_at).toLocaleString()}</>}
          {report?.last_error && <span className="text-destructive"> · {report.last_error.slice(0, 140)}</span>}
        </div>
        <div className="flex gap-2">
          <Button size="sm" variant="outline" className="gap-1.5" onClick={onSendNow} disabled={sendNow.isPending || !report?.slack_channel_id}>
            {sendNow.isPending ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <Send className="h-3.5 w-3.5" />} Send now
          </Button>
          <Button size="sm" className="gap-1.5" onClick={onSave} disabled={save.isPending}>
            {save.isPending ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <Save className="h-3.5 w-3.5" />} Save
          </Button>
        </div>
      </div>
    </Card>
  );
}
