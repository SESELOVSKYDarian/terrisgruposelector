import assert from "node:assert/strict";
import test from "node:test";

import { addMonthsIso, canReportPeriod, currentPersonalStage, daysBetween, periodBounds, personalReminderKey, personalReminderMessage } from "../src/modules/personal/period";

test("el período dura 3 meses desde la fecha de asignación: 15 sep → 15 dic → 15 mar (no trimestres calendario)", () => {
  assert.deepEqual(periodBounds("2026-09-15", 0), { start: "2026-09-15", end: "2026-12-15" });
  assert.deepEqual(periodBounds("2026-09-15", 1), { start: "2026-12-15", end: "2027-03-15" });
  assert.deepEqual(periodBounds("2026-09-15", 2), { start: "2027-03-15", end: "2027-06-15" });
});

test("los fines de mes se ajustan sin correr los períodos siguientes", () => {
  assert.equal(addMonthsIso("2026-11-30", 3), "2027-02-28");
  assert.equal(addMonthsIso("2026-01-31", 1), "2026-02-28");
  // El ancla evita la deriva: el 2.º período sigue siendo 30 de mayo, no 28.
  assert.deepEqual(periodBounds("2026-11-30", 1), { start: "2027-02-28", end: "2027-05-30" });
});

test("recordatorios: una semana antes, el día del vencimiento y tres días después", () => {
  const end = "2026-12-15";
  assert.equal(currentPersonalStage("2026-11-01", end), null);
  assert.equal(currentPersonalStage("2026-12-08", end), "SOON");
  assert.equal(currentPersonalStage("2026-12-14", end), "SOON");
  assert.equal(currentPersonalStage("2026-12-15", end), "DUE");
  assert.equal(currentPersonalStage("2026-12-17", end), "DUE");
  assert.equal(currentPersonalStage("2026-12-18", end), "OVERDUE");
  assert.equal(currentPersonalStage("2027-01-20", end), "OVERDUE");
});

test("la clave incluye el fin del período, así el período siguiente vuelve a avisar", () => {
  assert.notEqual(personalReminderKey("a1", "2026-12-15", "SOON"), personalReminderKey("a1", "2027-03-15", "SOON"));
  assert.equal(personalReminderKey("a1", "2026-12-15", "SOON"), personalReminderKey("a1", "2026-12-15", "SOON"));
  assert.match(personalReminderMessage("DUE", 12, "2026-12-15"), /Hoy vence el informe de tu territorio personal 12 \(15\/12\/2026\)/);
});

test("solo se informa el período en curso y cerca de su vencimiento", () => {
  assert.equal(daysBetween("2026-09-15", "2026-12-15"), 91);
  assert.equal(canReportPeriod("2026-09-16", "2026-09-15", "2026-12-15"), false);
  assert.equal(canReportPeriod("2026-11-20", "2026-09-15", "2026-12-15"), true);
  assert.equal(canReportPeriod("2026-09-01", "2026-09-15", "2026-12-15"), false);
});
