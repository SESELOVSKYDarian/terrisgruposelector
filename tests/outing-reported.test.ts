import assert from "node:assert/strict";
import test from "node:test";

import { lastOccurrences } from "../src/modules/outings/suggestions";
import { reportedOutingsFromVisits, type VisitRow } from "../src/modules/outings/reported";

const visit = (overrides: Partial<VisitRow> = {}): VisitRow => ({
  slot_id: "s1",
  outing_report_id: "r1",
  done_labels: ["A"],
  territory_rounds: { territory_id: "t1" },
  weekly_outing_slots: { slot_date: "2026-09-08", hora: "10:30:00" },
  ...overrides,
});

test("una visita informada de una salida cuenta con el día y la hora de ESA salida", () => {
  const [entry] = reportedOutingsFromVisits([visit()]);
  assert.deepEqual(entry, { territoryId: "t1", date: "2026-09-08", hora: "10:30:00", slotId: "s1" });
});

test("un informe sin manzanas hechas no cuenta como hecho", () => {
  assert.deepEqual(reportedOutingsFromVisits([visit({ done_labels: [] }), visit({ done_labels: null })]), []);
});

test("las visitas que no cuelgan de un informe de una salida no cuentan (ni las planificadas sin informar, que ni existen como visita)", () => {
  assert.deepEqual(reportedOutingsFromVisits([visit({ slot_id: null }), visit({ outing_report_id: null })]), []);
  assert.deepEqual(reportedOutingsFromVisits([visit({ weekly_outing_slots: null })]), []);
});

test("un territorio agregado durante la salida (no planificado) también cuenta si se informó", () => {
  assert.equal(reportedOutingsFromVisits([visit({ territory_rounds: [{ territory_id: "extra" }] })])[0].territoryId, "extra");
});

test("se pueden excluir las salidas de la semana que se está planificando", () => {
  assert.deepEqual(reportedOutingsFromVisits([visit()], { excludeSlotIds: new Set(["s1"]) }), []);
});

test("la última vez sale de lo informado: un territorio solo planificado no tiene historial", () => {
  const history = lastOccurrences(reportedOutingsFromVisits([visit({ territory_rounds: { territory_id: "informado" } })]).map((entry) => ({ territoryId: entry.territoryId, date: entry.date, hora: entry.hora })));
  assert.equal(history.get("informado")?.isoWeekday, 2);
  assert.equal(history.get("informado")?.turno, "MANANA");
  assert.equal(history.has("solo-planificado"), false);
});
