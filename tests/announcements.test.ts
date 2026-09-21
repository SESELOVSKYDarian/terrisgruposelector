import assert from "node:assert/strict";
import test from "node:test";

import { ANNOUNCEMENT_DESCRIPTION_MAX, ANNOUNCEMENT_TITLE_MAX, chunk, validateAnnouncement } from "../src/modules/announcements/validation";

test("un anuncio necesita título y descripción", () => {
  assert.equal(validateAnnouncement({ title: "  ", description: "x" }).ok, false);
  assert.equal(validateAnnouncement({ title: "Hola", description: "  " }).ok, false);
  assert.equal(validateAnnouncement({}).ok, false);
});

test("se limpian espacios y saltos de línea Windows", () => {
  const result = validateAnnouncement({ title: "  Salida   del  miércoles ", description: " Línea 1\r\nLínea 2 \n" });
  assert.ok(result.ok);
  if (result.ok) assert.deepEqual(result.value, { title: "Salida del miércoles", description: "Línea 1\nLínea 2" });
});

test("los límites de longitud se respetan", () => {
  assert.equal(validateAnnouncement({ title: "a".repeat(ANNOUNCEMENT_TITLE_MAX + 1), description: "x" }).ok, false);
  assert.equal(validateAnnouncement({ title: "a", description: "x".repeat(ANNOUNCEMENT_DESCRIPTION_MAX + 1) }).ok, false);
  assert.equal(validateAnnouncement({ title: "a".repeat(ANNOUNCEMENT_TITLE_MAX), description: "x" }).ok, true);
});

test("el reparto a destinatarios se hace en tandas", () => {
  assert.deepEqual(chunk([1, 2, 3, 4, 5], 2), [[1, 2], [3, 4], [5]]);
  assert.deepEqual(chunk([], 10), []);
});
