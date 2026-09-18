import { z } from "zod";
import { createAdminSupabaseClient, getCurrentProfile } from "@/lib/server/auth";
import { fail, ok } from "@/lib/server/responses";
import { getFreshPermissionContext } from "@/server/permissions";

export const runtime = "nodejs";

const mutationSchema = z.discriminatedUnion("action", [
  z.object({ action: z.literal("markRead"), ids: z.array(z.string().uuid()).min(1) }),
  z.object({ action: z.literal("markUnread"), ids: z.array(z.string().uuid()).min(1) }),
  z.object({ action: z.literal("markAllRead") }),
  z.object({ action: z.literal("delete"), ids: z.array(z.string().uuid()).min(1) }),
]);

async function currentRecipient() {
  const profile = await getCurrentProfile();
  if (!profile) return null;
  // Keep notifications on the same fresh-session/permission path as the V2 APIs.
  const permissions = await getFreshPermissionContext(profile.id);
  return permissions ? profile : null;
}

export async function GET() {
  try {
    const profile = await currentRecipient();
    if (!profile) return fail("No autenticado.", 401);
    const supabase = createAdminSupabaseClient();
    const expiry = new Date(Date.now() - 30 * 24 * 60 * 60 * 1000).toISOString();
    const { error: cleanupError } = await supabase.from("user_notifications").delete().eq("recipient_id", profile.id).lt("created_at", expiry);
    if (cleanupError) return fail(cleanupError.message, 500);
    const { data, error } = await supabase.from("user_notifications").select("id,notification_type,title,description,entity_type,entity_id,target_url,read_at,created_at").eq("recipient_id", profile.id).order("created_at", { ascending: false }).limit(100);
    if (error) return fail(error.message, 500);
    return ok({ notifications: data ?? [], unreadCount: (data ?? []).filter((notification) => !notification.read_at).length });
  } catch (error) { return fail(error instanceof Error ? error.message : "Error inesperado.", 500); }
}

export async function PATCH(request: Request) {
  try {
    const profile = await currentRecipient();
    if (!profile) return fail("No autenticado.", 401);
    const parsed = mutationSchema.safeParse(await request.json());
    if (!parsed.success) return fail("Solicitud de notificaciones inválida.", 422);
    const supabase = createAdminSupabaseClient();
    const { action } = parsed.data;
    const query = supabase.from("user_notifications").update(action === "markUnread" ? { read_at: null } : { read_at: new Date().toISOString() }).eq("recipient_id", profile.id);
    const { error } = action === "markAllRead" ? await query.is("read_at", null) : await query.in("id", parsed.data.ids);
    if (error) return fail(error.message, 500);
    return ok();
  } catch (error) { return fail(error instanceof Error ? error.message : "Error inesperado.", 500); }
}

export async function DELETE(request: Request) {
  try {
    const profile = await currentRecipient();
    if (!profile) return fail("No autenticado.", 401);
    const parsed = mutationSchema.safeParse({ action: "delete", ids: (await request.json()).ids });
    if (!parsed.success || parsed.data.action !== "delete") return fail("Solicitud de notificaciones inválida.", 422);
    const { error } = await createAdminSupabaseClient().from("user_notifications").delete().eq("recipient_id", profile.id).in("id", parsed.data.ids);
    if (error) return fail(error.message, 500);
    return ok();
  } catch (error) { return fail(error instanceof Error ? error.message : "Error inesperado.", 500); }
}
