import { getCurrentProfile, setTrustCookie } from "@/lib/server/auth";
import { fail, ok } from "@/lib/server/responses";

export const runtime = "nodejs";

export async function POST() {
  const profile = await getCurrentProfile();
  if (!profile) return fail("No autenticado.", 401);
  await setTrustCookie(profile.id);
  return ok();
}
