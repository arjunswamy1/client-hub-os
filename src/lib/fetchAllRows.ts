/**
 * The data API caps any single response at 1000 rows, whatever `.limit()` says.
 * A dashboard total built from one response silently under-reports once an account
 * passes 1000 rows. Every full-history query must page instead.
 */
export const PAGE_SIZE = 1000;

export async function fetchAllRows<T>(
  page: (offset: number, size: number) => Promise<{ data: unknown[] | null; error: { message: string } | null }>,
  maxRows = 100_000,
): Promise<T[]> {
  const rows: T[] = [];
  for (let offset = 0; offset < maxRows; offset += PAGE_SIZE) {
    const { data, error } = await page(offset, PAGE_SIZE);
    if (error) throw error;
    const batch = (data || []) as T[];
    rows.push(...batch);
    if (batch.length < PAGE_SIZE) break;
  }
  return rows;
}
