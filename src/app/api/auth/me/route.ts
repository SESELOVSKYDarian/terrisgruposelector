import { getCurrentProfile } from "@/lib/server/auth";
import { fail, ok } from "@/lib/server/responses";

export async function GET() {
  const profile = await getCurrentProfile();

  if (!profile) {
    return fail("No autenticado.", 401);
  }

  return ok({ profile });
}
