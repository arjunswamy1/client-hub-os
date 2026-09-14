/**
 * Media Brain — LAST WEBHOOK RECEIPT (operator test helper)
 *
 * One receipt, not a feed. It exists so somebody can place a test call and see,
 * without opening a database, exactly what the platform sent: the fields that
 * arrived, the fields that arrived as unreplaced `[MACRO]` literals, and the whole
 * custom-tag bag with values.
 *
 * Values are shown deliberately — this is a tool for a deliberate test, and a test
 * you cannot read is not a test. The shared secret is never part of a body and is
 * never rendered; anything credential-shaped in the tag bag is redacted upstream in
 * the webhook before it is stored.
 *
 * It renders for ANY client that has a webhook-delivered source, not just River Road.
 */

import { Badge } from '@/components/ui/badge';
import type { SyncStatusRow } from '@/hooks/useMediaBrainSyncStatus';
import {
  clickKeyHeadline,
  clickKeyReadiness,
  type ClickKeyState,
  type ClickKeyVerdict,
} from '@/lib/mediaBrain/clickKeyReadiness';

/** Sources that arrive by webhook rather than by a scheduled pull. */
const WEBHOOK_SOURCES = new Set(['moja', 'callgrid', 'ringfuel']);

/** The 12:39 test fire — the delivery that must never be mistaken for a real call. */
const KNOWN_TEST_FIRE = '2026-09-14T12:39';

interface ReceiptDetail {
  last_validation?: string | null;
  last_payload_fields?: string[] | null;
  last_unreplaced_tags?: string[] | null;
  last_payload_shape?: string | null;
  last_event_type?: string | null;
  last_delivery_id?: string | null;
  last_receipt_at?: string | null;
  last_custom_tags?: Record<string, unknown> | null;
  /** Raw per-key values captured by the webhook, top level or custom-tag bag. */
  last_click_keys?: Record<string, unknown> | null;
  /** Stamped the first time a receipt carried a real ad-level click key. */
  click_key_evidence_at?: string | null;
}

const fmt = (iso: string | null | undefined) =>
  iso ? new Date(iso).toISOString().replace('T', ' ').slice(0, 19) + ' UTC' : 'never';

/** HTTP result is not stored as a number; it is exactly what the validation implies. */
function httpResult(validation: string | null | undefined): string {
  switch (validation) {
    case 'ok':
      return '200 — accepted and stored';
    case 'invalid_secret':
      return '401 — rejected, shared secret did not match';
    case 'missing_client_id':
      return '400 — rejected, no valid client_id on the URL';
    case 'invalid_body':
      return '400 — rejected, body could not be parsed';
    case 'rejected_call_row':
      return '202 — receipt recorded, no row written (call_id missing)';
    case 'server_not_configured':
      return '500 — the webhook secret is not set on the server';
    case 'db_error':
      return '500 — accepted but the write failed';
    default:
      return 'unknown';
  }
}

export function WebhookReceiptPanel({ rows }: { rows: SyncStatusRow[] }) {
  const candidates = rows
    .filter((r) => WEBHOOK_SOURCES.has(r.source))
    .map((r) => ({ row: r, detail: (r.detail ?? {}) as ReceiptDetail }))
    .filter((c) => !!c.detail.last_receipt_at)
    .sort((a, b) => (a.detail.last_receipt_at! < b.detail.last_receipt_at! ? 1 : -1));

  const webhookSources = rows.filter((r) => WEBHOOK_SOURCES.has(r.source));
  if (webhookSources.length === 0) return null;

  if (candidates.length === 0) {
    return (
      <div className="rounded-lg border border-dashed p-4">
        <p className="text-sm font-semibold">Last webhook receipt</p>
        <p className="mt-1 text-xs text-muted-foreground">
          A webhook is configured for {webhookSources.map((r) => r.source).join(', ')}, but no delivery has ever been
          received, so there is no receipt to show. That is "never delivered", not "quiet" — placing a test call is the
          way to change it.
        </p>
      </div>
    );
  }

  const { row, detail } = candidates[0];
  const unreplaced = detail.last_unreplaced_tags ?? [];
  const fields = detail.last_payload_fields ?? [];
  const tags = detail.last_custom_tags ?? {};
  const receiptAt = detail.last_receipt_at ?? null;
  const isKnownTestFire = !!receiptAt && receiptAt.startsWith(KNOWN_TEST_FIRE);
  const looksLikeTest = isKnownTestFire || unreplaced.length > 0;

  return (
    <div className="rounded-lg border p-4">
      <div className="flex flex-wrap items-center gap-2">
        <p className="text-sm font-semibold">Last webhook receipt · {row.source}</p>
        <Badge variant={detail.last_validation === 'ok' ? 'outline' : 'destructive'} className="uppercase">
          {detail.last_validation ?? 'unknown'}
        </Badge>
        {looksLikeTest && (
          <Badge variant="destructive" className="uppercase">
            test fire — not a real call
          </Badge>
        )}
      </div>

      <p className="mt-1 text-xs text-muted-foreground">
        This shows a <strong>single receipt</strong>, not a feed — the most recent delivery only. It is here so a manual
        end-to-end test can be verified without a database query. The shared secret is never shown.
      </p>

      {looksLikeTest && (
        <p className="mt-2 rounded border border-destructive/40 bg-destructive/10 p-2 text-xs">
          {isKnownTestFire
            ? 'This is the 2026-09-14 12:39 UTC test fire, not a real call. '
            : 'This delivery arrived with unreplaced macro literals, which is the signature of a platform test fire rather than a real call. '}
          {unreplaced.length} field{unreplaced.length === 1 ? '' : 's'} arrived as an unreplaced <code>[MACRO]</code>{' '}
          literal, so nothing in it can be read as call data.
        </p>
      )}

      <dl className="mt-3 grid gap-x-6 gap-y-1 text-xs sm:grid-cols-2">
        <Pair label="Receipt timestamp" value={fmt(receiptAt)} />
        <Pair label="Event type" value={detail.last_event_type ?? 'not stated'} />
        <Pair label="HTTP result" value={httpResult(detail.last_validation)} />
        <Pair label="Payload shape" value={detail.last_payload_shape ?? 'unknown'} />
        <Pair label="Delivery id" value={detail.last_delivery_id ?? 'none sent'} />
        <Pair label="Rows written" value={String(row.rows_written ?? 0)} />
      </dl>

      <FieldList
        title={`Fields received (${fields.length})`}
        empty="No fields at all — the body was empty or unparseable."
        items={fields}
      />
      <FieldList
        title={`Arrived as unreplaced [MACRO] literals (${unreplaced.length})`}
        empty="None — every field carried a substituted value."
        items={unreplaced}
        tone="danger"
      />

      <div className="mt-3">
        <p className="text-xs font-medium uppercase tracking-wide text-muted-foreground">
          Custom tags ({Object.keys(tags).length})
        </p>
        {Object.keys(tags).length === 0 ? (
          <p className="mt-1 text-xs text-muted-foreground">
            No custom tags on this delivery. Click IDs can only ever arrive here — the platform has no built-in
            gclid/fbclid macro — so an empty bag means ad-level attribution has no key.
          </p>
        ) : (
          <dl className="mt-1 grid gap-x-6 gap-y-1 text-xs sm:grid-cols-2">
            {Object.entries(tags).map(([k, v]) => (
              <Pair key={k} label={k} value={v === null || v === undefined ? 'null' : String(v)} />
            ))}
          </dl>
        )}
      </div>
    </div>
  );
}

function Pair({ label, value }: { label: string; value: string }) {
  return (
    <div className="flex gap-2">
      <dt className="shrink-0 text-muted-foreground">{label}</dt>
      <dd className="break-all font-mono">{value}</dd>
    </div>
  );
}

function FieldList({
  title,
  items,
  empty,
  tone,
}: {
  title: string;
  items: string[];
  empty: string;
  tone?: 'danger';
}) {
  return (
    <div className="mt-3">
      <p className="text-xs font-medium uppercase tracking-wide text-muted-foreground">{title}</p>
      {items.length === 0 ? (
        <p className="mt-1 text-xs text-muted-foreground">{empty}</p>
      ) : (
        <p className={`mt-1 break-all font-mono text-xs ${tone === 'danger' ? 'text-destructive' : ''}`}>
          {items.join(', ')}
        </p>
      )}
    </div>
  );
}
