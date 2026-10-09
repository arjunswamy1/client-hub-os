// Jacuzzi lead email → hub → client Google Sheet, every 30 minutes.
//
// 1. Finds new emails from Teresa (Cannella) in AJ's inbox carrying the
//    "Jacuzzi TM … .xlsx" lead file; each email is processed once
//    (jacuzzi_lead_email_log.gmail_message_id is unique).
// 2. Adds only leads whose transaction id is new to jacuzzi_leads, priced at the
//    payout in effect on the lead's date (jacuzzi_payout_rates). Existing rows are
//    never changed.
// 3. Updates the client sheet: CT20 Daily (ON) (real Roku spend + impressions,
//    CT20 calls / QR), CT26(DRAG) and CT13 (OFF) (calls / QR), adding date rows
//    above the Grand Total and extending its sums when a date is missing.
//    Spend and impressions are only ever the real Roku figures.
// 4. DMs AJ a summary through postDirectMessage().
//
// Auth: cron nonce (cron_invocation_tokens) or the service-role bearer.
// Body: { dry_run?: boolean, message_id?: string } — dry_run reads and reports only.
import { createClient } from 'npm:@supabase/supabase-js@2';
import * as XLSX from 'npm:xlsx@0.18.5';
import { postDirectMessage } from '../_shared/slack-post.ts';
import {
  CLIENT_SHEET_ID, JACUZZI_CLIENT_ID, TABS, TERESA, countCell, extendTotals, isoToSerial,
  parseLeadRows, rateFor, stationRowValues, type Station,
} from '../_shared/jacuzzi-lead-sheet.ts';

const AJ_EMAIL = 'aj@connectpaidmedia.com';
const GMAIL = 'https://connector-gateway.lovable.dev/google_mail/gmail/v1';
const SHEETS = 'https://connector-gateway.lovable.dev/google_sheets/v4';
const json = (b: unknown, status = 200) => new Response(JSON.stringify(b), { status, headers: { 'Content-Type': 'application/json' } });

function gw(base: string, keyEnv: string) {
  return async (method: string, path: string, body?: unknown) => {
    const res = await fetch(`${base}${path}`, {
      method,
      headers: {
        Authorization: `Bearer ${Deno.env.get('LOVABLE_API_KEY')}`,
        'X-Connection-Api-Key': Deno.env.get(keyEnv)!,
        'Content-Type': 'application/json',
      },
      body: body === undefined ? undefined : JSON.stringify(body),
    });
    const text = await res.text();
    if (!res.ok) throw new Error(`${base.includes('mail') ? 'Gmail' : 'Sheets'} ${method} ${path.split('?')[0]} [${res.status}]: ${text.slice(0, 400)}`);
    return text ? JSON.parse(text) : {};
  };
}
const gmail = gw(GMAIL, 'GOOGLE_MAIL_API_KEY');
const sheets = gw(SHEETS, 'GOOGLE_SHEETS_API_KEY');
const q = (t: string) => `'${t}'`;

function findXlsx(part: any): { filename: string; attachmentId: string } | null {
  if (!part) return null;
  if (part.filename && /\.xlsx$/i.test(part.filename) && /jacuzzi/i.test(part.filename) && part.body?.attachmentId) {
    return { filename: part.filename, attachmentId: part.body.attachmentId };
  }
  for (const p of part.parts ?? []) { const hit = findXlsx(p); if (hit) return hit; }
  return null;
}

const b64urlToBytes = (s: string) => Uint8Array.from(atob(s.replace(/-/g, '+').replace(/_/g, '/')), (c) => c.charCodeAt(0));

Deno.serve(async (req) => {
  const db = createClient(Deno.env.get('SUPABASE_URL')!, Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!);
  const bearer = (req.headers.get('authorization') ?? '').replace(/^Bearer\s+/i, '');
  const nonce = req.headers.get('x-cron-nonce') ?? '';
  let ok = bearer !== '' && bearer === Deno.env.get('SUPABASE_SERVICE_ROLE_KEY');
  if (!ok && /^[0-9a-f-]{36}$/i.test(nonce)) {
    const { data } = await db.from('cron_invocation_tokens').delete().eq('token', nonce)
      .gt('created_at', new Date(Date.now() - 5 * 60000).toISOString()).select('token').maybeSingle();
    ok = !!data;
  }
  if (!ok) return json({ error: 'Unauthorized' }, 401);

  const body = await req.json().catch(() => ({}));
  const dryRun = body.dry_run === true;

  try {
    // ── 1. new emails ──
    let ids: string[];
    if (typeof body.message_id === 'string') ids = [body.message_id];
    else {
      const list = await gmail('GET', `/users/me/messages?maxResults=10&q=${encodeURIComponent(`from:${TERESA} has:attachment filename:xlsx newer_than:4d`)}`);
      ids = (list.messages ?? []).map((m: any) => m.id).reverse(); // oldest first
    }
    const { data: done } = await db.from('jacuzzi_lead_email_log').select('gmail_message_id').in('gmail_message_id', ids.length ? ids : ['-']);
    const doneSet = new Set((done ?? []).map((r: any) => r.gmail_message_id));
    const todo = ids.filter((id) => !doneSet.has(id));
    if (!todo.length) return json({ ok: true, processed: 0, note: 'no new lead emails' });

    const { data: rates } = await db.from('jacuzzi_payout_rates').select('effective_from, rate').eq('client_id', JACUZZI_CLIENT_ID);
    const results = [];

    for (const id of todo) {
      const msg = await gmail('GET', `/users/me/messages/${id}?format=full`);
      const headers = Object.fromEntries((msg.payload?.headers ?? []).map((h: any) => [String(h.name).toLowerCase(), h.value]));
      const from = String(headers['from'] ?? '');
      const att = findXlsx(msg.payload);
      const base = { gmail_message_id: id, subject: headers['subject'] ?? null, received_at: new Date(Number(msg.internalDate)).toISOString() };
      if (!from.toLowerCase().includes(TERESA) || !att) {
        if (!dryRun) await db.from('jacuzzi_lead_email_log').insert({ ...base, status: 'skipped', error: !att ? 'no Jacuzzi .xlsx attachment' : `sender ${from}` });
        results.push({ id, skipped: !att ? 'no Jacuzzi .xlsx attachment' : 'not from Teresa' });
        continue;
      }

      // ── 2. leads ──
      const a = await gmail('GET', `/users/me/messages/${id}/attachments/${att.attachmentId}`);
      const wb = XLSX.read(b64urlToBytes(a.data), { type: 'array' });
      const ws = wb.Sheets[wb.SheetNames.find((n) => /jacuzzi tm/i.test(n)) ?? wb.SheetNames[0]];
      const leads = parseLeadRows(XLSX.utils.sheet_to_json(ws, { defval: null, raw: true }) as Record<string, unknown>[]);
      if (!leads.length) throw new Error(`${att.filename}: no lead rows found`);

      const have = new Set<string>();
      for (let i = 0; i < leads.length; i += 300) {
        const { data } = await db.from('jacuzzi_leads').select('transaction_id').eq('client_id', JACUZZI_CLIENT_ID)
          .in('transaction_id', leads.slice(i, i + 300).map((l) => l.transaction_id));
        for (const r of data ?? []) have.add(String(r.transaction_id));
      }
      const fresh = leads.filter((l) => !have.has(l.transaction_id));
      const unpriced = fresh.filter((l) => rateFor(rates ?? [], l.transaction_date) === null);
      if (unpriced.length) throw new Error(`no payout rate recorded for ${unpriced[0].transaction_date}`);
      const rows = fresh.map((l) => ({ ...l, client_id: JACUZZI_CLIENT_ID, payout_rate: rateFor(rates ?? [], l.transaction_date), source: 'client_sheet' }));
      if (!dryRun && rows.length) {
        const { error } = await db.from('jacuzzi_leads').insert(rows);
        if (error) throw new Error(`jacuzzi_leads insert: ${error.message}`);
      }
      // Fresh lead dates plus the file's latest date, so a retry after a sheet failure still writes it.
      const latestInFile = leads.map((l) => l.transaction_date).sort().pop()!;
      const dates = [...new Set([...fresh.map((l) => l.transaction_date), latestInFile])].sort();

      // ── 3. sheet ──
      const sheetNotes: string[] = [];
      const writes: { range: string; values: unknown[][] }[] = [];
      if (dates.length) {
        // Counts per date and station, from the hub (so a date's cell is its full total, not just this email's).
        const { data: dayLeads } = await db.from('jacuzzi_leads').select('transaction_date, lead_type, station_code')
          .eq('client_id', JACUZZI_CLIENT_ID).in('transaction_date', dates);
        const count = (st: string, d: string, t: string) => (dayLeads ?? []).filter((x: any) => x.station_code === st && x.transaction_date === d && x.lead_type === t).length;
        const meta = await sheets('GET', `/spreadsheets/${CLIENT_SHEET_ID}?fields=sheets.properties(sheetId,title)`);
        const sheetId = (title: string) => meta.sheets.find((s: any) => s.properties.title === title)?.properties.sheetId;

        for (const st of Object.keys(TABS) as Station[]) {
          const tab = TABS[st];
          const sid = sheetId(tab.title);
          if (sid === undefined) { sheetNotes.push(`${tab.title}: tab not found`); continue; }
          const col = await sheets('GET', `/spreadsheets/${CLIENT_SHEET_ID}/values/${q(tab.title)}!A1:${tab.dateCol === 'C' ? 'C' : 'C'}600?valueRenderOption=UNFORMATTED_VALUE&dateTimeRenderOption=SERIAL_NUMBER`);
          const vals: unknown[][] = col.values ?? [];
          const dIdx = tab.dateCol === 'C' ? 2 : 1;
          const rowOf = new Map<number, number>();
          let gt = 0;
          vals.forEach((r, i) => {
            if (typeof r[dIdx] === 'number') rowOf.set(r[dIdx] as number, i + 1);
            if (tab.grandTotal && String(r[2] ?? '').trim().toLowerCase() === 'grand total') gt = i + 1;
          });
          const target = isoToSerial(dates[dates.length - 1]);
          const lastSerial = Math.max(...rowOf.keys());
          if (tab.grandTotal && target > lastSerial) {
            if (!gt) { sheetNotes.push(`${tab.title}: no Grand Total row found, new dates not added`); }
            else {
              const n = target - lastSerial;
              if (!dryRun) {
                await sheets('POST', `/spreadsheets/${CLIENT_SHEET_ID}:batchUpdate`, { requests: [{ insertDimension: { range: { sheetId: sid, dimension: 'ROWS', startIndex: gt - 1, endIndex: gt - 1 + n }, inheritFromBefore: true } }] });
                const newRows = Array.from({ length: n }, (_, k) => {
                  const iso = new Date(Date.UTC(1899, 11, 30) + (lastSerial + k + 1) * 86400000).toISOString().slice(0, 10);
                  return stationRowValues(st, gt + k, rateFor(rates ?? [], iso) ?? 330);
                });
                await sheets('PUT', `/spreadsheets/${CLIENT_SHEET_ID}/values/${q(tab.title)}!A${gt}:M${gt + n - 1}?valueInputOption=USER_ENTERED`, { values: newRows });
                const tot = await sheets('GET', `/spreadsheets/${CLIENT_SHEET_ID}/values/${q(tab.title)}!A${gt + n}:M${gt + n}?valueRenderOption=FORMULA`);
                const fixed = extendTotals((tot.values?.[0] ?? []) as string[], gt - 1, gt + n - 1);
                await sheets('PUT', `/spreadsheets/${CLIENT_SHEET_ID}/values/${q(tab.title)}!A${gt + n}:${String.fromCharCode(64 + fixed.length)}${gt + n}?valueInputOption=USER_ENTERED`, { values: [fixed] });
              }
              for (let k = 0; k < n; k++) rowOf.set(lastSerial + k + 1, gt + k);
              sheetNotes.push(`${tab.title}: added ${n} date row(s) and extended the Grand Total`);
            }
          }
          for (const d of dates) {
            const row = rowOf.get(isoToSerial(d));
            if (!row) { sheetNotes.push(`${tab.title}: no row for ${d}`); continue; }
            const calls = count(st, d, 'call'), qr = count(st, d, 'qr');
            writes.push({ range: `${q(tab.title)}!${tab.calls}${row}:${tab.qr}${row}`, values: [[countCell(calls), countCell(qr)]] });
            const rate = rateFor(rates ?? [], d);
            if (rate !== null) writes.push({ range: `${q(tab.title)}!${tab.rate}${row}`, values: [[rate]] });
            if (st === 'CT20') {
              const { data: roku } = await db.from('roku_daily_metrics').select('spend, impressions').eq('client_id', JACUZZI_CLIENT_ID).eq('entity', 'campaign').eq('date', d);
              if (roku?.length) {
                const spend = Math.round(roku.reduce((s: number, r: any) => s + Number(r.spend ?? 0), 0));
                const imps = roku.reduce((s: number, r: any) => s + Number(r.impressions ?? 0), 0);
                writes.push({ range: `${q(tab.title)}!E${row}`, values: [[imps]] }, { range: `${q(tab.title)}!G${row}`, values: [[spend]] });
                sheetNotes.push(`CT20 ${d}: ${imps.toLocaleString()} impressions, $${spend.toLocaleString()} spend, ${calls} calls, ${qr} QR`);
              } else sheetNotes.push(`CT20 ${d}: ${calls} calls, ${qr} QR — Roku spend/impressions not in yet, left blank`);
            } else if (calls + qr > 0) sheetNotes.push(`${st} ${d}: ${calls} calls, ${qr} QR`);
          }
        }
        if (!dryRun && writes.length) await sheets('POST', `/spreadsheets/${CLIENT_SHEET_ID}/values:batchUpdate`, { valueInputOption: 'USER_ENTERED', data: writes });
      }

      const summary = {
        email: base.subject, file: att.filename, sheet_rows: leads.length, leads_added: fresh.length,
        calls: fresh.filter((l) => l.lead_type === 'call').length, qr: fresh.filter((l) => l.lead_type === 'qr').length,
        revenue: rows.reduce((s, r) => s + Number(r.payout_rate ?? 0), 0), dates, sheet: sheetNotes,
      };
      if (!dryRun) {
        await db.from('jacuzzi_lead_email_log').insert({ ...base, attachment_name: att.filename, sheet_rows: leads.length, leads_added: fresh.length, lead_dates: dates, sheet_updates: { notes: sheetNotes, cells: writes.length } });
        const { data: aj } = await db.from('team_members').select('slack_user_id').eq('email', AJ_EMAIL).maybeSingle();
        if (aj?.slack_user_id) {
          const text = fresh.length
            ? `*Jacuzzi leads synced* from Teresa's email (${dates.join(', ')}): ${fresh.length} new lead(s) — ${summary.calls} calls, ${summary.qr} QR — $${summary.revenue.toLocaleString()}. Hub total now matches the file (${leads.length} rows).\nSheet: ${sheetNotes.join(' · ') || 'no changes'}`
            : `*Jacuzzi lead email* from Teresa had no new leads (all ${leads.length} already in the hub). Sheet unchanged.`;
          await postDirectMessage({ kind: 'send', userId: aj.slack_user_id, text });
        }
      }
      results.push({ id, ...summary });
    }
    return json({ ok: true, dry_run: dryRun, processed: results.length, results });
  } catch (e) {
    const message = e instanceof Error ? e.message : String(e);
    console.error('jacuzzi-lead-email-sync failed:', message);
    if (!dryRun) {
      const { data: aj } = await db.from('team_members').select('slack_user_id').eq('email', AJ_EMAIL).maybeSingle();
      if (aj?.slack_user_id) await postDirectMessage({ kind: 'send', userId: aj.slack_user_id, text: `⚠️ Jacuzzi lead email sync failed: ${message.slice(0, 300)}. Nothing was half-saved to the log; it will retry in 30 minutes.` });
    }
    return json({ ok: false, error: message }, 500);
  }
});
