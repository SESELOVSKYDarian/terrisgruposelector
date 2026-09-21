import assert from "node:assert/strict";
import test from "node:test";

import { formatDateEs, outingStartsAt, outingTimeParseStatus, parseOutingTime } from "../src/modules/outings/time";
import {
  canDeleteWeek,
  canEditWeek,
  canPerformTransition,
  canViewWeek,
  changedSlotFields,
  derivePlanningAuthority,
  editNeedsSuperintendentNotice,
  nextPlanningStatus,
  shouldNotifyConductor,
  type PlanningAuthority,
} from "../src/modules/outings/workflow";

const siervo: PlanningAuthority = { canPlan: true, canPublish: false };
const superintendente: PlanningAuthority = { canPlan: false, canPublish: true };
const nobody: PlanningAuthority = { canPlan: false, canPublish: false };

test("solo existen las transiciones DRAFT→IN_REVIEW, IN_REVIEW→DRAFT e IN_REVIEW→PUBLISHED", () => {
  assert.equal(nextPlanningStatus("DRAFT", "SUBMIT"), "IN_REVIEW");
  assert.equal(nextPlanningStatus("IN_REVIEW", "RETURN_TO_DRAFT"), "DRAFT");
  assert.equal(nextPlanningStatus("IN_REVIEW", "PUBLISH"), "PUBLISHED");
  // No se puede publicar un borrador ni volver a enviar algo ya publicado.
  assert.equal(nextPlanningStatus("DRAFT", "PUBLISH"), null);
  assert.equal(nextPlanningStatus("PUBLISHED", "SUBMIT"), null);
  assert.equal(nextPlanningStatus("PUBLISHED", "RETURN_TO_DRAFT"), null);
  assert.equal(nextPlanningStatus("DRAFT", "RETURN_TO_DRAFT"), null);
});

test("el Siervo de Territorios prepara y envía, pero solo el Superintendente aprueba y publica", () => {
  assert.equal(canPerformTransition(siervo, "SUBMIT"), true);
  assert.equal(canPerformTransition(siervo, "PUBLISH"), false);
  assert.equal(canPerformTransition(siervo, "RETURN_TO_DRAFT"), false);
  assert.equal(canPerformTransition(superintendente, "PUBLISH"), true);
  assert.equal(canPerformTransition(superintendente, "RETURN_TO_DRAFT"), true);
  assert.equal(canPerformTransition(nobody, "SUBMIT"), false);
});

test("edición: el borrador lo edita quien planifica, en revisión solo el revisor, publicada ambos", () => {
  assert.equal(canEditWeek(siervo, "DRAFT"), true);
  assert.equal(canEditWeek(siervo, "IN_REVIEW"), false);
  assert.equal(canEditWeek(superintendente, "IN_REVIEW"), true);
  assert.equal(canEditWeek(siervo, "PUBLISHED"), true);
  assert.equal(canEditWeek(superintendente, "PUBLISHED"), true);
  assert.equal(canEditWeek(nobody, "DRAFT"), false);
  assert.equal(canEditWeek(nobody, "PUBLISHED"), false);
});

test("eliminar: el Siervo solo borradores; semanas en revisión o publicadas solo el Superintendente", () => {
  assert.equal(canDeleteWeek(siervo, "DRAFT"), true);
  assert.equal(canDeleteWeek(siervo, "IN_REVIEW"), false);
  assert.equal(canDeleteWeek(siervo, "PUBLISHED"), false);
  assert.equal(canDeleteWeek(superintendente, "PUBLISHED"), true);
});

test("los usuarios sin autoridad solo ven planificación publicada", () => {
  assert.equal(canViewWeek(nobody, "PUBLISHED"), true);
  assert.equal(canViewWeek(nobody, "DRAFT"), false);
  assert.equal(canViewWeek(nobody, "IN_REVIEW"), false);
  assert.equal(canViewWeek(siervo, "DRAFT"), true);
});

test("editar una salida publicada sin autoridad de publicar avisa al Superintendente (caso 7)", () => {
  assert.equal(editNeedsSuperintendentNotice(siervo, "PUBLISHED"), true);
  assert.equal(editNeedsSuperintendentNotice(superintendente, "PUBLISHED"), false);
  // En borrador no hay aviso: nada se publicó todavía.
  assert.equal(editNeedsSuperintendentNotice(siervo, "DRAFT"), false);
  // El conductor solo se entera de lo que ya está publicado.
  assert.equal(shouldNotifyConductor("PUBLISHED"), true);
  assert.equal(shouldNotifyConductor("DRAFT"), false);
  assert.equal(shouldNotifyConductor("IN_REVIEW"), false);
});

test("el puente legacy ADMIN aplica solo mientras nadie tenga la responsabilidad V2 correspondiente", () => {
  const base = { hasPlanPermission: false, hasPublishPermission: false, isLegacyAdmin: true };
  assert.deepEqual(derivePlanningAuthority({ ...base, planHeldByAnyone: false, publishHeldByAnyone: false }), { canPlan: true, canPublish: true });
  // Ya hay un Siervo de Territorios: el admin legacy deja de planificar, pero puede seguir publicando.
  assert.deepEqual(derivePlanningAuthority({ ...base, planHeldByAnyone: true, publishHeldByAnyone: false }), { canPlan: false, canPublish: true });
  assert.deepEqual(derivePlanningAuthority({ ...base, planHeldByAnyone: true, publishHeldByAnyone: true }), { canPlan: false, canPublish: false });
  // Sin ser admin legacy el puente nunca aplica (Coordinador solo tampoco planifica).
  assert.deepEqual(derivePlanningAuthority({ hasPlanPermission: false, hasPublishPermission: false, isLegacyAdmin: false, planHeldByAnyone: false, publishHeldByAnyone: false }), { canPlan: false, canPublish: false });
  assert.deepEqual(derivePlanningAuthority({ hasPlanPermission: true, hasPublishPermission: false, isLegacyAdmin: false, planHeldByAnyone: true, publishHeldByAnyone: false }), { canPlan: true, canPublish: false });
});

test("changedSlotFields solo reporta campos que realmente cambiaron", () => {
  const before = { hora: "18:30", lugar: "Paso 123", conductor_id: "a", note: null, highlighted: false, status: "PROGRAMADA" as const };
  assert.deepEqual(changedSlotFields(before, { hora: "18:30", lugar: "Paso 123" }), []);
  assert.deepEqual(changedSlotFields(before, { hora: "19:00", conductor_id: "b" }), ["hora", "conductor"]);
  assert.deepEqual(changedSlotFields(before, { status: "CANCELADA" }), ["estado"]);
});

test("parseOutingTime interpreta los formatos horarios reconocidos", () => {
  assert.deepEqual(parseOutingTime("18:30"), { hour: 18, minute: 30 });
  assert.deepEqual(parseOutingTime("18.30"), { hour: 18, minute: 30 });
  assert.deepEqual(parseOutingTime("18h30"), { hour: 18, minute: 30 });
  assert.deepEqual(parseOutingTime("18 hs"), { hour: 18, minute: 0 });
  assert.deepEqual(parseOutingTime("9"), { hour: 9, minute: 0 });
  assert.deepEqual(parseOutingTime("9 am"), { hour: 9, minute: 0 });
  assert.deepEqual(parseOutingTime("9:15 p.m."), { hour: 21, minute: 15 });
  assert.deepEqual(parseOutingTime("12 am"), { hour: 0, minute: 0 });
  assert.deepEqual(parseOutingTime("12 pm"), { hour: 12, minute: 0 });
});

test("parseOutingTime no adivina: texto libre, rangos y horas imposibles quedan sin interpretar", () => {
  assert.equal(parseOutingTime("Zoom"), null);
  assert.equal(parseOutingTime("9 a 11"), null);
  assert.equal(parseOutingTime("25:00"), null);
  assert.equal(parseOutingTime("10:75"), null);
  assert.equal(parseOutingTime("13 pm"), null);
  assert.equal(parseOutingTime(""), null);
  assert.equal(parseOutingTime(null), null);
  assert.equal(outingTimeParseStatus("18:30"), "PARSED");
  assert.equal(outingTimeParseStatus("  "), "EMPTY");
  assert.equal(outingTimeParseStatus("Zoom"), "UNPARSEABLE");
});

test("outingStartsAt fija el instante real usando la hora de Buenos Aires (UTC-3)", () => {
  // 18:30 en Buenos Aires son las 21:30 UTC del mismo día.
  assert.equal(outingStartsAt("2026-09-24", "18:30")?.toISOString(), "2026-09-24T21:30:00.000Z");
  // A partir de las 21:00 locales el instante UTC cae en el día siguiente.
  assert.equal(outingStartsAt("2026-09-24", "22:00")?.toISOString(), "2026-09-25T01:00:00.000Z");
  assert.equal(outingStartsAt("2026-09-24", "Zoom"), null);
  assert.equal(outingStartsAt("24/09/2026", "18:30"), null);
});

test("formatDateEs muestra fechas dd/mm/aaaa sin corrimiento de zona horaria", () => {
  assert.equal(formatDateEs("2026-09-24"), "24/09/2026");
  assert.equal(formatDateEs("no-es-fecha"), "no-es-fecha");
});
