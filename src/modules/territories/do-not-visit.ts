export type DoNotVisitItem = { id: string; territory_id: string; address: string };

/** Trims and collapses whitespace so "Paso   456 " and "Paso 456" are the same address. */
export function normalizeAddress(address: string) {
  return address.trim().replace(/\s+/g, " ");
}

/** Comparison key: case- and accent-insensitive ("Rivadavía 3102" == "rivadavia 3102"). */
export function addressKey(address: string) {
  return normalizeAddress(address).normalize("NFD").replace(/[̀-ͯ]/g, "").toLowerCase();
}

export function isDuplicateAddress(existing: { address: string }[], candidate: string) {
  const key = addressKey(candidate);
  return existing.some((item) => addressKey(item.address) === key);
}

/** Warnings relevant to one outing: only its territories, ordered by territory number. */
export function warningsForTerritories(items: DoNotVisitItem[], territoryNumbers: ReadonlyMap<string, number | string>, territoryIds: string[]) {
  const wanted = new Set(territoryIds);
  return items
    .filter((item) => wanted.has(item.territory_id))
    .map((item) => ({ ...item, number: territoryNumbers.get(item.territory_id) ?? "?" }))
    .sort((a, b) => Number(a.number) - Number(b.number) || a.address.localeCompare(b.address));
}
