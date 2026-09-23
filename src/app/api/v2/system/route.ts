import { z } from "zod";
import { createAdminSupabaseClient, createMagicLoginToken, type SessionProfile } from "@/lib/server/auth";
import { forbid, handle, parseBody, requireProfile } from "@/server/api";
import { getLockDuration } from "@/server/buildings/activity";
import { googleCredentialsConfigured, s13WritesEnabled } from "@/server/integrations/s13-target";
import { otpEmailHtml, sendMail, smtpConfigured } from "@/lib/server/mail";
import { getFreshPermissionContext, hasPermission } from "@/server/permissions";
import { getPublicVapidKey } from "@/server/push";
import { getTerritoryAccess } from "@/server/territories/access";

export const runtime = "nodejs";

async function requireSystemAccess(profile: SessionProfile) {
  const territories = await getTerritoryAccess(profile);
  let canSystem = profile.roles.includes("ADMIN");
  try {
    const context = await getFreshPermissionContext(profile.id);
    canSystem = Boolean(context && hasPermission(context, "MANAGE_SYSTEM"));
  } catch {
    // V2 permission tables pending: legacy ADMIN keeps access.
  }
  if (!canSystem && !territories.canManage) forbid("No tenés acceso a los ajustes del sistema.");
  return territories;
}

/**
 * System settings overview. Reading is for the Coordinador (system) and for Servicio/Territorios;
 * it exposes only whether each integration is configured, never a secret value.
 */
export async function GET() {
  return handle(async () => {
    const profile = await requireProfile();
    const territories = await requireSystemAccess(profile);
    return {
      canEditLock: territories.canManage,
      lock: await getLockDuration(createAdminSupabaseClient()).catch(() => null),
      integrations: {
        push: Boolean(getPublicVapidKey()),
        googleCredentials: googleCredentialsConfigured(),
        googleWrites: s13WritesEnabled(),
        cron: Boolean(process.env.CRON_SECRET),
        email: smtpConfigured() || Boolean(process.env.RESEND_API_KEY),
      },
    };
  });
}

const body = z.object({ action: z.literal("sendTestEmail"), payload: z.object({ to: z.string().email() }) });

/**
 * Diagnostic only, for whoever can already see this screen: the full error message (SMTP/Resend
 * reject reasons, timeouts) is safe to show here, unlike on the public login/OTP flow.
 */
export async function POST(request: Request) {
  return handle(async () => {
    const profile = await requireProfile();
    await requireSystemAccess(profile);
    const { payload } = await parseBody(request, body);
    try {
      // Real magic token for your own account, so the test shows the full design and the button actually works.
      await sendMail(payload.to, "Correo de prueba - PR Territorios", otpEmailHtml("000000", createMagicLoginToken(profile.id)));
      return { sent: true, transport: smtpConfigured() ? "smtp" : "resend" };
    } catch (cause) {
      return { sent: false, transport: smtpConfigured() ? "smtp" : "resend", error: cause instanceof Error ? cause.message : "Error inesperado." };
    }
  });
}
