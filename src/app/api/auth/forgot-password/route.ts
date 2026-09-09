import { createAdminSupabaseClient, createResetToken } from "@/lib/server/auth";
import { resetPasswordEmailHtml, sendMail } from "@/lib/server/mail";
import { ok } from "@/lib/server/responses";

export const runtime = "nodejs";

export async function POST(request: Request) {
  const { usernameOrEmail } = (await request.json()) as { usernameOrEmail?: string };
  const value = usernameOrEmail?.trim();

  if (value) {
    const supabase = createAdminSupabaseClient();
    const { data: byUsername } = await supabase.from("profiles").select("id, email").eq("username", value).maybeSingle();
    const { data: byEmail } = byUsername ? { data: null } : await supabase.from("profiles").select("id, email").eq("email", value).maybeSingle();
    const profile = byUsername ?? byEmail;

    if (profile?.email) {
      const token = createResetToken(profile.id);
      const appUrl = process.env.NEXT_PUBLIC_APP_URL ?? new URL(request.url).origin;
      const link = `${appUrl}/reset-password?token=${token}`;
      await sendMail(profile.email, "Restablecer tu contrasena", resetPasswordEmailHtml(link));
    }
  }

  return ok();
}
