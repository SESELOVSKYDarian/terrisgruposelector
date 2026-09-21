import { NextRequest } from "next/server";
import { createAdminSupabaseClient } from "@/lib/server/auth";
import { ApiError, forbid, handle, requireProfile } from "@/server/api";
import { listS13Documents, loadS13Document } from "@/server/s13";
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
    return { documents, selected: await loadS13Document(supabase, document) };
  });
}
