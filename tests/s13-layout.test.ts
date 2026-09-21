import assert from "node:assert/strict";
import test from "node:test";

import { S13_SLOTS_PER_PAGE, buildS13Pages, formatS13Date, type S13Round } from "../src/modules/s13/layout";

const round = (id: string, assigned: string, completed: string | null, name: string): S13Round => ({ id, assigned_on: assigned, completed_on: completed, conductor_name: name });

test("las fechas se imprimen como en el documento: día-mes-año sin ceros", () => {
  assert.equal(formatS13Date("2026-07-05"), "5-7-26");
  assert.equal(formatS13Date("2026-10-15"), "15-10-26");
  assert.equal(formatS13Date(null), "");
  assert.equal(formatS13Date("no"), "");
});

test("caso 1: el territorio 24 muestra a Pérez (asignado y completado) y luego a Navarro", () => {
  const pages = buildS13Pages([{ number: 24, rounds: [round("r1", "2026-07-05", "2026-08-10", "Pérez J."), round("r2", "2026-08-12", "2026-09-10", "Navarro W.")] }]);
  assert.equal(pages.length, 1);
  const [row] = pages[0].rows;
  assert.equal(row.slots.length, S13_SLOTS_PER_PAGE);
  assert.deepEqual([row.slots[0]?.conductor, row.slots[0]?.assigned_on, row.slots[0]?.completed_on], ["Pérez J.", "2026-07-05", "2026-08-10"]);
  assert.equal(row.slots[1]?.conductor, "Navarro W.");
  assert.equal(row.slots[2], null);
  assert.equal(row.slots[3], null);
});

test("al llenarse las cuatro rondas visibles se crea una página nueva que arranca en la quinta ronda", () => {
  const rounds = Array.from({ length: 5 }, (_, index) => round(`r${index + 1}`, `2026-0${index + 1}-01`, `2026-0${index + 1}-20`, `C${index + 1}`));
  const pages = buildS13Pages([{ number: 3, rounds }]);
  assert.equal(pages.length, 2);
  assert.deepEqual(pages[0].rows[0].slots.map((slot) => slot?.round_id), ["r1", "r2", "r3", "r4"]);
  assert.deepEqual(pages[1].rows[0].slots.map((slot) => slot?.round_id ?? null), ["r5", null, null, null]);
});

test("la columna 'última fecha en que se completó' toma la de la última ronda de la página anterior", () => {
  const rounds = Array.from({ length: 5 }, (_, index) => round(`r${index + 1}`, `2026-0${index + 1}-01`, `2026-0${index + 1}-20`, `C${index + 1}`));
  const pages = buildS13Pages([{ number: 3, rounds, legacy_last_completed_on: "2025-12-01" }]);
  // Página 1: historia previa al seguimiento por vueltas.
  assert.equal(pages[0].rows[0].last_completed_on, "2025-12-01");
  // Página 2: fecha de completado de la 4ª ronda (r4).
  assert.equal(pages[1].rows[0].last_completed_on, "2026-04-20");
});

test("una página nueva existe para todos los territorios, aunque otros tengan pocas rondas", () => {
  const busy = Array.from({ length: 5 }, (_, index) => round(`b${index}`, `2026-0${index + 1}-01`, `2026-0${index + 1}-20`, "X"));
  const pages = buildS13Pages([
    { number: 2, rounds: [round("q1", "2026-02-01", "2026-02-10", "Y")] },
    { number: 1, rounds: busy },
  ]);
  assert.equal(pages.length, 2);
  // Ordenados por número de territorio.
  assert.deepEqual(pages[1].rows.map((row) => row.territory_number), [1, 2]);
  assert.deepEqual(pages[1].rows[1].slots, [null, null, null, null]);
  assert.equal(pages[1].rows[1].last_completed_on, null);
});

test("una ronda abierta se muestra sin fecha de completado y las rondas se ordenan por asignación", () => {
  const pages = buildS13Pages([{ number: 5, rounds: [round("open", "2026-09-01", null, "Gómez L."), round("done", "2026-03-01", "2026-04-01", "Pérez J.")] }]);
  const slots = pages[0].rows[0].slots;
  assert.equal(slots[0]?.round_id, "done");
  assert.equal(slots[1]?.round_id, "open");
  assert.equal(slots[1]?.completed_on, null);
});
