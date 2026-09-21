import assert from "node:assert/strict";
import test from "node:test";

import {
  argentinaLocalToDate,
  completedByLabel,
  currentReminderStage,
  datesForSelection,
  formatDeadlineEs,
  isWindowOpen,
  planningWeekStart,
  reminderNaturalKey,
  validateResponseInput,
  windowTitle,
} from "../src/modules/groups/group-outings";

const firstService = "2026-10-03"; // sábado
const deadline = argentinaLocalToDate("2026-10-01T21:00")!; // jueves 21:00 hora Argentina = 2026-10-02T00:00Z

test("la fecha límite se interpreta siempre en hora de Argentina", () => {
  assert.equal(deadline.toISOString(), "2026-10-02T00:00:00.000Z");
  assert.equal(argentinaLocalToDate("2026-10-01 21:00"), null);
  assert.equal(formatDeadlineEs(deadline), "jue 01/10 21:00");
});

test("caso 4: recordatorio una semana antes y luego a 24 h, 6 h y 2 h del cierre", () => {
  const at = (iso: string) => currentReminderStage(new Date(iso), deadline, firstService)?.stage ?? null;
  assert.equal(at("2026-09-20T12:00:00Z"), null);
  assert.equal(at("2026-09-26T04:00:00Z"), "WEEK_BEFORE");
  assert.equal(at("2026-10-01T00:30:00Z"), "H24");
  assert.equal(at("2026-10-01T18:10:00Z"), "H6");
  assert.equal(at("2026-10-01T22:30:00Z"), "H2");
  // Pasado el cierre ya no se recuerda nada.
  assert.equal(at("2026-10-02T00:00:01Z"), null);
});

test("una corrida tardía solo dispara la etapa más urgente, sin inundar", () => {
  // A 1 h del cierre ya pasaron WEEK_BEFORE, H24, H6 y H2: solo debe salir H2.
  assert.equal(currentReminderStage(new Date("2026-10-01T23:00:00Z"), deadline, firstService)?.stage, "H2");
});

test("caso 4: la prórroga re-arma los recordatorios con la nueva fecha (la clave incluye el cierre)", () => {
  const extended = argentinaLocalToDate("2026-10-02T21:00")!; // un día más
  const before = reminderNaturalKey("w1", "g1", "u1", "H24", deadline);
  // Con el cierre viejo ya vencido, el scheduler mira la nueva fecha y vuelve a dar H24.
  const now = new Date("2026-10-02T00:00:00Z");
  assert.equal(currentReminderStage(now, deadline, firstService), null);
  const stage = currentReminderStage(now, extended, firstService);
  assert.equal(stage?.stage, "H24");
  assert.notEqual(reminderNaturalKey("w1", "g1", "u1", "H24", extended), before);
  // Misma etapa + mismo cierre + misma persona = misma clave (idempotente).
  assert.equal(reminderNaturalKey("w1", "g1", "u1", "H24", deadline), before);
});

test("la ventana está abierta solo antes del cierre", () => {
  assert.equal(isWindowOpen(deadline, new Date("2026-10-01T23:59:00Z")), true);
  assert.equal(isWindowOpen(deadline, new Date("2026-10-02T00:00:01Z")), false);
});

test("Salida por Grupo: sábado, domingo o ambos, con el domingo pegado a su sábado", () => {
  assert.deepEqual(datesForSelection("2026-10-03", "BOTH"), { saturday_date: "2026-10-03", sunday_date: "2026-10-04" });
  assert.deepEqual(datesForSelection("2026-10-03", "SATURDAY"), { saturday_date: "2026-10-03", sunday_date: null });
  assert.deepEqual(datesForSelection("2026-10-03", "SUNDAY"), { saturday_date: null, sunday_date: "2026-10-04" });
  // Un día que no es sábado no es una selección válida.
  assert.equal(datesForSelection("2026-10-02", "BOTH"), null);
  assert.equal(windowTitle({ saturday_date: "2026-10-03", sunday_date: "2026-10-04" }), "Salida por Grupo: sáb 03/10 y dom 04/10");
});

test("el fin de semana pertenece a la semana de planificación que empezó el jueves anterior", () => {
  assert.equal(planningWeekStart("2026-10-03"), "2026-10-01");
  assert.equal(planningWeekStart("2026-10-04"), "2026-10-01");
  assert.equal(planningWeekStart("2026-10-01"), "2026-10-01");
  assert.equal(planningWeekStart("2026-10-07"), "2026-10-01");
  assert.equal(planningWeekStart("2026-10-08"), "2026-10-08");
});

test("solo el lugar es obligatorio; la hora, si viene, debe ser HH:MM", () => {
  assert.equal(validateResponseInput({ lugar: "  " }).ok, false);
  assert.equal(validateResponseInput({ lugar: "Paso 123", hora: "9:00" }).ok, false);
  const ok = validateResponseInput({ lugar: " Paso 123 ", hora: "09:00", conductor_id: "c1", territory_ids: ["t1", "t1", "t2"] });
  assert.ok(ok.ok);
  if (ok.ok) assert.deepEqual(ok.value, { lugar: "Paso 123", hora: "09:00", conductor_id: "c1", territory_ids: ["t1", "t2"] });
  const minimal = validateResponseInput({ lugar: "Paso 123" });
  assert.ok(minimal.ok);
  if (minimal.ok) assert.deepEqual(minimal.value, { lugar: "Paso 123", hora: null, conductor_id: null, territory_ids: [] });
});

test("caso 3: el otro responsable ve quién completó la información", () => {
  const people = [{ id: "sg", full_name: "Pérez J." }, { id: "aux", full_name: "Gómez L." }];
  const response = { completed_by: "sg" };
  assert.equal(completedByLabel(response, people, "aux"), "Completado por Pérez J.");
  assert.equal(completedByLabel(response, people, "sg"), "Completado por vos");
  assert.equal(completedByLabel(null, people, "aux"), null);
});
