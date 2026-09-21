import assert from "node:assert/strict";
import test from "node:test";

import { formatConductorName } from "../src/modules/territories/names";
import { allLabelsKnown, derivePendingByVisit, labelsStillPending, priorDoneLabels, summarizeRound } from "../src/modules/territories/rounds";

const labels = ["A", "B", "C", "D"];

test("caso 1: Pérez inicia, Navarro continúa y termina: S-13 queda a nombre de Pérez con la fecha final de Navarro", () => {
  const visits = [
    { id: "v1", visit_date: "2026-07-05", conductor_id: "perez", done_labels: ["A", "B"], pending_labels: [] as string[], created_at: "2026-07-05T20:00:00Z" },
    { id: "v2", visit_date: "2026-08-10", conductor_id: "navarro", done_labels: ["C", "D"], pending_labels: [] as string[], created_at: "2026-08-10T20:00:00Z" },
  ];
  const pending = derivePendingByVisit(labels, visits);
  assert.deepEqual(pending, [["C", "D"], []]);
  const summary = summarizeRound(visits.map((visit, index) => ({ ...visit, pending_labels: pending[index] })));
  assert.deepEqual(summary, { conductor_id: "perez", assigned_on: "2026-07-05", completed_on: "2026-08-10", pending_block_labels: [], done_block_labels: ["C", "D"] });
});

test("la vuelta sigue abierta mientras el último informe deje manzanas pendientes", () => {
  const visits = [{ visit_date: "2026-07-05", conductor_id: "perez", done_labels: ["A"], pending_labels: ["B", "C", "D"] }];
  const summary = summarizeRound(visits);
  assert.equal(summary?.completed_on, null);
  assert.deepEqual(summary?.pending_block_labels, ["B", "C", "D"]);
  assert.equal(summarizeRound([]), null);
});

test("el conductor responsable es el del primer informe aunque se cargue desordenado", () => {
  const summary = summarizeRound([
    { visit_date: "2026-08-10", conductor_id: "navarro", done_labels: ["B"], pending_labels: [] },
    { visit_date: "2026-07-05", conductor_id: "perez", done_labels: ["A"], pending_labels: ["B"] },
  ]);
  assert.equal(summary?.conductor_id, "perez");
  assert.equal(summary?.assigned_on, "2026-07-05");
  assert.equal(summary?.completed_on, "2026-08-10");
});

test("corregir un informe anterior recalcula lo pendiente de toda la cadena", () => {
  // Pérez corrige: en realidad también hizo la manzana C el primer día.
  const corrected = derivePendingByVisit(labels, [{ done_labels: ["A", "B", "C"] }, { done_labels: ["D"] }]);
  assert.deepEqual(corrected, [["D"], []]);
});

test("lo que puede tildar el conductor excluye lo ya hecho en informes anteriores de la vuelta abierta", () => {
  const visits = [
    { id: "v1", visit_date: "2026-07-05", conductor_id: "perez", done_labels: ["A"], pending_labels: [], created_at: "1" },
    { id: "v2", visit_date: "2026-07-12", conductor_id: "navarro", done_labels: ["B"], pending_labels: [], created_at: "2" },
  ];
  assert.deepEqual(priorDoneLabels(visits), ["A", "B"]);
  assert.deepEqual(priorDoneLabels(visits, "v2"), ["A"]);
  assert.deepEqual(priorDoneLabels(visits, "v1"), []);
  assert.deepEqual(labelsStillPending(labels, [{ done_labels: ["A", "B"] }]), ["C", "D"]);
});

test("las manzanas informadas deben pertenecer al territorio", () => {
  assert.equal(allLabelsKnown(["A", "B"], labels), true);
  assert.equal(allLabelsKnown(["A", "Z"], labels), false);
});

test("el nombre del S-13 es apellido + inicial", () => {
  assert.equal(formatConductorName("Juan Pérez"), "Pérez J.");
  assert.equal(formatConductorName("juan carlos Pérez"), "Pérez J.");
  assert.equal(formatConductorName("Pérez, Juan"), "Pérez J.");
  assert.equal(formatConductorName("  Walter   Navarro "), "Navarro W.");
  assert.equal(formatConductorName("Madonna"), "Madonna");
  assert.equal(formatConductorName(null), "");
});
