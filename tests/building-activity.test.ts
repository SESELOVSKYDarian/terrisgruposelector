import assert from "node:assert/strict";
import test from "node:test";

import { addLock, canUndo, canWorkUnit, isDoneForRound, outcomeFor, unitStatus, validateLockDuration, type ActivityRow } from "../src/modules/buildings/activity";

const NOW = new Date("2026-09-24T15:00:00Z");
const activity = (overrides: Partial<ActivityRow>): ActivityRow => ({
  id: "a1", unit_id: "u1", user_id: "perez", attended: true, interested: true, outcome: "REVISITA", worked_at: "2026-09-20T12:00:00Z",
  next_available_at: null, revisit_active: true, undone_at: null, unlocked_at: null, round_id: "r1", ...overrides,
});

test("el resultado depende de si atendió y mostró interés", () => {
  assert.equal(outcomeFor(true, true), "REVISITA");
  assert.equal(outcomeFor(true, false), "TRABAJADO");
  assert.equal(outcomeFor(true, null), "TRABAJADO");
  assert.equal(outcomeFor(false, null), "TRABAJADO");
  assert.equal(outcomeFor(false, true), "TRABAJADO");
});

test("el bloqueo es configurable y un mes es un mes de calendario (no 30 días fijos)", () => {
  assert.equal(addLock(new Date("2026-01-15T12:00:00Z"), { amount: 1, unit: "months" }).toISOString(), "2026-02-15T12:00:00.000Z");
  assert.equal(addLock(new Date("2026-01-31T12:00:00Z"), { amount: 1, unit: "months" }).toISOString(), "2026-02-28T12:00:00.000Z");
  assert.equal(addLock(new Date("2026-12-10T00:00:00Z"), { amount: 2, unit: "months" }).toISOString(), "2027-02-10T00:00:00.000Z");
  assert.equal(addLock(new Date("2026-09-24T00:00:00Z"), { amount: 2, unit: "weeks" }).toISOString(), "2026-10-08T00:00:00.000Z");
  assert.equal(addLock(new Date("2026-09-24T00:00:00Z"), { amount: 10, unit: "days" }).toISOString(), "2026-10-04T00:00:00.000Z");
  assert.equal(validateLockDuration({ amount: 1, unit: "months" }).ok, true);
  assert.equal(validateLockDuration({ amount: 0, unit: "days" }).ok, false);
  assert.equal(validateLockDuration({ amount: 3, unit: "years" }).ok, false);
  assert.equal(validateLockDuration({ amount: 25, unit: "months" }).ok, false);
});

test("caso 5: la revisita de Pérez queda accesible para él y bloqueada para Gómez, que ve de quién es", () => {
  const status = unitStatus([activity({})], NOW);
  assert.equal(status.state, "REVISITA");
  assert.equal(status.owner_id, "perez");
  assert.deepEqual(canWorkUnit(status, "perez"), { ok: true });
  const blocked = canWorkUnit(status, "gomez");
  assert.equal(blocked.ok, false);
});

test("caso 5: la revisita cuenta como completada para la vuelta", () => {
  assert.equal(isDoneForRound([activity({})], "r1", NOW), true);
  // Aunque haya sido abierta en una vuelta anterior, mientras siga activa cuenta.
  assert.equal(isDoneForRound([activity({ round_id: "r0" })], "r1", NOW), true);
  // Quitada la revisita, esa vuelta anterior ya no cuenta para la nueva.
  assert.equal(isDoneForRound([activity({ round_id: "r0", revisit_active: false })], "r1", NOW), false);
  assert.equal(isDoneForRound([], "r1", NOW), false);
});

test("quitar la revisita deja el departamento disponible para todos", () => {
  const released = unitStatus([activity({ revisit_active: false })], NOW);
  assert.equal(released.state, "DISPONIBLE");
  assert.deepEqual(canWorkUnit(released, "gomez"), { ok: true });
});

test("trabajado o no atendido bloquea hasta next_available_at y luego se libera solo", () => {
  const worked = activity({ outcome: "TRABAJADO", attended: false, interested: null, revisit_active: false, next_available_at: "2026-10-24T15:00:00Z" });
  assert.equal(unitStatus([worked], NOW).state, "BLOQUEADO");
  assert.equal(canWorkUnit(unitStatus([worked], NOW), "perez").ok, false);
  assert.equal(unitStatus([worked], new Date("2026-10-24T15:00:01Z")).state, "DISPONIBLE");
});

test("desbloquear (Servicio/Territorios) libera bloqueos temporales y revisitas", () => {
  const locked = activity({ outcome: "TRABAJADO", attended: false, interested: null, revisit_active: false, next_available_at: "2026-10-24T15:00:00Z", unlocked_at: "2026-09-24T14:00:00Z" });
  assert.equal(unitStatus([locked], NOW).state, "DISPONIBLE");
  assert.equal(unitStatus([activity({ unlocked_at: "2026-09-24T14:00:00Z" })], NOW).state, "DISPONIBLE");
});

test("deshacer no destruye el historial: la actividad anulada deja de contar y el estado se recalcula", () => {
  const older = activity({ id: "old", outcome: "TRABAJADO", attended: true, interested: false, revisit_active: false, next_available_at: "2026-08-01T00:00:00Z", worked_at: "2026-07-01T12:00:00Z", user_id: "gomez" });
  const wrong = activity({ id: "wrong", user_id: "perez", worked_at: "2026-09-24T12:00:00Z" });
  assert.equal(unitStatus([older, wrong], NOW).state, "REVISITA");
  const undone = { ...wrong, undone_at: "2026-09-24T13:00:00Z" };
  assert.equal(unitStatus([older, undone], NOW).state, "DISPONIBLE");
  assert.equal(isDoneForRound([undone], "r1", NOW), false);
});

test("quién puede deshacer: el autor sobre su marca más reciente, o un responsable sobre cualquiera", () => {
  const status = unitStatus([activity({ id: "mine", user_id: "perez" })], NOW);
  assert.equal(canUndo(status, { id: "mine", user_id: "perez" }, "perez", false), true);
  assert.equal(canUndo(status, { id: "mine", user_id: "perez" }, "gomez", false), false);
  assert.equal(canUndo(status, { id: "mine", user_id: "perez" }, "gomez", true), true);
  // Una marca vieja del autor ya no es la más reciente.
  assert.equal(canUndo(status, { id: "older", user_id: "perez" }, "perez", false), false);
});
