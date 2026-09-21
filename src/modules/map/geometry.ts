export type Point = [number, number];

export const MAX_POLYGON_POINTS = 500;

/** Shapes are stored as normalized [x, y] pairs (0..1) over the map image. */
export function validatePolygon(input: unknown): { ok: true; points: Point[] } | { ok: false; error: string } {
  if (!Array.isArray(input)) return { ok: false, error: "La forma debe ser una lista de puntos." };
  if (input.length < 3) return { ok: false, error: "Una forma necesita al menos 3 puntos." };
  if (input.length > MAX_POLYGON_POINTS) return { ok: false, error: `Una forma admite hasta ${MAX_POLYGON_POINTS} puntos.` };
  const points: Point[] = [];
  for (const raw of input) {
    if (!Array.isArray(raw) || raw.length !== 2) return { ok: false, error: "Cada punto debe ser [x, y]." };
    const [x, y] = raw as unknown[];
    if (typeof x !== "number" || typeof y !== "number" || !Number.isFinite(x) || !Number.isFinite(y) || x < 0 || x > 1 || y < 0 || y > 1) {
      return { ok: false, error: "Los puntos deben estar dentro del mapa." };
    }
    points.push([round(x), round(y)]);
  }
  return { ok: true, points };
}

const round = (value: number) => Math.round(value * 100000) / 100000;

/** Twice the signed area (shoelace); its magnitude is zero for degenerate, collinear shapes. */
function signedArea2(points: Point[]) {
  return points.reduce((total, [x1, y1], index) => {
    const [x2, y2] = points[(index + 1) % points.length];
    return total + (x1 * y2 - x2 * y1);
  }, 0);
}

export function polygonArea(points: Point[]) {
  return Math.abs(signedArea2(points)) / 2;
}

/** Area-weighted centroid; falls back to the average of the vertices for degenerate shapes. */
export function polygonCentroid(points: Point[]): Point {
  const area2 = signedArea2(points);
  if (Math.abs(area2) < 1e-12) {
    return [points.reduce((sum, [x]) => sum + x, 0) / points.length, points.reduce((sum, [, y]) => sum + y, 0) / points.length];
  }
  let cx = 0;
  let cy = 0;
  points.forEach(([x1, y1], index) => {
    const [x2, y2] = points[(index + 1) % points.length];
    const cross = x1 * y2 - x2 * y1;
    cx += (x1 + x2) * cross;
    cy += (y1 + y2) * cross;
  });
  return [cx / (3 * area2), cy / (3 * area2)];
}

/** SVG `points` attribute for a viewBox of "0 0 1 1". */
export function toSvgPoints(points: Point[]) {
  return points.map(([x, y]) => `${x},${y}`).join(" ");
}

/** Click position inside the rendered image -> normalized coordinates (clamped to the image). */
export function toNormalizedPoint(clientX: number, clientY: number, rect: { left: number; top: number; width: number; height: number }): Point {
  const clamp = (value: number) => Math.min(1, Math.max(0, value));
  return [round(clamp((clientX - rect.left) / rect.width)), round(clamp((clientY - rect.top) / rect.height))];
}

export type TerritoryMapState = "SIN_INICIAR" | "EN_CURSO" | "COMPLETADO";

/**
 * A territory with an open round is EN_CURSO; once a round closes (every block done) it shows
 * COMPLETADO until the next one starts; a territory with no round at all is SIN_INICIAR.
 */
export function territoryMapState(hasOpenRound: boolean, hasCompletedRound: boolean): TerritoryMapState {
  if (hasOpenRound) return "EN_CURSO";
  return hasCompletedRound ? "COMPLETADO" : "SIN_INICIAR";
}

/** Same-origin path or https URL only: never javascript:, data: or protocol-relative URLs. */
export function isSafeImageUrl(value: string) {
  return /^(\/(?!\/)[A-Za-z0-9_./%-]+|https:\/\/[^\s]+)$/.test(value);
}
