import { NextRequest } from "next/server";
import { createAdminSupabaseClient, getCurrentProfile } from "@/lib/server/auth";
import { fail, ok } from "@/lib/server/responses";
import { getFreshPermissionContext, hasPermission } from "@/server/permissions";

export const runtime = "nodejs";
const limit = 12;
const sourceLimit = 200;
const matches = (value: string, term: string) => !term || value.toLocaleLowerCase().includes(term);

export async function GET(request: NextRequest) {
  try {
    const profile = await getCurrentProfile();
    if (!profile) return fail("No autenticado.", 401);
    const permissions = await getFreshPermissionContext(profile.id);
    if (!permissions) return fail("No autorizado.", 403);
    const term = (request.nextUrl.searchParams.get("q") ?? "").trim().toLocaleLowerCase();
    const supabase = createAdminSupabaseClient();
    const canTerritories = hasPermission(permissions, "MANAGE_TERRITORIES");
    const canUsers = hasPermission(permissions, "MANAGE_USERS");
    const canOutings = hasPermission(permissions, "PLAN_OUTINGS") || hasPermission(permissions, "PUBLISH_OUTINGS");
    const [territories, users, outings] = await Promise.all([
      canTerritories ? supabase.from("territories").select("id,number,name").eq("active", true).order("number").limit(sourceLimit) : Promise.resolve({ data: [], error: null }),
      canUsers ? supabase.from("profiles").select("id,full_name,username").eq("active", true).order("full_name").limit(sourceLimit) : Promise.resolve({ data: [], error: null }),
      canOutings ? supabase.from("weekly_outings").select("id,starts_on").order("starts_on", { ascending: false }).limit(sourceLimit) : Promise.resolve({ data: [], error: null }),
    ]);
    const error = [territories.error, users.error, outings.error].find(Boolean);
    if (error) return fail(error.message, 500);
    return ok({ entries: [
      ...(territories.data ?? []).filter((item) => matches(`territorio ${item.number} ${item.name}`, term)).map((item) => ({ id: `territory:${item.id}`, type: "territory", label: `Territorio #${item.number}`, sublabel: item.name || undefined, view: "territories" })),
      ...(users.data ?? []).filter((item) => matches(`${item.full_name} ${item.username}`, term)).map((item) => ({ id: `user:${item.id}`, type: "user", label: item.full_name, sublabel: `@${item.username}`, view: "users" })),
      ...(outings.data ?? []).filter((item) => matches(`salida ${item.starts_on}`, term)).map((item) => ({ id: `outing:${item.id}`, type: "outing", label: `Salida: semana del ${item.starts_on}`, sublabel: "Planificación semanal", view: "outings" })),
    ].slice(0, limit) });
  } catch (error) { return fail(error instanceof Error ? error.message : "Error inesperado.", 500); }
}
