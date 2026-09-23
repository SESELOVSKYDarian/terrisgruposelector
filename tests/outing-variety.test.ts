import assert from "node:assert/strict";
import test from "node:test";

import { lastOccurrences, prioritizeTerritories, suggestOptions, turnoOf, varietyOf, type SuggestionPoint } from "../src/modules/outings/suggestions";

const esquina = (id: string, territoryIds: string[]): SuggestionPoint => ({ id, name: "", address: `Esquina ${id}`, kind: "ESQUINA", availableDays: [], territoryIds });
const base = { priority: ["t1", "t2", "t3", "t4", "t5"], usedTerritoryIds: new Set<string>() };

test("turno según la hora: mañana < 12, tarde < 18, noche desde las 18; sin hora = desconocido", () => {
  assert.equal(turnoOf("10:30"), "MANANA");
  assert.equal(turnoOf("10:30:00"), "MANANA");
  assert.equal(turnoOf("12:00"), "TARDE");
  assert.equal(turnoOf("17:59"), "TARDE");
  assert.equal(turnoOf("18:00"), "NOCHE");
  assert.equal(turnoOf(""), null);
  assert.equal(turnoOf(null), null);
  assert.equal(turnoOf("a la tarde"), null);
});

test("la última vez de cada territorio es la salida más reciente (fecha y hora)", () => {
  const last = lastOccurrences([
    { territoryId: "t1", date: "2026-09-01", hora: "10:30" },
    { territoryId: "t1", date: "2026-09-10", hora: "18:00" },
    { territoryId: "t1", date: "2026-09-10", hora: "09:00" },
    { territoryId: "t2", date: "2026-09-08", hora: null },
  ]);
  assert.deepEqual(last.get("t1"), { date: "2026-09-10", isoWeekday: 4, turno: "NOCHE" });
  assert.deepEqual(last.get("t2"), { date: "2026-09-08", isoWeekday: 2, turno: null });
});

test("variedad: distinto día = 0, mismo día y otro turno = 1, mismo día y turno = 2", () => {
  const martesManana = { date: "2026-09-08", isoWeekday: 2, turno: "MANANA" as const };
  assert.equal(varietyOf(undefined, 2, "MANANA"), 0);
  assert.equal(varietyOf(martesManana, 4, "MANANA"), 0);
  assert.equal(varietyOf(martesManana, 2, "TARDE"), 1);
  assert.equal(varietyOf(martesManana, 2, "MANANA"), 2);
  assert.equal(varietyOf(martesManana, 2, null), 2);
});

test("si el territorio se hizo el martes a la mañana, para otro martes a la mañana se elige otro", () => {
  const history = lastOccurrences([{ territoryId: "t1", date: "2026-09-08", hora: "10:30" }]);
  const points = [esquina("a", ["t1"]), esquina("b", ["t2"])];
  const martes = suggestOptions({ ...base, points, isoWeekday: 2, slotTurno: "MANANA", history });
  assert.equal(martes[0].point?.id, "b");
  assert.equal(martes.find((option) => option.territoryId === "t1")?.variety, 2);
  const jueves = suggestOptions({ ...base, points, isoWeekday: 4, slotTurno: "MANANA", history });
  assert.equal(jueves[0].territoryId, "t1");
});

test("mismo día pero otro turno solo baja un poco: la necesidad sigue pesando", () => {
  const history = lastOccurrences([{ territoryId: "t1", date: "2026-09-08", hora: "10:30" }]);
  const near = suggestOptions({ ...base, points: [esquina("a", ["t1"]), esquina("b", ["t2"])], isoWeekday: 2, slotTurno: "TARDE", history });
  assert.equal(near[0].territoryId, "t2");
  assert.equal(near.find((option) => option.territoryId === "t1")?.variety, 1);
  const far = suggestOptions({ ...base, usedTerritoryIds: new Set(["x1", "x2", "x3"]), priority: ["t1", "x1", "x2", "x3", "x4", "x5"], points: [esquina("a", ["t1"]), esquina("b", ["x4"])], isoWeekday: 2, slotTurno: "TARDE", history });
  assert.equal(far[0].territoryId, "t1");
});

test("si todo repite igual, igual se sugiere algo: la repetición es preferencia, no prohibición", () => {
  const history = lastOccurrences([{ territoryId: "t1", date: "2026-09-08", hora: "10:30" }]);
  const options = suggestOptions({ ...base, priority: ["t1"], points: [esquina("a", ["t1"])], isoWeekday: 2, slotTurno: "MANANA", history });
  assert.equal(options[0].territoryId, "t1");
  assert.equal(options[0].variety, 2);
});

test("los territorios ya hechos en la vuelta quedan al final aunque tengan una vuelta abierta vieja", () => {
  const order = prioritizeTerritories([
    { id: "hecho-en-vuelta", openSince: "2026-01-01", lastCompleted: "2024-01-01", doneInRound: true },
    { id: "pendiente-reciente", openSince: null, lastCompleted: "2026-08-01", doneInRound: false },
    { id: "pendiente-viejo", openSince: null, lastCompleted: "2025-01-01", doneInRound: false },
  ]);
  assert.deepEqual(order, ["pendiente-viejo", "pendiente-reciente", "hecho-en-vuelta"]);
});
