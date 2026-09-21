import "server-only";

import { createAdminSupabaseClient } from "@/lib/server/auth";
import { formatDateEs } from "@/modules/outings/time";
import { emitDomainEvent } from "@/server/events";
import { runGroupWindowReminders } from "@/server/groups/group-outings";
import type { AdminSupabase } from "@/server/outings/planning";
import { initialDriverReportDeadline, runDriverReportReminders, runReminderJobs, weekendReminderDueAt, type DriverReportReminderCandidate } from "./reminders";

type SlotRow = { id: string; slot_date: string; starts_at: string; conductor_id: string; weekly_outings: { status: string | null } | { status: string | null }[] | null };

const isPublished = (slot: SlotRow) => ((Array.isArray(slot.weekly_outings) ? slot.weekly_outings[0]?.status : slot.weekly_outings?.status) ?? "PUBLISHED") === "PUBLISHED";

async function programmedSlots(supabase: AdminSupabase, fromIso: string, toIso: string) {
  const { data, error } = await supabase
    .from("weekly_outing_slots")
    .select("id, slot_date, starts_at, conductor_id, weekly_outings!inner(status)")
    .eq("status", "PROGRAMADA")
    .not("conductor_id", "is", null)
    .not("starts_at", "is", null)
    .gte("starts_at", fromIso)
    .lte("starts_at", toIso);
  if (error) throw new Error(error.message);
  return ((data ?? []) as unknown as SlotRow[]).filter(isPublished);
}

/** 3 hours after the scheduled time, if the conductor's report is still missing. */
async function runDriverReportJob(supabase: AdminSupabase, now: Date) {
  const slots = await programmedSlots(supabase, new Date(now.getTime() - 14 * 24 * 60 * 60 * 1000).toISOString(), now.toISOString());
  if (!slots.length) return 0;
  const { data: reports, error } = await supabase.from("outing_reports").select("slot_id").in("slot_id", slots.map((slot) => slot.id));
  if (error) throw new Error(error.message);
  const reported = new Set((reports ?? []).map((report) => report.slot_id as string));
  const candidates: DriverReportReminderCandidate[] = slots.map((slot) => {
    const deadline = initialDriverReportDeadline(new Date(slot.starts_at));
    return {
      // The deadline is part of the key: a rescheduled outing gets a fresh reminder.
      naturalKey: `outing-report-due:${slot.id}:${deadline.toISOString()}`,
      conductorId: slot.conductor_id,
      slotId: slot.id,
      reportFormUrl: `/?view=myOutings&highlight=${slot.id}`,
      reportDeadlineAt: deadline,
      completedAt: reported.has(slot.id) ? now : null,
    };
  });
  return runDriverReportReminders(candidates.map((candidate) => ({ ...candidate })), async (input) => {
    const slot = slots.find((entry) => entry.id === input.payload.slotId);
    await emitDomainEvent({ ...input, payload: { ...input.payload, title: `Informe pendiente: salida del ${formatDateEs(slot?.slot_date ?? "")}` } });
  }, now);
}

/** Weekend outings: reminder to the conductor three calendar days before the outing. */
async function runWeekendReminderJob(supabase: AdminSupabase, now: Date) {
  const slots = await programmedSlots(supabase, now.toISOString(), new Date(now.getTime() + 5 * 24 * 60 * 60 * 1000).toISOString());
  let emitted = 0;
  for (const slot of slots) {
    const isodow = new Date(`${slot.slot_date}T00:00:00Z`).getUTCDay();
    if (isodow !== 6 && isodow !== 0) continue;
    if (weekendReminderDueAt(new Date(slot.starts_at)).getTime() > now.getTime()) continue;
    await emitDomainEvent({ type: "OUTING_REMINDER", naturalKey: `outing-reminder:${slot.id}:${new Date(slot.starts_at).toISOString()}`, payload: { recipientId: slot.conductor_id, slotId: slot.id, weeklyOutingId: "", slotDate: formatDateEs(slot.slot_date), audience: "conductor" } });
    emitted += 1;
  }
  return emitted;
}

async function guarded(name: string, job: () => Promise<number>) {
  try {
    return { emitted: await job(), error: null as string | null };
  } catch (error) {
    console.error(`Falló el recordatorio ${name}:`, error);
    return { emitted: 0, error: error instanceof Error ? error.message : "Error inesperado." };
  }
}

/**
 * Every reminder job that has real data behind it. Jobs are idempotent (natural keys), so
 * running this from cron or by hand repeatedly never duplicates a notification.
 */
export async function runAllReminderJobs(now = new Date()) {
  const supabase = createAdminSupabaseClient();
  const base = await runReminderJobs();
  const jobs = {
    groupWindows: await guarded("groupWindows", () => runGroupWindowReminders(supabase, now)),
    driverReport: await guarded("driverReport", () => runDriverReportJob(supabase, now)),
    weekend: await guarded("weekend", () => runWeekendReminderJob(supabase, now)),
  };
  return { ...base, emitted: base.emitted + Object.values(jobs).reduce((total, job) => total + job.emitted, 0), jobs };
}
