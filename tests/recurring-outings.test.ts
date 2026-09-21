import assert from "node:assert/strict";
import test from "node:test";

import { addDaysIso, formatTemplateHora, isValidHora, planMaterialization, templateOverrides, weekOffsetForIsoDow, type TemplateSlot } from "../src/modules/outings/recurring";

const template: TemplateSlot[] = [
  { id: "mon", isodow: 1, hora: "09:00:00", lugar: null, default_conductor_id: "perez", active: true, sort_order: 0 },
  { id: "tue", isodow: 2, hora: "18:00:00", lugar: "Paso 123", default_conductor_id: "garcia", active: true, sort_order: 0 },
  { id: "thu", isodow: 4, hora: "18:00:00", lugar: null, default_conductor_id: "perez", active: true, sort_order: 0 },
  { id: "thu-late", isodow: 4, hora: "20:30:00", lugar: null, default_conductor_id: null, active: true, sort_order: 1 },
  { id: "paused", isodow: 5, hora: "10:00:00", lugar: null, default_conductor_id: "perez", active: false, sort_order: 0 },
];

test("la semana va de jueves a miércoles: cada día ISO cae en su offset", () => {
  assert.deepEqual([4, 5, 6, 7, 1, 2, 3].map(weekOffsetForIsoDow), [0, 1, 2, 3, 4, 5, 6]);
  assert.equal(addDaysIso("2026-09-24", 4), "2026-09-28");
});

test("la plantilla genera filas con el conductor estrella y fechas reales de la semana", () => {
  const rows = planMaterialization("2026-09-24", template, new Set());
  assert.deepEqual(
    rows.map((row) => [row.slot_date, row.hora, row.conductor_id]),
    [
      ["2026-09-24", "18:00", "perez"],
      ["2026-09-24", "20:30", null],
      ["2026-09-28", "09:00", "perez"],
      ["2026-09-29", "18:00", "garcia"],
    ],
  );
  // Las filas pausadas no se generan y el orden dentro del día sigue la hora.
  assert.equal(rows.some((row) => row.template_slot_id === "paused"), false);
  assert.deepEqual(rows.filter((row) => row.slot_date === "2026-09-24").map((row) => row.sort_order), [0, 1]);
});

test("aplicar la plantilla de nuevo no duplica filas ya generadas", () => {
  const first = planMaterialization("2026-09-24", template, new Set());
  const again = planMaterialization("2026-09-24", template, new Set(first.map((row) => row.template_slot_id)));
  assert.equal(again.length, 0);
  // Si una fila se borró de la semana (no hubo salida), sí se puede volver a generar solo esa.
  const partial = planMaterialization("2026-09-24", template, new Set(["mon", "tue", "thu-late"]));
  assert.deepEqual(partial.map((row) => row.template_slot_id), ["thu"]);
});

test("un override de semana se detecta sin alterar la estrella de la plantilla", () => {
  const thu = template[2];
  assert.deepEqual(templateOverrides({ hora: "18:00", conductor_id: "perez" }, thu), []);
  assert.deepEqual(templateOverrides({ hora: "18:00", conductor_id: "navarro" }, thu), ["conductor"]);
  assert.deepEqual(templateOverrides({ hora: "19:00", conductor_id: "navarro" }, thu), ["hora", "conductor"]);
  // La plantilla original queda intacta.
  assert.equal(thu.default_conductor_id, "perez");
});

test("la hora de plantilla se normaliza y valida", () => {
  assert.equal(formatTemplateHora("09:00:00"), "09:00");
  assert.equal(formatTemplateHora("9:05"), "09:05");
  assert.equal(isValidHora("18:30"), true);
  assert.equal(isValidHora("24:00"), false);
  assert.equal(isValidHora("9:00"), false);
  assert.equal(isValidHora("Zoom"), false);
});
