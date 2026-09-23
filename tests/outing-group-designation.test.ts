import assert from "node:assert/strict";
import test from "node:test";

import { planMaterialization, type TemplateSlot } from "../src/modules/outings/recurring";

const row = (overrides: Partial<TemplateSlot>): TemplateSlot => ({ id: "x", isodow: 1, hora: "09:00", lugar: null, default_conductor_id: null, default_group_id: null, active: true, sort_order: 0, ...overrides });

test("una fila de la plantilla con grupo genera la salida con ese grupo y sin conductor", () => {
  const [slot] = planMaterialization("2026-09-24", [row({ id: "g", isodow: 2, default_group_id: "grupo-1" })], new Set());
  assert.equal(slot.group_id, "grupo-1");
  assert.equal(slot.conductor_id, null);
});

test("una fila con conductor fijo no lleva grupo", () => {
  const [slot] = planMaterialization("2026-09-24", [row({ id: "c", default_conductor_id: "perez" })], new Set());
  assert.equal(slot.conductor_id, "perez");
  assert.equal(slot.group_id, null);
});

test("las plantillas anteriores a los grupos (sin la columna) siguen funcionando", () => {
  const legacy = { id: "l", isodow: 4, hora: "18:00", lugar: null, default_conductor_id: "garcia", active: true, sort_order: 0 } as TemplateSlot;
  const [slot] = planMaterialization("2026-09-24", [legacy], new Set());
  assert.equal(slot.group_id, null);
  assert.equal(slot.conductor_id, "garcia");
});
