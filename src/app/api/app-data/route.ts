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
import { blockStatuses, reservationStatuses } from "@/lib/domain";

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
  service_date: z.string().date(),
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

async function requireProfile() {
  const profile = await getCurrentProfile();
  if (!profile) throw new Error("No autenticado.");
  return profile;
}

function isPastDeadline(deadline: string) {
  return new Date(deadline).getTime() < Date.now();
}

function migrationMessage(message: string) {
  const fields = ["reservation_windows", "reservation_window_id", "departure_location", "admin_notifications", "group_id", "reserved_by_admin", "admin_note"];
  return fields.some((field) => message.includes(field))
    ? `${message} Ejecuta supabase/custom-auth-migration.sql en Supabase y vuelve a intentar.`
    : message;
}

function getServiceDay(serviceDate: string) {
  const date = new Date(`${serviceDate}T00:00:00Z`);
  const serviceDay = date.getUTCDay() === 6 ? "SATURDAY" : date.getUTCDay() === 0 ? "SUNDAY" : null;
  return serviceDay;
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

  if (profile.role !== "ADMIN") {
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
    const isAdmin = profile.role === "ADMIN";

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
        ? supabase.from("profiles").select("id, username, full_name, role, active, must_change_password, password_updated_at, group_id, groups(name)").order("full_name")
        : Promise.resolve({ data: [], error: null }),
      isAdmin
        ? supabase
            .from("admin_notifications")
            .select("*, profiles!actor_id(full_name,username), territory_reservations(service_date,reservation_windows(name))")
            .order("created_at", { ascending: false })
            .limit(30)
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
      };
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
      blocks: isAdmin ? blocks : [],
      rounds: isAdmin ? rounds : [],
      blockStatuses: isAdmin ? statuses : [],
      profiles: profilesResult.data ?? [],
      notifications: notificationsResult.data ?? [],
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
      if (profile.role !== "ANCIANO") return fail("Las respuestas de ventana corresponden a los ancianos.", 403);
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
      if (profile.role !== "ADMIN") query.eq("responsible_user_id", profile.id);
      const { error } = await query;
      if (error) return fail(error.message);
      return ok();
    }

    assertAdmin(profile);

    if (action === "createAdminReservations") {
      const result = createAdminReservationSchema.safeParse(payload);
      if (!result.success) return fail("Selecciona la ventana, fecha y al menos un territorio.", 422);

      const { data: windowData, error: windowError } = await supabase
        .from("reservation_windows")
        .select("*")
        .eq("id", result.data.reservation_window_id)
        .single();
      if (windowError || !windowData || !windowData.active) return fail("La ventana no esta disponible.", 404);
      if (![windowData.saturday_date, windowData.sunday_date].includes(result.data.service_date)) {
        return fail("La fecha no pertenece a esta ventana.", 422);
      }

      const serviceDay = getServiceDay(result.data.service_date);
      if (!serviceDay) return fail("La fecha debe ser sabado o domingo.", 422);

      const territoryIds = [...new Set(result.data.territory_ids)];
      try {
        await ensureTerritoriesCanBeReserved(territoryIds);
      } catch (error) {
        return fail(error instanceof Error ? error.message : "No se pudieron validar los territorios.", 409);
      }

      const rows = territoryIds.map((territoryId) => ({
        reservation_window_id: result.data.reservation_window_id,
        territory_id: territoryId,
        group_id: null,
        responsible_user_id: profile.id,
        service_date: result.data.service_date,
        service_day: serviceDay,
        departure_location: "Reservado por administracion",
        reserved_by_admin: true,
        admin_note: result.data.admin_note?.trim() || null,
        created_by: profile.id,
      }));
      const { data: reservations, error } = await supabase
        .from("territory_reservations")
        .insert(rows)
        .select("id");
      if (error || !reservations?.length) {
        return fail(error?.code === "23505" ? "Uno de esos territorios ya esta reservado para esa fecha." : error?.message ?? "No se pudo reservar.", error?.code === "23505" ? 409 : 400);
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

      const rows = (territoryBlocks ?? []).map((block) => ({
        annual_round_id: annualRoundId,
        block_id: block.id,
        status: completedBlockIds.has(block.id) || completedNewLabels.has(String(block.label).toUpperCase()) ? "COMPLETED" : "PENDING",
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
      if (!["territories", "groups", "blocks", "annual_rounds"].includes(table)) return fail("Tabla invalida.", 422);
      const { error } = await supabase.from(table).delete().eq("id", String(payload?.id));
      if (error) return fail(error.message);
      return ok();
    }

    if (action === "createUser") {
      const passwordMode = String(payload?.passwordMode);
      const temporaryPassword = passwordMode === "generate" ? generateTemporaryPassword() : String(payload?.password ?? "");
      if (temporaryPassword.length < 8) return fail("La contrasena debe tener al menos 8 caracteres.", 422);
      const { error } = await supabase.from("profiles").insert({
        username: String(payload?.username ?? "").trim(),
        full_name: String(payload?.full_name ?? "").trim(),
        group_id: payload?.group_id ? String(payload.group_id) : null,
        role: payload?.role === "ADMIN" ? "ADMIN" : "ANCIANO",
        active: true,
        password_hash: hashPassword(temporaryPassword),
        must_change_password: true,
        password_updated_at: new Date().toISOString(),
      });
      if (error) return fail(error.message);
      return ok({ temporaryPassword: passwordMode === "generate" ? temporaryPassword : null });
    }

    if (action === "updateUser") {
      const patch: Record<string, unknown> = {};
      if (payload?.full_name !== undefined) patch.full_name = String(payload.full_name);
      if (payload?.group_id !== undefined) patch.group_id = payload.group_id ? String(payload.group_id) : null;
      if (payload?.role !== undefined) patch.role = payload.role === "ADMIN" ? "ADMIN" : "ANCIANO";
      if (payload?.active !== undefined) patch.active = Boolean(payload.active);
      const password = String(payload?.password ?? "");
      if (password) {
        if (password.length < 8) return fail("La contrasena debe tener al menos 8 caracteres.", 422);
        patch.password_hash = hashPassword(password);
        patch.must_change_password = Boolean(payload?.must_change_password ?? true);
        patch.password_updated_at = new Date().toISOString();
      }
      const { error } = await supabase.from("profiles").update(patch).eq("id", String(payload?.id));
      if (error) return fail(error.message);
      return ok();
    }

    if (action === "deleteUser") {
      const id = String(payload?.id);
      const { data: user, error: readError } = await supabase.from("profiles").select("role").eq("id", id).single();
      if (readError || !user) return fail("Usuario no encontrado.", 404);
      if (user.role === "ADMIN") return fail("No se puede eliminar un usuario admin.", 403);
      const { error } = await supabase.from("profiles").delete().eq("id", id);
      if (error) return fail(error.message);
      return ok();
    }

    return fail("Accion no soportada.", 422);
  } catch (error) {
    return fail(error instanceof Error ? error.message : "Error inesperado.", 401);
  }
}
