import { clearSessionCookie } from "@/lib/server/auth";
import { ok } from "@/lib/server/responses";

export async function POST() {
  await clearSessionCookie();
  return ok();
}
