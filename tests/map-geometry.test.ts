import assert from "node:assert/strict";
import test from "node:test";

import { isSafeImageUrl, polygonArea, polygonCentroid, territoryMapState, toNormalizedPoint, toSvgPoints, validatePolygon } from "../src/modules/map/geometry";

test("una forma válida tiene 3+ puntos normalizados dentro del mapa", () => {
  const ok = validatePolygon([[0.1, 0.1], [0.5, 0.1], [0.3, 0.6]]);
  assert.ok(ok.ok);
  assert.equal(validatePolygon([[0, 0], [1, 1]]).ok, false);
  assert.equal(validatePolygon([[0, 0], [1, 1], [1.2, 0.5]]).ok, false);
  assert.equal(validatePolygon([[0, 0], [1, 1], [Number.NaN, 0.5]]).ok, false);
  assert.equal(validatePolygon([[0, 0], [1, 1], ["a", "b"]]).ok, false);
  assert.equal(validatePolygon("no").ok, false);
  assert.equal(validatePolygon(Array.from({ length: 501 }, () => [0.5, 0.5])).ok, false);
});

test("los puntos se redondean para no guardar ruido decimal", () => {
  const result = validatePolygon([[0.123456789, 0.1], [0.5, 0.2], [0.3, 0.6]]);
  assert.ok(result.ok);
  if (result.ok) assert.equal(result.points[0][0], 0.12346);
});

test("centroide y área de un cuadrado", () => {
  const square: [number, number][] = [[0.2, 0.2], [0.6, 0.2], [0.6, 0.6], [0.2, 0.6]];
  const [cx, cy] = polygonCentroid(square);
  assert.ok(Math.abs(cx - 0.4) < 1e-9 && Math.abs(cy - 0.4) < 1e-9);
  assert.ok(Math.abs(polygonArea(square) - 0.16) < 1e-9);
  // Una forma degenerada (puntos alineados) no rompe: cae al promedio de vértices.
  const line: [number, number][] = [[0, 0], [0.5, 0.5], [1, 1]];
  assert.deepEqual(polygonCentroid(line), [0.5, 0.5]);
});

test("el clic se convierte a coordenadas normalizadas y se recorta al mapa", () => {
  const rect = { left: 100, top: 50, width: 400, height: 200 };
  assert.deepEqual(toNormalizedPoint(300, 150, rect), [0.5, 0.5]);
  assert.deepEqual(toNormalizedPoint(50, 400, rect), [0, 1]);
  assert.equal(toSvgPoints([[0.1, 0.2], [0.3, 0.4]]), "0.1,0.2 0.3,0.4");
});

test("el estado del territorio en el mapa sigue la vuelta abierta o la última cerrada", () => {
  assert.equal(territoryMapState(true, true), "EN_CURSO");
  assert.equal(territoryMapState(true, false), "EN_CURSO");
  assert.equal(territoryMapState(false, true), "COMPLETADO");
  assert.equal(territoryMapState(false, false), "SIN_INICIAR");
});

test("solo se aceptan imágenes del propio sitio o https", () => {
  assert.equal(isSafeImageUrl("/maps/territorios.jpg"), true);
  assert.equal(isSafeImageUrl("https://cdn.example.com/mapa.jpg"), true);
  assert.equal(isSafeImageUrl("//evil.example.com/mapa.jpg"), false);
  assert.equal(isSafeImageUrl("javascript:alert(1)"), false);
  assert.equal(isSafeImageUrl("data:image/png;base64,AAA"), false);
  assert.equal(isSafeImageUrl("http://insecure.example.com/x.jpg"), false);
});
