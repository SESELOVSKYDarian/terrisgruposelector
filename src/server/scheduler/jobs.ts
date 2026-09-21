import "server-only";

import { createAdminSupabaseClient } from "@/lib/server/auth";
import { runGroupWindowReminders } from "@/server/groups/group-outings";
import { runReminderJobs } from "./reminders";

/**
 * Every reminder job that has real data behind it. Jobs are idempotent (natural keys), so
 * running this from cron or by hand repeatedly never duplicates a notification.
 */
export async function runAllReminderJobs(now = new Date()) {
  const base = await runReminderJobs();
  let groupWindows = 0;
  let groupWindowsError: string | null = null;
  try {
    groupWindows = await runGroupWindowReminders(createAdminSupabaseClient(), now);
  } catch (error) {
    groupWindowsError = error instanceof Error ? error.message : "Error inesperado.";
    console.error("Falló el recordatorio de Salida por Grupo:", error);
  }
  return { ...base, emitted: base.emitted + groupWindows, jobs: { groupWindows: { emitted: groupWindows, error: groupWindowsError } } };
}
