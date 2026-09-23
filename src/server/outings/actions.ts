import "server-only";

import { createAdminSupabaseClient, type SessionProfile } from "@/lib/server/auth";
import { fail, ok } from "@/lib/server/responses";
import { formatDateEs } from "@/modules/outings/time";
import {
  canDeleteWeek,
  canEditWeek,
  canPerformTransition,
  changedSlotFields,
  editNeedsSuperintendentNotice,
  isSlotStatus,
  nextPlanningStatus,
  shouldNotifyConductor,
  type PlanningAuthority,
  type PlanningTransition,
  type SlotSnapshot,
  type SlotStatus,
} from "@/modules/outings/workflow";
import {
  getPlanningAuthority,
  loadWeek,
  resolveReviewerIds,
  safeEmit,
  writeAudit,
  type AdminSupabase,
  type WeekRow,
} from "./planning";
import { autoFillWeek } from "./autofill";
import { materializeTemplate } from "./recurring";
import { assignPhoneNumbers, zoomAnnouncementDraft } from "@/server/telephone";

/** Every action that mutates the weekly plan. They all go through planning authority, not legacy ADMIN. */
export const OUTING_ACTIONS = new Set([
  "createWeeklyOuting",
  "deleteWeeklyOuting",
  "createWeeklyOutingSlot",
  "updateWeeklyOutingSlot",
  "deleteWeeklyOutingSlot",
  "setSlotTerritories",
  "setSlotStatus",
  "setSlotZoom",
  "switchSlotToZoom",
  "autoFillWeeklyOuting",
  "regenerateWeeklyOutingSlots",
  "upsertWeekendRoster",
  "submitWeeklyOuting",
  "returnWeeklyOutingToDraft",
  "publishWeeklyOuting",
]);

type Payload = Record<string, unknown> | undefined;
export type Ctx = { supabase: AdminSupabase; profile: SessionProfile; authority: PlanningAuthority };

export type SlotRow = SlotSnapshot & { id: string; weekly_outing_id: string; slot_date: string };

const SLOT_COLUMNS = "id,weekly_outing_id,slot_date,conductor_id,hora,lugar,note,highlighted,status";
const NOTIFIABLE_EXCLUDED = new Set(["destacada"]);

const forbidden = (message = "No tenés permiso para esta acción de planificación.") => fail(message, 403);

function migrationHint(message: string) {
  return /status|starts_at|submitted_|published_|audit_log/.test(message)
    ? `${message} Ejecutá supabase/fase-6-weekly-planning-workflow-migration.sql y volvé a intentar.`
    : message;
}

function text(value: unknown) {
  return value ? String(value) : null;
}

async function loadSlot(supabase: AdminSupabase, slotId: string): Promise<SlotRow | null> {
  const { data, error } = await supabase.from("weekly_outing_slots").select(SLOT_COLUMNS).eq("id", slotId).maybeSingle();
  if (error) throw new Error(migrationHint(error.message));
  if (!data) return null;
  return { ...data, status: (data.status ?? "PROGRAMADA") as SlotStatus } as SlotRow;
}

function slotSnapshot(slot: SlotRow): SlotSnapshot {
  return { hora: slot.hora, lugar: slot.lugar, conductor_id: slot.conductor_id, note: slot.note, highlighted: slot.highlighted, status: slot.status };
}

/**
 * Fans out the consequences of editing/cancelling a slot of a PUBLISHED week:
 * the affected conductor(s) and, when the editor cannot publish, the reviewers.
 * Drafts and weeks in review never notify conductors.
 */
export async function notifyPublishedSlotChange(
  ctx: Ctx,
  week: WeekRow,
  input: { slot: SlotRow; kind: "updated" | "cancelled"; changed: string[]; conductorAfter: string | null; stamp: string; detail?: string },
) {
  if (!shouldNotifyConductor(week.status)) return;
  const { supabase, profile, authority } = ctx;
  const { slot, kind, stamp } = input;
  const notifiable = input.changed.filter((field) => !NOTIFIABLE_EXCLUDED.has(field));
  const conductorBefore = slot.conductor_id;
  const conductorChanged = conductorBefore !== input.conductorAfter;
  if (!notifiable.length && !conductorChanged && kind !== "cancelled") return;

  const slotPayload = { slotId: slot.id, weeklyOutingId: week.id, slotDate: formatDateEs(slot.slot_date) };
  const changesDetail = input.detail ?? (notifiable.length ? `Cambios: ${notifiable.join(", ")}.` : undefined);
  const key = (name: string, recipientId: string) => `weekly-outing-slot:${slot.id}:${name}:${recipientId}:${stamp}`;

  if (kind === "cancelled") {
    const recipient = input.conductorAfter ?? conductorBefore;
    if (recipient && recipient !== profile.id) {
      await safeEmit({ type: "OUTING_CANCELLED", naturalKey: key("cancelled", recipient), actorId: profile.id, payload: { recipientId: recipient, ...slotPayload, audience: "conductor", detail: changesDetail } });
    }
  } else if (conductorChanged) {
    if (conductorBefore && conductorBefore !== profile.id) {
      await safeEmit({ type: "OUTING_UPDATED", naturalKey: key("unassigned", conductorBefore), actorId: profile.id, payload: { recipientId: conductorBefore, ...slotPayload, audience: "conductor", detail: "Ya no estás asignado a esta salida." } });
    }
    if (input.conductorAfter && input.conductorAfter !== profile.id) {
      await safeEmit({ type: "OUTING_ASSIGNED", naturalKey: key("assigned", input.conductorAfter), actorId: profile.id, payload: { recipientId: input.conductorAfter, ...slotPayload, audience: "conductor", detail: changesDetail } });
    }
  } else if (input.conductorAfter && input.conductorAfter !== profile.id) {
    await safeEmit({ type: "OUTING_UPDATED", naturalKey: key("updated", input.conductorAfter), actorId: profile.id, payload: { recipientId: input.conductorAfter, ...slotPayload, audience: "conductor", detail: changesDetail } });
  }

  if (editNeedsSuperintendentNotice(authority, week.status)) {
    const reviewers = await resolveReviewerIds(supabase);
    const summary = notifiable.length ? notifiable.join(", ") : kind === "cancelled" ? "cancelación" : "asignación";
    for (const reviewerId of reviewers) {
      if (reviewerId === profile.id) continue;
      await safeEmit({
        type: kind === "cancelled" ? "OUTING_CANCELLED" : "OUTING_UPDATED",
        naturalKey: key("reviewer", reviewerId),
        actorId: profile.id,
        payload: { recipientId: reviewerId, ...slotPayload, audience: "reviewer", detail: `Editada por ${profile.full_name}: ${summary}.` },
      });
    }
  }
}

async function transitionWeek(ctx: Ctx, weekId: string, transition: PlanningTransition) {
  const { supabase, profile, authority } = ctx;
  const week = await loadWeek(supabase, weekId);
  if (!week) return fail("Semana no encontrada.", 404);
  if (!canPerformTransition(authority, transition)) return forbidden("Esta acción corresponde a otro rol de planificación.");
  const target = nextPlanningStatus(week.status, transition);
  if (!target) return fail("La planificación no está en un estado que permita esta acción.", 409);

  const now = new Date().toISOString();
  const patch: Record<string, unknown> =
    transition === "SUBMIT"
      ? { status: target, submitted_at: now, submitted_by: profile.id }
      : transition === "RETURN_TO_DRAFT"
        ? { status: target }
        : { status: target, approved_at: now, approved_by: profile.id, published_at: now, published_by: profile.id };

  // Matching on the current status makes concurrent transitions lose cleanly instead of overwriting.
  const { data: updated, error } = await supabase.from("weekly_outings").update({ ...patch, updated_at: now }).eq("id", week.id).eq("status", week.status).select("id");
  if (error) return fail(migrationHint(error.message));
  if (!updated?.length) return fail("La planificación cambió mientras la editabas. Actualizá e intentá de nuevo.", 409);

  await writeAudit(supabase, {
    actorId: profile.id,
    action: transition === "SUBMIT" ? "WEEK_SUBMITTED" : transition === "RETURN_TO_DRAFT" ? "WEEK_RETURNED_TO_DRAFT" : "WEEK_PUBLISHED",
    entityType: "weekly_outing",
    entityId: week.id,
    metadata: { starts_on: week.starts_on },
    before: { status: week.status },
    after: { status: target },
  });

  const startsOn = formatDateEs(week.starts_on);
  const weekPayload = (recipientId: string) => ({ recipientId, outingId: week.id, startsOn });
  const key = (name: string, recipientId: string) => `weekly-outing:${week.id}:${name}:${now}:${recipientId}`;

  if (transition === "SUBMIT") {
    for (const reviewerId of await resolveReviewerIds(supabase)) {
      if (reviewerId !== profile.id) await safeEmit({ type: "OUTING_DRAFT_SUBMITTED", naturalKey: key("submitted", reviewerId), actorId: profile.id, payload: weekPayload(reviewerId) });
    }
  } else if (transition === "RETURN_TO_DRAFT") {
    for (const planner of new Set([week.submitted_by, week.created_by])) {
      if (planner && planner !== profile.id) await safeEmit({ type: "OUTING_DRAFT_RETURNED", naturalKey: key("returned", planner), actorId: profile.id, payload: weekPayload(planner) });
    }
  } else {
    if (week.submitted_by && week.submitted_by !== profile.id) {
      await safeEmit({ type: "OUTING_DRAFT_APPROVED", naturalKey: key("approved", week.submitted_by), actorId: profile.id, payload: weekPayload(week.submitted_by) });
    }
    const { data: slots } = await supabase.from("weekly_outing_slots").select("conductor_id,status").eq("weekly_outing_id", week.id);
    const conductors = new Set((slots ?? []).filter((slot) => slot.conductor_id && slot.status !== "CANCELADA").map((slot) => slot.conductor_id as string));
    for (const conductorId of conductors) {
      if (conductorId !== profile.id) await safeEmit({ type: "OUTING_PUBLISHED", naturalKey: key("published", conductorId), actorId: profile.id, payload: weekPayload(conductorId) });
    }
  }
  return ok({ status: target });
}

/** Authorizes editing a whole week (auto-fill / regenerate): returns a response when denied, null when allowed. */
async function guardWeekEdit(ctx: Ctx, weekId: string, auditAction: string) {
  const week = await loadWeek(ctx.supabase, weekId);
  if (!week) return fail("Semana no encontrada.", 404);
  if (!canEditWeek(ctx.authority, week.status)) return forbidden("Esta planificación no se puede editar en su estado actual.");
  if (week.status === "PUBLISHED") {
    await writeAudit(ctx.supabase, { actorId: ctx.profile.id, action: auditAction, entityType: "weekly_outing", entityId: week.id, metadata: { starts_on: week.starts_on } });
  }
  return null;
}

/** Returns a response when the action was handled (or denied), null when it is not an outing action. */
export async function handleOutingAction(action: string, payload: Payload, profile: SessionProfile): Promise<Response | null> {
  if (!OUTING_ACTIONS.has(action)) return null;
  const supabase = createAdminSupabaseClient();
  const authority = await getPlanningAuthority(profile);
  if (!authority.canPlan && !authority.canPublish) return forbidden();
  const ctx: Ctx = { supabase, profile, authority };

  try {
    if (action === "createWeeklyOuting") {
      const startsOn = String(payload?.starts_on ?? "");
      if (!/^\d{4}-\d{2}-\d{2}$/.test(startsOn) || new Date(`${startsOn}T00:00:00Z`).getUTCDay() !== 4) {
        return fail("La fecha de inicio debe ser un jueves.", 422);
      }
      const { data: outing, error } = await supabase.from("weekly_outings").insert({ starts_on: startsOn, created_by: profile.id }).select("id").single();
      if (error || !outing) return fail(migrationHint(error?.message ?? "No se pudo crear la semana."));
      await writeAudit(supabase, { actorId: profile.id, action: "WEEK_CREATED", entityType: "weekly_outing", entityId: outing.id, metadata: { starts_on: startsOn } });
      // New weeks start from the recurring template (starred conductors). A missing template
      // table (Fase 7 migration pending) simply means an empty week, as before.
      try {
        await materializeTemplate(supabase, { id: outing.id, starts_on: startsOn });
      } catch (templateError) {
        console.warn("No se pudo aplicar la plantilla semanal:", templateError);
      }
      return ok({ id: outing.id });
    }

    if (action === "submitWeeklyOuting") return transitionWeek(ctx, String(payload?.id ?? ""), "SUBMIT");
    if (action === "returnWeeklyOutingToDraft") return transitionWeek(ctx, String(payload?.id ?? ""), "RETURN_TO_DRAFT");
    if (action === "publishWeeklyOuting") return transitionWeek(ctx, String(payload?.id ?? ""), "PUBLISH");

    if (action === "autoFillWeeklyOuting" || action === "regenerateWeeklyOutingSlots") {
      const weekId = String(payload?.weekly_outing_id ?? "");
      const regenerate = action === "regenerateWeeklyOutingSlots";
      const slotIds = regenerate && Array.isArray(payload?.slot_ids) ? payload.slot_ids.map((id) => String(id)) : undefined;
      if (regenerate && !slotIds?.length) return fail("Elegí qué salidas regenerar.", 422);
      const denied = await guardWeekEdit(ctx, weekId, regenerate ? "WEEK_SLOTS_REGENERATED" : "WEEK_AUTOFILLED");
      if (denied) return denied;
      const result = await autoFillWeek(supabase, { weeklyOutingId: weekId, regenerateSlotIds: slotIds });
      if ("error" in result) return fail(migrationHint(result.error), result.status ?? 500);
      if (regenerate && result.filled === 0) return fail("No hay otra opción distinta disponible: los territorios y puntos cercanos ya están en uso o no aplican a ese día.", 409);
      if (regenerate) {
        const week = await loadWeek(supabase, weekId);
        const stamp = new Date().toISOString();
        for (const change of result.changes) {
          const changedSlot = week?.status === "PUBLISHED" ? await loadSlot(supabase, change.slotId) : null;
          if (week && changedSlot) {
            await notifyPublishedSlotChange(ctx, week, { slot: changedSlot, kind: "updated", changed: change.lugarChanged ? ["lugar", "territorios"] : ["territorios"], conductorAfter: changedSlot.conductor_id, stamp });
          }
        }
      }
      return ok({ filled: result.filled, skipped: result.skipped });
    }

    if (action === "upsertWeekendRoster") {
      const serviceDate = String(payload?.service_date ?? "");
      if (!/^\d{4}-\d{2}-\d{2}$/.test(serviceDate)) return fail("Fecha inválida.", 422);
      const weekday = new Date(`${serviceDate}T00:00:00Z`).getUTCDay();
      if (weekday !== 6 && weekday !== 0) return fail("La fecha debe ser sábado o domingo.", 422);
      const conductorId = text(payload?.conductor_id);
      const groupId = text(payload?.group_id);
      if (conductorId && groupId) return fail("Elegí un conductor o un grupo, no ambos.", 422);
      if (!conductorId && !groupId) {
        const { error } = await supabase.from("weekend_roster").delete().eq("service_date", serviceDate);
        if (error) return fail(migrationHint(error.message));
        return ok();
      }
      if (groupId) {
        const { data: group } = await supabase.from("groups").select("id").eq("id", groupId).maybeSingle();
        if (!group) return fail("El grupo no existe.", 422);
      }
      const { error } = await supabase.from("weekend_roster").upsert({ service_date: serviceDate, conductor_id: conductorId, group_id: groupId, updated_at: new Date().toISOString() }, { onConflict: "service_date" });
      if (error) return fail(migrationHint(error.message.includes("group_id") || error.message.includes("conductor_id") ? `${error.message} Ejecutá supabase/fase-24-group-designation.sql y volvé a intentar.` : error.message));
      return ok();
    }

    if (action === "deleteWeeklyOuting") {
      const week = await loadWeek(supabase, String(payload?.id ?? ""));
      if (!week) return fail("Semana no encontrada.", 404);
      if (!canDeleteWeek(authority, week.status)) return forbidden("Solo el Superintendente de Servicio puede eliminar una planificación en revisión o publicada.");
      const { data: slots } = await supabase.from("weekly_outing_slots").select(SLOT_COLUMNS).eq("weekly_outing_id", week.id);
      const { error } = await supabase.from("weekly_outings").delete().eq("id", week.id);
      if (error) return fail(error.message);
      await writeAudit(supabase, { actorId: profile.id, action: "WEEK_DELETED", entityType: "weekly_outing", entityId: week.id, metadata: { starts_on: week.starts_on }, before: { status: week.status, slots: slots ?? [] } });
      return ok();
    }

    if (action === "createWeeklyOutingSlot") {
      const weekId = String(payload?.weekly_outing_id ?? "");
      const week = await loadWeek(supabase, weekId);
      if (!week) return fail("Semana no encontrada.", 404);
      if (!canEditWeek(authority, week.status)) return forbidden("Esta planificación no se puede editar en su estado actual.");
      const { data: siblings } = await supabase.from("weekly_outing_slots").select("sort_order").eq("weekly_outing_id", weekId).eq("slot_date", String(payload?.slot_date)).order("sort_order", { ascending: false }).limit(1);
      const nextOrder = (siblings?.[0]?.sort_order ?? -1) + 1;
      const { error } = await supabase.from("weekly_outing_slots").insert({ weekly_outing_id: weekId, slot_date: String(payload?.slot_date), sort_order: nextOrder });
      if (error) return fail(error.message);
      return ok();
    }

    // Everything below operates on an existing slot and its week.
    const slotId = String(payload?.id ?? payload?.slot_id ?? "");
    const slot = await loadSlot(supabase, slotId);
    if (!slot) return fail("Salida no encontrada.", 404);
    const week = await loadWeek(supabase, slot.weekly_outing_id);
    if (!week) return fail("Semana no encontrada.", 404);
    if (!canEditWeek(authority, week.status)) return forbidden("Esta planificación no se puede editar en su estado actual.");
    const now = new Date().toISOString();
    const before = slotSnapshot(slot);
    const published = week.status === "PUBLISHED";

    if (action === "setSlotZoom" || action === "switchSlotToZoom") {
      const zoom = action === "switchSlotToZoom" ? true : Boolean(payload?.zoom);
      // Rain: only the Superintendente de Servicio may turn an already published outing into a Zoom one.
      if (published && !authority.canPublish) return forbidden("Cambiar una salida publicada a Zoom corresponde al Superintendente de Servicio.");
      const { data: current } = await supabase.from("weekly_outing_slots").select("is_zoom, lugar").eq("id", slot.id).single();
      if (Boolean(current?.is_zoom) === zoom) return ok({ zoom, unchanged: true });

      if (zoom) {
        const { data: primary } = await supabase.from("weekly_outing_slot_territories").select("territory_id").eq("slot_id", slot.id).order("sort_order").limit(1).maybeSingle();
        if (!primary) return fail("Asigná un territorio a la salida antes de pasarla a Zoom.", 422);
        const { error } = await supabase.from("weekly_outing_slots").update({ is_zoom: true, lugar: "Zoom", updated_at: now }).eq("id", slot.id);
        if (error) return fail(migrationHint(error.message));
        const assignment = await assignPhoneNumbers(supabase, { slotId: slot.id, primaryTerritoryId: primary.territory_id as string, actorId: profile.id });
        await writeAudit(supabase, { actorId: profile.id, action: "SLOT_SWITCHED_TO_ZOOM", entityType: "weekly_outing_slot", entityId: slot.id, metadata: { weekly_outing_id: week.id, slot_date: slot.slot_date, week_status: week.status, rain: action === "switchSlotToZoom" }, before: { lugar: slot.lugar, is_zoom: false }, after: { lugar: "Zoom", is_zoom: true, territories: assignment.territory_ids.length, numbers: assignment.total } });
        if (published) await notifyPublishedSlotChange(ctx, week, { slot, kind: "updated", changed: ["lugar"], conductorAfter: slot.conductor_id, stamp: now, detail: "La salida se realizará por Zoom." });
        return ok({ zoom: true, numbers: assignment.total, territories: assignment.territory_ids.length, announcement: published ? zoomAnnouncementDraft(slot.slot_date, slot.hora) : null });
      }

      const { count } = await supabase.from("telephone_call_results").select("id", { count: "exact", head: true }).eq("slot_id", slot.id);
      if (count) return fail("Ya hay resultados telefónicos registrados: no se puede quitar Zoom.", 409);
      const cleared = await supabase.from("telephone_assignments").delete().eq("slot_id", slot.id);
      if (cleared.error) return fail(cleared.error.message);
      const restoredLugar = current?.lugar === "Zoom" ? null : current?.lugar ?? null;
      const { error } = await supabase.from("weekly_outing_slots").update({ is_zoom: false, lugar: restoredLugar, updated_at: now }).eq("id", slot.id);
      if (error) return fail(migrationHint(error.message));
      await writeAudit(supabase, { actorId: profile.id, action: "SLOT_ZOOM_REMOVED", entityType: "weekly_outing_slot", entityId: slot.id, metadata: { weekly_outing_id: week.id, slot_date: slot.slot_date, week_status: week.status }, before: { lugar: current?.lugar, is_zoom: true }, after: { lugar: restoredLugar, is_zoom: false } });
      if (published) await notifyPublishedSlotChange(ctx, week, { slot, kind: "updated", changed: ["lugar"], conductorAfter: slot.conductor_id, stamp: now, detail: "La salida volvió a ser presencial." });
      return ok({ zoom: false });
    }

    if (action === "updateWeeklyOutingSlot") {
      const patch: Record<string, unknown> = { updated_at: now };
      const after: Partial<SlotSnapshot> = {};
      if (payload?.hora !== undefined) { after.hora = text(payload.hora); patch.hora = after.hora; }
      if (payload?.lugar !== undefined) { after.lugar = text(payload.lugar); patch.lugar = after.lugar; }
      if (payload?.conductor_id !== undefined) { after.conductor_id = text(payload.conductor_id); patch.conductor_id = after.conductor_id; }
      if (payload?.highlighted !== undefined) { after.highlighted = Boolean(payload.highlighted); patch.highlighted = after.highlighted; }
      if (payload?.note !== undefined) { after.note = text(payload.note); patch.note = after.note; }
      // Designated group (instead of a conductor). Outings born from a group's own response are edited there.
      let groupBefore: string | null = null;
      let groupAfter: string | null = null;
      let groupChanged = false;
      if (payload?.group_id !== undefined) {
        const { data: current, error: currentError } = await supabase.from("weekly_outing_slots").select("group_id, group_response_id").eq("id", slot.id).single();
        if (currentError) return fail(migrationHint(currentError.message));
        if (current?.group_response_id) return fail("Esta salida la carga el grupo desde su respuesta: se edita desde ahí.", 409);
        groupBefore = (current?.group_id as string | null) ?? null;
        groupAfter = text(payload.group_id);
        if (groupAfter) {
          const { data: group } = await supabase.from("groups").select("id").eq("id", groupAfter).maybeSingle();
          if (!group) return fail("El grupo no existe.", 422);
          // A designated group replaces the conductor unless the caller says otherwise.
          if (payload?.conductor_id === undefined) { after.conductor_id = null; patch.conductor_id = null; }
        }
        groupChanged = groupBefore !== groupAfter;
        patch.group_id = groupAfter;
      }
      const changed = [...changedSlotFields(before, after), ...(groupChanged ? ["grupo"] : [])];
      const { error } = await supabase.from("weekly_outing_slots").update(patch).eq("id", slot.id);
      if (error) return fail(migrationHint(error.message));
      if (published && changed.length) {
        const changedKeys = (Object.keys(after) as (keyof SlotSnapshot)[]).filter((field) => after[field] !== undefined && after[field] !== before[field]);
        await writeAudit(supabase, {
          actorId: profile.id,
          action: "SLOT_UPDATED_AFTER_PUBLISH",
          entityType: "weekly_outing_slot",
          entityId: slot.id,
          metadata: { weekly_outing_id: week.id, slot_date: slot.slot_date },
          before: { ...Object.fromEntries(changedKeys.map((field) => [field, before[field]])), ...(groupChanged ? { group_id: groupBefore } : {}) },
          after: { ...Object.fromEntries(changedKeys.map((field) => [field, after[field]])), ...(groupChanged ? { group_id: groupAfter } : {}) },
        });
        await notifyPublishedSlotChange(ctx, week, { slot, kind: "updated", changed, conductorAfter: after.conductor_id !== undefined ? after.conductor_id : slot.conductor_id, stamp: now });
      }
      return ok();
    }

    if (action === "setSlotStatus") {
      if (!isSlotStatus(payload?.status)) return fail("Estado de salida inválido.", 422);
      const status = payload.status;
      if (status === slot.status) return ok();
      const { error } = await supabase.from("weekly_outing_slots").update({ status, updated_at: now, cancelled_at: status === "CANCELADA" ? now : null, cancelled_by: status === "CANCELADA" ? profile.id : null }).eq("id", slot.id);
      if (error) return fail(migrationHint(error.message));
      await writeAudit(supabase, { actorId: profile.id, action: status === "CANCELADA" ? "SLOT_CANCELLED" : "SLOT_STATUS_CHANGED", entityType: "weekly_outing_slot", entityId: slot.id, metadata: { weekly_outing_id: week.id, slot_date: slot.slot_date, week_status: week.status }, before: { status: slot.status }, after: { status } });
      if (status === "CANCELADA") await notifyPublishedSlotChange(ctx, week, { slot, kind: "cancelled", changed: ["estado"], conductorAfter: slot.conductor_id, stamp: now });
      return ok();
    }

    if (action === "deleteWeeklyOutingSlot") {
      const { error } = await supabase.from("weekly_outing_slots").delete().eq("id", slot.id);
      if (error) return fail(error.message);
      if (published) {
        await writeAudit(supabase, { actorId: profile.id, action: "SLOT_DELETED_AFTER_PUBLISH", entityType: "weekly_outing_slot", entityId: slot.id, metadata: { weekly_outing_id: week.id, slot_date: slot.slot_date }, before: slot });
        await notifyPublishedSlotChange(ctx, week, { slot, kind: "cancelled", changed: [], conductorAfter: slot.conductor_id, stamp: now, detail: "La salida fue eliminada de la planificación." });
      }
      return ok();
    }

    if (action === "setSlotTerritories") {
      const entries = Array.isArray(payload?.territories) ? payload.territories : [];
      const { data: existing } = await supabase.from("weekly_outing_slot_territories").select("territory_id,sort_order").eq("slot_id", slot.id).order("sort_order");
      const beforeIds = (existing ?? []).map((row) => row.territory_id as string);
      const afterIds = entries.map((entry) => String((entry as Record<string, unknown>).territory_id));

      const { error: deleteError } = await supabase.from("weekly_outing_slot_territories").delete().eq("slot_id", slot.id);
      if (deleteError) return fail(deleteError.message);
      const rows = entries.map((entry, index) => {
        const item = entry as Record<string, unknown>;
        return { slot_id: slot.id, territory_id: String(item.territory_id), territory_round_id: text(item.territory_round_id), display_override: text(item.display_override), sort_order: index };
      });
      if (rows.length) {
        const { error } = await supabase.from("weekly_outing_slot_territories").insert(rows);
        if (error) return fail(error.message);
      }
      if (published && JSON.stringify(beforeIds) !== JSON.stringify(afterIds)) {
        await writeAudit(supabase, { actorId: profile.id, action: "SLOT_TERRITORIES_CHANGED_AFTER_PUBLISH", entityType: "weekly_outing_slot", entityId: slot.id, metadata: { weekly_outing_id: week.id, slot_date: slot.slot_date }, before: { territory_ids: beforeIds }, after: { territory_ids: afterIds } });
        await notifyPublishedSlotChange(ctx, week, { slot, kind: "updated", changed: ["territorios"], conductorAfter: slot.conductor_id, stamp: now });
      }
      return ok();
    }

    return null;
  } catch (error) {
    return fail(error instanceof Error ? migrationHint(error.message) : "Error inesperado.", 500);
  }
}
