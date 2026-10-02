import assert from "node:assert/strict";
import test from "node:test";

import { houseNumber, streetOf } from "../src/modules/buildings/address";
import { parseBulkBuildings } from "../src/modules/buildings/structure";

test("la calle es todo lo que va antes del número de puerta", () => {
  assert.equal(streetOf("Paso 3252"), "Paso");
  assert.equal(streetOf("14 de Julio 4150"), "14 de Julio");
  assert.equal(streetOf("Lisandro de la Torre 102"), "Lisandro de la Torre");
  assert.equal(streetOf("Guido 4116 (Torre 8)"), "Guido");
  assert.equal(streetOf("Sin numero"), "Sin numero");
});

test("el número de puerta ordena los edificios de una calle", () => {
  assert.equal(houseNumber("Paso 3252"), 3252);
  assert.equal(houseNumber("14 de Julio 4150"), 4150);
  assert.equal(houseNumber("Sin numero"), 0);
});

test("la carga masiva acepta tab o punto y coma y descarta líneas inválidas", () => {
  const { rows, invalid } = parseBulkBuildings("12\tPaso 456\tA, B ,C\n13;Larrea 3228\nxx\tFoo 1\n\n14\t\n");
  assert.deepEqual(rows, [
    { territory_number: 12, address: "Paso 456", labels: ["A", "B", "C"] },
    { territory_number: 13, address: "Larrea 3228", labels: [] },
  ]);
  assert.equal(invalid, 2);
});
