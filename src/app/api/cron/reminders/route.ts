import { runReminderJobs } from "@/server/scheduler/reminders";
import { fail, ok } from "@/lib/server/responses";

export const runtime = "nodejs";

/** Manual, secret-protected trigger; compatible with a future Vercel Cron call. */
export async function GET(request: Request) {
  const secret = process.env.CRON_SECRET;
  if (!secret || request.headers.get("authorization") !== `Bearer ${secret}`) return fail("No autorizado.", 401);
  return ok(await runReminderJobs());
}
