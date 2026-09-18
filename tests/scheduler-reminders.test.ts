import assert from "node:assert/strict";
import test from "node:test";

import { driverReportReminderDueAt, initialDriverReportDeadline, weekendReminderDueAt } from "../src/server/scheduler/reminders";

test("el recordatorio de fin de semana conserva la hora de Buenos Aires tres días antes", () => {
  // 12:15Z equivale a 09:15 en Buenos Aires; el cálculo no depende de la zona del servidor.
  const due = weekendReminderDueAt(new Date("2026-06-08T12:15:00.000Z"));
  assert.equal(due.toISOString(), "2026-06-05T12:15:00.000Z");
});

test("el recordatorio de informe usa el deadline persistido sin recalcular un offset", () => {
  assert.equal(driverReportReminderDueAt(new Date("2026-06-08T15:15:00.000Z")).toISOString(), "2026-06-08T15:15:00.000Z");
});

test("el deadline inicial de informe queda tres horas después de la salida en UTC", () => {
  assert.equal(initialDriverReportDeadline(new Date("2026-06-08T12:15:00.000Z")).toISOString(), "2026-06-08T15:15:00.000Z");
});
