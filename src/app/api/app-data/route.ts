import { z } from "zod";
import {
  assertAdmin,
  createAdminSupabaseClient,
  generateTemporaryPassword,
  getCurrentProfile,
  hashPassword,
  type SessionProfile,
} from "@/lib/server/auth";
import { fail, ok } from "@/lib/server/responses";
import { blockStatuses, reservationStatuses, roles } from "@/lib/domain";

export const runtime = "nodejs";

const reservationBaseSchema = z.object({
  reservation_window_id: z.string().uuid(),
  service_date: z.string().date(),
  departure_location: z.string().trim().min(2).max(180),
});

const createReservationSchema = reservationBaseSchema.extend({
  territory_ids: z.array(z.string().uuid()).min(1).max(20),
});

const createAdminReservationSchema = z.object({
  reservation_window_id: z.string().uuid(),
  territory_ids: z.array(z.string().uuid()).min(1).max(20),
  admin_note: z.string().trim().max(240).optional(),
});

const updateReservationSchema = reservationBaseSchema.extend({
  territory_id: z.string().uuid(),
});

const windowSchema = z
  .object({
    name: z.string().trim().min(2).max(100),
    saturday_date: z.union([z.string().date(), z.literal(""), z.null()]).optional(),
    sunday_date: z.union([z.string().date(), z.literal(""), z.null()]).optional(),
    booking_deadline: z.string().datetime(),
    active: z.boolean().optional(),
  })
  .refine((value) => value.saturday_date || value.sunday_date, {
    message: "Debes indicar al menos una fecha.",
  });

const territoryVisitSchema = z.object({
  territory_id: z.string().uuid(),
  visit_date: z.string().date(),
  done_labels: z.array(z.string().trim().min(1)).default([]),
  pending_labels: z.array(z.string().trim().min(1)).default([]),
});

async function requireProfile() {
  const profile = await getCurrentProfile();
  if (!profile) throw new Error("No autenticado.");
  return profile;
}

function isPastDeadline(deadline: string) {
  return new Date(deadline).getTime() < Date.now();
}

function migrationMessage(message: string) {
  const fields = ["reservation_windows", "reservation_window_id", "departure_location", "admin_notifications", "group_id", "reserved_by_admin", "admin_note", "profile_roles", "territory_rounds", "weekly_outing", "departure_points", "weekend_roster"];
  return fields.some((field) => message.includes(field))
    ? `${message} Ejecuta las migraciones de supabase/ pendientes y vuelve a intentar.`
    : message;
}

function getServiceDay(serviceDate: string) {
  const date = new Date(`${serviceDate}T00:00:00Z`);
  const serviceDay = date.getUTCDay() === 6 ? "SATURDAY" : date.getUTCDay() === 0 ? "SUNDAY" : null;
  return serviceDay;
}

function getWindowServiceDates(windowData: { saturday_date: string | null; sunday_date: string | null }) {
  return [windowData.saturday_date, windowData.sunday_date].filter(Boolean) as string[];
}

async function ensureTerritoriesCanBeReserved(territoryIds: string[]) {
  const supabase = createAdminSupabaseClient();
  const { data: territories, error: territoriesError } = await supabase
    .from("territories")
    .select("id")
    .in("id", territoryIds)
    .eq("active", true);
  if (territoriesError) throw new Error(territoriesError.message);
  if ((territories ?? []).length !== territoryIds.length) {
    throw new Error("Uno de los territorios seleccionados no esta activo.");
  }

  const { data: activeRound } = await supabase
    .from("annual_rounds")
    .select("id")
    .eq("status", "OPEN")
    .order("year", { ascending: false })
    .order("opened_at", { ascending: false })
    .limit(1)
    .maybeSingle();
  if (!activeRound) return;

  const { data: territoryBlocks, error: blockError } = await supabase
    .from("blocks")
    .select("id, territory_id")
    .in("territory_id", territoryIds)
    .eq("active", true);
  if (blockError) throw new Error(blockError.message);
  const blockIds = (territoryBlocks ?? []).map((block) => block.id);
  const { data: completedStatuses, error: statusError } = blockIds.length
    ? await supabase
        .from("block_round_statuses")
        .select("block_id")
        .eq("annual_round_id", activeRound.id)
        .eq("status", "COMPLETED")
        .in("block_id", blockIds)
    : { data: [], error: null };
  if (statusError) throw new Error(statusError.message);
  const completedIds = new Set((completedStatuses ?? []).map((status) => status.block_id));
  const completedTerritory = territoryIds.find((territoryId) => {
    const matchingBlocks = (territoryBlocks ?? []).filter((block) => block.territory_id === territoryId);
    return matchingBlocks.length > 0 && matchingBlocks.every((block) => completedIds.has(block.id));
  });
  if (completedTerritory) {
    throw new Error("Uno de los territorios seleccionados ya tiene todas sus manzanas completadas.");
  }
}

async function getReservationForChange(
  id: string,
  profile: SessionProfile,
) {
  const supabase = createAdminSupabaseClient();
  const { data, error } = await supabase
    .from("territory_reservations")
    .select("id, responsible_user_id, status, reservation_windows(booking_deadline)")
    .eq("id", id)
    .single();

  if (error || !data) throw new Error("Reserva no encontrada.");
  const windowData = Array.isArray(data.reservation_windows)
    ? data.reservation_windows[0]
    : data.reservation_windows;

  if (!profile.roles.includes("ADMIN")) {
    if (data.responsible_user_id !== profile.id) throw new Error("No puedes modificar una reserva ajena.");
    if (!windowData || isPastDeadline(windowData.booking_deadline)) {
      throw new Error("La fecha limite de esta ventana ya paso.");
    }
  }

  return data;
}

export async function GET() {
  try {
    const profile = await requireProfile();
    const supabase = createAdminSupabaseClient();
    const isAdmin = profile.roles.includes("ADMIN");
    const canSeeBlocks = isAdmin || profile.roles.includes("CONDUCTOR");

    const groupsQuery = isAdmin
      ? supabase.from("groups").select("*").order("name")
      : profile.group_id
        ? supabase.from("groups").select("*").eq("id", profile.group_id)
        : Promise.resolve({ data: [], error: null });
    const reservationsQuery = isAdmin
      ? supabase
          .from("territory_reservations")
          .select("*, territories(number,name), groups(name), profiles!responsible_user_id(full_name,username), reservation_windows(name,booking_deadline)")
          .order("service_date", { ascending: true })
      : supabase
          .from("territory_reservations")
          .select("*, territories(number,name), groups(name), profiles!responsible_user_id(full_name,username), reservation_windows(name,booking_deadline)")
          .eq("responsible_user_id", profile.id)
          .order("service_date", { ascending: true });

    const [
      groupsResult,
      territoriesResult,
      windowsResult,
      reservationsResult,
      unavailableResult,
      blocksResult,
      roundsResult,
      statusesResult,
      profilesResult,
      notificationsResult,
      territoryRoundsResult,
      weeklyOutingsResult,
      departurePointsResult,
      weekendRosterResult,
    ] = await Promise.all([
      groupsQuery,
      supabase.from("territories").select("*").eq("active", true).order("number"),
      supabase.from("reservation_windows").select("*").order("saturday_date", { ascending: true }),
      reservationsQuery,
      isAdmin
        ? Promise.resolve({ data: [], error: null })
        : supabase
            .from("territory_reservations")
            .select("territory_id, service_date")
            .eq("status", "ACTIVE"),
      supabase.from("blocks").select("*").eq("active", true).order("label"),
      supabase.from("annual_rounds").select("*").order("year", { ascending: false }).order("opened_at", { ascending: false }),
      supabase.from("block_round_statuses").select("*, blocks(label,territory_id,territories(number,name))").order("updated_at", { ascending: false }),
      isAdmin
        ? supabase.from("profiles").select("id, username, full_name, active, must_change_password, password_updated_at, group_id, groups(name), profile_roles(role)").order("full_name")
        : Promise.resolve({ data: [], error: null }),
      isAdmin
        ? supabase
            .from("admin_notifications")
            .select("*, profiles!actor_id(full_name,username), territory_reservations(service_date,reservation_windows(name))")
            .order("created_at", { ascending: false })
            .limit(30)
        : Promise.resolve({ data: [], error: null }),
      supabase
        .from("territory_rounds")
        .select("*, territories(number,name), profiles!conductor_id(full_name,username)")
        .order("assigned_on", { ascending: false }),
      isAdmin
        ? supabase
            .from("weekly_outings")
            .select("*, weekly_outing_slots(*, profiles!conductor_id(full_name,username), weekly_outing_slot_territories(*, territories(number), territory_rounds(pending_block_labels,conductor_id)))")
            .order("starts_on", { ascending: false })
        : Promise.resolve({ data: [], error: null }),
      isAdmin
        ? supabase.from("departure_points").select("*, territories(number)").order("name")
        : Promise.resolve({ data: [], error: null }),
      isAdmin
        ? supabase.from("weekend_roster").select("*, profiles!conductor_id(full_name,username)").order("service_date")
        : Promise.resolve({ data: [], error: null }),
    ]);

    const firstError = [
      groupsResult.error,
      territoriesResult.error,
      windowsResult.error,
      reservationsResult.error,
      unavailableResult.error,
      blocksResult.error,
      roundsResult.error,
      statusesResult.error,
      profilesResult.error,
      notificationsResult.error,
      territoryRoundsResult.error,
      weeklyOutingsResult.error,
      departurePointsResult.error,
      weekendRosterResult.error,
    ].find(Boolean);
    if (firstError) return fail(migrationMessage(firstError.message), 500);

    const rounds = roundsResult.data ?? [];
    const blocks = blocksResult.data ?? [];
    const statuses = statusesResult.data ?? [];
    const activeRound = rounds.find((round) => round.status === "OPEN") ?? null;
    const activeStatuses = new Map(
      statuses
        .filter((status) => status.annual_round_id === activeRound?.id)
        .map((status) => [status.block_id, status.status]),
    );
    const lastCompletionByTerritory = new Map<string, string>();
    for (const status of statuses) {
      const territoryId = status.blocks?.territory_id;
      if (status.status !== "COMPLETED" || !status.completed_on || !territoryId) continue;
      const current = lastCompletionByTerritory.get(territoryId);
      if (!current || status.completed_on > current) lastCompletionByTerritory.set(territoryId, status.completed_on);
    }
    const territoryProgress = (territoriesResult.data ?? []).map((territory) => {
      const territoryBlocks = blocks.filter((block) => block.territory_id === territory.id);
      const completedBlocks = territoryBlocks.filter((block) => activeStatuses.get(block.id) === "COMPLETED");
      return {
        territory_id: territory.id,
        total_blocks: territoryBlocks.length,
        completed_blocks: completedBlocks.length,
        pending_labels: territoryBlocks
          .filter((block) => activeStatuses.get(block.id) !== "COMPLETED")
          .map((block) => block.label),
        last_completed_at: lastCompletionByTerritory.get(territory.id) ?? null,
      };
    });

    const profiles = (profilesResult.data ?? []).map((item) => {
      const { profile_roles, ...rest } = item as typeof item & { profile_roles?: { role: string }[] };
      return { ...rest, roles: (profile_roles ?? []).map((entry) => entry.role) };
    });

    return ok({
      profile,
      groups: groupsResult.data ?? [],
      territories: territoriesResult.data ?? [],
      reservationWindows: windowsResult.data ?? [],
      reservations: reservationsResult.data ?? [],
      unavailableReservations: unavailableResult.data ?? [],
      territoryProgress,
      activeRound: activeRound ? { id: activeRound.id, year: activeRound.year, name: activeRound.name } : null,
      blocks: canSeeBlocks ? blocks : [],
      rounds: isAdmin ? rounds : [],
      blockStatuses: isAdmin ? statuses : [],
      profiles,
      notifications: notificationsResult.data ?? [],
      territoryRounds: territoryRoundsResult.data ?? [],
      weeklyOutings: weeklyOutingsResult.data ?? [],
      departurePoints: departurePointsResult.data ?? [],
      weekendRoster: weekendRosterResult.data ?? [],
    });
  } catch (error) {
    return fail(error instanceof Error ? error.message : "Error inesperado.", 401);
  }
}

export async function POST(request: Request) {
  try {
    const profile = await requireProfile();
    const supabase = createAdminSupabaseClient();
    const { action, payload } = (await request.json()) as {
      action: string;
      payload?: Record<string, unknown>;
    };

    if (action === "createReservation" || action === "updateReservation") {
      const result = action === "createReservation"
        ? createReservationSchema.safeParse(payload)
        : updateReservationSchema.safeParse(payload);
      if (!result.success) return fail("Completa el territorio y el lugar de salida.", 422);
      if (!profile.roles.includes("ANCIANO")) return fail("Las respuestas de ventana corresponden a los ancianos.", 403);
      if (!profile.group_id) return fail("Tu usuario no tiene un grupo asignado. Contacta al administrador.", 422);

      const { data: windowData, error: windowError } = await supabase
        .from("reservation_windows")
        .select("*")
        .eq("id", result.data.reservation_window_id)
        .single();
      if (windowError || !windowData || !windowData.active) return fail("La ventana no esta disponible.", 404);
      if (isPastDeadline(windowData.booking_deadline)) return fail("La fecha limite de esta ventana ya paso.", 409);
      if (![windowData.saturday_date, windowData.sunday_date].includes(result.data.service_date)) {
        return fail("La fecha no pertenece a esta ventana.", 422);
      }

      const serviceDay = getServiceDay(result.data.service_date);
      if (!serviceDay) return fail("La fecha debe ser sabado o domingo.", 422);

      const territoryIds = "territory_ids" in result.data
        ? [...new Set(result.data.territory_ids)]
        : [result.data.territory_id];
      try {
        await ensureTerritoriesCanBeReserved(territoryIds);
      } catch (error) {
        return fail(error instanceof Error ? error.message : "No se pudieron validar los territorios.", 409);
      }

      if (action === "updateReservation") {
        await getReservationForChange(String(payload?.id), profile);
        const { error } = await supabase
          .from("territory_reservations")
          .update({
            territory_id: territoryIds[0],
            departure_location: result.data.departure_location,
          })
          .eq("id", String(payload?.id))
          .eq("responsible_user_id", profile.id);
        if (error) return fail(error.code === "23505" ? "Ese territorio ya fue reservado para esa fecha." : error.message, 409);
        return ok();
      }

      const rows = territoryIds.map((territoryId) => ({
        reservation_window_id: result.data.reservation_window_id,
        territory_id: territoryId,
        group_id: profile.group_id,
        responsible_user_id: profile.id,
        service_date: result.data.service_date,
        service_day: serviceDay,
        departure_location: result.data.departure_location,
        created_by: profile.id,
      }));
      const { data: reservations, error } = await supabase
        .from("territory_reservations")
        .insert(rows)
        .select("id")
      if (error || !reservations?.length) {
        return fail(error?.code === "23505" ? "Uno de esos territorios ya esta reservado para esa fecha." : error?.message ?? "No se pudo reservar.", error?.code === "23505" ? 409 : 400);
      }

      await supabase.from("admin_notifications").insert({
        reservation_id: null,
        actor_id: profile.id,
        message: `${profile.full_name} reservo ${territoryIds.length} territorio${territoryIds.length === 1 ? "" : "s"} en ${windowData.name} para el ${result.data.service_date}.`,
      });
      return ok();
    }

    if (action === "deleteReservation") {
      const id = String(payload?.id);
      await getReservationForChange(id, profile);
      const query = supabase.from("territory_reservations").delete().eq("id", id);
      if (!profile.roles.includes("ADMIN")) query.eq("responsible_user_id", profile.id);
      const { error } = await query;
      if (error) return fail(error.message);
      return ok();
    }

    if (action === "submitTerritoryVisit") {
      if (!profile.roles.includes("CONDUCTOR")) return fail("Esta accion es solo para conductores.", 403);
      const result = territoryVisitSchema.safeParse(payload);
      if (!result.success) return fail("Completa el territorio, la fecha y las manzanas.", 422);
      const { territory_id, visit_date, done_labels, pending_labels } = result.data;

      const { data: openRound, error: openRoundError } = await supabase
        .from("territory_rounds")
        .select("*")
        .eq("territory_id", territory_id)
        .is("completed_on", null)
        .maybeSingle();
      if (openRoundError) return fail(openRoundError.message);

      const allDone = pending_labels.length === 0;
      let territoryRoundId: string;

      if (allDone) {
        if (openRound) {
          const { error } = await supabase
            .from("territory_rounds")
            .update({
              completed_on: visit_date,
              pending_block_labels: [],
              done_block_labels: [...new Set([...(openRound.done_block_labels ?? []), ...done_labels])],
              updated_at: new Date().toISOString(),
            })
            .eq("id", openRound.id);
          if (error) return fail(error.message);
          territoryRoundId = openRound.id;
        } else {
          const { data: created, error } = await supabase
            .from("territory_rounds")
            .insert({
              territory_id,
              conductor_id: profile.id,
              assigned_on: visit_date,
              completed_on: visit_date,
              pending_block_labels: [],
              done_block_labels: done_labels,
            })
            .select("id")
            .single();
          if (error || !created) return fail(error?.message ?? "No se pudo registrar la visita.");
          territoryRoundId = created.id;
        }
      } else if (openRound) {
        const { error } = await supabase
          .from("territory_rounds")
          .update({
            pending_block_labels: pending_labels,
            done_block_labels: done_labels,
            updated_at: new Date().toISOString(),
          })
          .eq("id", openRound.id);
        if (error) return fail(error.message);
        territoryRoundId = openRound.id;
      } else {
        const { data: created, error } = await supabase
          .from("territory_rounds")
          .insert({
            territory_id,
            conductor_id: profile.id,
            assigned_on: visit_date,
            completed_on: null,
            pending_block_labels: pending_labels,
            done_block_labels: done_labels,
          })
          .select("id")
          .single();
        if (error || !created) return fail(error?.message ?? "No se pudo registrar la visita.");
        territoryRoundId = created.id;
      }

      await supabase.from("territory_visits").insert({
        territory_round_id: territoryRoundId,
        conductor_id: profile.id,
        visit_date,
        done_labels,
        pending_labels,
      });

      return ok();
    }

    assertAdmin(profile);

    if (action === "createAdminReservations") {
      const result = createAdminReservationSchema.safeParse(payload);
      if (!result.success) return fail("Selecciona la ventana y al menos un territorio.", 422);

      const { data: windowData, error: windowError } = await supabase
        .from("reservation_windows")
        .select("*")
        .eq("id", result.data.reservation_window_id)
        .single();
      if (windowError || !windowData || !windowData.active) return fail("La ventana no esta disponible.", 404);
      const serviceDates = getWindowServiceDates(windowData);
      if (!serviceDates.length) return fail("La ventana no tiene fechas habilitadas.", 422);

      const territoryIds = [...new Set(result.data.territory_ids)];
      try {
        await ensureTerritoriesCanBeReserved(territoryIds);
      } catch (error) {
        return fail(error instanceof Error ? error.message : "No se pudieron validar los territorios.", 409);
      }

      const rows = territoryIds.flatMap((territoryId) => serviceDates.map((serviceDate) => {
        const serviceDay = getServiceDay(serviceDate);
        return {
          reservation_window_id: result.data.reservation_window_id,
          territory_id: territoryId,
          group_id: null,
          responsible_user_id: profile.id,
          service_date: serviceDate,
          service_day: serviceDay,
          departure_location: "Bloqueado por administracion",
          reserved_by_admin: true,
          admin_note: result.data.admin_note?.trim() || null,
          created_by: profile.id,
        };
      }));
      const { data: reservations, error } = await supabase
        .from("territory_reservations")
        .insert(rows)
        .select("id");
      if (error || !reservations?.length) {
        return fail(error?.code === "23505" ? "Uno de esos territorios ya esta reservado o bloqueado dentro de esta ventana." : error?.message ?? "No se pudo bloquear.", error?.code === "23505" ? 409 : 400);
      }
      return ok();
    }

    if (action === "createWindow" || action === "updateWindow") {
      const result = windowSchema.safeParse(payload);
      if (!result.success) return fail(result.error.issues[0]?.message ?? "Datos de ventana invalidos.", 422);
      if (result.data.saturday_date && new Date(`${result.data.saturday_date}T00:00:00Z`).getUTCDay() !== 6) {
        return fail("La fecha de sabado debe caer en sabado.", 422);
      }
      if (result.data.sunday_date && new Date(`${result.data.sunday_date}T00:00:00Z`).getUTCDay() !== 0) {
        return fail("La fecha de domingo debe caer en domingo.", 422);
      }
      const row = {
        name: result.data.name,
        saturday_date: result.data.saturday_date || null,
        sunday_date: result.data.sunday_date || null,
        booking_deadline: result.data.booking_deadline,
        active: result.data.active ?? true,
        updated_at: new Date().toISOString(),
      };
      const query = action === "createWindow"
        ? supabase.from("reservation_windows").insert({ ...row, created_by: profile.id })
        : supabase.from("reservation_windows").update(row).eq("id", String(payload?.id));
      const { error } = await query;
      if (error) return fail(error.message);
      return ok();
    }

    if (action === "deleteWindow") {
      const { error } = await supabase.from("reservation_windows").delete().eq("id", String(payload?.id));
      if (error) return fail(error.message);
      return ok();
    }

    if (action === "markNotificationRead") {
      const query = supabase.from("admin_notifications").update({ read_at: new Date().toISOString() });
      if (payload?.id) query.eq("id", String(payload.id)); else query.is("read_at", null);
      const { error } = await query;
      if (error) return fail(error.message);
      return ok();
    }

    if (action === "updateReservationStatus") {
      const status = String(payload?.status);
      if (!reservationStatuses.includes(status as never)) return fail("Estado invalido.", 422);
      const patch = status === "COMPLETED"
        ? { status, completed_at: new Date().toISOString(), cancelled_at: null }
        : status === "CANCELLED"
          ? { status, cancelled_at: new Date().toISOString(), completed_at: null }
          : { status, completed_at: null, cancelled_at: null };
      const { error } = await supabase.from("territory_reservations").update(patch).eq("id", String(payload?.id));
      if (error) return fail(error.code === "23505" ? "No se puede reabrir porque el territorio ya tiene otra reserva activa para esa fecha." : error.message, error.code === "23505" ? 409 : 400);
      return ok();
    }

    if (action === "upsertBlockStatus") {
      const status = String(payload?.status);
      if (!blockStatuses.includes(status as never)) return fail("Estado invalido.", 422);
      const { error } = await supabase.from("block_round_statuses").upsert({
        annual_round_id: String(payload?.annual_round_id),
        block_id: String(payload?.block_id),
        status,
        updated_by: profile.id,
        updated_at: new Date().toISOString(),
      }, { onConflict: "annual_round_id,block_id" });
      if (error) return fail(error.message);
      return ok();
    }

    if (action === "deleteBlockStatus") {
      const { error } = await supabase.from("block_round_statuses").delete().eq("id", String(payload?.id));
      if (error) return fail(error.message);
      return ok();
    }

    if (action === "setTerritoryBlockProgress") {
      const annualRoundId = String(payload?.annual_round_id ?? "");
      const territoryId = String(payload?.territory_id ?? "");
      const completedBlockIds = new Set(
        Array.isArray(payload?.completed_block_ids)
          ? payload.completed_block_ids.map((id) => String(id))
          : [],
      );
      const newLabels = Array.isArray(payload?.new_block_labels)
        ? payload.new_block_labels.map((label) => String(label).trim()).filter(Boolean)
        : [];
      const completedNewLabels = new Set(
        Array.isArray(payload?.completed_new_block_labels)
          ? payload.completed_new_block_labels.map((label) => String(label).trim().toUpperCase()).filter(Boolean)
          : [],
      );
      const completedOn = typeof payload?.completed_on === "string" ? payload.completed_on : null;

      if (!annualRoundId || !territoryId) return fail("Falta seleccionar territorio y vuelta.", 422);

      if (newLabels.length) {
        const uniqueLabels = [...new Set(newLabels.map((label) => label.toUpperCase()))];
        const { error: insertError } = await supabase.from("blocks").upsert(
          uniqueLabels.map((label) => ({ territory_id: territoryId, label })),
          { onConflict: "territory_id,label" },
        );
        if (insertError) return fail(insertError.message);
      }

      const { data: territoryBlocks, error: blocksError } = await supabase
        .from("blocks")
        .select("id,label")
        .eq("territory_id", territoryId)
        .eq("active", true);
      if (blocksError) return fail(blocksError.message);

      const allCompleted = (territoryBlocks ?? []).length > 0 && (territoryBlocks ?? []).every(
        (block) => completedBlockIds.has(block.id) || completedNewLabels.has(String(block.label).toUpperCase()),
      );
      if (allCompleted && (!completedOn || !/^\d{4}-\d{2}-\d{2}$/.test(completedOn))) {
        return fail("Indica una fecha válida de finalización.", 422);
      }

      const rows = (territoryBlocks ?? []).map((block) => ({
        annual_round_id: annualRoundId,
        block_id: block.id,
        status: completedBlockIds.has(block.id) || completedNewLabels.has(String(block.label).toUpperCase()) ? "COMPLETED" : "PENDING",
        completed_on: allCompleted ? completedOn : null,
        updated_by: profile.id,
        updated_at: new Date().toISOString(),
      }));

      if (rows.length) {
        const { error } = await supabase
          .from("block_round_statuses")
          .upsert(rows, { onConflict: "annual_round_id,block_id" });
        if (error) return fail(error.message);
      }

      return ok();
    }

    if (action === "createTerritory" || action === "updateTerritory") {
      const number = Number(payload?.number);
      const row = { number, name: `Territorio ${number}`, notes: null };
      const query = action === "createTerritory"
        ? supabase.from("territories").insert(row)
        : supabase.from("territories").update(row).eq("id", String(payload?.id));
      const { error } = await query;
      if (error) return fail(error.message);
      return ok();
    }

    if (action === "createGroup" || action === "updateGroup") {
      const row = { name: String(payload?.name ?? "").trim() };
      const query = action === "createGroup"
        ? supabase.from("groups").insert(row)
        : supabase.from("groups").update(row).eq("id", String(payload?.id));
      const { error } = await query;
      if (error) return fail(error.message);
      return ok();
    }

    if (action === "createDeparturePoint" || action === "updateDeparturePoint") {
      const row = {
        name: String(payload?.name ?? "").trim(),
        address: String(payload?.address ?? "").trim(),
        territory_id: payload?.territory_id ? String(payload.territory_id) : null,
        updated_at: new Date().toISOString(),
      };
      if (!row.name || !row.address) return fail("Completa el nombre y la direccion.", 422);
      const query = action === "createDeparturePoint"
        ? supabase.from("departure_points").insert(row)
        : supabase.from("departure_points").update(row).eq("id", String(payload?.id));
      const { error } = await query;
      if (error) return fail(error.message);
      return ok();
    }

    if (action === "upsertWeekendRoster") {
      const serviceDate = String(payload?.service_date ?? "");
      if (!/^\d{4}-\d{2}-\d{2}$/.test(serviceDate)) return fail("Fecha invalida.", 422);
      const day = new Date(`${serviceDate}T00:00:00Z`).getUTCDay();
      if (day !== 6 && day !== 0) return fail("La fecha debe ser sabado o domingo.", 422);

      const conductorId = payload?.conductor_id ? String(payload.conductor_id) : null;
      if (!conductorId) {
        const { error } = await supabase.from("weekend_roster").delete().eq("service_date", serviceDate);
        if (error) return fail(error.message);
        return ok();
      }

      const { error } = await supabase.from("weekend_roster").upsert(
        { service_date: serviceDate, conductor_id: conductorId, updated_at: new Date().toISOString() },
        { onConflict: "service_date" },
      );
      if (error) return fail(error.message);
      return ok();
    }

    if (action === "createBlock" || action === "updateBlock") {
      const row = { territory_id: String(payload?.territory_id), label: String(payload?.label ?? "").trim() };
      const query = action === "createBlock"
        ? supabase.from("blocks").insert(row)
        : supabase.from("blocks").update(row).eq("id", String(payload?.id));
      const { error } = await query;
      if (error) return fail(error.message);
      return ok();
    }

    if (action === "createRound") {
      const { data: round, error: roundError } = await supabase.from("annual_rounds").insert({
        year: Number(payload?.year),
        name: String(payload?.name ?? "").trim() || `Vuelta ${Number(payload?.year)}`,
        created_by: profile.id,
      }).select().single();
      if (roundError || !round) return fail(roundError?.message ?? "No se pudo crear la vuelta.");
      const { data: blocks } = await supabase.from("blocks").select("id").eq("active", true);
      const rows = (blocks ?? []).map((block) => ({
        annual_round_id: round.id,
        block_id: block.id,
        status: "PENDING",
        updated_by: profile.id,
      }));
      if (rows.length) {
        const { error } = await supabase.from("block_round_statuses").insert(rows);
        if (error) return fail(error.message);
      }
      return ok();
    }

    if (action === "updateRound") {
      const closed = payload?.status === "CLOSED";
      const { error } = await supabase.from("annual_rounds").update({
        year: Number(payload?.year),
        name: String(payload?.name ?? "").trim(),
        status: closed ? "CLOSED" : "OPEN",
        closed_at: closed ? new Date().toISOString() : null,
      }).eq("id", String(payload?.id));
      if (error) return fail(error.message);
      return ok();
    }

    if (action === "deleteRow") {
      const table = String(payload?.table);
      if (!["territories", "groups", "blocks", "annual_rounds", "departure_points"].includes(table)) return fail("Tabla invalida.", 422);
      const { error } = await supabase.from(table).delete().eq("id", String(payload?.id));
      if (error) return fail(error.message);
      return ok();
    }

    if (action === "createUser") {
      const passwordMode = String(payload?.passwordMode);
      const temporaryPassword = passwordMode === "generate" ? generateTemporaryPassword() : String(payload?.password ?? "");
      if (temporaryPassword.length < 8) return fail("La contrasena debe tener al menos 8 caracteres.", 422);
      const requestedRoles = Array.isArray(payload?.roles) ? payload.roles.map((role) => String(role)) : [];
      const validRoles = requestedRoles.filter((role) => roles.includes(role as never));
      if (!validRoles.length) return fail("Selecciona al menos un rol.", 422);

      const { data: created, error } = await supabase.from("profiles").insert({
        username: String(payload?.username ?? "").trim(),
        full_name: String(payload?.full_name ?? "").trim(),
        group_id: payload?.group_id ? String(payload.group_id) : null,
        role: validRoles.includes("ADMIN") ? "ADMIN" : "ANCIANO",
        active: true,
        password_hash: hashPassword(temporaryPassword),
        must_change_password: true,
        password_updated_at: new Date().toISOString(),
      }).select("id").single();
      if (error || !created) return fail(error?.message ?? "No se pudo crear el usuario.");

      const { error: rolesError } = await supabase.from("profile_roles").insert(
        validRoles.map((role) => ({ profile_id: created.id, role })),
      );
      if (rolesError) return fail(rolesError.message);

      return ok({ temporaryPassword: passwordMode === "generate" ? temporaryPassword : null });
    }

    if (action === "updateUser") {
      const patch: Record<string, unknown> = {};
      if (payload?.full_name !== undefined) patch.full_name = String(payload.full_name);
      if (payload?.group_id !== undefined) patch.group_id = payload.group_id ? String(payload.group_id) : null;
      if (payload?.active !== undefined) patch.active = Boolean(payload.active);
      const password = String(payload?.password ?? "");
      if (password) {
        if (password.length < 8) return fail("La contrasena debe tener al menos 8 caracteres.", 422);
        patch.password_hash = hashPassword(password);
        patch.must_change_password = Boolean(payload?.must_change_password ?? true);
        patch.password_updated_at = new Date().toISOString();
      }

      if (payload?.roles !== undefined) {
        const requestedRoles = Array.isArray(payload.roles) ? payload.roles.map((role) => String(role)) : [];
        const validRoles = requestedRoles.filter((role) => roles.includes(role as never));
        if (!validRoles.length) return fail("Selecciona al menos un rol.", 422);
        patch.role = validRoles.includes("ADMIN") ? "ADMIN" : "ANCIANO";

        const { error: deleteError } = await supabase.from("profile_roles").delete().eq("profile_id", String(payload?.id));
        if (deleteError) return fail(deleteError.message);
        const { error: insertError } = await supabase.from("profile_roles").insert(
          validRoles.map((role) => ({ profile_id: String(payload?.id), role })),
        );
        if (insertError) return fail(insertError.message);
      }

      if (Object.keys(patch).length) {
        const { error } = await supabase.from("profiles").update(patch).eq("id", String(payload?.id));
        if (error) return fail(error.message);
      }
      return ok();
    }

    if (action === "deleteUser") {
      const id = String(payload?.id);
      const { data: user, error: readError } = await supabase.from("profile_roles").select("role").eq("profile_id", id);
      if (readError) return fail(readError.message);
      if ((user ?? []).some((entry) => entry.role === "ADMIN")) return fail("No se puede eliminar un usuario admin.", 403);
      const { error } = await supabase.from("profiles").delete().eq("id", id);
      if (error) return fail(error.message);
      return ok();
    }

    if (action === "createWeeklyOuting") {
      const startsOn = String(payload?.starts_on ?? "");
      if (!/^\d{4}-\d{2}-\d{2}$/.test(startsOn) || new Date(`${startsOn}T00:00:00Z`).getUTCDay() !== 4) {
        return fail("La fecha de inicio debe ser un jueves.", 422);
      }
      const { data: outing, error } = await supabase
        .from("weekly_outings")
        .insert({ starts_on: startsOn, created_by: profile.id })
        .select("id")
        .single();
      if (error || !outing) return fail(error?.message ?? "No se pudo crear la semana.");
      return ok({ id: outing.id });
    }

    if (action === "deleteWeeklyOuting") {
      const { error } = await supabase.from("weekly_outings").delete().eq("id", String(payload?.id));
      if (error) return fail(error.message);
      return ok();
    }

    if (action === "createWeeklyOutingSlot") {
      const { data: siblings } = await supabase
        .from("weekly_outing_slots")
        .select("sort_order")
        .eq("weekly_outing_id", String(payload?.weekly_outing_id))
        .eq("slot_date", String(payload?.slot_date))
        .order("sort_order", { ascending: false })
        .limit(1);
      const nextOrder = (siblings?.[0]?.sort_order ?? -1) + 1;
      const { error } = await supabase.from("weekly_outing_slots").insert({
        weekly_outing_id: String(payload?.weekly_outing_id),
        slot_date: String(payload?.slot_date),
        sort_order: nextOrder,
      });
      if (error) return fail(error.message);
      return ok();
    }

    if (action === "updateWeeklyOutingSlot") {
      const patch: Record<string, unknown> = { updated_at: new Date().toISOString() };
      if (payload?.hora !== undefined) patch.hora = payload.hora ? String(payload.hora) : null;
      if (payload?.lugar !== undefined) patch.lugar = payload.lugar ? String(payload.lugar) : null;
      if (payload?.conductor_id !== undefined) patch.conductor_id = payload.conductor_id ? String(payload.conductor_id) : null;
      if (payload?.highlighted !== undefined) patch.highlighted = Boolean(payload.highlighted);
      if (payload?.note !== undefined) patch.note = payload.note ? String(payload.note) : null;
      const { error } = await supabase.from("weekly_outing_slots").update(patch).eq("id", String(payload?.id));
      if (error) return fail(error.message);
      return ok();
    }

    if (action === "deleteWeeklyOutingSlot") {
      const { error } = await supabase.from("weekly_outing_slots").delete().eq("id", String(payload?.id));
      if (error) return fail(error.message);
      return ok();
    }

    if (action === "setSlotTerritories") {
      const slotId = String(payload?.slot_id ?? "");
      const entries = Array.isArray(payload?.territories) ? payload.territories : [];
      if (!slotId) return fail("Falta la fila.", 422);

      const { error: deleteError } = await supabase.from("weekly_outing_slot_territories").delete().eq("slot_id", slotId);
      if (deleteError) return fail(deleteError.message);

      const rows = entries.map((entry, index) => {
        const item = entry as Record<string, unknown>;
        return {
          slot_id: slotId,
          territory_id: String(item.territory_id),
          territory_round_id: item.territory_round_id ? String(item.territory_round_id) : null,
          display_override: item.display_override ? String(item.display_override) : null,
          sort_order: index,
        };
      });
      if (rows.length) {
        const { error } = await supabase.from("weekly_outing_slot_territories").insert(rows);
        if (error) return fail(error.message);
      }
      return ok();
    }

    if (action === "autoFillWeeklyOuting") {
      const weeklyOutingId = String(payload?.weekly_outing_id ?? "");
      const { data: outing, error: outingError } = await supabase
        .from("weekly_outings")
        .select("starts_on")
        .eq("id", weeklyOutingId)
        .single();
      if (outingError || !outing) return fail("Semana no encontrada.", 404);

      const [territoriesResult, territoryRoundsResult, completedStatusesResult, existingSlotsResult] = await Promise.all([
        supabase.from("territories").select("id").eq("active", true),
        supabase.from("territory_rounds").select("id,territory_id,assigned_on,completed_on"),
        supabase.from("block_round_statuses").select("completed_on,blocks(territory_id)").eq("status", "COMPLETED"),
        supabase.from("weekly_outing_slots").select("id,slot_date").eq("weekly_outing_id", weeklyOutingId),
      ]);
      const firstError = [territoriesResult.error, territoryRoundsResult.error, completedStatusesResult.error, existingSlotsResult.error].find(Boolean);
      if (firstError) return fail(firstError.message);

      const lastCompletedByTerritory = new Map<string, string>();
      for (const status of completedStatusesResult.data ?? []) {
        const blockRef = Array.isArray(status.blocks) ? status.blocks[0] : status.blocks;
        const territoryId = blockRef?.territory_id;
        if (!territoryId || !status.completed_on) continue;
        const current = lastCompletedByTerritory.get(territoryId);
        if (!current || status.completed_on > current) lastCompletedByTerritory.set(territoryId, status.completed_on);
      }

      const openRoundByTerritory = new Map<string, { id: string; assigned_on: string }>();
      for (const round of territoryRoundsResult.data ?? []) {
        if (round.completed_on) continue;
        openRoundByTerritory.set(round.territory_id, { id: round.id, assigned_on: round.assigned_on });
      }

      const priorityTerritoryIds = (territoriesResult.data ?? [])
        .map((territory) => ({
          id: territory.id,
          open: openRoundByTerritory.get(territory.id) ?? null,
          lastCompleted: lastCompletedByTerritory.get(territory.id) ?? null,
        }))
        .sort((a, b) => {
          if (Boolean(a.open) !== Boolean(b.open)) return a.open ? -1 : 1;
          if (a.open && b.open) return a.open.assigned_on.localeCompare(b.open.assigned_on);
          return (a.lastCompleted ?? "").localeCompare(b.lastCompleted ?? "");
        })
        .map((entry) => entry.id);

      const existingSlots = existingSlotsResult.data ?? [];
      const existingSlotIds = existingSlots.map((slot) => slot.id);
      const { data: existingSlotTerritories, error: slotTerritoriesError } = existingSlotIds.length
        ? await supabase.from("weekly_outing_slot_territories").select("slot_id").in("slot_id", existingSlotIds)
        : { data: [], error: null };
      if (slotTerritoriesError) return fail(slotTerritoriesError.message);
      const slotsWithTerritory = new Set((existingSlotTerritories ?? []).map((entry) => entry.slot_id));

      const startsOn = outing.starts_on;
      const days = Array.from({ length: 7 }, (_, index) => {
        const date = new Date(`${startsOn}T00:00:00Z`);
        date.setUTCDate(date.getUTCDate() + index);
        return date.toISOString().slice(0, 10);
      });

      const targetSlotIds: string[] = [];
      for (const day of days) {
        const daySlots = existingSlots.filter((slot) => slot.slot_date === day);
        const emptySlot = daySlots.find((slot) => !slotsWithTerritory.has(slot.id));
        if (emptySlot) {
          targetSlotIds.push(emptySlot.id);
          continue;
        }
        if (daySlots.length === 0) {
          const { data: created, error } = await supabase
            .from("weekly_outing_slots")
            .insert({ weekly_outing_id: weeklyOutingId, slot_date: day, sort_order: 0 })
            .select("id")
            .single();
          if (error) return fail(error.message);
          if (created) targetSlotIds.push(created.id);
        }
      }

      const usedTerritoryIds = new Set<string>();
      let pointer = 0;
      for (const slotId of targetSlotIds) {
        while (pointer < priorityTerritoryIds.length && usedTerritoryIds.has(priorityTerritoryIds[pointer])) pointer += 1;
        if (pointer >= priorityTerritoryIds.length) break;
        const territoryId = priorityTerritoryIds[pointer];
        usedTerritoryIds.add(territoryId);
        pointer += 1;

        const { error } = await supabase.from("weekly_outing_slot_territories").insert({
          slot_id: slotId,
          territory_id: territoryId,
          territory_round_id: openRoundByTerritory.get(territoryId)?.id ?? null,
          sort_order: 0,
        });
        if (error) return fail(error.message);
      }

      return ok();
    }

    return fail("Accion no soportada.", 422);
  } catch (error) {
    return fail(error instanceof Error ? error.message : "Error inesperado.", 401);
  }
}
