// READ-ONLY SQL FALLBACK — for questions no canonical metric covers.
//
// Enforcement is in the database (public.bot_readonly_select): the statement runs
// as the `bot_readonly` identity, which holds SELECT and nothing else and has no
// privilege at all on slack_tokens, platform_connections, invite/onboarding token
// tables, or the auth / vault / storage schemas. On top of that the function
// rejects anything that is not a single SELECT (or WITH … SELECT), rejects
// comments, rejects every write or session keyword, rejects any text touching a
// blocked schema/table or a column named like a token, secret or password,
// applies a 5-second statement timeout and caps the returned rows.
//
// The client-side checks below are a fast, legible first pass only. The database
// is the boundary.

export const SQL_BLOCKED_PATTERNS: RegExp[] = [
  /\bauth\./i, /\bvault\./i, /\bstorage\./i, /\brealtime\./i, /\bsupabase_functions\./i,
  /pg_catalog|pg_roles|pg_authid|pg_shadow|information_schema|pgsodium/i,
  /slack_tokens|platform_connections|cron_invocation_tokens|onboarding_tokens|email_unsubscribe_tokens|client_invites|team_invites/i,
  /token|secret|password|decrypted/i,
];

/** Call tables shared by two accounts. */
export const SHARED_CALL_TABLES = /\b(ringfuel_calls|cannaball_calls)\b/i;

const WRITE_KEYWORDS = /\b(insert|update|delete|drop|alter|create|grant|revoke|truncate|copy|merge|call|do|vacuum|reindex|cluster|comment|listen|notify|lock|prepare|execute|set|reset|import)\b/i;

export interface SqlResult {
  ok: boolean;
  sql: string;
  rows: unknown[];
  error?: string;
}

export function screenSql(sqlRaw: string): { ok: true; sql: string } | { ok: false; error: string } {
  const sql = (sqlRaw || '').trim().replace(/;\s*$/, '').trim();
  if (!sql) return { ok: false, error: 'empty query' };
  if (sql.includes(';')) return { ok: false, error: 'only a single statement is allowed' };
  if (!/^(with|select)\s/i.test(sql)) return { ok: false, error: 'only SELECT is allowed' };
  if (/(--|\/\*)/.test(sql)) return { ok: false, error: 'comments are not allowed' };
  if (WRITE_KEYWORDS.test(sql)) return { ok: false, error: 'the query contains a forbidden keyword' };
  for (const p of SQL_BLOCKED_PATTERNS) {
    if (p.test(sql)) return { ok: false, error: `the query touches blocked data (${p.source})` };
  }
  // ringfuel_calls holds Spektrafin AND Jacuzzi; cannaball_calls holds Cannaball
  // AND PPC Media. An aggregate over either without a client filter mixes two
  // accounts — it has already produced a wrong conclusion here once.
  if (SHARED_CALL_TABLES.test(sql) && !/\bclient_id\b/i.test(sql)) {
    return { ok: false, error: 'ringfuel_calls and cannaball_calls hold more than one account — filter on client_id' };
  }
  return { ok: true, sql };
}

export async function runReadOnlySql(supabase: any, sqlRaw: string, rowLimit = 200): Promise<SqlResult> {
  const screened = screenSql(sqlRaw);
  if (!screened.ok) return { ok: false, sql: sqlRaw, rows: [], error: (screened as { ok: false; error: string }).error };
  const { data, error } = await supabase.rpc('bot_readonly_select', {
    p_sql: screened.sql,
    p_row_limit: rowLimit,
  });
  if (error) return { ok: false, sql: screened.sql, rows: [], error: error.message };
  return { ok: true, sql: screened.sql, rows: Array.isArray(data) ? data : [] };
}
