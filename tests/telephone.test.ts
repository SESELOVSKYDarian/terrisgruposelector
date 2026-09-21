import assert from "node:assert/strict";
import test from "node:test";

import { PHONE_MINIMUM, orderByAge, parsePhoneList, pendingResults, phoneKey, selectTerritoriesForPhoneOuting, type PhoneTerritory } from "../src/modules/telephone/assignment";

const territory = (id: string, number: number, phone_count: number, last_activity_on: string | null): PhoneTerritory => ({ id, number, phone_count, last_activity_on });

test("el mínimo por salida telefónica es 20 números", () => {
  assert.equal(PHONE_MINIMUM, 20);
});

test("caso 2: Zoom sobre el territorio 3 (8) suma el más atrasado (5→7) y luego el siguiente (9→12)", () => {
  const territories = [
    territory("t3", 3, 8, "2026-09-01"),
    territory("t5", 5, 7, "2026-03-01"), // el más atrasado
    territory("t9", 9, 12, "2026-05-01"),
    territory("t11", 11, 30, "2026-08-01"),
  ];
  const result = selectTerritoriesForPhoneOuting("t3", territories);
  assert.deepEqual(result.territory_ids, ["t3", "t5", "t9"]);
  assert.equal(result.total, 27);
});

test("el ejemplo del enunciado: 8 + 7 = 15 no alcanza, se suma otro con 11 y llega a 26", () => {
  const territories = [territory("t3", 3, 8, "2026-09-01"), territory("t8", 8, 7, "2026-01-01"), territory("t12", 12, 11, "2026-02-01")];
  const result = selectTerritoriesForPhoneOuting("t3", territories);
  assert.deepEqual(result.territory_ids, ["t3", "t8", "t12"]);
  assert.equal(result.total, 26);
});

test("si el territorio planificado ya tiene 20 o más se usan solo esos", () => {
  const territories = [territory("t3", 3, 20, "2026-09-01"), territory("t5", 5, 7, null)];
  assert.deepEqual(selectTerritoriesForPhoneOuting("t3", territories), { territory_ids: ["t3"], total: 20 });
});

test("nunca se reemplaza el territorio principal y los territorios se agregan completos", () => {
  const territories = [territory("t3", 3, 5, "2026-09-01"), territory("t4", 4, 40, "2026-01-01")];
  const result = selectTerritoriesForPhoneOuting("t3", territories);
  // 5 + 40 = 45: se asignan los 40 completos aunque superen el mínimo.
  assert.deepEqual(result, { territory_ids: ["t3", "t4"], total: 45 });
});

test("si no hay suficientes números en total se asignan todos los disponibles", () => {
  const territories = [territory("t3", 3, 4, "2026-09-01"), territory("t5", 5, 3, "2026-01-01"), territory("t6", 6, 0, null)];
  assert.deepEqual(selectTerritoriesForPhoneOuting("t3", territories), { territory_ids: ["t3", "t5"], total: 7 });
});

test("la antigüedad pone primero a los nunca trabajados y desempata por número", () => {
  const ordered = orderByAge([territory("a", 9, 1, "2026-02-01"), territory("b", 4, 1, null), territory("c", 2, 1, "2026-02-01"), territory("d", 7, 1, null)]);
  assert.deepEqual(ordered.map((entry) => entry.number), [4, 7, 2, 9]);
});

test("los números se comparan por dígitos y la carga masiva informa lo omitido", () => {
  assert.equal(phoneKey("11 4444-5555"), "1144445555");
  const result = parsePhoneList("11 4444-5555\n1144445555\n12345\n011 5555 1234, 4444-0000", new Set(["44440000"]));
  assert.deepEqual(result.accepted.map((entry) => entry.number_key), ["1144445555", "01155551234"]);
  assert.deepEqual(result.skipped.map((entry) => entry.reason), ["duplicate", "invalid", "duplicate"]);
});

test("los resultados pendientes son los números asignados sin resultado", () => {
  const assigned = [{ phone_number_id: "n1" }, { phone_number_id: "n2" }, { phone_number_id: "n3" }];
  assert.deepEqual(pendingResults(assigned, new Set(["n2"])).map((entry) => entry.phone_number_id), ["n1", "n3"]);
});
