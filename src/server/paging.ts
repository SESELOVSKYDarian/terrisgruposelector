import "server-only";

/** PostgREST caps a response at 1000 rows: reads of history tables must page through them. `page` needs a stable order. */
export async function fetchAll<T>(page: (from: number, to: number) => PromiseLike<{ data: T[] | null; error: { message: string } | null }>) {
  const rows: T[] = [];
  for (let from = 0; ; from += 1000) {
    const { data, error } = await page(from, from + 999);
    if (error) return { data: null, error };
    rows.push(...(data ?? []));
    if ((data?.length ?? 0) < 1000) return { data: rows, error: null };
  }
}
