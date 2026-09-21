import { z } from "zod";
import { createAdminSupabaseClient } from "@/lib/server/auth";
import { isSafeImageUrl, validatePolygon } from "@/modules/map/geometry";
import { ApiError, forbid, handle, parseBody, requireProfile } from "@/server/api";
import { loadMap } from "@/server/map";
import { writeAudit } from "@/server/outings/planning";
import { getTerritoryAccess } from "@/server/territories/access";

export const runtime = "nodejs";

const mutation = z.discriminatedUnion("action", [
  z.object({ action: z.literal("createLayer"), payload: z.object({ name: z.string().trim().min(1).max(120), image_url: z.string().max(500) }) }),
  z.object({ action: z.literal("setImageSize"), payload: z.object({ layer_id: z.string().uuid(), width: z.number().int().min(1).max(20000), height: z.number().int().min(1).max(20000) }) }),
  z.object({ action: z.literal("saveFeature"), payload: z.object({ layer_id: z.string().uuid(), territory_id: z.string().uuid(), block_id: z.string().uuid().nullable().optional(), points: z.array(z.unknown()) }) }),
  z.object({ action: z.literal("deleteFeature"), payload: z.object({ id: z.string().uuid() }) }),
]);

export async function GET() {
  return handle(async () => {
    const profile = await requireProfile();
    if (!(await getTerritoryAccess(profile)).canManage) forbid("No tenés permiso para ver el mapa de territorios.");
    return { ...(await loadMap(createAdminSupabaseClient())), canEdit: true };
  });
}

export async function POST(request: Request) {
  return handle(async () => {
    const profile = await requireProfile();
    if (!(await getTerritoryAccess(profile)).canManage) forbid("Solo Superintendente de Servicio o Siervo de Territorios pueden configurar el mapa.");
    const { action, payload } = await parseBody(request, mutation);
    const supabase = createAdminSupabaseClient();

    if (action === "createLayer") {
      if (!isSafeImageUrl(payload.image_url)) throw new ApiError("La imagen debe ser una ruta del sitio (p. ej. /maps/territorios.jpg) o una URL https.", 422);
      // Only one map is active: the previous one is archived, never deleted.
      const archived = await supabase.from("territory_map_layers").update({ active: false, updated_at: new Date().toISOString() }).eq("active", true);
      if (archived.error) throw new Error(archived.error.message);
      const { data, error } = await supabase.from("territory_map_layers").insert({ name: payload.name, image_url: payload.image_url, created_by: profile.id }).select("id").single();
      if (error || !data) throw new Error(error?.message ?? "No se pudo crear el mapa.");
      await writeAudit(supabase, { actorId: profile.id, action: "MAP_LAYER_CREATED", entityType: "territory_map_layer", entityId: data.id, after: payload });
      return { id: data.id };
    }

    if (action === "setImageSize") {
      const { error } = await supabase.from("territory_map_layers").update({ image_width: payload.width, image_height: payload.height }).eq("id", payload.layer_id).is("image_width", null);
      if (error) throw new Error(error.message);
      return {};
    }

    if (action === "deleteFeature") {
      const { data: before } = await supabase.from("territory_map_features").select("*").eq("id", payload.id).maybeSingle();
      if (!before) throw new ApiError("Forma no encontrada.", 404);
      const { error } = await supabase.from("territory_map_features").delete().eq("id", payload.id);
      if (error) throw new Error(error.message);
      await writeAudit(supabase, { actorId: profile.id, action: "MAP_FEATURE_DELETED", entityType: "territory_map_feature", entityId: payload.id, before });
      return {};
    }

    const polygon = validatePolygon(payload.points);
    if (!polygon.ok) throw new ApiError(polygon.error, 422);
    const blockId = payload.block_id ?? null;
    if (blockId) {
      const { data: block } = await supabase.from("blocks").select("id").eq("id", blockId).eq("territory_id", payload.territory_id).maybeSingle();
      if (!block) throw new ApiError("La manzana no pertenece a ese territorio.", 422);
    }
    const existing = await supabase.from("territory_map_features").select("id").eq("layer_id", payload.layer_id).eq("territory_id", payload.territory_id).is("block_id", blockId).maybeSingle();
    if (existing.error) throw new Error(existing.error.message);
    const saved = existing.data
      ? await supabase.from("territory_map_features").update({ points: polygon.points, updated_at: new Date().toISOString() }).eq("id", existing.data.id).select("id").single()
      : await supabase.from("territory_map_features").insert({ layer_id: payload.layer_id, territory_id: payload.territory_id, block_id: blockId, points: polygon.points }).select("id").single();
    if (saved.error || !saved.data) throw new Error(saved.error?.message ?? "No se pudo guardar la forma.");
    await writeAudit(supabase, { actorId: profile.id, action: existing.data ? "MAP_FEATURE_UPDATED" : "MAP_FEATURE_CREATED", entityType: "territory_map_feature", entityId: saved.data.id, metadata: { territory_id: payload.territory_id, block_id: blockId }, after: { points: polygon.points.length } });
    return { id: saved.data.id };
  });
}
