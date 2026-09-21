import assert from "node:assert/strict";
import test from "node:test";

import { applyDiff, autoLayout, gridSize, labelKey, nextFreeCell, normalizeLabel, validateUnits, type Unit } from "../src/modules/buildings/structure";

const grid = (labels: string[]): Unit[] => autoLayout(labels, 2).map((unit, index) => ({ ...unit, id: `u${index}` }));

test("los identificadores son texto libre, no un patrón numérico", () => {
  for (const labels of [["A1", "A2", "B1", "B2"], ["1", "2", "3", "4"], ["PB-A", "PB-B", "1°A", "1°B"]]) {
    const result = validateUnits(autoLayout(labels, 2));
    assert.ok(result.ok, labels.join());
  }
  assert.equal(normalizeLabel("  1°   A "), "1° A");
  assert.equal(labelKey(" pb-A "), "pb-a");
});

test("la grilla se arma por filas: [A1][A2] / [B1][B2] / [C1][C2]", () => {
  const units = autoLayout(["A1", "A2", "B1", "B2", "C1", "C2"], 2);
  assert.deepEqual(units.map((unit) => [unit.label, unit.row, unit.col]), [["A1", 0, 0], ["A2", 0, 1], ["B1", 1, 0], ["B2", 1, 1], ["C1", 2, 0], ["C2", 2, 1]]);
  assert.deepEqual(gridSize(units), { rows: 3, cols: 2 });
});

test("no se aceptan nombres repetidos (ignorando mayúsculas) ni celdas ocupadas dos veces", () => {
  assert.equal(validateUnits([{ id: null, label: "A1", row: 0, col: 0 }, { id: null, label: "a1", row: 0, col: 1 }]).ok, false);
  assert.equal(validateUnits([{ id: null, label: "A1", row: 0, col: 0 }, { id: null, label: "A2", row: 0, col: 0 }]).ok, false);
  assert.equal(validateUnits([{ id: null, label: "", row: 0, col: 0 }]).ok, false);
  assert.equal(validateUnits([{ id: null, label: "x".repeat(21), row: 0, col: 0 }]).ok, false);
  assert.equal(validateUnits([{ id: null, label: "A1", row: -1, col: 0 }]).ok, false);
});

test("caso 6: ADD A3 se aplica sin tocar el resto ni perder la identidad de los timbres existentes", () => {
  const before = grid(["A1", "A2", "B1", "B2"]);
  const result = applyDiff(before, [{ op: "ADD", label: "A3" }]);
  assert.ok(result.ok);
  if (!result.ok) return;
  assert.equal(result.units.length, 5);
  // Los existentes conservan su id (la actividad histórica los sigue).
  assert.deepEqual(result.units.filter((unit) => unit.id).map((unit) => unit.id).sort(), ["u0", "u1", "u2", "u3"]);
  assert.equal(result.units.find((unit) => unit.label === "A3")?.id, null);
});

test("REMOVE, RENAME y MOVE operan por nombre y conservan el id al renombrar", () => {
  const before = grid(["A1", "A2", "B1"]);
  const renamed = applyDiff(before, [{ op: "RENAME", from: "b1", to: "B1-bis" }, { op: "REMOVE", label: "A2" }, { op: "MOVE", label: "A1", row: 5, col: 1 }]);
  assert.ok(renamed.ok);
  if (!renamed.ok) return;
  assert.deepEqual(renamed.units.map((unit) => unit.label).sort(), ["A1", "B1-bis"]);
  assert.equal(renamed.units.find((unit) => unit.label === "B1-bis")?.id, "u2");
  assert.deepEqual(renamed.units.find((unit) => unit.label === "A1") && [renamed.units.find((unit) => unit.label === "A1")!.row, renamed.units.find((unit) => unit.label === "A1")!.col], [5, 1]);
});

test("una corrección inválida se rechaza completa (todo o nada)", () => {
  const before = grid(["A1", "A2"]);
  assert.equal(applyDiff(before, [{ op: "ADD", label: "A3" }, { op: "REMOVE", label: "Z9" }]).ok, false);
  assert.equal(applyDiff(before, [{ op: "ADD", label: "a1" }]).ok, false);
  assert.equal(applyDiff(before, [{ op: "RENAME", from: "A1", to: "A2" }]).ok, false);
  assert.equal(applyDiff(before, [{ op: "MOVE", label: "A1", row: 0, col: 1 }]).ok, false);
  // El original no se modifica.
  assert.deepEqual(before.map((unit) => unit.label), ["A1", "A2"]);
});

test("un timbre nuevo sin posición ocupa la primera celda libre", () => {
  const units = grid(["A1", "A2", "B1"]);
  assert.deepEqual(nextFreeCell(units), { row: 1, col: 1 });
  assert.deepEqual(nextFreeCell([]), { row: 0, col: 0 });
});
