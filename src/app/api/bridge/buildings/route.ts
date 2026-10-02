import { timingSafeEqual } from "node:crypto";
import { z } from "zod";
import { createAdminSupabaseClient } from "@/lib/server/auth";
import { censusReasons } from "@/modules/buildings/structure";
import { ApiError, handle, parseBody } from "@/server/api";
import { markUnitAnonymous, releaseRevisitAnonymous } from "@/server/buildings/activity";
import { bridgeBuilding, bridgeSearch, bridgeStreet, bridgeStreets, bridgeTerritories, bridgeTerritory } from "@/server/buildings/bridge";
import { reportCensusFromWeb } from "@/server/buildings/census";
import { proposeBuildingFromWeb } from "@/server/buildings";

export const runtime = "nodejs";

/**
 * Server-to-server door for the public cperalta.com.ar site (PHP). It has no accounts, so every call
 * must carry the shared secret; without BUILDINGS_BRIDGE_SECRET configured the door stays shut.
 */
function authorize(request: Request) {
  const secret = process.env.BUILDINGS_BRIDGE_SECRET;
  if (!secret) throw new ApiError("El puente con el sitio web no está configurado.", 503);
  const given = request.headers.get("x-bridge-secret") ?? "";
  const a = Buffer.from(given);
  const b = Buffer.from(secret);
  if (a.length !== b.length || !timingSafeEqual(a, b)) throw new ApiError("No autorizado.", 401);
}

const mutation = z.discriminatedUnion("action", [
  z.object({ action: z.literal("search"), payload: z.object({ q: z.string().max(100) }) }),
  z.object({ action: z.literal("streets"), payload: z.object({}).optional() }),
  z.object({ action: z.literal("street"), payload: z.object({ street: z.string().min(1).max(150) }) }),
  z.object({ action: z.literal("territories"), payload: z.object({}).optional() }),
  z.object({ action: z.literal("territory"), payload: z.object({ number: z.number().int().min(1).max(9999) }) }),
  z.object({ action: z.literal("building"), payload: z.object({ id: z.string().uuid() }) }),
  z.object({ action: z.literal("markUnit"), payload: z.object({ unit_id: z.string().uuid(), attended: z.boolean(), interested: z.boolean().nullable().optional(), no_return: z.boolean().optional() }) }),
  z.object({ action: z.literal("releaseRevisit"), payload: z.object({ unit_id: z.string().uuid() }) }),
  z.object({ action: z.literal("reportCensus"), payload: z.object({ building_id: z.string().uuid(), reason: z.enum(censusReasons), description: z.string().max(1500).nullable().optional(), photo_data: z.string().max(900000).nullable().optional(), contact: z.string().max(120).nullable().optional() }) }),
  z.object({ action: z.literal("proposeBuilding"), payload: z.object({ address: z.string().min(3).max(200), unit_count: z.number().int().min(1).max(500), photo_data: z.string().max(900000), territory_number: z.number().int().min(1).max(9999).nullable().optional(), contact: z.string().max(120).nullable().optional() }) }),
]);

export async function POST(request: Request) {
  return handle(async () => {
    authorize(request);
    const { action, payload } = await parseBody(request, mutation);
    const supabase = createAdminSupabaseClient();
    switch (action) {
      case "search": return bridgeSearch(supabase, payload.q);
      case "streets": return bridgeStreets(supabase);
      case "street": return bridgeStreet(supabase, payload.street);
      case "territories": return bridgeTerritories(supabase);
      case "territory": return bridgeTerritory(supabase, payload.number);
      case "building": return bridgeBuilding(supabase, payload.id);
      case "markUnit": return markUnitAnonymous(supabase, payload);
      case "releaseRevisit": return releaseRevisitAnonymous(supabase, payload.unit_id);
      case "reportCensus": return reportCensusFromWeb(supabase, payload);
      case "proposeBuilding": return proposeBuildingFromWeb(supabase, payload);
    }
  });
}
