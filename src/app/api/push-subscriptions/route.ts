import { z } from "zod";
import { createAdminSupabaseClient, getCurrentProfile } from "@/lib/server/auth";
import { fail, ok } from "@/lib/server/responses";
import { getPublicVapidKey } from "@/server/push";

export const runtime = "nodejs";

const subscriptionSchema = z.object({
  deviceId: z.string().uuid(),
  deviceName: z.string().trim().min(1).max(120),
  subscription: z.object({ endpoint: z.string().url().max(2000), keys: z.object({ p256dh: z.string().min(1).max(512), auth: z.string().min(1).max(512) }) }),
});

async function profileOrUnauthorized() {
  const profile = await getCurrentProfile();
  return profile?.active ? profile : null;
}

export async function GET() {
  const profile = await profileOrUnauthorized();
  if (!profile) return fail("No autenticado.", 401);
  // The person's own devices, for the personal settings screen (never anyone else's).
  const { data } = await createAdminSupabaseClient().from("push_subscriptions").select("device_id, device_name, enabled, updated_at").eq("profile_id", profile.id).order("updated_at", { ascending: false });
  return ok({ vapidPublicKey: getPublicVapidKey(), devices: data ?? [] });
}

export async function POST(request: Request) {
  try {
    const profile = await profileOrUnauthorized();
    if (!profile) return fail("No autenticado.", 401);
    if (!getPublicVapidKey()) return ok({ configured: false });
    const parsed = subscriptionSchema.safeParse(await request.json());
    if (!parsed.success) return fail("Suscripción push inválida.", 422);
    const { deviceId, deviceName, subscription } = parsed.data;
    const { error } = await createAdminSupabaseClient().from("push_subscriptions").upsert({ profile_id: profile.id, device_id: deviceId, device_name: deviceName, endpoint: subscription.endpoint, p256dh: subscription.keys.p256dh, auth: subscription.keys.auth, enabled: true, disabled_at: null, updated_at: new Date().toISOString() }, { onConflict: "profile_id,device_id" });
    if (error) return fail(error.message, 500);
    return ok({ configured: true });
  } catch (error) { return fail(error instanceof Error ? error.message : "Error inesperado.", 500); }
}

export async function DELETE(request: Request) {
  try {
    const profile = await profileOrUnauthorized();
    if (!profile) return fail("No autenticado.", 401);
    const parsed = z.object({ deviceId: z.string().uuid() }).safeParse(await request.json());
    if (!parsed.success) return fail("Dispositivo inválido.", 422);
    const { error } = await createAdminSupabaseClient().from("push_subscriptions").update({ enabled: false, disabled_at: new Date().toISOString() }).eq("profile_id", profile.id).eq("device_id", parsed.data.deviceId);
    if (error) return fail(error.message, 500);
    return ok();
  } catch (error) { return fail(error instanceof Error ? error.message : "Error inesperado.", 500); }
}
