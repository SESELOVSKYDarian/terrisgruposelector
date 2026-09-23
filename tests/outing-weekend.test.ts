import assert from "node:assert/strict";
import test from "node:test";

import { assembleTerritories, companionCandidates, type SuggestionPoint } from "../src/modules/outings/suggestions";

const blocks: Record<string, number> = { a: 5, b: 3, c: 4, d: 12, e: 2, f: 2 };
const blocksOf = (id: string) => blocks[id] ?? 0;

test("fin de semana: siempre al menos 2 territorios, aunque el primero ya tenga 8 manzanas", () => {
  assert.deepEqual(assembleTerritories({ first: "d", candidates: ["a", "b"], blocksOf }), ["d", "a"]);
});

test("se suma un tercero solo si con dos todavia no llega a 8 manzanas", () => {
  assert.deepEqual(assembleTerritories({ first: "b", candidates: ["e", "c"], blocksOf }), ["b", "e", "c"]); // 3+2=5 -> falta
});

test("5+3 manzanas ya son 8: quedan dos territorios", () => {
  assert.deepEqual(assembleTerritories({ first: "a", candidates: ["b", "c"], blocksOf }), ["a", "b"]);
});

test("nunca pasa de 3 territorios, aunque no lleguen a 8 manzanas", () => {
  assert.deepEqual(assembleTerritories({ first: "e", candidates: ["f", "b", "a"], blocksOf }), ["e", "f", "b"]);
});

test("si no hay candidatos se queda con lo que hay", () => {
  assert.deepEqual(assembleTerritories({ first: "a", candidates: [], blocksOf }), ["a"]);
});

test("los acompanantes cercanos al punto van primero, despues por necesidad", () => {
  const point: SuggestionPoint = { id: "p", name: "", address: "Casa", kind: "CASA", availableDays: [], territoryIds: ["t3", "t1"] };
  const order = companionCandidates({ points: [point], priority: ["t1", "t2", "t3", "t4"], isoWeekday: 6, usedTerritoryIds: new Set(["t2"]), point, picked: ["t1"] });
  assert.deepEqual(order, ["t3", "t4"]);
});

test("los acompanantes excluyen los usados, los excluidos y los ya elegidos", () => {
  const order = companionCandidates({ points: [], priority: ["t1", "t2", "t3", "t4"], isoWeekday: 7, usedTerritoryIds: new Set(["t2"]), excludeTerritoryIds: new Set(["t3"]), point: null, picked: ["t1"] });
  assert.deepEqual(order, ["t4"]);
});
