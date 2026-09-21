import "server-only";

import type { SessionProfile } from "@/lib/server/auth";
import {
  argentinaLocalToDate,
  currentReminderStage,
  datesForSelection,
  formatDeadlineEs,
  isWindowOpen,
  planningWeekStart,
  reminderMessage,
  reminderNaturalKey,
  validateResponseInput,
  windowServiceDates,
  windowTitle,
} from "@/modules/groups/group-outings";
import { changedSlotFields, type SlotSnapshot } from "@/modules/outings/workflow";
import { ApiError, forbid } from "@/server/api";
import { notifyPublishedSlotChange, type SlotRow } from "@/server/outings/actions";
import { isEligibleConductor, loadWeek, safeEmit, writeAudit, type AdminSupabase } from "@/server/outings/planning";
import type { PlanningAuthority } from "@/modules/outings/workflow";

export type Person = { id: string; full_name: string };
type WindowRow = { id: string; name: string; saturday_date: string | null; sunday_date: string | null; booking_deadline: string; active: boolean };
export type GroupCtx = { supabase: AdminSupabase; profile: SessionProfile; authority: PlanningAuthority };

const RESPONSIBILITIES = ["SUPERINTENDENTE_GRUPO", "AUXILIAR_GRUPO"];

/**
 * Superintendente + Auxiliar of a group. While a group has no V2 assignment yet,
 * its legacy elders (ANCIANO in that group) act as the responsibles, so live groups keep working.
 */
export async function groupResponsibles(supabase: AdminSupabase, groupId: string): Promise<Person[]> {
  let ids: string[] = [];
  const assigned = await supabase.from("group_responsibility_assignments").select("profile_id").eq("group_id", groupId).is("ended_at", null).in("responsibility", RESPONSIBILITIES);
  if (!assigned.error) ids = [...new Set((assigned.data ?? []).map((row) => row.profile_id as string))];
  if (!ids.length) {
    const { data: elders, error } = await supabase.from("profile_roles").select("profile_id, profiles!inner(group_id)").eq("role", "ANCIANO").eq("profiles.group_id", groupId);
    if (error) throw new Error(error.message);
    ids = (elders ?? []).map((row) => row.profile_id as string);
  }
  if (!ids.length) return [];
  const { data, error } = await supabase.from("profiles").select("id, full_name").in("id", ids).eq("active", true).order("full_name");
  if (error) throw new Error(error.message);
  return (data ?? []) as Person[];
}

async function loadWindow(supabase: AdminSupabase, windowId: string): Promise<WindowRow> {
  const { data, error } = await supabase.from("reservation_windows").select("id,name,saturday_date,sunday_date,booking_deadline,active").eq("id", windowId).maybeSingle();
  if (error) throw new Error(error.message);
  if (!data) throw new ApiError("Ventana no encontrada.", 404);
  return data as WindowRow;
}

async function activeGroups(supabase: AdminSupabase) {
  const { data, error } = await supabase.from("groups").select("id, name").eq("active", true).order("name");
  if (error) throw new Error(error.message);
  return (data ?? []) as { id: string; name: string }[];
}

/** Opens the group window for Saturday, Sunday or both and tells every group's responsibles. */
export async function openGroupOuting(ctx: GroupCtx, input: { saturday_date: string; days: "SATURDAY" | "SUNDAY" | "BOTH"; deadline_local: string }) {
  const { supabase, profile } = ctx;
  if (!ctx.authority.canPlan && !ctx.authority.canPublish) forbid("Solo quien planifica las salidas puede abrir una Salida por Grupo.");
  const dates = datesForSelection(input.saturday_date, input.days);
  if (!dates) throw new ApiError("Elegí un sábado válido.", 422);
  const deadline = argentinaLocalToDate(input.deadline_local);
  if (!deadline || deadline.getTime() <= Date.now()) throw new ApiError("La fecha límite debe estar en el futuro.", 422);

  const overlapping = await supabase.from("reservation_windows").select("id").eq("active", true).or([dates.saturday_date ? `saturday_date.eq.${dates.saturday_date}` : "", dates.sunday_date ? `sunday_date.eq.${dates.sunday_date}` : ""].filter(Boolean).join(","));
  if (overlapping.error) throw new Error(overlapping.error.message);
  if (overlapping.data?.length) throw new ApiError("Ya hay una ventana abierta para esas fechas.", 409);

  const name = windowTitle(dates);
  const { data: created, error } = await supabase.from("reservation_windows").insert({ name, ...dates, booking_deadline: deadline.toISOString(), active: true, created_by: profile.id }).select("id").single();
  if (error || !created) throw new Error(error?.message ?? "No se pudo abrir la ventana.");

  await writeAudit(supabase, { actorId: profile.id, action: "GROUP_WINDOW_OPENED", entityType: "reservation_window", entityId: created.id, metadata: { ...dates, deadline: deadline.toISOString() } });
  const detail = `Tenés hasta el ${formatDeadlineEs(deadline)} para completar la información (el lugar de salida es obligatorio).`;
  for (const group of await activeGroups(supabase)) {
    for (const person of await groupResponsibles(supabase, group.id)) {
      await safeEmit({ type: "GROUP_WINDOW_OPENED", naturalKey: `group-window:${created.id}:opened:${person.id}`, actorId: profile.id, payload: { recipientId: person.id, windowId: created.id, title: name, detail } });
    }
  }
  return { id: created.id };
}

/** Prórroga: only planners. The new deadline re-arms every reminder stage (it is part of the key). */
export async function extendWindowDeadline(ctx: GroupCtx, input: { window_id: string; deadline_local: string }) {
  const { supabase, profile } = ctx;
  if (!ctx.authority.canPlan && !ctx.authority.canPublish) forbid("Solo quien planifica las salidas puede dar una prórroga.");
  const window = await loadWindow(supabase, input.window_id);
  const deadline = argentinaLocalToDate(input.deadline_local);
  if (!deadline || deadline.getTime() <= Date.now()) throw new ApiError("La nueva fecha límite debe estar en el futuro.", 422);
  if (deadline.getTime() === new Date(window.booking_deadline).getTime()) throw new ApiError("Esa ya es la fecha límite actual.", 422);
  const { error } = await supabase.from("reservation_windows").update({ booking_deadline: deadline.toISOString(), updated_at: new Date().toISOString() }).eq("id", window.id);
  if (error) throw new Error(error.message);
  await writeAudit(supabase, { actorId: profile.id, action: "GROUP_WINDOW_DEADLINE_EXTENDED", entityType: "reservation_window", entityId: window.id, before: { deadline: window.booking_deadline }, after: { deadline: deadline.toISOString() } });

  const dates = windowServiceDates(window);
  for (const group of await pendingGroups(supabase, window.id, dates)) {
    for (const person of group.responsibles) {
      await safeEmit({ type: "GROUP_WINDOW_REMINDER", naturalKey: `group-window:${window.id}:${group.id}:${person.id}:extended:${deadline.toISOString()}`, actorId: profile.id, payload: { recipientId: person.id, windowId: window.id, title: window.name, detail: `Se extendió el plazo: ahora vence el ${formatDeadlineEs(deadline)}.` } });
    }
  }
  return {};
}

/** Groups that still owe at least one date of the window, with their responsibles. */
export async function pendingGroups(supabase: AdminSupabase, windowId: string, dates: string[]) {
  const { data: responses, error } = await supabase.from("group_outing_responses").select("group_id, service_date").eq("reservation_window_id", windowId);
  if (error) throw new Error(error.message);
  const answered = new Set((responses ?? []).map((row) => `${row.group_id}:${row.service_date}`));
  const pending: { id: string; name: string; responsibles: Person[] }[] = [];
  for (const group of await activeGroups(supabase)) {
    if (dates.every((date) => answered.has(`${group.id}:${date}`))) continue;
    pending.push({ ...group, responsibles: await groupResponsibles(supabase, group.id) });
  }
  return pending;
}

export type SaveResponseInput = { window_id: string; group_id: string; service_date: string; lugar: string; hora?: string | null; conductor_id?: string | null; territory_ids?: string[] };

/** Either responsible (or a planner) completes/edits the single shared response until the deadline. */
export async function saveGroupResponse(ctx: GroupCtx, input: SaveResponseInput) {
  const { supabase, profile } = ctx;
  const window = await loadWindow(supabase, input.window_id);
  if (!window.active) throw new ApiError("Esta ventana ya no está activa.", 409);
  if (!windowServiceDates(window).includes(input.service_date)) throw new ApiError("La fecha no pertenece a esta ventana.", 422);
  if (!isWindowOpen(window.booking_deadline)) throw new ApiError("La fecha límite ya pasó. Pedí una prórroga al Superintendente de Servicio o al Siervo de Territorios.", 409);

  const { data: group } = await supabase.from("groups").select("id, name, active").eq("id", input.group_id).maybeSingle();
  if (!group?.active) throw new ApiError("Grupo no encontrado.", 404);
  const responsibles = await groupResponsibles(supabase, group.id);
  const isPlanner = ctx.authority.canPlan || ctx.authority.canPublish;
  if (!responsibles.some((person) => person.id === profile.id) && !isPlanner) forbid("Solo el Superintendente o el Auxiliar del grupo pueden completar esta información.");

  const parsed = validateResponseInput(input);
  if (!parsed.ok) throw new ApiError(parsed.error, 422);
  const value = parsed.value;
  if (value.conductor_id && !(await isEligibleConductor(supabase, value.conductor_id, group.id))) throw new ApiError("El conductor debe tener la característica Conductor y pertenecer al grupo.", 422);

  if (value.territory_ids.length) {
    const { data: active, error } = await supabase.from("territories").select("id").in("id", value.territory_ids).eq("active", true);
    if (error) throw new Error(error.message);
    if ((active ?? []).length !== value.territory_ids.length) throw new ApiError("Uno de los territorios no está activo.", 422);
  }

  const existing = await supabase.from("group_outing_responses").select("id, completed_by").eq("reservation_window_id", window.id).eq("group_id", group.id).eq("service_date", input.service_date).maybeSingle();
  if (existing.error) throw new Error(existing.error.message);
  if (value.territory_ids.length) {
    // Checked before any write so a conflict never leaves a half-saved response behind.
    const { data: taken, error: takenError } = await supabase.from("territory_reservations").select("territory_id, group_response_id, territories(number)").in("territory_id", value.territory_ids).eq("service_date", input.service_date).eq("status", "ACTIVE");
    if (takenError) throw new Error(takenError.message);
    const conflicts = (taken ?? []).filter((row) => row.group_response_id !== (existing.data?.id ?? null));
    if (conflicts.length) {
      const numbers = conflicts.map((row) => (row as unknown as { territories: { number: string | number } | null }).territories?.number ?? "?").join(", ");
      throw new ApiError(`El territorio ${numbers} ya está reservado para esa fecha.`, 409);
    }
  }
  const now = new Date().toISOString();
  let responseId = existing.data?.id as string | undefined;
  const created = !responseId;
  if (responseId) {
    const { error } = await supabase.from("group_outing_responses").update({ lugar: value.lugar, hora: value.hora, conductor_id: value.conductor_id, updated_by: profile.id, updated_at: now }).eq("id", responseId);
    if (error) throw new Error(error.message);
  } else {
    const { data, error } = await supabase.from("group_outing_responses").insert({ reservation_window_id: window.id, group_id: group.id, service_date: input.service_date, lugar: value.lugar, hora: value.hora, conductor_id: value.conductor_id, completed_by: profile.id, updated_by: profile.id }).select("id").single();
    if (error || !data) throw new Error(error?.message ?? "No se pudo guardar la respuesta.");
    responseId = data.id as string;
  }

  await syncReservations(supabase, { responseId, window, groupId: group.id, serviceDate: input.service_date, lugar: value.lugar, territoryIds: value.territory_ids, actorId: profile.id });
  await syncPlanning(ctx, { responseId, groupId: group.id, serviceDate: input.service_date, lugar: value.lugar, hora: value.hora, conductorId: value.conductor_id, territoryIds: value.territory_ids });
  await writeAudit(supabase, { actorId: profile.id, action: created ? "GROUP_RESPONSE_COMPLETED" : "GROUP_RESPONSE_UPDATED", entityType: "group_outing_response", entityId: responseId, metadata: { window_id: window.id, group_id: group.id, service_date: input.service_date, on_behalf: !responsibles.some((person) => person.id === profile.id) }, after: value });

  if (created) {
    const title = `${group.name}: ${windowTitle(window).replace("Salida por Grupo: ", "")}`;
    for (const person of responsibles) {
      if (person.id === profile.id) continue;
      await safeEmit({ type: "GROUP_RESERVATION_COMPLETED", naturalKey: `group-response:${responseId}:completed:${person.id}`, actorId: profile.id, payload: { recipientId: person.id, windowId: window.id, title, detail: `Completado por ${profile.full_name}. Podés editarlo hasta el ${formatDeadlineEs(window.booking_deadline)}.` } });
    }
  }
  return { id: responseId };
}

async function syncReservations(supabase: AdminSupabase, input: { responseId: string; window: WindowRow; groupId: string; serviceDate: string; lugar: string; territoryIds: string[]; actorId: string }) {
  const { data: current, error } = await supabase.from("territory_reservations").select("id, territory_id").eq("group_response_id", input.responseId).eq("status", "ACTIVE");
  if (error) throw new Error(error.message);
  const wanted = new Set(input.territoryIds);
  const kept = (current ?? []).filter((row) => wanted.has(row.territory_id as string));
  const removed = (current ?? []).filter((row) => !wanted.has(row.territory_id as string));
  const keptIds = new Set(kept.map((row) => row.territory_id as string));
  const toAdd = input.territoryIds.filter((id) => !keptIds.has(id));

  if (removed.length) {
    const { error: cancelError } = await supabase.from("territory_reservations").update({ status: "CANCELLED", cancelled_at: new Date().toISOString() }).in("id", removed.map((row) => row.id as string));
    if (cancelError) throw new Error(cancelError.message);
  }
  if (kept.length) {
    const { error: updateError } = await supabase.from("territory_reservations").update({ departure_location: input.lugar }).in("id", kept.map((row) => row.id as string));
    if (updateError) throw new Error(updateError.message);
  }
  if (toAdd.length) {
    const serviceDay = new Date(`${input.serviceDate}T00:00:00Z`).getUTCDay() === 6 ? "SATURDAY" : "SUNDAY";
    const rows = toAdd.map((territoryId) => ({ reservation_window_id: input.window.id, territory_id: territoryId, group_id: input.groupId, responsible_user_id: input.actorId, service_date: input.serviceDate, service_day: serviceDay, departure_location: input.lugar, group_response_id: input.responseId, created_by: input.actorId }));
    const { error: insertError } = await supabase.from("territory_reservations").insert(rows);
    // The partial unique index is the authority on "one active reservation per territory/date".
    if (insertError?.code === "23505") throw new ApiError("Uno de los territorios ya está reservado para esa fecha por otro grupo.", 409);
    if (insertError) throw new Error(insertError.message);
  }
}

/** The response owns exactly one planning slot for its date; it is created/updated automatically. */
async function syncPlanning(ctx: GroupCtx, input: { responseId: string; groupId: string; serviceDate: string; lugar: string; hora: string | null; conductorId: string | null; territoryIds: string[] }) {
  const { supabase, profile } = ctx;
  const startsOn = planningWeekStart(input.serviceDate);
  let weekId: string | undefined;
  const found = await supabase.from("weekly_outings").select("id").eq("starts_on", startsOn).order("created_at").limit(1);
  if (found.error) throw new Error(found.error.message);
  weekId = found.data?.[0]?.id as string | undefined;
  if (!weekId) {
    const { data, error } = await supabase.from("weekly_outings").insert({ starts_on: startsOn, created_by: profile.id }).select("id").single();
    if (error || !data) throw new Error(error?.message ?? "No se pudo crear la semana de planificación.");
    weekId = data.id as string;
    await writeAudit(supabase, { actorId: profile.id, action: "WEEK_CREATED", entityType: "weekly_outing", entityId: weekId, metadata: { starts_on: startsOn, source: "group_response" } });
  }
  const week = await loadWeek(supabase, weekId);
  if (!week) return;

  const existing = await supabase.from("weekly_outing_slots").select("id,weekly_outing_id,slot_date,conductor_id,hora,lugar,note,highlighted,status").eq("group_response_id", input.responseId).maybeSingle();
  if (existing.error) throw new Error(existing.error.message);
  const now = new Date().toISOString();
  const after: Partial<SlotSnapshot> = { hora: input.hora, lugar: input.lugar, conductor_id: input.conductorId };
  let slotId: string;

  if (existing.data) {
    const slot = { ...existing.data, status: existing.data.status ?? "PROGRAMADA" } as SlotRow;
    slotId = slot.id;
    const changed = changedSlotFields(slot, after);
    const { error } = await supabase.from("weekly_outing_slots").update({ hora: input.hora, lugar: input.lugar, conductor_id: input.conductorId, slot_date: input.serviceDate, updated_at: now }).eq("id", slotId);
    if (error) throw new Error(error.message);
    if (changed.length) await notifyPublishedSlotChange({ supabase, profile, authority: { canPlan: false, canPublish: false } }, week, { slot, kind: "updated", changed, conductorAfter: input.conductorId, stamp: now });
  } else {
    const { data: siblings } = await supabase.from("weekly_outing_slots").select("sort_order").eq("weekly_outing_id", week.id).eq("slot_date", input.serviceDate).order("sort_order", { ascending: false }).limit(1);
    const { data, error } = await supabase
      .from("weekly_outing_slots")
      .insert({ weekly_outing_id: week.id, slot_date: input.serviceDate, sort_order: (siblings?.[0]?.sort_order ?? -1) + 1, hora: input.hora, lugar: input.lugar, conductor_id: input.conductorId, group_id: input.groupId, group_response_id: input.responseId })
      .select("id")
      .single();
    if (error || !data) throw new Error(error?.message ?? "No se pudo crear la salida en la planificación.");
    slotId = data.id as string;
    if (input.conductorId) {
      const fresh: SlotRow = { id: slotId, weekly_outing_id: week.id, slot_date: input.serviceDate, hora: input.hora, lugar: input.lugar, conductor_id: null, note: null, highlighted: false, status: "PROGRAMADA" };
      await notifyPublishedSlotChange({ supabase, profile, authority: { canPlan: false, canPublish: false } }, week, { slot: fresh, kind: "updated", changed: [], conductorAfter: input.conductorId, stamp: now });
    }
  }

  const { error: clearError } = await supabase.from("weekly_outing_slot_territories").delete().eq("slot_id", slotId);
  if (clearError) throw new Error(clearError.message);
  if (input.territoryIds.length) {
    const { error } = await supabase.from("weekly_outing_slot_territories").insert(input.territoryIds.map((territoryId, index) => ({ slot_id: slotId, territory_id: territoryId, sort_order: index })));
    if (error) throw new Error(error.message);
  }
}

/**
 * Scheduler entry: reminds the responsibles of every group that still owes a date.
 * Idempotent per (window, group, person, stage, deadline); a completed group is never reminded.
 */
export async function runGroupWindowReminders(supabase: AdminSupabase, now = new Date()) {
  const { data: windows, error } = await supabase.from("reservation_windows").select("id,name,saturday_date,sunday_date,booking_deadline,active").eq("active", true).gt("booking_deadline", now.toISOString());
  if (error) throw new Error(error.message);
  let emitted = 0;
  for (const window of (windows ?? []) as WindowRow[]) {
    const dates = windowServiceDates(window);
    if (!dates.length) continue;
    const deadline = new Date(window.booking_deadline);
    const due = currentReminderStage(now, deadline, [...dates].sort()[0]);
    if (!due) continue;
    for (const group of await pendingGroups(supabase, window.id, dates)) {
      for (const person of group.responsibles) {
        await safeEmit({ type: "GROUP_WINDOW_REMINDER", naturalKey: reminderNaturalKey(window.id, group.id, person.id, due.stage, deadline), payload: { recipientId: person.id, windowId: window.id, title: window.name, detail: reminderMessage(due.stage, deadline) } });
        emitted += 1;
      }
    }
  }
  return emitted;
}
