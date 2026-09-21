import { NextRequest } from "next/server";
import { z } from "zod";
import { createAdminSupabaseClient } from "@/lib/server/auth";
import { ApiError, forbid, handle, parseBody, requireProfile } from "@/server/api";
import { canAccessTerritory, getBuildingAccess } from "@/server/buildings/access";
import { createBuilding, decideProposal, listBuildings, loadBuilding, proposeBuilding, saveStructure } from "@/server/buildings";
import { writeAudit } from "@/server/outings/planning";
import { applyCensusCorrection, censusPhoto, dismissCensus, listPendingCensus, reportMissingCensus } from "@/server/buildings/census";
import { censusReasons } from "@/modules/buildings/structure";
import { getLockDuration, loadUnitStatuses, markUnit, releaseRevisit, setLockDuration, undoActivity, unlockUnits } from "@/server/buildings/activity";

export const runtime = "nodejs";

const address = z.string().trim().min(3).max(200);
const unit = z.object({ id: z.string().uuid().nullable(), label: z.string().max(40), row: z.number().int(), col: z.number().int() });

const mutation = z.discriminatedUnion("action", [
  z.object({ action: z.literal("create"), payload: z.object({ territory_id: z.string().uuid(), address, labels: z.array(z.string().max(40)).max(300).optional(), columns: z.number().int().min(1).max(20).optional() }) }),
  z.object({ action: z.literal("propose"), payload: z.object({ territory_id: z.string().uuid(), address }) }),
  z.object({ action: z.literal("decideProposal"), payload: z.object({ id: z.string().uuid(), approve: z.boolean(), note: z.string().max(400).nullable().optional() }) }),
  z.object({ action: z.literal("saveStructure"), payload: z.object({ building_id: z.string().uuid(), expected_version: z.number().int().min(1), units: z.array(unit).max(300) }) }),
  z.object({ action: z.literal("reportCensus"), payload: z.object({ building_id: z.string().uuid(), base_version: z.number().int().min(1), reason: z.enum(censusReasons), description: z.string().max(1500).nullable().optional(), photo_data: z.string().max(900000).nullable().optional(), diff: z.array(z.unknown()).max(50).nullable().optional() }) }),
  z.object({ action: z.literal("applyCorrection"), payload: z.object({ id: z.string().uuid() }) }),
  z.object({ action: z.literal("dismissCensus"), payload: z.object({ id: z.string().uuid(), note: z.string().max(400).nullable().optional() }) }),
  z.object({ action: z.literal("markUnit"), payload: z.object({ unit_id: z.string().uuid(), attended: z.boolean(), interested: z.boolean().nullable().optional() }) }),
  z.object({ action: z.literal("undoActivity"), payload: z.object({ id: z.string().uuid(), reason: z.string().max(300).nullable().optional() }) }),
  z.object({ action: z.literal("releaseRevisit"), payload: z.object({ unit_id: z.string().uuid() }) }),
  z.object({ action: z.literal("unlock"), payload: z.object({ scope: z.enum(["UNIT", "BUILDING", "TERRITORY"]), id: z.string().uuid() }) }),
  z.object({ action: z.literal("setLockDuration"), payload: z.object({ amount: z.number().int(), unit: z.enum(["days", "weeks", "months"]) }) }),
  z.object({ action: z.literal("setStatus"), payload: z.object({ building_id: z.string().uuid(), active: z.boolean() }) }),
]);

export async function GET(request: NextRequest) {
  return handle(async () => {
    const profile = await requireProfile();
    const supabase = createAdminSupabaseClient();
    const access = await getBuildingAccess(supabase, profile);
    const params = request.nextUrl.searchParams;

    const buildingId = params.get("building");
    if (buildingId) {
      if (!z.string().uuid().safeParse(buildingId).success) throw new ApiError("Edificio inválido.", 422);
      const building = await loadBuilding(supabase, buildingId);
      if (!building || !canAccessTerritory(access, building.territory_id)) throw new ApiError("Edificio no encontrado.", 404);
      return { canManage: access.canManage, me: profile.id, me_name: profile.full_name, building, statuses: await loadUnitStatuses(supabase, buildingId, profile, access.canManage) };
    }

    const photoId = params.get("censusPhoto");
    if (photoId) {
      if (!access.canManage) forbid("Solo Servicio o Territorios ven las fotos de los informes.");
      if (!z.string().uuid().safeParse(photoId).success) throw new ApiError("Informe inválido.", 422);
      return { photo: await censusPhoto(supabase, photoId) };
    }

    const territoryId = params.get("territory") ?? undefined;
    if (territoryId && !z.string().uuid().safeParse(territoryId).success) throw new ApiError("Territorio inválido.", 422);
    if (territoryId && !canAccessTerritory(access, territoryId)) forbid("No tenés acceso a los edificios de ese territorio.");

    const [buildings, proposals, census, territories] = await Promise.all([
      listBuildings(supabase, { territoryIds: access.territoryIds, territoryId, q: params.get("q") ?? undefined }),
      access.canManage
        ? supabase.from("building_proposals").select("id, territory_id, address, created_at, profiles!proposed_by(full_name), territories(number)").eq("status", "PENDING").order("created_at")
        : Promise.resolve({ data: [], error: null }),
      access.canManage ? listPendingCensus(supabase) : Promise.resolve([]),
      // Territories the caller can attach a building/proposal to.
      (async () => {
        const query = supabase.from("territories").select("id, number, name").eq("active", true).order("number");
        return access.territoryIds ? (access.territoryIds.size ? query.in("id", [...access.territoryIds]) : { data: [], error: null }) : query;
      })(),
    ]);
    if (proposals.error) throw new Error(proposals.error.message);
    if (territories.error) throw new Error(territories.error.message);
    return {
      canManage: access.canManage,
      lock: access.canManage ? await getLockDuration(supabase) : null,
      buildings,
      census,
      territories: territories.data ?? [],
      proposals: (proposals.data ?? []).map((row) => {
        const author = Array.isArray(row.profiles) ? row.profiles[0] : row.profiles;
        const territory = Array.isArray(row.territories) ? row.territories[0] : row.territories;
        return { id: row.id, territory_id: row.territory_id, territory_number: (territory as { number?: number } | null)?.number ?? 0, address: row.address, created_at: row.created_at, author: (author as { full_name?: string } | null)?.full_name ?? null };
      }),
    };
  });
}

export async function POST(request: Request) {
  return handle(async () => {
    const profile = await requireProfile();
    const { action, payload } = await parseBody(request, mutation);
    const supabase = createAdminSupabaseClient();
    const access = await getBuildingAccess(supabase, profile);

    if (action === "propose") {
      if (!canAccessTerritory(access, payload.territory_id)) forbid("Solo podés informar edificios de territorios de tus salidas.");
      return proposeBuilding(supabase, profile, payload);
    }

    if (action === "reportCensus") return reportMissingCensus(supabase, profile, access, payload);
    if (action === "markUnit") return markUnit(supabase, profile, access, payload);
    if (action === "undoActivity") return undoActivity(supabase, profile, access, payload);
    if (action === "releaseRevisit") return releaseRevisit(supabase, profile, access, payload.unit_id);

    if (!access.canManage) forbid("Solo Superintendente de Servicio o Siervo de Territorios administran los edificios.");
    if (action === "unlock") return unlockUnits(supabase, profile, payload);
    if (action === "setLockDuration") return setLockDuration(supabase, profile.id, payload);
    if (action === "applyCorrection") return applyCensusCorrection(supabase, profile, payload.id);
    if (action === "dismissCensus") return dismissCensus(supabase, profile, payload);
    if (action === "create") return { id: await createBuilding(supabase, { ...payload, actorId: profile.id }) };
    if (action === "decideProposal") return decideProposal(supabase, profile, payload);
    if (action === "saveStructure") return saveStructure(supabase, profile.id, payload);

    const { error } = await supabase.from("buildings").update({ status: payload.active ? "ACTIVE" : "INACTIVE", updated_at: new Date().toISOString() }).eq("id", payload.building_id);
    if (error) throw new Error(error.message);
    await writeAudit(supabase, { actorId: profile.id, action: payload.active ? "BUILDING_ACTIVATED" : "BUILDING_DEACTIVATED", entityType: "building", entityId: payload.building_id });
    return {};
  });
}
