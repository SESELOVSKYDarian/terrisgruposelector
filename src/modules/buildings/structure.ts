/** A doorbell/apartment. The label is free TEXT ("A1", "2B", "PB-A", "1°A"): no numeric pattern is assumed. */
export type Unit = { id: string | null; label: string; row: number; col: number };

export const MAX_UNITS = 300;
export const MAX_LABEL_LENGTH = 20;
export const MAX_GRID = 99;

export function normalizeLabel(label: string) {
  return label.normalize("NFC").trim().replace(/\s+/g, " ");
}

/** Case-insensitive identity, matching the database's unique index on lower(btrim(label)). */
export function labelKey(label: string) {
  return normalizeLabel(label).toLowerCase();
}

export type StructureResult = { ok: true; units: Unit[] } | { ok: false; error: string };

export function validateUnits(input: Unit[]): StructureResult {
  if (input.length > MAX_UNITS) return { ok: false, error: `Un edificio admite hasta ${MAX_UNITS} timbres.` };
  const labels = new Set<string>();
  const cells = new Set<string>();
  const units: Unit[] = [];
  for (const raw of input) {
    const label = normalizeLabel(raw.label);
    if (!label) return { ok: false, error: "Hay un timbre sin nombre." };
    if (label.length > MAX_LABEL_LENGTH) return { ok: false, error: `El nombre «${label}» supera ${MAX_LABEL_LENGTH} caracteres.` };
    if (!Number.isInteger(raw.row) || !Number.isInteger(raw.col) || raw.row < 0 || raw.col < 0 || raw.row > MAX_GRID || raw.col > MAX_GRID) return { ok: false, error: "Posición de timbre inválida." };
    const key = labelKey(label);
    if (labels.has(key)) return { ok: false, error: `El timbre «${label}» está repetido.` };
    labels.add(key);
    const cell = `${raw.row}:${raw.col}`;
    if (cells.has(cell)) return { ok: false, error: "Dos timbres ocupan la misma posición de la grilla." };
    cells.add(cell);
    units.push({ id: raw.id, label, row: raw.row, col: raw.col });
  }
  return { ok: true, units: sortUnits(units) };
}

export function sortUnits(units: Unit[]) {
  return [...units].sort((a, b) => a.row - b.row || a.col - b.col);
}

/** Lays labels out row by row with `columns` per row (the default grid for a fresh building). */
export function autoLayout(labels: string[], columns = 2): Unit[] {
  const width = Math.max(1, columns);
  return labels.map((label, index) => ({ id: null, label: normalizeLabel(label), row: Math.floor(index / width), col: index % width }));
}

export function gridSize(units: Unit[]) {
  return { rows: units.reduce((max, unit) => Math.max(max, unit.row + 1), 0), cols: units.reduce((max, unit) => Math.max(max, unit.col + 1), 0) };
}

/** First free cell in row-major order, honouring the grid width already in use. */
export function nextFreeCell(units: Unit[]) {
  const { cols } = gridSize(units);
  const width = Math.max(1, cols);
  const taken = new Set(units.map((unit) => `${unit.row}:${unit.col}`));
  for (let index = 0; index <= units.length + width; index += 1) {
    const cell = { row: Math.floor(index / width), col: index % width };
    if (!taken.has(`${cell.row}:${cell.col}`)) return cell;
  }
  return { row: gridSize(units).rows, col: 0 };
}

/** Structured proposal stored with a "falta censar" report. */
export type DiffOp =
  | { op: "ADD"; label: string; row?: number; col?: number }
  | { op: "REMOVE"; label: string }
  | { op: "RENAME"; from: string; to: string }
  | { op: "MOVE"; label: string; row: number; col: number };

const find = (units: Unit[], label: string) => units.findIndex((unit) => labelKey(unit.label) === labelKey(label));

/**
 * Applies a structured correction to a structure. Pure and all-or-nothing: the first invalid
 * operation (unknown label, duplicate name, occupied cell) aborts and reports why, so a
 * partially applied correction can never be saved.
 */
export function applyDiff(current: Unit[], ops: DiffOp[]): StructureResult {
  let units = current.map((unit) => ({ ...unit }));
  for (const op of ops) {
    if (op.op === "ADD") {
      const label = normalizeLabel(op.label);
      if (!label) return { ok: false, error: "ADD sin nombre." };
      if (find(units, label) !== -1) return { ok: false, error: `El timbre «${label}» ya existe.` };
      const cell = op.row !== undefined && op.col !== undefined ? { row: op.row, col: op.col } : nextFreeCell(units);
      units.push({ id: null, label, row: cell.row, col: cell.col });
    } else if (op.op === "REMOVE") {
      const index = find(units, op.label);
      if (index === -1) return { ok: false, error: `No existe el timbre «${op.label}».` };
      units = units.filter((_, position) => position !== index);
    } else if (op.op === "RENAME") {
      const index = find(units, op.from);
      if (index === -1) return { ok: false, error: `No existe el timbre «${op.from}».` };
      const target = normalizeLabel(op.to);
      const clash = find(units, target);
      if (clash !== -1 && clash !== index) return { ok: false, error: `El timbre «${target}» ya existe.` };
      units[index] = { ...units[index], label: target };
    } else {
      const index = find(units, op.label);
      if (index === -1) return { ok: false, error: `No existe el timbre «${op.label}».` };
      units[index] = { ...units[index], row: op.row, col: op.col };
    }
  }
  return validateUnits(units);
}

export const censusReasons = ["FALTAN_TIMBRES", "ORDEN_INCORRECTO", "CAMBIO_NUMERACION", "OTRO"] as const;
export type CensusReason = (typeof censusReasons)[number];

export const censusReasonLabels: Record<CensusReason, string> = {
  FALTAN_TIMBRES: "Faltan timbres",
  ORDEN_INCORRECTO: "Orden incorrecto",
  CAMBIO_NUMERACION: "Cambió la numeración",
  OTRO: "Otro",
};

export const MAX_DIFF_OPS = 50;

/** Validates a structured proposal coming from the client before it is stored. */
export function parseDiffOps(input: unknown): { ok: true; ops: DiffOp[] } | { ok: false; error: string } {
  if (!Array.isArray(input)) return { ok: false, error: "La propuesta debe ser una lista de cambios." };
  if (input.length > MAX_DIFF_OPS) return { ok: false, error: `La propuesta admite hasta ${MAX_DIFF_OPS} cambios.` };
  const text = (value: unknown) => (typeof value === "string" && value.trim() ? normalizeLabel(value) : null);
  const int = (value: unknown) => (typeof value === "number" && Number.isInteger(value) && value >= 0 && value <= MAX_GRID ? value : null);
  const ops: DiffOp[] = [];
  for (const raw of input as Record<string, unknown>[]) {
    if (!raw || typeof raw !== "object") return { ok: false, error: "Cambio inválido." };
    if (raw.op === "ADD") {
      const label = text(raw.label);
      if (!label) return { ok: false, error: "ADD necesita un nombre." };
      const row = raw.row === undefined ? undefined : int(raw.row);
      const col = raw.col === undefined ? undefined : int(raw.col);
      if (row === null || col === null || (row === undefined) !== (col === undefined)) return { ok: false, error: "Posición inválida en ADD." };
      ops.push(row === undefined || col === undefined ? { op: "ADD", label } : { op: "ADD", label, row, col });
    } else if (raw.op === "REMOVE") {
      const label = text(raw.label);
      if (!label) return { ok: false, error: "REMOVE necesita un nombre." };
      ops.push({ op: "REMOVE", label });
    } else if (raw.op === "RENAME") {
      const from = text(raw.from);
      const to = text(raw.to);
      if (!from || !to) return { ok: false, error: "RENAME necesita el nombre actual y el nuevo." };
      ops.push({ op: "RENAME", from, to });
    } else if (raw.op === "MOVE") {
      const label = text(raw.label);
      const row = int(raw.row);
      const col = int(raw.col);
      if (!label || row === null || col === null) return { ok: false, error: "MOVE necesita nombre y posición." };
      ops.push({ op: "MOVE", label, row, col });
    } else {
      return { ok: false, error: "Tipo de cambio desconocido." };
    }
  }
  return { ok: true, ops };
}

/** Human summary of a proposal, e.g. "ADD A3 · RENAME 2B → 2C". */
export function describeDiff(ops: DiffOp[]) {
  return ops
    .map((op) => (op.op === "ADD" ? `ADD ${op.label}` : op.op === "REMOVE" ? `REMOVE ${op.label}` : op.op === "RENAME" ? `RENAME ${op.from} → ${op.to}` : `MOVE ${op.label} → fila ${op.row + 1}, col ${op.col + 1}`))
    .join(" · ");
}
