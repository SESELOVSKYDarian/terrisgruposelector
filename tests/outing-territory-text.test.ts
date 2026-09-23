import assert from "node:assert/strict";
import test from "node:test";

import { formatSlotTerritories } from "../src/modules/outings/territory-text";

test("un territorio completo y otro con manzanas pendientes: 22+15(M1-M2)", () => {
  assert.equal(formatSlotTerritories([{ number: 22 }, { number: 15, pendingLabels: ["M1", "M2"] }]), "22+15(M1-M2)");
});

test("manzanas salteadas se separan con coma", () => {
  assert.equal(formatSlotTerritories([{ number: 7, pendingLabels: ["M1", "M3", "M4"] }]), "7(M1,M3-M4)");
});

test("varios territorios completos", () => {
  assert.equal(formatSlotTerritories([{ number: 3 }, { number: 9, pendingLabels: [] }, { number: 12, pendingLabels: null }]), "3+9+12");
});

test("el texto escrito a mano tiene prioridad", () => {
  assert.equal(formatSlotTerritories([{ number: 4, pendingLabels: ["M1"], override: " 4 (medio) " }, { number: 5 }]), "4 (medio)+5");
});

test("sin territorios el texto queda vacio", () => {
  assert.equal(formatSlotTerritories([]), "");
});
