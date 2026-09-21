import { NextRequest } from "next/server";
import { z } from "zod";
import { createAdminSupabaseClient } from "@/lib/server/auth";
import { handle, parseBody, requireProfile } from "@/server/api";
import { loadMyOutings, submitReport, territoryFormState } from "@/server/outings/reports";
import { getPlanningAuthority } from "@/server/outings/planning";

export const runtime = "nodejs";

const submit = z.object({
  action: z.literal("submitReport"),
  payload: z.object({
    slot_id: z.string().uuid(),
    notes: z.string().max(2000).nullable().optional(),
    entries: z.array(z.object({ territory_id: z.string().uuid(), done_labels: z.array(z.string().min(1).max(40)).max(200) })).min(1).max(20),
  }),
});

export async function GET(request: NextRequest) {
  return handle(async () => {
    const profile = await requireProfile();
    const supabase = createAdminSupabaseClient();
    // Blocks and progress of a territory added during the outing ("+ Agregar otro territorio").
    const territory = request.nextUrl.searchParams.get("territory");
    if (territory) {
      if (!z.string().uuid().safeParse(territory).success) return {};
      return territoryFormState(supabase, territory);
    }
    return loadMyOutings(supabase, profile, await getPlanningAuthority(profile));
  });
}

export async function POST(request: Request) {
  return handle(async () => {
    const profile = await requireProfile();
    const { payload } = await parseBody(request, submit);
    return submitReport({ supabase: createAdminSupabaseClient(), profile, authority: await getPlanningAuthority(profile) }, payload);
  });
}
