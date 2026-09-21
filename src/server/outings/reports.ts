import "server-only";

import type { SessionProfile } from "@/lib/server/auth";
import { allLabelsKnown, priorDoneLabels } from "@/modules/territories/rounds";
import { addDaysIso } from "@/modules/outings/recurring";
import { argentinaToday, formatDateEs } from "@/modules/outings/time";
import { formatConductorName } from "@/modules/territories/names";
import type { PlanningAuthority } from "@/modules/outings/workflow";
import { ApiError, forbid } from "@/server/api";
import { initialDriverReportDeadline } from "@/server/scheduler/reminders";
import { recomputeRound, territoryLabels } from "@/server/territories/rounds";
import { activeDoNotVisit } from "@/server/territories/do-not-visit";
import { loadWeek, resolvePlannerIds, safeEmit, writeAudit, type AdminSupabase } from "./planning";

export type ReportCtx = { supabase: AdminSupabase; profile: SessionProfile; authority: PlanningAuthority };
export type ReportEntryInput = { territory_id: string; done_labels: string[] };
export type SubmitReportInput = { slot_id: string; notes?: string | null; entries: ReportEntryInput[] };

type VisitRow = { id: string; territory_round_id: string; visit_date: string; created_at: string; conductor_id: string; done_labels: string[]; pending_labels: string[] };

const isPlanner = (authority: PlanningAuthority) => authority.canPlan || authority.canPublish;

/** Labels and "done so far" for the territory's currently open round (the state a new report starts from). */
export async function territoryFormState(supabase: AdminSupabase, territoryId: string) {
  const labels = await territoryLabels(supabase, territoryId);
  const { data: round } = await supabase.from("territory_rounds").select("id").eq("territory_id", territoryId).is("completed_on", null).maybeSingle();
  let prior: string[] = [];
  if (round) {
    const { data: visits, error } = await supabase.from("territory_visits").select("id, visit_date, created_at, conductor_id, done_labels, pending_labels").eq("territory_round_id", round.id);
    if (error) throw new Error(error.message);
    prior = priorDoneLabels((visits ?? []) as VisitRow[]);
  }
  const warnings = await activeDoNotVisit(supabase, [territoryId]);
  return { labels, prior_done: prior, do_not_visit: warnings.map((item) => item.address) };
}

const SLOT_SELECT = "id,weekly_outing_id,slot_date,hora,lugar,starts_at,status,group_id,conductor_id,weekly_outings!inner(status),weekly_outing_slot_territories(territory_id,sort_order,territories(number,name))";

type SlotRecord = {
  id: string; weekly_outing_id: string; slot_date: string; hora: string | null; lugar: string | null; starts_at: string | null; status: string | null; group_id: string | null; conductor_id: string | null;
  weekly_outings: { status: string | null } | { status: string | null }[] | null;
  weekly_outing_slot_territories: { territory_id: string; sort_order: number; territories: { number: string | number; name: string | null } | { number: string | number; name: string | null }[] | null }[];
};

const first = <T,>(value: T | T[] | null | undefined): T | null => (Array.isArray(value) ? value[0] ?? null : value ?? null);
const isPublished = (slot: SlotRecord) => (first(slot.weekly_outings)?.status ?? "PUBLISHED") === "PUBLISHED";

/**
 * Everything "Mis salidas" needs: the conductor's published outings (last 30 days → next 14),
 * their report if any, and for each territory the blocks still open. Planners also get the
 * outings of others that are still waiting for a report so they can load them on behalf.
 */
export async function loadMyOutings(supabase: AdminSupabase, profile: SessionProfile, authority: PlanningAuthority, now = new Date()) {
  const today = argentinaToday(now);
  const from = addDaysIso(today, -30);
  const to = addDaysIso(today, 14);

  const mine = await supabase.from("weekly_outing_slots").select(SLOT_SELECT).eq("conductor_id", profile.id).gte("slot_date", from).lte("slot_date", to).order("slot_date").order("sort_order");
  if (mine.error) throw new Error(mine.error.message);
  let slots = ((mine.data ?? []) as unknown as SlotRecord[]).filter(isPublished);

  let othersPendingIds: string[] = [];
  if (isPlanner(authority)) {
    const others = await supabase.from("weekly_outing_slots").select(SLOT_SELECT).neq("conductor_id", profile.id).not("conductor_id", "is", null).eq("status", "PROGRAMADA").gte("slot_date", addDaysIso(today, -14)).lte("slot_date", today).order("slot_date");
    if (others.error) throw new Error(others.error.message);
    const extra = ((others.data ?? []) as unknown as SlotRecord[]).filter(isPublished);
    othersPendingIds = extra.map((slot) => slot.id);
    slots = [...slots, ...extra];
  }
  if (!slots.length) return { me: profile.id, canReportForOthers: isPlanner(authority), slots: [] as unknown[], territories: await allTerritories(supabase) };

  const slotIds = slots.map((slot) => slot.id);
  const { data: reports, error: reportsError } = await supabase.from("outing_reports").select("id, slot_id, notes, submitted_by, submitted_at, conductor_id").in("slot_id", slotIds);
  if (reportsError) throw new Error(reportsError.message);
  const reportBySlot = new Map((reports ?? []).map((report) => [report.slot_id as string, report]));
  const reportIds = (reports ?? []).map((report) => report.id as string);

  const { data: reportVisits, error: visitsError } = reportIds.length
    ? await supabase.from("territory_visits").select("id, outing_report_id, territory_round_id, visit_date, created_at, conductor_id, done_labels, pending_labels, planned, territory_rounds(territory_id, completed_on, territories(number,name))").in("outing_report_id", reportIds)
    : { data: [], error: null };
  if (visitsError) throw new Error(visitsError.message);

  const plannedTerritoryIds = slots.flatMap((slot) => slot.weekly_outing_slot_territories.map((entry) => entry.territory_id));
  const reportedTerritoryIds = (reportVisits ?? []).map((visit) => first((visit as { territory_rounds: { territory_id: string } | { territory_id: string }[] | null }).territory_rounds)?.territory_id).filter((id): id is string => Boolean(id));
  const territoryIds = [...new Set([...plannedTerritoryIds, ...reportedTerritoryIds])];

  const [{ data: blockRows, error: blocksError }, { data: openRounds, error: openError }] = territoryIds.length
    ? await Promise.all([
        supabase.from("blocks").select("territory_id, label").in("territory_id", territoryIds).eq("active", true).order("label"),
        supabase.from("territory_rounds").select("id, territory_id").in("territory_id", territoryIds).is("completed_on", null),
      ])
    : [{ data: [], error: null }, { data: [], error: null }];
  if (blocksError || openError) throw new Error((blocksError ?? openError)!.message);
  const labelsByTerritory = new Map<string, string[]>();
  for (const row of blockRows ?? []) labelsByTerritory.set(row.territory_id as string, [...(labelsByTerritory.get(row.territory_id as string) ?? []), row.label as string]);

  const roundIds = [...new Set([...(openRounds ?? []).map((round) => round.id as string), ...(reportVisits ?? []).map((visit) => visit.territory_round_id as string)])];
  const { data: roundVisits, error: roundVisitsError } = roundIds.length
    ? await supabase.from("territory_visits").select("id, territory_round_id, visit_date, created_at, conductor_id, done_labels, pending_labels").in("territory_round_id", roundIds)
    : { data: [], error: null };
  if (roundVisitsError) throw new Error(roundVisitsError.message);
  const visitsByRound = new Map<string, VisitRow[]>();
  for (const visit of (roundVisits ?? []) as VisitRow[]) visitsByRound.set(visit.territory_round_id, [...(visitsByRound.get(visit.territory_round_id) ?? []), visit]);
  const warningRows = await activeDoNotVisit(supabase, territoryIds);
  const warningsOf = (territoryId: string) => warningRows.filter((row) => row.territory_id === territoryId).map((row) => row.address);
  const openRoundByTerritory = new Map((openRounds ?? []).map((round) => [round.territory_id as string, round.id as string]));

  const profileIds = [...new Set([...slots.map((slot) => slot.conductor_id), ...(reports ?? []).map((report) => report.submitted_by as string | null)].filter((id): id is string => Boolean(id)))];
  const { data: people } = profileIds.length ? await supabase.from("profiles").select("id, full_name").in("id", profileIds) : { data: [] };
  const nameOf = (id: string | null) => formatConductorName((people ?? []).find((person) => person.id === id)?.full_name) || null;

  const territoryMeta = new Map<string, { number: string | number; name: string | null }>();
  for (const slot of slots) for (const entry of slot.weekly_outing_slot_territories) { const meta = first(entry.territories); if (meta) territoryMeta.set(entry.territory_id, meta); }
  for (const visit of reportVisits ?? []) {
    const round = first((visit as unknown as { territory_rounds: { territory_id: string; territories: { number: string | number; name: string | null } | { number: string | number; name: string | null }[] | null } | { territory_id: string; territories: { number: string | number; name: string | null } | null }[] | null }).territory_rounds) as { territory_id: string; territories: { number: string | number; name: string | null } | { number: string | number; name: string | null }[] | null } | null;
    const meta = first(round?.territories);
    if (round && meta) territoryMeta.set(round.territory_id, meta);
  }

  const result = slots.map((slot) => {
    const report = reportBySlot.get(slot.id) ?? null;
    const planned = [...slot.weekly_outing_slot_territories].sort((a, b) => a.sort_order - b.sort_order).map((entry) => entry.territory_id);
    const entriesRaw = report ? (reportVisits ?? []).filter((visit) => visit.outing_report_id === report.id) : [];
    const entries = entriesRaw.map((visit) => {
      const round = first((visit as unknown as { territory_rounds: { territory_id: string; completed_on: string | null } | { territory_id: string; completed_on: string | null }[] | null }).territory_rounds);
      const territoryId = round?.territory_id ?? "";
      return {
        territory_id: territoryId,
        number: territoryMeta.get(territoryId)?.number ?? "?",
        name: territoryMeta.get(territoryId)?.name ?? null,
        done_labels: visit.done_labels as string[],
        pending_labels: visit.pending_labels as string[],
        planned: Boolean(visit.planned),
        round_closed: Boolean(round?.completed_on),
        labels: labelsByTerritory.get(territoryId) ?? [],
        do_not_visit: warningsOf(territoryId),
        prior_done: priorDoneLabels(visitsByRound.get(visit.territory_round_id as string) ?? [], visit.id as string),
      };
    });
    const territories = planned.map((territoryId) => {
      const roundId = openRoundByTerritory.get(territoryId);
      return {
        territory_id: territoryId,
        number: territoryMeta.get(territoryId)?.number ?? "?",
        name: territoryMeta.get(territoryId)?.name ?? null,
        labels: labelsByTerritory.get(territoryId) ?? [],
        do_not_visit: warningsOf(territoryId),
        prior_done: roundId ? priorDoneLabels(visitsByRound.get(roundId) ?? []) : [],
      };
    });
    const deadline = slot.starts_at ? initialDriverReportDeadline(new Date(slot.starts_at)) : null;
    return {
      id: slot.id,
      slot_date: slot.slot_date,
      hora: slot.hora,
      lugar: slot.lugar,
      status: slot.status ?? "PROGRAMADA",
      group_id: slot.group_id,
      conductor_id: slot.conductor_id,
      conductor_name: nameOf(slot.conductor_id),
      mine: slot.conductor_id === profile.id,
      report_deadline: deadline?.toISOString() ?? null,
      overdue: !report && (slot.status ?? "PROGRAMADA") === "PROGRAMADA" && (deadline ? deadline.getTime() < now.getTime() : slot.slot_date < today),
      territories,
      report: report
        ? { id: report.id, notes: report.notes as string | null, submitted_at: report.submitted_at, submitted_by: report.submitted_by, submitted_by_name: nameOf(report.submitted_by as string | null), on_behalf: Boolean(report.submitted_by && report.submitted_by !== slot.conductor_id), entries }
        : null,
    };
  });

  return { me: profile.id, canReportForOthers: isPlanner(authority), othersPending: othersPendingIds, slots: result, territories: await allTerritories(supabase) };
}

async function allTerritories(supabase: AdminSupabase) {
  const { data, error } = await supabase.from("territories").select("id, number, name").eq("active", true).order("number");
  if (error) throw new Error(error.message);
  return data ?? [];
}

/** Creates or edits the outing report and rebuilds every affected round (S-13 rules). */
export async function submitReport(ctx: ReportCtx, input: SubmitReportInput) {
  const { supabase, profile, authority } = ctx;
  const { data: slot, error: slotError } = await supabase.from("weekly_outing_slots").select("id, weekly_outing_id, slot_date, conductor_id, status, weekly_outing_slot_territories(territory_id)").eq("id", input.slot_id).maybeSingle();
  if (slotError) throw new Error(slotError.message);
  if (!slot) throw new ApiError("Salida no encontrada.", 404);
  const week = await loadWeek(supabase, slot.weekly_outing_id as string);
  if (!week || week.status !== "PUBLISHED") throw new ApiError("La salida todavía no está publicada.", 409);
  if (slot.status === "CANCELADA") throw new ApiError("La salida fue cancelada.", 409);
  if (!slot.conductor_id) throw new ApiError("La salida no tiene conductor asignado.", 422);
  const onBehalf = slot.conductor_id !== profile.id;
  if (onBehalf && !isPlanner(authority)) forbid("Solo el conductor de la salida puede cargar su informe.");

  const entries = input.entries;
  if (!entries.length) throw new ApiError("Agregá al menos un territorio.", 422);
  if (new Set(entries.map((entry) => entry.territory_id)).size !== entries.length) throw new ApiError("Un territorio no puede repetirse en el informe.", 422);
  const planned = new Set((slot.weekly_outing_slot_territories as { territory_id: string }[]).map((entry) => entry.territory_id));

  const labelsByTerritory = new Map<string, string[]>();
  for (const entry of entries) {
    const { data: territory } = await supabase.from("territories").select("id").eq("id", entry.territory_id).eq("active", true).maybeSingle();
    if (!territory) throw new ApiError("Uno de los territorios no está activo.", 422);
    const labels = await territoryLabels(supabase, entry.territory_id);
    if (!allLabelsKnown(entry.done_labels, labels)) throw new ApiError("Hay manzanas que no pertenecen al territorio.", 422);
    labelsByTerritory.set(entry.territory_id, labels);
  }

  const now = new Date().toISOString();
  const existingReport = await supabase.from("outing_reports").select("id, submitted_by").eq("slot_id", slot.id).maybeSingle();
  if (existingReport.error) throw new Error(existingReport.error.message);
  let reportId = existingReport.data?.id as string | undefined;
  const created = !reportId;
  if (reportId) {
    const { error } = await supabase.from("outing_reports").update({ notes: input.notes || null, updated_by: profile.id, updated_at: now }).eq("id", reportId);
    if (error) throw new Error(error.message);
  } else {
    const { data, error } = await supabase.from("outing_reports").insert({ slot_id: slot.id, conductor_id: slot.conductor_id, submitted_by: profile.id, updated_by: profile.id, notes: input.notes || null }).select("id").single();
    if (error || !data) throw new Error(error?.message ?? "No se pudo guardar el informe.");
    reportId = data.id as string;
  }

  const { data: existingVisits, error: existingError } = await supabase.from("territory_visits").select("id, territory_round_id, territory_rounds(territory_id, completed_on)").eq("outing_report_id", reportId);
  if (existingError) throw new Error(existingError.message);
  type Existing = { id: string; territory_round_id: string; territory_id: string; closed: boolean };
  const current: Existing[] = (existingVisits ?? []).map((visit) => {
    const round = first((visit as unknown as { territory_rounds: { territory_id: string; completed_on: string | null } | { territory_id: string; completed_on: string | null }[] | null }).territory_rounds);
    return { id: visit.id as string, territory_round_id: visit.territory_round_id as string, territory_id: round?.territory_id ?? "", closed: Boolean(round?.completed_on) };
  });

  const touchedRounds = new Set<string>();
  const before = current.map((visit) => visit.territory_id);
  for (const entry of entries) {
    const existing = current.find((visit) => visit.territory_id === entry.territory_id);
    if (existing) {
      if (existing.closed && !isPlanner(authority)) throw new ApiError("La vuelta de ese territorio ya se cerró: solo quien planifica puede corregirla.", 422);
      const { error } = await supabase.from("territory_visits").update({ done_labels: entry.done_labels, updated_by: profile.id, updated_at: now }).eq("id", existing.id);
      if (error) throw new Error(error.message);
      touchedRounds.add(existing.territory_round_id);
      continue;
    }
    const roundId = await openOrCreateRound(supabase, entry.territory_id, slot.conductor_id as string, slot.slot_date as string);
    const { error } = await supabase.from("territory_visits").insert({ territory_round_id: roundId, conductor_id: slot.conductor_id, visit_date: slot.slot_date, done_labels: entry.done_labels, pending_labels: [], outing_report_id: reportId, slot_id: slot.id, submitted_by: profile.id, updated_by: profile.id, planned: planned.has(entry.territory_id) });
    if (error) throw new Error(error.message);
    touchedRounds.add(roundId);
  }
  for (const removed of current.filter((visit) => !entries.some((entry) => entry.territory_id === visit.territory_id))) {
    if (removed.closed && !isPlanner(authority)) throw new ApiError("La vuelta de ese territorio ya se cerró: solo quien planifica puede corregirla.", 422);
    const { error } = await supabase.from("territory_visits").delete().eq("id", removed.id);
    if (error) throw new Error(error.message);
    touchedRounds.add(removed.territory_round_id);
  }
  for (const roundId of touchedRounds) {
    const message = await recomputeRound(supabase, roundId, { derive: true });
    if (message) throw new Error(message);
  }

  if (slot.status === "PROGRAMADA") {
    await supabase.from("weekly_outing_slots").update({ status: "REALIZADA", updated_at: now }).eq("id", slot.id);
  }
  await writeAudit(supabase, { actorId: profile.id, action: created ? "OUTING_REPORT_SUBMITTED" : "OUTING_REPORT_UPDATED", entityType: "outing_report", entityId: reportId, metadata: { slot_id: slot.id, slot_date: slot.slot_date, on_behalf: onBehalf, conductor_id: slot.conductor_id }, before: created ? null : { territory_ids: before }, after: { territories: entries } });

  if (created) {
    const { data: conductor } = await supabase.from("profiles").select("full_name").eq("id", slot.conductor_id).maybeSingle();
    const title = `${formatConductorName(conductor?.full_name as string | undefined)} informó la salida del ${formatDateEs(slot.slot_date as string)}${onBehalf ? ` (cargado por ${formatConductorName(profile.full_name)})` : ""}.`;
    for (const recipientId of await resolvePlannerIds(supabase)) {
      if (recipientId === profile.id) continue;
      await safeEmit({ type: "VISIT_REPORT_SUBMITTED", naturalKey: `outing-report:${reportId}:submitted:${recipientId}`, actorId: profile.id, payload: { recipientId, reportId, title, targetUrl: `/?view=myOutings&highlight=${reportId}` } });
    }
  }
  return { id: reportId, created };
}

async function openOrCreateRound(supabase: AdminSupabase, territoryId: string, conductorId: string, assignedOn: string) {
  const open = async () => (await supabase.from("territory_rounds").select("id").eq("territory_id", territoryId).is("completed_on", null).maybeSingle()).data?.id as string | undefined;
  const existing = await open();
  if (existing) return existing;
  const { data, error } = await supabase.from("territory_rounds").insert({ territory_id: territoryId, conductor_id: conductorId, assigned_on: assignedOn, completed_on: null, pending_block_labels: [], done_block_labels: [] }).select("id").single();
  if (error?.code === "23505") {
    const raced = await open();
    if (raced) return raced;
  }
  if (error || !data) throw new Error(error?.message ?? "No se pudo abrir la vuelta.");
  return data.id as string;
}

