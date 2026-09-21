import { z } from "zod";
import { createAdminSupabaseClient } from "@/lib/server/auth";
import { chunk, validateAnnouncement } from "@/modules/announcements/validation";
import { ApiError, forbid, handle, parseBody, requireProfile } from "@/server/api";
import { safeEmit, writeAudit } from "@/server/outings/planning";
import { canPublishAnnouncements } from "@/server/announcements";

export const runtime = "nodejs";

const mutation = z.discriminatedUnion("action", [
  z.object({ action: z.literal("publish"), payload: z.object({ title: z.string(), description: z.string() }) }),
  z.object({ action: z.literal("archive"), payload: z.object({ id: z.string().uuid() }) }),
]);

export async function GET() {
  return handle(async () => {
    const profile = await requireProfile();
    const supabase = createAdminSupabaseClient();
    const { data, error } = await supabase.from("announcements").select("id, title, description, created_at, profiles!created_by(full_name)").is("archived_at", null).order("created_at", { ascending: false }).limit(50);
    if (error) throw new Error(error.message);
    return {
      canPublish: await canPublishAnnouncements(profile),
      items: (data ?? []).map((row) => {
        const author = Array.isArray(row.profiles) ? row.profiles[0] : row.profiles;
        return { id: row.id, title: row.title, description: row.description, created_at: row.created_at, author: (author as { full_name?: string } | null)?.full_name ?? null };
      }),
    };
  });
}

export async function POST(request: Request) {
  return handle(async () => {
    const profile = await requireProfile();
    if (!(await canPublishAnnouncements(profile))) forbid("Solo el Coordinador o el Superintendente de Servicio pueden publicar anuncios.");
    const { action, payload } = await parseBody(request, mutation);
    const supabase = createAdminSupabaseClient();

    if (action === "archive") {
      const { error, data } = await supabase.from("announcements").update({ archived_at: new Date().toISOString(), archived_by: profile.id }).eq("id", payload.id).is("archived_at", null).select("id");
      if (error) throw new Error(error.message);
      if (!data?.length) throw new ApiError("Anuncio no encontrado.", 404);
      await writeAudit(supabase, { actorId: profile.id, action: "ANNOUNCEMENT_ARCHIVED", entityType: "announcement", entityId: payload.id });
      return {};
    }

    const parsed = validateAnnouncement(payload);
    if (!parsed.ok) throw new ApiError(parsed.error, 422);
    const { data: created, error } = await supabase.from("announcements").insert({ ...parsed.value, created_by: profile.id }).select("id").single();
    if (error || !created) throw new Error(error?.message ?? "No se pudo publicar el anuncio.");
    await writeAudit(supabase, { actorId: profile.id, action: "ANNOUNCEMENT_PUBLISHED", entityType: "announcement", entityId: created.id, after: parsed.value });

    // One internal notification + push per active user (idempotent per announcement/recipient).
    const { data: users, error: usersError } = await supabase.from("profiles").select("id").eq("active", true);
    if (usersError) throw new Error(usersError.message);
    const recipients = (users ?? []).map((row) => row.id as string).filter((id) => id !== profile.id);
    for (const group of chunk(recipients, 10)) {
      await Promise.all(group.map((recipientId) => safeEmit({ type: "ANNOUNCEMENT_PUBLISHED", naturalKey: `announcement:${created.id}:${recipientId}`, actorId: profile.id, payload: { recipientId, announcementId: created.id, title: parsed.value.title, detail: parsed.value.description } })));
    }
    return { id: created.id, notified: recipients.length };
  });
}
