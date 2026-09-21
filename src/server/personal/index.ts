import "server-only";

import type { SessionProfile } from "@/lib/server/auth";
import { argentinaToday, formatDateEs } from "@/modules/outings/time";
import { canReportPeriod, currentPersonalStage, periodBounds, personalModeLabels, personalReminderKey, personalReminderMessage, type PersonalMode } from "@/modules/personal/period";
import { isPhoneActivity, type PhoneActivity } from "@/modules/telephone/assignment";
import { formatConductorName } from "@/modules/territories/names";
import { allLabelsKnown } from "@/modules/territories/rounds";
import { ApiError, forbid } from "@/server/api";
import { emitDomainEvent } from "@/server/events";
import { resolveTerritoryManagerIds, safeEmit, writeAudit, type AdminSupabase } from "@/server/outings/planning";
import { territoryFormState } from "@/server/outings/reports";
import { activeDoNotVisit } from "@/server/territories/do-not-visit";
import { openOrCreateRound, recomputeRound, territoryLabels } from "@/server/territories/rounds";

const ASSIGNMENT_COLUMNS = "id, profile_id, territory_id, mode, assigned_on, period_index, period_start, period_end, status, auto_renew, created_at, territories(number, name), profiles!profile_id(full_name)";

type Row = { id: string; profile_id: string; territory_id: string; mode: PersonalMode; assigned_on: string; period_index: number; period_start: string; period_end: string; status: string; auto_renew: boolean; created_at: string; territories: { number: number; name: string | null } | { number: number; name: string | null }[] | null; profiles: { full_name: string } | { full_name: string }[] | null };

const first = <T,>(value: T | T[] | null | undefined): T | null => (Array.isArray(value) ? value[0] ?? null : value ?? null);

function shape(row: Row) {
  return {
    id: row.id,
    profile_id: row.profile_id,
    person: formatConductorName(first(row.profiles)?.full_name) || null,
    territory_id: row.territory_id,
    territory_number: first(row.territories)?.number ?? 0,
    mode: row.mode,
    assigned_on: row.assigned_on,
    period_start: row.period_start,
    period_end: row.period_end,
    status: row.status,
    auto_renew: row.auto_renew,
  };
}

/** Territories a person works through an ACTIVE personal assignment in a given mode. */
export async function personalTerritoryIds(supabase: AdminSupabase, profileId: string, mode?: PersonalMode) {
  let query = supabase.from("personal_territory_assignments").select("territory_id").eq("profile_id", profileId).eq("status", "ACTIVE");
  if (mode) query = query.eq("mode", mode);
  const { data, error } = await query;
  if (error) throw new Error(error.message);
  return [...new Set((data ?? []).map((row) => row.territory_id as string))];
}

/** Managers assign a territory to a person in one mode; the first period starts on the assignment date. */
export async function createAssignment(supabase: AdminSupabase, manager: SessionProfile, input: { profile_id: string; territory_id: string; mode: PersonalMode; assigned_on: string }) {
  const { data: person } = await supabase.from("profiles").select("id, full_name").eq("id", input.profile_id).eq("active", true).maybeSingle();
  if (!person) throw new ApiError("Persona no encontrada o inactiva.", 404);
  const { data: territory } = await supabase.from("territories").select("id, number").eq("id", input.territory_id).eq("active", true).maybeSingle();
  if (!territory) throw new ApiError("Territorio no encontrado.", 404);
  const bounds = periodBounds(input.assigned_on, 0);
  const { data, error } = await supabase.from("personal_territory_assignments").insert({ profile_id: input.profile_id, territory_id: input.territory_id, mode: input.mode, assigned_on: input.assigned_on, period_index: 0, period_start: bounds.start, period_end: bounds.end, created_by: manager.id }).select("id").single();
  if (error?.code === "23505") throw new ApiError("Esa persona ya tiene ese territorio en esa modalidad.", 409);
  if (error || !data) throw new Error(error?.message ?? "No se pudo asignar el territorio.");
  await writeAudit(supabase, { actorId: manager.id, action: "PERSONAL_TERRITORY_ASSIGNED", entityType: "personal_territory_assignment", entityId: data.id, metadata: { profile_id: input.profile_id, territory_id: input.territory_id, mode: input.mode }, after: bounds });
  if (input.profile_id !== manager.id) {
    await safeEmit({ type: "PERSONAL_TERRITORY_ASSIGNED", naturalKey: `personal-territory:${data.id}:assigned`, actorId: manager.id, payload: { recipientId: input.profile_id, assignmentId: data.id, title: `Te asignaron el territorio ${territory.number} (${personalModeLabels[input.mode]}). Tu primer informe vence el ${formatDateEs(bounds.end)}.` } });
  }
  return { id: data.id as string };
}

export async function endAssignment(supabase: AdminSupabase, manager: SessionProfile, id: string) {
  const { data, error } = await supabase.from("personal_territory_assignments").update({ status: "ENDED", ended_by: manager.id, ended_at: new Date().toISOString(), updated_at: new Date().toISOString() }).eq("id", id).eq("status", "ACTIVE").select("id");
  if (error) throw new Error(error.message);
  if (!data?.length) throw new ApiError("Asignación no encontrada o ya finalizada.", 404);
  await writeAudit(supabase, { actorId: manager.id, action: "PERSONAL_TERRITORY_ENDED", entityType: "personal_territory_assignment", entityId: id });
  return {};
}

/** Everything the person needs to report each ACTIVE assignment, with the form data of its mode. */
export async function loadMine(supabase: AdminSupabase, profile: SessionProfile, now = new Date()) {
  const today = argentinaToday(now);
  const { data, error } = await supabase.from("personal_territory_assignments").select(ASSIGNMENT_COLUMNS).eq("profile_id", profile.id).eq("status", "ACTIVE").order("period_end");
  if (error) throw new Error(error.message);
  const assignments = [];
  for (const row of (data ?? []) as unknown as Row[]) {
    const base = shape(row);
    const { data: reported } = await supabase.from("personal_territory_reports").select("id, submitted_at").eq("assignment_id", row.id).eq("period_start", row.period_start).maybeSingle();
    const warnings = (await activeDoNotVisit(supabase, [row.territory_id])).map((item) => item.address);
    let form: Record<string, unknown> = {};
    if (row.mode === "CASA_EN_CASA") form = await territoryFormState(supabase, row.territory_id);
    else if (row.mode === "TELEFONICO") {
      const { data: numbers } = await supabase.from("territory_phone_numbers").select("id, number, activity, last_activity_on").eq("territory_id", row.territory_id).eq("active", true).order("number");
      form = { numbers: numbers ?? [] };
    } else {
      form = await buildingSummary(supabase, profile.id, row.territory_id, row.period_start, row.period_end);
    }
    assignments.push({ ...base, reported_at: (reported?.submitted_at as string | undefined) ?? null, can_report: !reported && canReportPeriod(today, row.period_start, row.period_end), do_not_visit: warnings, form });
  }
  return { assignments };
}

/** Doorbells this person worked in the territory's buildings during the period. */
async function buildingSummary(supabase: AdminSupabase, profileId: string, territoryId: string, periodStart: string, periodEnd: string) {
  const { data: buildings, error } = await supabase.from("buildings").select("id").eq("territory_id", territoryId);
  if (error) throw new Error(error.message);
  const ids = (buildings ?? []).map((row) => row.id as string);
  if (!ids.length) return { buildings: 0, worked: 0, revisits: 0 };
  const { data: rows, error: activityError } = await supabase.from("building_unit_activity").select("outcome").in("building_id", ids).eq("user_id", profileId).is("undone_at", null).gte("worked_at", `${periodStart}T00:00:00-03:00`).lt("worked_at", `${periodEnd}T00:00:00-03:00`);
  if (activityError) throw new Error(activityError.message);
  return { buildings: ids.length, worked: (rows ?? []).length, revisits: (rows ?? []).filter((row) => row.outcome === "REVISITA").length };
}

export type ReportInput = { assignment_id: string; notes?: string | null; done_labels?: string[]; results?: { phone_number_id: string; activity: PhoneActivity }[] };

/**
 * Submits the period report with the SAME logic as the matching form: block progress feeds the
 * territory's round (and so the S-13), phone results update each number, buildings summarize the
 * doorbells worked. Then the assignment rolls to its next 3-month period.
 */
export async function submitPersonalReport(supabase: AdminSupabase, profile: SessionProfile, input: ReportInput, now = new Date()) {
  const { data, error } = await supabase.from("personal_territory_assignments").select(ASSIGNMENT_COLUMNS).eq("id", input.assignment_id).maybeSingle();
  if (error) throw new Error(error.message);
  const row = data as unknown as Row | null;
  if (!row || row.status !== "ACTIVE") throw new ApiError("Asignación no encontrada.", 404);
  if (row.profile_id !== profile.id) forbid("Solo la persona asignada puede entregar este informe.");
  const today = argentinaToday(now);
  if (!canReportPeriod(today, row.period_start, row.period_end)) throw new ApiError("Todavía no es momento de entregar el informe de este período.", 409);
  const { data: already } = await supabase.from("personal_territory_reports").select("id").eq("assignment_id", row.id).eq("period_start", row.period_start).maybeSingle();
  if (already) throw new ApiError("El informe de este período ya fue entregado.", 409);

  let summary: Record<string, unknown> = {};
  if (row.mode === "CASA_EN_CASA") {
    const done = input.done_labels ?? [];
    const labels = await territoryLabels(supabase, row.territory_id);
    if (!allLabelsKnown(done, labels)) throw new ApiError("Hay manzanas que no pertenecen al territorio.", 422);
    if (done.length) {
      const roundId = await openOrCreateRound(supabase, row.territory_id, profile.id, today);
      const { error: visitError } = await supabase.from("territory_visits").insert({ territory_round_id: roundId, conductor_id: profile.id, visit_date: today, done_labels: done, pending_labels: [], submitted_by: profile.id, updated_by: profile.id, planned: true, personal_assignment_id: row.id });
      if (visitError) throw new Error(visitError.message);
      const message = await recomputeRound(supabase, roundId, { derive: true });
      if (message) throw new Error(message);
    }
    summary = { done_blocks: done.length };
  } else if (row.mode === "TELEFONICO") {
    const results = input.results ?? [];
    const { data: numbers } = await supabase.from("territory_phone_numbers").select("id").eq("territory_id", row.territory_id).eq("active", true);
    const allowed = new Set((numbers ?? []).map((number) => number.id as string));
    if (results.some((entry) => !allowed.has(entry.phone_number_id) || !isPhoneActivity(entry.activity))) throw new ApiError("Hay números que no pertenecen al territorio.", 422);
    const stamp = now.toISOString();
    for (const entry of results) {
      await supabase.from("telephone_call_results").delete().eq("personal_assignment_id", row.id).eq("phone_number_id", entry.phone_number_id).eq("called_on", today);
      const { error: insertError } = await supabase.from("telephone_call_results").insert({ personal_assignment_id: row.id, phone_number_id: entry.phone_number_id, conductor_id: profile.id, activity: entry.activity, called_on: today, recorded_by: profile.id });
      if (insertError) throw new Error(insertError.message);
      const { error: stateError } = await supabase.from("territory_phone_numbers").update({ activity: entry.activity, last_activity_on: today, last_conductor_id: profile.id, updated_at: stamp }).eq("id", entry.phone_number_id).or(`last_activity_on.is.null,last_activity_on.lte.${today}`);
      if (stateError) throw new Error(stateError.message);
    }
    const counts: Record<string, number> = {};
    for (const entry of results) counts[entry.activity] = (counts[entry.activity] ?? 0) + 1;
    summary = { called: results.length, by_activity: counts };
  } else {
    summary = await buildingSummary(supabase, profile.id, row.territory_id, row.period_start, row.period_end);
  }

  const { data: report, error: reportError } = await supabase.from("personal_territory_reports").insert({ assignment_id: row.id, period_start: row.period_start, period_end: row.period_end, submitted_by: profile.id, notes: input.notes || null, summary }).select("id").single();
  if (reportError?.code === "23505") throw new ApiError("El informe de este período ya fue entregado.", 409);
  if (reportError || !report) throw new Error(reportError?.message ?? "No se pudo guardar el informe.");

  if (row.auto_renew) {
    const next = periodBounds(row.assigned_on, row.period_index + 1);
    await supabase.from("personal_territory_assignments").update({ period_index: row.period_index + 1, period_start: next.start, period_end: next.end, updated_at: now.toISOString() }).eq("id", row.id);
  }
  await writeAudit(supabase, { actorId: profile.id, action: "PERSONAL_TERRITORY_REPORT_SUBMITTED", entityType: "personal_territory_assignment", entityId: row.id, metadata: { mode: row.mode, period_start: row.period_start, period_end: row.period_end, renewed: row.auto_renew }, after: summary });

  const title = `${formatConductorName(profile.full_name)} entregó el informe de su territorio personal ${first(row.territories)?.number ?? "?"} (${personalModeLabels[row.mode]}).`;
  for (const recipientId of await resolveTerritoryManagerIds(supabase)) {
    if (recipientId === profile.id) continue;
    await safeEmit({ type: "VISIT_REPORT_SUBMITTED", naturalKey: `personal-report:${report.id}:${recipientId}`, actorId: profile.id, payload: { recipientId, reportId: report.id, title, targetUrl: "/?view=territories&tab=personal" } });
  }
  return { id: report.id as string, summary };
}

/** Managers see every assignment with its latest reports. */
export async function listForManagers(supabase: AdminSupabase) {
  const [assignments, people, territories, reports] = await Promise.all([
    supabase.from("personal_territory_assignments").select(ASSIGNMENT_COLUMNS).order("status").order("period_end"),
    supabase.from("profiles").select("id, full_name").eq("active", true).order("full_name"),
    supabase.from("territories").select("id, number, name").eq("active", true).order("number"),
    supabase.from("personal_territory_reports").select("assignment_id, period_start, period_end, submitted_at, summary").order("submitted_at", { ascending: false }).limit(200),
  ]);
  for (const result of [assignments, people, territories, reports]) if (result.error) throw new Error(result.error.message);
  return {
    assignments: ((assignments.data ?? []) as unknown as Row[]).map((row) => ({ ...shape(row), last_report: (reports.data ?? []).find((report) => report.assignment_id === row.id) ?? null })),
    people: people.data ?? [],
    territories: territories.data ?? [],
  };
}

/** Scheduler entry: one reminder per assignment period, the most urgent due stage only. */
export async function runPersonalTerritoryReminders(supabase: AdminSupabase, now = new Date()) {
  const today = argentinaToday(now);
  const { data, error } = await supabase.from("personal_territory_assignments").select("id, profile_id, period_start, period_end, territories(number)").eq("status", "ACTIVE");
  if (error) throw new Error(error.message);
  let emitted = 0;
  for (const row of data ?? []) {
    const stage = currentPersonalStage(today, row.period_end as string);
    if (!stage) continue;
    const { data: reported } = await supabase.from("personal_territory_reports").select("id").eq("assignment_id", row.id).eq("period_start", row.period_start).maybeSingle();
    if (reported) continue;
    const territory = Array.isArray(row.territories) ? row.territories[0] : row.territories;
    await emitDomainEvent({ type: "PERSONAL_TERRITORY_REPORT_DUE", naturalKey: personalReminderKey(row.id as string, row.period_end as string, stage), payload: { recipientId: row.profile_id as string, assignmentId: row.id as string, title: personalReminderMessage(stage, (territory as { number?: number } | null)?.number ?? "?", row.period_end as string) } });
    emitted += 1;
  }
  return emitted;
}
