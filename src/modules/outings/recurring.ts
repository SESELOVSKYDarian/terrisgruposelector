export type TemplateSlot = {
  id: string;
  isodow: number;
  hora: string;
  lugar: string | null;
  default_conductor_id: string | null;
  /** Designated group instead of a fixed conductor (never both). */
  default_group_id?: string | null;
  active: boolean;
  sort_order: number;
};

export type MaterializedSlot = {
  template_slot_id: string;
  slot_date: string;
  hora: string;
  lugar: string | null;
  conductor_id: string | null;
  group_id: string | null;
  sort_order: number;
};

export const isoWeekdayNames = ["", "Lunes", "Martes", "Miércoles", "Jueves", "Viernes", "Sábado", "Domingo"] as const;

/** Planning weeks run Thursday → Wednesday: days after the start date for an ISO weekday. */
export function weekOffsetForIsoDow(isodow: number) {
  return (isodow - 4 + 7) % 7;
}

export function addDaysIso(date: string, days: number) {
  const base = new Date(`${date}T00:00:00Z`);
  base.setUTCDate(base.getUTCDate() + days);
  return base.toISOString().slice(0, 10);
}

/** Postgres `time` arrives as "HH:MM:SS"; slots and forms use "HH:MM". */
export function formatTemplateHora(time: string) {
  const match = /^(\d{1,2}):(\d{2})/.exec(time);
  return match ? `${match[1].padStart(2, "0")}:${match[2]}` : time;
}

export function isValidHora(value: string) {
  return /^([01]\d|2[0-3]):[0-5]\d$/.test(value);
}

/**
 * Rows to insert so a week reflects the recurring template. Slots already
 * generated from a template row are skipped, which makes re-applying idempotent.
 */
export function planMaterialization(startsOn: string, template: TemplateSlot[], alreadyMaterialized: ReadonlySet<string>): MaterializedSlot[] {
  const perDay = new Map<number, number>();
  return [...template]
    .filter((slot) => slot.active && !alreadyMaterialized.has(slot.id))
    .sort((a, b) => weekOffsetForIsoDow(a.isodow) - weekOffsetForIsoDow(b.isodow) || a.hora.localeCompare(b.hora) || a.sort_order - b.sort_order)
    .map((slot) => {
      const order = perDay.get(slot.isodow) ?? 0;
      perDay.set(slot.isodow, order + 1);
      return {
        template_slot_id: slot.id,
        slot_date: addDaysIso(startsOn, weekOffsetForIsoDow(slot.isodow)),
        hora: formatTemplateHora(slot.hora),
        lugar: slot.lugar,
        conductor_id: slot.default_conductor_id,
        group_id: slot.default_group_id ?? null,
        sort_order: order,
      };
    });
}

/** Fields where a week's slot departs from its template ("ajustada esta semana"). */
export function templateOverrides(slot: { hora: string | null; conductor_id: string | null }, template: Pick<TemplateSlot, "hora" | "default_conductor_id">) {
  const overrides: ("hora" | "conductor")[] = [];
  if ((slot.hora ?? "") !== formatTemplateHora(template.hora)) overrides.push("hora");
  if ((slot.conductor_id ?? null) !== (template.default_conductor_id ?? null)) overrides.push("conductor");
  return overrides;
}
