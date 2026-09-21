import assert from "node:assert/strict";
import test from "node:test";

import { buildS13Pages } from "../src/modules/s13/layout";
import { buildReplaceRequests, cellCoordinates, cellKey, decideWrite, diffCells, pagesToCells, parseCellKey, reconcile } from "../src/modules/s13/sync";

const pages = buildS13Pages([
  { number: 24, rounds: [{ id: "r1", assigned_on: "2026-07-05", completed_on: "2026-07-05", conductor_name: "Petroff G." }, { id: "r2", assigned_on: "2026-08-10", completed_on: "2026-08-10", conductor_name: "Navarro W." }] },
  { number: 25, rounds: [] },
]);

test("el S-13 se convierte en celdas lógicas: conductor, fecha asignada y completada por ronda", () => {
  const cells = pagesToCells(pages);
  assert.equal(cells[cellKey(1, 24, { slot: 0, field: "who" })], "Petroff G.");
  assert.equal(cells[cellKey(1, 24, { slot: 0, field: "from" })], "5-7-26");
  assert.equal(cells[cellKey(1, 24, { slot: 0, field: "to" })], "5-7-26");
  assert.equal(cells[cellKey(1, 24, { slot: 1, field: "who" })], "Navarro W.");
  assert.equal(cells[cellKey(1, 24, { slot: 1, field: "to" })], "10-8-26");
  // Lo vacío no genera celdas.
  assert.equal(Object.keys(cells).some((key) => key.startsWith("p1/t25/")), false);
});

test("solo se envían las diferencias respecto de lo último escrito en el Doc", () => {
  const cells = pagesToCells(pages);
  assert.deepEqual(diffCells(cells, cells), { changes: [], unchanged: Object.keys(cells).length });
  const snapshot = { ...cells };
  delete snapshot[cellKey(1, 24, { slot: 1, field: "to" })];
  snapshot[cellKey(1, 24, { slot: 0, field: "who" })] = "Otro N.";
  snapshot["p1/t30/last"] = "1-1-20";
  const { changes } = diffCells(cells, snapshot);
  assert.deepEqual(changes.map((change) => `${change.operation} ${change.key}`), ["SET p1/t24/s0/who", "SET p1/t24/s1/to", "CLEAR p1/t30/last"]);
});

test("las claves se parsean y se mapean a filas/columnas según el layout de dos filas por territorio", () => {
  assert.deepEqual(parseCellKey("p2/t24/s3/from"), { page: 2, territory: 24, slot: 3, field: "from" });
  assert.equal(parseCellKey("cualquier/cosa"), null);
  // Territorio 1 del documento 1-20: primera fila tras el encabezado (2 filas).
  assert.deepEqual(cellCoordinates("p1/t1/last", 1), { page: 1, row: 2, column: 1 });
  assert.deepEqual(cellCoordinates("p1/t1/s0/who", 1), { page: 1, row: 2, column: 2 });
  assert.deepEqual(cellCoordinates("p1/t1/s0/from", 1), { page: 1, row: 3, column: 0 });
  assert.deepEqual(cellCoordinates("p1/t1/s0/to", 1), { page: 1, row: 3, column: 1 });
  // El territorio 24 en el documento 21-36 es el cuarto: dos filas por territorio.
  assert.deepEqual(cellCoordinates("p1/t24/s1/who", 21), { page: 1, row: 8, column: 3 });
  assert.equal(cellCoordinates("p1/t10/last", 21), null);
});

test("los pedidos de Google Docs se emiten de atrás hacia adelante y conservan el salto de línea de la celda", () => {
  const requests = buildReplaceRequests([
    { range: { startIndex: 10, endIndex: 14 }, text: "Pérez J." },
    { range: { startIndex: 40, endIndex: 41 }, text: "5-7-26" }, // celda vacía: solo insertar
    { range: { startIndex: 25, endIndex: 30 }, text: "" }, // limpiar: solo borrar
  ]);
  assert.deepEqual(requests, [
    { insertText: { location: { index: 40 }, text: "5-7-26" } },
    { deleteContentRange: { range: { startIndex: 25, endIndex: 29 } } },
    { deleteContentRange: { range: { startIndex: 10, endIndex: 13 } } },
    { insertText: { location: { index: 10 }, text: "Pérez J." } },
  ]);
});

test("nunca se escribe en un Doc real sin modo, credenciales, habilitación y staging verificado", () => {
  const base = { stagingDocumentId: "stg", externalDocumentId: "prod", stagingVerifiedAt: null as string | null, credentialsConfigured: true, writesEnabled: true };
  assert.deepEqual(decideWrite({ ...base, mode: "DRY_RUN", credentialsConfigured: false, writesEnabled: false }), { allowed: true, target: "NONE", documentId: null });
  assert.equal(decideWrite({ ...base, mode: "STAGING", credentialsConfigured: false }).allowed, false);
  assert.equal(decideWrite({ ...base, mode: "STAGING", writesEnabled: false }).allowed, false);
  assert.equal(decideWrite({ ...base, mode: "STAGING", stagingDocumentId: null }).allowed, false);
  assert.deepEqual(decideWrite({ ...base, mode: "STAGING" }), { allowed: true, target: "STAGING", documentId: "stg" });
  // Producción exige haber verificado la copia de prueba y tener el ID real.
  assert.equal(decideWrite({ ...base, mode: "PRODUCTION" }).allowed, false);
  assert.equal(decideWrite({ ...base, mode: "PRODUCTION", stagingVerifiedAt: "2026-09-01T00:00:00Z", externalDocumentId: null }).allowed, false);
  assert.deepEqual(decideWrite({ ...base, mode: "PRODUCTION", stagingVerifiedAt: "2026-09-01T00:00:00Z" }), { allowed: true, target: "PRODUCTION", documentId: "prod" });
});

test("la reconciliación lista lo que difiere entre la base y el Doc; la base siempre manda", () => {
  const mismatches = reconcile({ "p1/t1/last": "1-1-26", "p1/t2/last": "2-2-26" }, { "p1/t1/last": "1-1-26", "p1/t2/last": "9-9-99", "p1/t3/last": "3-3-26" });
  assert.deepEqual(mismatches, [{ key: "p1/t2/last", database: "2-2-26", document: "9-9-99" }, { key: "p1/t3/last", database: null, document: "3-3-26" }]);
});

import { extractGoogleDocId } from "../src/modules/s13/sync";

test("el ID del Google Doc se extrae de la URL o se acepta tal cual, y todo lo demás se rechaza", () => {
  const id = "1AbCdEfGhIjKlMnOpQrStUvWxYz0123456789_-abc";
  assert.equal(extractGoogleDocId(`https://docs.google.com/document/d/${id}/edit?usp=sharing`), id);
  assert.equal(extractGoogleDocId(`https://docs.google.com/document/u/0/d/${id}/edit`), id);
  assert.equal(extractGoogleDocId(id), id);
  assert.equal(extractGoogleDocId("https://evil.example.com/document/d/" + id), null);
  assert.equal(extractGoogleDocId("corto"), null);
  assert.equal(extractGoogleDocId(""), null);
});
