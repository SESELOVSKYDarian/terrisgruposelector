import { z } from "zod";
import { createAdminSupabaseClient } from "@/lib/server/auth";
import { forbid, handle, parseBody, requireProfile } from "@/server/api";
import { deleteCardLayout, loadAllCardLayouts, loadTerritoriesWithBlocks, saveCardLayout } from "@/server/territories/card-layout";
import { getTerritoryAccess } from "@/server/territories/access";

export const runtime = "nodejs";

/** Any logged-in profile can read every layout (needed so a conductor sees their own territory's card); the
 * territory/block picker list is only included for whoever manages territories (the editor needs it). */
export async function GET() {
  return handle(async () => {
    const profile = await requireProfile();
    const supabase = createAdminSupabaseClient();
    const canManage = (await getTerritoryAccess(profile)).canManage;
    return { layouts: await loadAllCardLayouts(supabase), territories: canManage ? await loadTerritoriesWithBlocks(supabase) : null };
  });
}

const point = z.tuple([z.number(), z.number()]);
const mutation = z.discriminatedUnion("action", [
  z.object({
    action: z.literal("save"),
    payload: z.object({
      territory_id: z.string().uuid(),
      view_box: z.string().min(1).max(60),
      blocks: z.array(z.object({ label: z.string().min(1).max(20), points: z.array(point).min(3).max(60) })).max(60),
      street_labels: z.array(z.object({ text: z.string().min(1).max(40), x: z.number(), y: z.number(), rotate: z.number() })).max(40),
    }),
  }),
  z.object({ action: z.literal("delete"), payload: z.object({ territory_id: z.string().uuid() }) }),
]);

/** Drawing the territory card is for whoever manages territories (same gate as the S-13 test field). */
export async function POST(request: Request) {
  return handle(async () => {
    const profile = await requireProfile();
    if (!(await getTerritoryAccess(profile)).canManage) forbid("Solo quien gestiona territorios puede editar la tarjeta.");
    const { action, payload } = await parseBody(request, mutation);
    const supabase = createAdminSupabaseClient();
    return action === "save" ? saveCardLayout(supabase, profile.id, payload) : deleteCardLayout(supabase, payload.territory_id);
  });
}
