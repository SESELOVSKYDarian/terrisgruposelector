import { S13_SLOTS_PER_PAGE } from "./layout";
import { cellKey, type CellMap, type DocCellRange } from "./sync";

/** The slice of a Google Docs `documents.get` response that the S-13 needs (Docs API v1). */
export type DocsCell = {
  content?: { startIndex?: number; endIndex?: number; paragraph?: { elements?: { textRun?: { content?: string } }[] } }[];
  tableCellStyle?: { rowSpan?: number; columnSpan?: number };
};
export type DocsTable = { rows?: number; columns?: number; tableRows?: { tableCells?: DocsCell[] }[] };
export type DocsBodyContent = { table?: DocsTable }[];

/** Rows above the first territory: "Núm. de terr. / Última fecha / Asignado a" + "Fecha asignó / Fecha completó". */
const HEADER_ROWS = 2;

function normalize(text: string) {
  return text.normalize("NFD").replace(/[̀-ͯ]/g, "").toLowerCase();
}

export function cellText(cell: DocsCell) {
  const raw = (cell.content ?? []).flatMap((block) => block.paragraph?.elements ?? []).map((element) => element.textRun?.content ?? "").join("");
  return raw.replace(/\n+$/, "").trim();
}

export function cellRange(cell: DocsCell): DocCellRange | null {
  const content = cell.content ?? [];
  const start = content[0]?.startIndex;
  const end = content[content.length - 1]?.endIndex;
  return start === undefined || end === undefined ? null : { startIndex: start, endIndex: end };
}

/** The territory table is the one whose first header cell reads "Núm. de terr."; otherwise the biggest one. */
export function findS13Table(body: DocsBodyContent): DocsTable | null {
  const tables = body.map((element) => element.table).filter((table): table is DocsTable => Boolean(table?.tableRows?.length));
  const byHeader = tables.find((table) => {
    const first = table.tableRows?.[0]?.tableCells?.[0];
    return first ? normalize(cellText(first)).startsWith("num") : false;
  });
  return byHeader ?? [...tables].sort((a, b) => (b.tableRows?.length ?? 0) - (a.tableRows?.length ?? 0))[0] ?? null;
}

/**
 * Places every cell at its logical (row, column) in the grid. Merged tables come in two shapes and both
 * are handled: "compact" (rows only list the cells that start there, so a row under a row-span is
 * shorter) and "full" (every row lists every grid position).
 */
export function buildGrid(table: DocsTable): Map<string, DocsCell> {
  const rows = table.tableRows ?? [];
  const width = table.columns ?? Math.max(0, ...rows.map((row) => (row.tableCells ?? []).reduce((sum, cell) => sum + (cell.tableCellStyle?.columnSpan ?? 1), 0)));
  const grid = new Map<string, DocsCell>();
  const occupied = new Set<string>();
  rows.forEach((row, r) => {
    const cells = row.tableCells ?? [];
    if (width && cells.length === width) {
      cells.forEach((cell, c) => grid.set(`${r},${c}`, cell));
      return;
    }
    let c = 0;
    for (const cell of cells) {
      while (occupied.has(`${r},${c}`)) c += 1;
      grid.set(`${r},${c}`, cell);
      const rowSpan = Math.max(1, cell.tableCellStyle?.rowSpan ?? 1);
      const colSpan = Math.max(1, cell.tableCellStyle?.columnSpan ?? 1);
      for (let dr = 0; dr < rowSpan; dr += 1) for (let dc = 0; dc < colSpan; dc += 1) occupied.add(`${r + dr},${c + dc}`);
      c += colSpan;
    }
  });
  return grid;
}

export type S13DocRead = {
  /** Non-empty managed cells, keyed like the logical cells (`p<page>/t<n>/…`). */
  cells: CellMap;
  /** Text range of EVERY managed cell (empty ones too), so any of them can be written. */
  ranges: Map<string, DocCellRange>;
  territories: number[];
};

/**
 * Reads the S-13 table of one page: territories are found by the number written in the first column
 * (not by arithmetic), and each one owns two rows — names on top, assigned/completed dates below.
 */
export function readS13Table(body: DocsBodyContent, page: number): S13DocRead {
  const table = findS13Table(body);
  const result: S13DocRead = { cells: {}, ranges: new Map(), territories: [] };
  if (!table) return result;
  const grid = buildGrid(table);
  const total = table.tableRows?.length ?? 0;
  const register = (key: string, row: number, column: number) => {
    const cell = grid.get(`${row},${column}`);
    const range = cell ? cellRange(cell) : null;
    if (!cell || !range) return;
    result.ranges.set(key, range);
    const text = cellText(cell);
    if (text) result.cells[key] = text;
  };
  for (let row = HEADER_ROWS; row < total; row += 1) {
    const number = grid.get(`${row},0`);
    const text = number ? cellText(number) : "";
    if (!/^\d+$/.test(text)) continue;
    const territory = Number(text);
    result.territories.push(territory);
    register(cellKey(page, territory, "last"), row, 1);
    for (let slot = 0; slot < S13_SLOTS_PER_PAGE; slot += 1) {
      register(cellKey(page, territory, { slot, field: "who" }), row, 2 + slot * 2);
      register(cellKey(page, territory, { slot, field: "from" }), row + 1, 2 + slot * 2);
      register(cellKey(page, territory, { slot, field: "to" }), row + 1, 3 + slot * 2);
    }
  }
  return result;
}

/** Every logical key that has content in the document: used to blank a freshly copied page. */
export function clearAllChanges(read: S13DocRead) {
  return Object.keys(read.cells).map((key) => ({ key, operation: "CLEAR" as const, value: null }));
}
