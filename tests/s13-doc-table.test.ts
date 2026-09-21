import assert from "node:assert/strict";
import test from "node:test";

import { readS13Table, type DocsBodyContent, type DocsCell } from "../src/modules/s13/doc-table";
import { buildReplaceRequests, groupChangesByPage, pagesNeedingCopy } from "../src/modules/s13/sync";

/** Builds Docs-API-shaped cells with increasing indexes, like documents.get returns them. */
function makeDocument(territories: Record<number, Record<string, string>>, shape: "compact" | "full"): DocsBodyContent {
  let index = 10;
  const cell = (text: string, rowSpan = 1, columnSpan = 1): DocsCell => {
    const start = index;
    index += text.length + 1;
    return { content: [{ startIndex: start, endIndex: index, paragraph: { elements: [{ textRun: { content: `${text}\n` } }] } }], tableCellStyle: { rowSpan, columnSpan } };
  };
  const covered = (): DocsCell => cell("", 0, 0);
  // Headers exactly like the real S-13: "Núm. de terr." and "Última fecha" span two rows, "Asignado a" spans two columns.
  const rows: { tableCells: DocsCell[] }[] = [];
  // "full" lists the positions swallowed by a merge too; "compact" (what the export shows) omits them.
  const wide = (text: string) => (shape === "full" ? [cell(text, 1, 2), covered()] : [cell(text, 1, 2)]);
  rows.push({ tableCells: [cell("Núm. de terr.", 2), cell("Última fecha en que se completó", 2), ...[0, 1, 2, 3].flatMap(() => wide("Asignado a"))] });
  rows.push({ tableCells: [...(shape === "full" ? [covered(), covered()] : []), ...[0, 1, 2, 3].flatMap(() => [cell("Fecha en que se asignó"), cell("Fecha en que se completó")])] });
  for (const [number, values] of Object.entries(territories)) {
    rows.push({ tableCells: [cell(number, 2), cell(values.last ?? "", 2), ...[0, 1, 2, 3].flatMap((slot) => wide(values[`who${slot}`] ?? ""))] });
    rows.push({ tableCells: [...(shape === "full" ? [covered(), covered()] : []), ...[0, 1, 2, 3].flatMap((slot) => [cell(values[`from${slot}`] ?? ""), cell(values[`to${slot}`] ?? "")])] });
  }
  return [{ table: { rows: rows.length, columns: 10, tableRows: rows } }];
}

const data = { 3: { last: "1-6-26", who0: "Guarna G.", from0: "8-9-26" }, 4: {} };

for (const shape of ["compact", "full"] as const) {
  test(`lee la tabla del S-13 (${shape}): conductor, fechas y última fecha por territorio`, () => {
    const read = readS13Table(makeDocument(data, shape), 1);
    assert.deepEqual(read.territories, [3, 4]);
    assert.equal(read.cells["p1/t3/last"], "1-6-26");
    assert.equal(read.cells["p1/t3/s0/who"], "Guarna G.");
    assert.equal(read.cells["p1/t3/s0/from"], "8-9-26");
    assert.equal(read.cells["p1/t3/s0/to"], undefined);
    // Las celdas vacías también se pueden escribir.
    assert.ok(read.ranges.has("p1/t4/s3/who"));
    assert.ok(read.ranges.has("p1/t4/s3/to"));
  });
}

test("las celdas de fecha de la fila inferior no se confunden con las combinadas de arriba", () => {
  const read = readS13Table(makeDocument({ 21: { who1: "Petroff G.", from1: "5-7-26", to1: "6-7-26" } }, "compact"), 2);
  assert.equal(read.cells["p2/t21/s1/who"], "Petroff G.");
  assert.equal(read.cells["p2/t21/s1/from"], "5-7-26");
  assert.equal(read.cells["p2/t21/s1/to"], "6-7-26");
  assert.equal(read.cells["p2/t21/s0/from"], undefined);
});

test("los rangos leídos generan los pedidos de escritura de Docs sin pisar el salto de línea de la celda", () => {
  const read = readS13Table(makeDocument({ 3: { who0: "Guarna G." } }, "compact"), 1);
  const filled = read.ranges.get("p1/t3/s0/who")!;
  const empty = read.ranges.get("p1/t3/s1/who")!;
  const requests = buildReplaceRequests([
    { range: filled, text: "" },
    { range: empty, text: "Otro N." },
  ]);
  // De atrás hacia adelante: primero la celda de más abajo en el documento.
  assert.deepEqual(requests, [
    { insertText: { location: { index: empty.startIndex }, text: "Otro N." } },
    { deleteContentRange: { range: { startIndex: filled.startIndex, endIndex: filled.endIndex - 1 } } },
  ]);
});

test("sin tabla en el documento no hay celdas ni territorios", () => {
  assert.deepEqual(readS13Table([], 1).territories, []);
});

test("las hojas nuevas se piden en orden y solo las que faltan", () => {
  assert.deepEqual(pagesNeedingCopy(1, []), []);
  assert.deepEqual(pagesNeedingCopy(3, [2]), [3]);
  assert.deepEqual(pagesNeedingCopy(3, []), [2, 3]);
});

test("los cambios se reparten por hoja", () => {
  const grouped = groupChangesByPage([
    { key: "p1/t3/last", operation: "SET", value: "1-1-26" },
    { key: "p2/t3/s0/who", operation: "SET", value: "A B." },
    { key: "p2/t4/last", operation: "CLEAR", value: null },
  ]);
  assert.deepEqual([...grouped.keys()], [1, 2]);
  assert.equal(grouped.get(2)?.length, 2);
});
