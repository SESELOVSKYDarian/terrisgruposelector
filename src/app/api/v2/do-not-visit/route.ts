import { z } from "zod";
import { createAdminSupabaseClient } from "@/lib/server/auth";
import { isDuplicateAddress, normalizeAddress } from "@/modules/territories/do-not-visit";
import { ApiError, forbid, handle, parseBody, requireProfile } from "@/server/api";
import { writeAudit } from "@/server/outings/planning";
import { getTerritoryAccess } from "@/server/territories/access";

export const runtime = "nodejs";

const address = z.string().transform(normalizeAddress).pipe(z.string().min(3).max(200));

const mutation = z.discriminatedUnion("action", [
  z.object({ action: z.literal("create"), payload: z.object({ territory_id: z.string().uuid(), address }) }),
  z.object({ action: z.literal("update"), payload: z.object({ id: z.string().uuid(), address }) }),
  z.object({ action: z.literal("setActive"), payload: z.object({ id: z.string().uuid(), active: z.boolean() }) }),
  z.object({ action: z.literal("delete"), payload: z.object({ id: z.string().uuid() }) }),
]);

async function requireManager() {
  const profile = await requireProfile();
  if (!(await getTerritoryAccess(profile)).canManage) forbid("Solo Superintendente de Servicio o Siervo de Territorios administran las direcciones No visitar.");
  return profile;
}

export async function GET() {
  return handle(async () => {
    await requireManager();
    const supabase = createAdminSupabaseClient();
    const [items, territories] = await Promise.all([
      supabase.from("do_not_visit_addresses").select("id, territory_id, address, active, created_at").order("created_at", { ascending: false }),
      supabase.from("territories").select("id, number, name").eq("active", true).order("number"),
    ]);
    for (const result of [items, territories]) if (result.error) throw new Error(result.error.message);
    return { items: items.data ?? [], territories: territories.data ?? [] };
  });
}

export async function POST(request: Request) {
  return handle(async () => {
    const profile = await requireManager();
    const { action, payload } = await parseBody(request, mutation);
    const supabase = createAdminSupabaseClient();

    if (action === "create") {
      const { data: territory } = await supabase.from("territories").select("id").eq("id", payload.territory_id).eq("active", true).maybeSingle();
      if (!territory) throw new ApiError("Territorio no encontrado.", 404);
      const { data: existing, error: existingError } = await supabase.from("do_not_visit_addresses").select("address").eq("territory_id", payload.territory_id).eq("active", true);
      if (existingError) throw new Error(existingError.message);
      if (isDuplicateAddress(existing ?? [], payload.address)) throw new ApiError("Esa dirección ya está en No visitar para ese territorio.", 409);
      const { data, error } = await supabase.from("do_not_visit_addresses").insert({ territory_id: payload.territory_id, address: payload.address }).select("id").single();
      if (error || !data) throw new Error(error?.message ?? "No se pudo guardar la dirección.");
      await writeAudit(supabase, { actorId: profile.id, action: "DO_NOT_VISIT_ADDED", entityType: "do_not_visit_address", entityId: data.id, metadata: { territory_id: payload.territory_id }, after: { address: payload.address } });
      return { id: data.id };
    }

    const { data: before } = await supabase.from("do_not_visit_addresses").select("id, territory_id, address, active").eq("id", payload.id).maybeSingle();
    if (!before) throw new ApiError("Dirección no encontrada.", 404);

    if (action === "delete") {
      const { error } = await supabase.from("do_not_visit_addresses").delete().eq("id", payload.id);
      if (error) throw new Error(error.message);
      await writeAudit(supabase, { actorId: profile.id, action: "DO_NOT_VISIT_DELETED", entityType: "do_not_visit_address", entityId: payload.id, before });
      return {};
    }

    const patch = action === "update" ? { address: payload.address } : { active: payload.active };
    const { error } = await supabase.from("do_not_visit_addresses").update({ ...patch, updated_at: new Date().toISOString() }).eq("id", payload.id);
    if (error) throw new Error(error.message);
    await writeAudit(supabase, { actorId: profile.id, action: action === "update" ? "DO_NOT_VISIT_UPDATED" : payload.active ? "DO_NOT_VISIT_ACTIVATED" : "DO_NOT_VISIT_DEACTIVATED", entityType: "do_not_visit_address", entityId: payload.id, metadata: { territory_id: before.territory_id }, before, after: patch });
    return {};
  });
}
