import assert from "node:assert/strict";
import test from "node:test";

import {
  isoWeekdayOf,
  matchPointByLugar,
  pointAllowedOn,
  pointLugar,
  prioritizeTerritories,
  suggestOptions,
  suggestPoints,
  type SuggestionPoint,
} from "../src/modules/outings/suggestions";

const casa = (id: string, territoryIds: string[], availableDays: number[] = []): SuggestionPoint => ({ id, name: `Casa ${id}`, address: `Calle ${id}`, kind: "CASA", availableDays, territoryIds });
const esquina = (id: string, territoryIds: string[], availableDays: number[] = []): SuggestionPoint => ({ id, name: "", address: `Esquina ${id}`, kind: "ESQUINA", availableDays, territoryIds });
const priority = ["t1", "t2", "t3", "t4", "t5"];
const base = { priority, usedTerritoryIds: new Set<string>() };

test("día ISO: sábado 6, domingo 7", () => {
  assert.equal(isoWeekdayOf("2026-09-26"), 6);
  assert.equal(isoWeekdayOf("2026-09-27"), 7);
  assert.equal(isoWeekdayOf("2026-09-28"), 1);
});

test("entre semana una casa sin días declarados no se ofrece; con el día declarado sí", () => {
  assert.equal(pointAllowedOn(casa("a", []), 2), false);
  assert.equal(pointAllowedOn(casa("a", [], [2]), 2), true);
  assert.equal(pointAllowedOn(casa("a", [], [2]), 3), false);
  assert.equal(pointAllowedOn(esquina("e", []), 2), true);
  assert.equal(pointAllowedOn(esquina("e", [], [6]), 2), false);
});

test("fin de semana: la casa gana aunque la esquina tenga un territorio más urgente", () => {
  const options = suggestOptions({ ...base, isoWeekday: 6, points: [esquina("e", ["t1"]), casa("c", ["t4"])] });
  assert.equal(options[0].point?.id, "c");
  assert.equal(options[0].territoryId, "t4");
  assert.equal(options[1].point?.id, "e");
});

test("fin de semana: entre casas gana la que tiene el territorio más necesitado", () => {
  const options = suggestOptions({ ...base, isoWeekday: 7, points: [casa("lejos", ["t5"]), casa("cerca", ["t2", "t3"])] });
  assert.deepEqual(options.slice(0, 2).map((option) => option.point?.id), ["cerca", "lejos"]);
});

test("una casa sin territorios libres no se sugiere", () => {
  const options = suggestPoints({ ...base, isoWeekday: 6, usedTerritoryIds: new Set(["t1"]), points: [casa("c", ["t1"]), esquina("e", ["t2"])] });
  assert.deepEqual(options.map((option) => option.point.id), ["e"]);
});

test("entre semana solo esquinas (o casas con ese día); manda la necesidad del territorio", () => {
  const options = suggestPoints({ ...base, isoWeekday: 3, points: [casa("sin-dias", ["t1"]), casa("miercoles", ["t3"], [3]), esquina("e", ["t2"])] });
  assert.deepEqual(options.map((option) => option.point.id), ["e", "miercoles"]);
});

test("excluir el punto y los territorios actuales ofrece otra alternativa", () => {
  const points = [casa("a", ["t1"]), casa("b", ["t2"]), casa("c", ["t3"])];
  const first = suggestOptions({ ...base, isoWeekday: 6, points })[0];
  assert.equal(first.point?.id, "a");
  const next = suggestOptions({ ...base, isoWeekday: 6, points, excludePointIds: new Set(["a"]), excludeTerritoryIds: new Set(["t1"]) })[0];
  assert.equal(next.point?.id, "b");
});

test("un territorio sin punto se puede trabajar sin lugar; uno cercano solo a puntos que no aplican hoy queda de último recurso", () => {
  const options = suggestOptions({ ...base, isoWeekday: 3, points: [casa("c", ["t1"])] });
  assert.ok(options.every((option) => option.point === null));
  assert.deepEqual(options.map((option) => option.territoryId), ["t2", "t3", "t4", "t5", "t1"]);
});

test("prioridad: vuelta abierta primero (la más vieja), luego la última vez completada más lejana", () => {
  const order = prioritizeTerritories([
    { id: "hecho-reciente", openSince: null, lastCompleted: "2026-08-01" },
    { id: "nunca", openSince: null, lastCompleted: null },
    { id: "abierta-vieja", openSince: "2026-05-01", lastCompleted: "2025-01-01" },
    { id: "abierta-nueva", openSince: "2026-09-01", lastCompleted: null },
    { id: "hecho-viejo", openSince: null, lastCompleted: "2025-02-01" },
  ]);
  assert.deepEqual(order, ["abierta-vieja", "abierta-nueva", "nunca", "hecho-viejo", "hecho-reciente"]);
});

test("el lugar de una salida se reconoce por dirección o por 'dirección - nombre'", () => {
  const points = [casa("a", []), esquina("b", [])];
  assert.equal(pointLugar(points[0]), "Calle a - Casa a");
  assert.equal(matchPointByLugar(points, "calle a - casa a")?.id, "a");
  assert.equal(matchPointByLugar(points, " Esquina b ")?.id, "b");
  assert.equal(matchPointByLugar(points, "otro lugar"), null);
  assert.equal(matchPointByLugar(points, null), null);
});
