// Pure helpers for the Jacuzzi lead-email workflow (jacuzzi-lead-email-sync):
// turning rows of the client's TM sheet into lead records, and the Google Sheet
// row math for the CT20 / CT26 / CT13 tabs. No I/O here — tests import it.

export const JACUZZI_CLIENT_ID = 'dc25f274-20f4-4650-b0cc-654073b925f4';
export const TERESA = 'tmancusi@cannellamedia.com';
export const CLIENT_SHEET_ID = '1SQANpBgsf7FutpwE7bShb9FuYkNI5lSD96qQqtmHcQ0';

export interface LeadRecord {
  transaction_id: string;
  transaction_date: string;
  transaction_time: string | null;
  lead_type: 'call' | 'qr';
  station_code: string | null;
  attributed_station: string | null;
  toll_free_number: string | null;
  caller_ani: string | null;
  area_code: string | null;
  billing_city: string | null;
  billing_state: string | null;
  billing_zip: string | null;
  call_status: string | null;
}

const EXCEL_EPOCH = Date.UTC(1899, 11, 30);
export const serialToIso = (serial: number) => new Date(EXCEL_EPOCH + Math.round(serial) * 86400000).toISOString().slice(0, 10);
export const isoToSerial = (iso: string) => Math.round((Date.parse(`${iso}T00:00:00Z`) - EXCEL_EPOCH) / 86400000);

function cellText(v: unknown): string | null {
  if (v === null || v === undefined) return null;
  if (typeof v === 'number') return Number.isInteger(v) ? String(v) : String(v);
  const s = String(v).trim();
  return s ? s : null;
}

function dateOf(v: unknown): string | null {
  if (typeof v === 'number' && v > 20000) return serialToIso(v);
  if (v instanceof Date && !isNaN(v.getTime())) return v.toISOString().slice(0, 10);
  const s = cellText(v);
  if (!s) return null;
  if (/^\d{4}-\d{2}-\d{2}/.test(s)) return s.slice(0, 10);
  const m = s.match(/^(\d{1,2})\/(\d{1,2})\/(\d{2,4})/);
  if (m) return `${m[3].length === 2 ? `20${m[3]}` : m[3]}-${m[1].padStart(2, '0')}-${m[2].padStart(2, '0')}`;
  return null;
}

function timeOf(v: unknown): string | null {
  if (typeof v === 'number' && v >= 0 && v < 1) {
    const secs = Math.round(v * 86400);
    const p = (n: number) => String(n).padStart(2, '0');
    return `${p(Math.floor(secs / 3600))}:${p(Math.floor((secs % 3600) / 60))}:${p(secs % 60)}`;
  }
  const s = cellText(v);
  const m = s?.match(/(\d{1,2}):(\d{2})(?::(\d{2}))?/);
  return m ? `${m[1].padStart(2, '0')}:${m[2]}:${m[3] ?? '00'}` : null;
}

/** Rows as produced by sheet_to_json (header row → keys). Rows without an id or date are skipped. */
export function parseLeadRows(rows: Record<string, unknown>[]): LeadRecord[] {
  const out: LeadRecord[] = [];
  const seen = new Set<string>();
  for (const r of rows) {
    const id = cellText(r['Transaction ID']);
    const date = dateOf(r['Transaction Date']);
    if (!id || !date || seen.has(id)) continue;
    seen.add(id);
    const station = cellText(r['Station Code'])?.toUpperCase() ?? null;
    out.push({
      transaction_id: id.replace(/\.0$/, ''),
      transaction_date: date,
      transaction_time: timeOf(r['Transaction Time']),
      lead_type: String(r['Record Detail'] ?? '').trim().toUpperCase() === 'QR' ? 'qr' : 'call',
      station_code: station,
      attributed_station: station,
      toll_free_number: cellText(r['Toll Free Number']),
      caller_ani: cellText(r['Caller ANI']),
      area_code: cellText(r['Area Code']),
      billing_city: cellText(r['Billing City']),
      billing_state: cellText(r['Billing State']),
      billing_zip: cellText(r['Billing Zip Code']),
      call_status: cellText(r['Calls Status']),
    });
  }
  return out;
}

/** Payout in effect on a date, from jacuzzi_payout_rates rows. */
export function rateFor(rates: { effective_from: string; rate: number }[], date: string): number | null {
  let hit: number | null = null;
  for (const r of [...rates].sort((a, b) => a.effective_from.localeCompare(b.effective_from))) if (date >= r.effective_from) hit = Number(r.rate);
  return hit;
}

/** Tabs the workflow writes. dateCol holds the date; Grand Total label sits in labelCol on station tabs. */
export const TABS = {
  CT20: { title: 'CT20 Daily (ON)', dateCol: 'C', calls: 'H', qr: 'I', rate: 'N', imps: 'E', spend: 'G', grandTotal: false },
  CT26: { title: 'CT26(DRAG)', dateCol: 'B', calls: 'G', qr: 'H', rate: 'M', grandTotal: true },
  CT13: { title: 'CT13 (OFF)', dateCol: 'B', calls: 'G', qr: 'H', rate: 'M', grandTotal: true },
} as const;
export type Station = keyof typeof TABS;

/** One new station-tab date row, same formulas as the rows above it. */
export function stationRowValues(station: Station, row: number, rate: number): (string | number)[] {
  return [station, `=B${row - 1}+1`, `=text(B${row},"ddd")`, 0, `=iferror(F${row}/D${row}*1000,0)`, 0, '-', '-',
    `=sum(G${row}:H${row})`, `=I${row}*M${row}`, `=IFERROR((J${row}-F${row})/J${row},0)`, `=J${row}-F${row}`, rate];
}

/** Grand-total formulas after rows were inserted: every `X2:Xn` range ending on the old last row now ends on the new one. */
export function extendTotals(formulas: string[], oldLast: number, newLast: number): string[] {
  const re = new RegExp(`([A-Z]+)2:([A-Z]+)${oldLast}(?!\\d)`, 'g');
  return formulas.map((f) => (typeof f === 'string' ? f.replace(re, `$12:$2${newLast}`) : f));
}

/** Count cell: the sheet writes "-" for zero. */
export const countCell = (n: number) => (n > 0 ? n : '-');
