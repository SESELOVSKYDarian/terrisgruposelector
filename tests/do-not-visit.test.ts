import assert from "node:assert/strict";
import test from "node:test";

import { addressKey, isDuplicateAddress, normalizeAddress, warningsForTerritories } from "../src/modules/territories/do-not-visit";

test("las direcciones se normalizan sin espacios de más", () => {
  assert.equal(normalizeAddress("  Paso   456 "), "Paso 456");
});

test("los duplicados ignoran mayúsculas, acentos y espacios", () => {
  assert.equal(addressKey("Rivadavía  3102"), "rivadavia 3102");
  assert.equal(isDuplicateAddress([{ address: "Rivadavia 3102" }], "  rivadavía 3102 "), true);
  assert.equal(isDuplicateAddress([{ address: "Rivadavia 3102" }], "Rivadavia 3103"), false);
});

test("una salida muestra solo el No visitar de sus territorios, ordenado", () => {
  const numbers = new Map<string, number>([["t3", 3], ["t8", 8]]);
  const items = [
    { id: "a", territory_id: "t8", address: "Independencia 2450" },
    { id: "b", territory_id: "t3", address: "Paso 456" },
    { id: "c", territory_id: "t9", address: "Otra 1" },
  ];
  const warnings = warningsForTerritories(items, numbers, ["t3", "t8"]);
  assert.deepEqual(warnings.map((warning) => [warning.number, warning.address]), [[3, "Paso 456"], [8, "Independencia 2450"]]);
  assert.deepEqual(warningsForTerritories(items, numbers, ["t1"]), []);
});
