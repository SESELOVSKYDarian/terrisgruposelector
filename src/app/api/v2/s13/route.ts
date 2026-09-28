import { NextRequest } from "next/server";
import { z } from "zod";
import { createAdminSupabaseClient } from "@/lib/server/auth";
import { ApiError, forbid, handle, parseBody, requireProfile } from "@/server/api";
import { listS13Documents, loadS13Document } from "@/server/s13";
import { createTestEntry, deleteTestEntry, listTestEntries } from "@/server/s13/test-entries";
import { compareWithDocuments, configureSync, runS13Sync, syncStatus } from "@/server/s13/sync";
import { getTerritoryAccess } from "@/server/territories/access";

export const runtime = "nodejs";

export async function GET(request: NextRequest) {
  return handle(async () => {
    const profile = await requireProfile();
    const access = await getTerritoryAccess(profile);
    if (!access.canViewS13) forbid("No tenés permiso para ver el S-13.");
    const supabase = createAdminSupabaseClient();
    const documents = await listS13Documents(supabase);
    if (!documents.length) return { documents, selected: null };
    const code = request.nextUrl.searchParams.get("doc") ?? documents[0].code;
    const document = documents.find((entry) => entry.code === code);
    if (!document) throw new ApiError("Documento S-13 no encontrado.", 404);
    return {
      documents,
      selected: await loadS13Document(supabase, document),
      sync: await syncStatus(supabase, document.code).catch(() => null),
      tests: access.canManage ? await listTestEntries(supabase) : null,
    };
  });
}

const mutation = z.discriminatedUnion("action", [
  z.object({ action: z.literal("sync"), payload: z.object({ code: z.string().min(1).max(40) }) }),
  z.object({ action: z.literal("compare"), payload: z.object({ code: z.string().min(1).max(40) }) }),
  z.object({
    action: z.literal("test_create"),
    payload: z.object({
      territory_number: z.number().int().min(1).max(999),
      conductor_id: z.string().uuid(),
      assigned_on: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
      completed_on: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).nullable(),
    }),
  }),
  z.object({ action: z.literal("test_delete"), payload: z.object({ id: z.string().uuid() }) }),
  z.object({
    action: z.literal("configure"),
    payload: z.object({ code: z.string().min(1).max(40), sync_mode: z.enum(["DRY_RUN", "STAGING", "PRODUCTION"]), staging_document: z.string().max(400).nullable(), external_document: z.string().max(400).nullable(), staging_verified: z.boolean() }),
  }),
]);

/** Generating/syncing the S-13 is for whoever may read it (Coordinador, Servicio, Territorios). */
export async function POST(request: Request) {
  return handle(async () => {
    const profile = await requireProfile();
    if (!(await getTerritoryAccess(profile)).canViewS13) forbid("No tenés permiso para sincronizar el S-13.");
    const { action, payload } = await parseBody(request, mutation);
    const supabase = createAdminSupabaseClient();
    if (action === "test_create" || action === "test_delete") {
      if (!(await getTerritoryAccess(profile)).canManage) forbid("Solo quien gestiona territorios puede usar el campo de pruebas.");
      return action === "test_create" ? createTestEntry(supabase, payload) : deleteTestEntry(supabase, payload.id);
    }
    if (action === "sync") return runS13Sync(supabase, profile.id, payload.code);
    if (action === "compare") return compareWithDocuments(supabase, payload.code);
    return configureSync(supabase, profile.id, payload);
  });
}
