import "server-only";

import { formatTemplateHora, planMaterialization, type TemplateSlot } from "@/modules/outings/recurring";
import type { AdminSupabase } from "./planning";

export async function loadTemplate(supabase: AdminSupabase): Promise<TemplateSlot[]> {
  const { data, error } = await supabase.from("recurring_outing_slots").select("id,isodow,hora,lugar,default_conductor_id,active,sort_order").order("isodow").order("hora");
  if (error) throw new Error(error.message);
  return (data ?? []).map((row) => ({ ...row, hora: formatTemplateHora(row.hora as string) })) as TemplateSlot[];
}

/**
 * Generates the week's slots from the recurring template (conductor = the starred default).
 * Idempotent: template rows already present in the week are skipped.
 */
export async function materializeTemplate(supabase: AdminSupabase, week: { id: string; starts_on: string }) {
  const template = await loadTemplate(supabase);
  if (!template.length) return 0;
  const { data: existing, error: existingError } = await supabase.from("weekly_outing_slots").select("template_slot_id").eq("weekly_outing_id", week.id).not("template_slot_id", "is", null);
  if (existingError) throw new Error(existingError.message);
  const already = new Set((existing ?? []).map((row) => row.template_slot_id as string));
  const rows = planMaterialization(week.starts_on, template, already).map((row) => ({ ...row, weekly_outing_id: week.id }));
  if (!rows.length) return 0;
  const { error } = await supabase.from("weekly_outing_slots").insert(rows);
  if (error) throw new Error(error.message);
  return rows.length;
}
