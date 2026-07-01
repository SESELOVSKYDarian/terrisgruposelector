"use client";

/* eslint-disable react-hooks/set-state-in-effect */

import { FormEvent, useCallback, useEffect, useMemo, useState } from "react";
import {
  Bell,
  CalendarClock,
  CalendarDays,
  Check,
  CheckCircle2,
  Copy,
  Edit3,
  Grid3X3,
  KeyRound,
  LogOut,
  Map,
  MapPin,
  Plus,
  RefreshCw,
  ShieldCheck,
  Trash2,
  Users,
  Wand2,
  X,
} from "lucide-react";
import {
  reservationStatusLabels,
  serviceDayLabels,
  type BlockStatus,
  type ReservationStatus,
  type Role,
  type ServiceDay,
} from "@/lib/domain";
import { cn } from "@/lib/utils";

type Group = { id: string; name: string; active: boolean };
type Profile = {
  id: string;
  username: string;
  full_name: string;
  group_id: string | null;
  groups?: Pick<Group, "name"> | null;
  role: Role;
  active: boolean;
  must_change_password: boolean;
};
type Territory = { id: string; number: number; name: string; active: boolean };
type Block = { id: string; territory_id: string; label: string; active: boolean };
type Round = { id: string; year: number; name: string; status: "OPEN" | "CLOSED" };
type ReservationWindow = {
  id: string;
  name: string;
  saturday_date: string | null;
  sunday_date: string | null;
  booking_deadline: string;
  active: boolean;
};
type Reservation = {
  id: string;
  reservation_window_id: string;
  territory_id: string;
  group_id: string;
  responsible_user_id: string;
  service_date: string;
  service_day: ServiceDay;
  departure_location: string;
  status: ReservationStatus;
  territories?: Pick<Territory, "number" | "name"> | null;
  groups?: Pick<Group, "name"> | null;
  profiles?: Pick<Profile, "full_name" | "username"> | null;
  reservation_windows?: Pick<ReservationWindow, "name" | "booking_deadline"> | null;
};
type BlockRoundStatus = { id: string; annual_round_id: string; block_id: string; status: BlockStatus };
type TerritoryProgress = {
  territory_id: string;
  total_blocks: number;
  completed_blocks: number;
  pending_labels: string[];
};
type Notification = {
  id: string;
  message: string;
  read_at: string | null;
  created_at: string;
  profiles?: Pick<Profile, "full_name" | "username"> | null;
};
type AppData = {
  profile: Profile;
  groups: Group[];
  territories: Territory[];
  reservationWindows: ReservationWindow[];
  reservations: Reservation[];
  unavailableReservations: { territory_id: string; service_date: string }[];
  territoryProgress: TerritoryProgress[];
  activeRound: Pick<Round, "id" | "year" | "name"> | null;
  blocks: Block[];
  rounds: Round[];
  blockStatuses: BlockRoundStatus[];
  profiles: Profile[];
  notifications: Notification[];
};
type ModalState =
  | { type: "territory"; item?: Territory }
  | { type: "territoryBlocks"; territory: Territory }
  | { type: "group"; item?: Group }
  | { type: "block"; item?: Block }
  | { type: "round"; item?: Round }
  | { type: "window"; item?: ReservationWindow }
  | { type: "reservation"; window: ReservationWindow; date: string; item?: Reservation }
  | { type: "user"; item?: Profile }
  | { type: "password"; item: Profile }
  | null;

const emptyProfile: Profile = {
  id: "",
  username: "",
  full_name: "",
  group_id: null,
  role: "ANCIANO",
  active: false,
  must_change_password: false,
};
const emptyData: AppData = {
  profile: emptyProfile,
  groups: [],
  territories: [],
  reservationWindows: [],
  reservations: [],
  unavailableReservations: [],
  territoryProgress: [],
  activeRound: null,
  blocks: [],
  rounds: [],
  blockStatuses: [],
  profiles: [],
  notifications: [],
};

const reservationStyles: Record<ReservationStatus, string> = {
  ACTIVE: "border-blue-200 bg-blue-50 text-blue-700",
  COMPLETED: "border-emerald-200 bg-emerald-50 text-emerald-700",
  CANCELLED: "border-slate-200 bg-slate-50 text-slate-700",
  EXPIRED: "border-rose-200 bg-rose-50 text-rose-700",
};

async function requestJson(path: string, init?: RequestInit) {
  const response = await fetch(path, {
    ...init,
    headers: { "Content-Type": "application/json", ...(init?.headers ?? {}) },
  });
  const body = await response.json().catch(() => ({}));
  if (!response.ok) throw new Error(body.error ?? "Error inesperado.");
  return body;
}

function displayDate(date: string) {
  const [year, month, day] = date.slice(0, 10).split("-");
  return `${day}/${month}/${year}`;
}

function displayDateTime(value: string) {
  const date = new Date(value);
  return `${displayDate(date.toISOString())} ${String(date.getHours()).padStart(2, "0")}:${String(date.getMinutes()).padStart(2, "0")}`;
}

function localDateTimeValue(value?: string) {
  if (!value) return "";
  const date = new Date(value);
  const offset = date.getTimezoneOffset() * 60_000;
  return new Date(date.getTime() - offset).toISOString().slice(0, 16);
}

function territorySelectionLabel(territory: Territory, progress?: TerritoryProgress) {
  const base = `Territorio #${territory.number}`;
  if (!progress || progress.completed_blocks === 0) return base;
  if (progress.total_blocks > 0 && progress.completed_blocks === progress.total_blocks) {
    return `${base} - Completado`;
  }
  return `${base} - Faltan ${progress.pending_labels.join(", ")}`;
}

export default function Home() {
  const [profile, setProfile] = useState<Profile | null>(null);
  const [data, setData] = useState<AppData>(emptyData);
  const [activeView, setActiveView] = useState("windows");
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [toast, setToast] = useState<{ type: "success" | "error"; text: string } | null>(null);
  const [modal, setModal] = useState<ModalState>(null);
  const [temporaryPassword, setTemporaryPassword] = useState("");
  const [passwordMode, setPasswordMode] = useState<"manual" | "generate">("generate");
  const [loadedAt, setLoadedAt] = useState(0);

  const isAdmin = profile?.role === "ADMIN";
  const openRound = data.rounds.find((round) => round.status === "OPEN");
  const activeReservations = useMemo(
    () => data.reservations.filter((reservation) => reservation.status === "ACTIVE"),
    [data.reservations],
  );
  const unreadCount = data.notifications.filter((notification) => !notification.read_at).length;

  const loadData = useCallback(async (options?: { throwOnError?: boolean }) => {
    setLoading(true);
    try {
      const body = (await requestJson("/api/app-data")) as AppData;
      setData(body);
      setProfile(body.profile);
      setLoadedAt(Date.now());
    } catch (error) {
      setProfile(null);
      if (options?.throwOnError) throw error;
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    void loadData();
  }, [loadData]);

  useEffect(() => {
    if (!toast) return;
    const timeout = window.setTimeout(() => setToast(null), 3600);
    return () => window.clearTimeout(timeout);
  }, [toast]);

  async function login(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setSaving(true);
    const form = new FormData(event.currentTarget);
    try {
      await requestJson("/api/auth/login", {
        method: "POST",
        body: JSON.stringify({
          username: String(form.get("username") ?? ""),
          password: String(form.get("password") ?? ""),
        }),
      });
      await loadData({ throwOnError: true });
      setActiveView("windows");
      setToast({ type: "success", text: "Sesion iniciada." });
    } catch (error) {
      setToast({ type: "error", text: error instanceof Error ? error.message : "No se pudo ingresar." });
    } finally {
      setSaving(false);
    }
  }

  async function logout() {
    await requestJson("/api/auth/logout", { method: "POST", body: "{}" });
    setProfile(null);
    setData(emptyData);
  }

  async function mutate(action: string, payload?: Record<string, unknown>, form?: HTMLFormElement) {
    setSaving(true);
    try {
      const result = await requestJson("/api/app-data", {
        method: "POST",
        body: JSON.stringify({ action, payload }),
      });
      if (result.temporaryPassword) setTemporaryPassword(result.temporaryPassword);
      form?.reset();
      setModal(null);
      setToast({ type: "success", text: "Cambios guardados." });
      await loadData();
      return result;
    } catch (error) {
      setToast({ type: "error", text: error instanceof Error ? error.message : "No se pudo guardar." });
      return null;
    } finally {
      setSaving(false);
    }
  }

  function submitFromForm(
    event: FormEvent<HTMLFormElement>,
    action: string,
    map: (form: FormData) => Record<string, unknown>,
  ) {
    event.preventDefault();
    const form = event.currentTarget;
    void mutate(action, map(new FormData(form)), form);
  }

  if (!profile) {
    return (
      <main className="grid min-h-screen place-items-center bg-slate-100 px-4 py-8 text-slate-950">
        <Toast toast={toast} onClose={() => setToast(null)} />
        <section className="w-full max-w-md rounded-lg border border-slate-200 bg-white p-5 shadow-sm">
          <span className="inline-flex h-11 w-11 items-center justify-center rounded-md bg-blue-50 text-blue-700">
            <ShieldCheck size={22} aria-hidden="true" />
          </span>
          <p className="mt-4 text-sm font-semibold uppercase tracking-[0.14em] text-blue-700">Terris Grupo Selector</p>
          <h1 className="mt-2 text-2xl font-semibold">Ingresar</h1>
          <p className="mt-2 text-sm leading-6 text-slate-600">Usa tu usuario interno y contrasena asignada.</p>
          <form className="mt-6 space-y-3" onSubmit={login}>
            <Field label="Usuario"><input className={inputClass} name="username" autoComplete="username" required /></Field>
            <Field label="Contrasena"><input className={inputClass} name="password" type="password" autoComplete="current-password" required /></Field>
            <button className={primaryButtonClass} disabled={saving || loading} type="submit">
              <KeyRound size={18} aria-hidden="true" />
              {saving || loading ? "Ingresando..." : "Ingresar"}
            </button>
          </form>
        </section>
      </main>
    );
  }

  return (
    <main className="min-h-screen bg-slate-100 text-slate-950">
      <Toast toast={toast} onClose={() => setToast(null)} />
      <div className="mx-auto flex w-full max-w-7xl flex-col gap-5 px-4 py-5 sm:px-6 lg:px-8">
        <header className="flex flex-col gap-4 border-b border-slate-200 pb-5 lg:flex-row lg:items-center lg:justify-between">
          <div>
            <p className="text-sm font-semibold uppercase tracking-[0.14em] text-blue-700">Terris Grupo Selector</p>
            <h1 className="mt-2 text-2xl font-semibold sm:text-3xl">
              {isAdmin ? "Gestion de territorios" : "Reservas de mi grupo"}
            </h1>
            <p className="mt-2 text-sm text-slate-600">
              {profile.full_name} - {isAdmin ? "Super admin" : data.groups[0]?.name ?? "Sin grupo asignado"}
            </p>
          </div>
          <div className="flex flex-wrap gap-2">
            <button className={secondaryButtonClass} onClick={() => void loadData()} type="button">
              <RefreshCw size={18} aria-hidden="true" />Actualizar
            </button>
            <button className={secondaryButtonClass} onClick={logout} type="button">
              <LogOut size={18} aria-hidden="true" />Salir
            </button>
          </div>
        </header>

        {isAdmin ? (
          <>
            <section className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
              <Metric icon={<Map size={20} />} label="Territorios" value={data.territories.length} />
              <Metric icon={<CalendarDays size={20} />} label="Reservas activas" value={activeReservations.length} />
              <Metric icon={<CalendarClock size={20} />} label="Ventanas activas" value={data.reservationWindows.filter((item) => item.active).length} />
              <Metric icon={<Bell size={20} />} label="Avisos nuevos" value={unreadCount} />
            </section>
            <AdminNav activeView={activeView} unreadCount={unreadCount} onChange={setActiveView} />
            <AdminView
              activeView={activeView}
              data={data}
              loadedAt={loadedAt}
              openRound={openRound}
              setModal={setModal}
              mutate={mutate}
            />
          </>
        ) : (
          <ElderReservations data={data} loadedAt={loadedAt} setModal={setModal} mutate={mutate} />
        )}
      </div>

      <ModalShell modal={modal} onClose={() => setModal(null)}>
        {modal ? renderModal({
          modal,
          data,
          saving,
          passwordMode,
          setPasswordMode,
          setTemporaryPassword,
          mutate,
          submitFromForm,
        }) : null}
      </ModalShell>
      <TemporaryPasswordModal password={temporaryPassword} onClose={() => setTemporaryPassword("")} />
    </main>
  );
}

function AdminNav({
  activeView,
  unreadCount,
  onChange,
}: {
  activeView: string;
  unreadCount: number;
  onChange: (view: string) => void;
}) {
  const tabs = [
    ["windows", "Ventanas"],
    ["reservations", "Reservas"],
    ["notifications", `Avisos${unreadCount ? ` (${unreadCount})` : ""}`],
    ["territories", "Territorios"],
    ["rounds", "Vueltas"],
    ["groups", "Grupos"],
    ["users", "Usuarios"],
  ];
  return (
    <nav className="flex gap-2 overflow-x-auto rounded-lg border border-slate-200 bg-white p-2" aria-label="Administracion">
      {tabs.map(([id, label]) => (
        <button key={id} className={tabClass(activeView === id)} onClick={() => onChange(id)} type="button">{label}</button>
      ))}
    </nav>
  );
}

function ElderReservations({
  data,
  loadedAt,
  setModal,
  mutate,
}: {
  data: AppData;
  loadedAt: number;
  setModal: (modal: ModalState) => void;
  mutate: (action: string, payload?: Record<string, unknown>) => Promise<unknown>;
}) {
  const windows = data.reservationWindows.filter((window) => window.active);
  if (!data.profile.group_id) {
    return <EmptyState icon={<Users size={24} />} title="Falta asignar tu grupo" text="El administrador debe asignarte un grupo antes de que puedas reservar." />;
  }
  if (!windows.length) {
    return <EmptyState icon={<CalendarClock size={24} />} title="No hay ventanas disponibles" text="Cuando el administrador publique fechas para reservar, apareceran aqui." />;
  }
  return (
    <section className="space-y-4" aria-label="Ventanas de reserva">
      {windows.map((window) => {
        const expired = new Date(window.booking_deadline).getTime() < loadedAt;
        const dates = [window.saturday_date, window.sunday_date].filter(Boolean) as string[];
        return (
          <article className="overflow-hidden rounded-lg border border-slate-200 bg-white" key={window.id}>
            <div className="flex flex-col gap-3 border-b border-slate-200 p-4 sm:flex-row sm:items-center sm:justify-between">
              <div>
                <div className="flex flex-wrap items-center gap-2">
                  <h2 className="text-lg font-semibold">{window.name}</h2>
                  <Badge className={expired ? "border-slate-200 bg-slate-100 text-slate-700" : "border-emerald-200 bg-emerald-50 text-emerald-700"}>
                    {expired ? "Cerrada" : "Disponible"}
                  </Badge>
                </div>
                <p className="mt-2 text-sm text-slate-600">Limite para responder: {displayDateTime(window.booking_deadline)}</p>
              </div>
            </div>
            <div className="grid divide-y divide-slate-200 md:grid-cols-2 md:divide-x md:divide-y-0">
              {dates.map((date) => {
                const dayReservations = data.reservations.filter(
                  (item) => item.reservation_window_id === window.id && item.service_date === date && item.status === "ACTIVE",
                );
                return (
                  <div className="min-w-0 p-4" key={date}>
                    <p className="text-sm font-semibold text-slate-950">
                      {date === window.saturday_date ? "Sabado" : "Domingo"} {displayDate(date)}
                    </p>
                    {dayReservations.length ? (
                      <div className="mt-3 space-y-2">
                        {dayReservations.map((reservation) => (
                          <div className="rounded-md border border-blue-200 bg-blue-50 p-3" key={reservation.id}>
                            <div className="flex items-start gap-3">
                              <CheckCircle2 className="mt-0.5 shrink-0 text-blue-700" size={20} />
                              <div className="min-w-0">
                                <p className="font-semibold text-blue-950">Territorio #{reservation.territories?.number}</p>
                                <p className="mt-1 break-words text-sm text-blue-900">Salida: {reservation.departure_location}</p>
                              </div>
                            </div>
                            {!expired ? (
                              <div className="mt-3 flex gap-2 border-t border-blue-200 pt-3">
                                <button className={miniButtonClass} onClick={() => setModal({ type: "reservation", window, date, item: reservation })} type="button">
                                  <Edit3 size={15} />Editar
                                </button>
                                <DeleteButton onClick={() => void mutate("deleteReservation", { id: reservation.id })} />
                              </div>
                            ) : null}
                          </div>
                        ))}
                      </div>
                    ) : (
                      <p className="mt-3 text-sm text-slate-500">
                        {expired ? "No se envio una reserva antes del cierre." : "Todavia no agregaste territorios para este dia."}
                      </p>
                    )}
                    {!expired ? (
                      <button className={dayReservations.length ? secondaryButtonClass + " mt-3" : primarySmallButtonClass + " mt-3"} onClick={() => setModal({ type: "reservation", window, date })} type="button">
                        <Plus size={16} />{dayReservations.length ? "Agregar territorios" : "Completar reserva"}
                      </button>
                    ) : null}
                  </div>
                );
              })}
            </div>
          </article>
        );
      })}
    </section>
  );
}

function AdminView({
  activeView,
  data,
  loadedAt,
  openRound,
  setModal,
  mutate,
}: {
  activeView: string;
  data: AppData;
  loadedAt: number;
  openRound?: Round;
  setModal: (modal: ModalState) => void;
  mutate: (action: string, payload?: Record<string, unknown>) => Promise<unknown>;
}) {
  if (activeView === "windows") {
    const elderGroupIds = new Set(data.profiles.filter((profile) => profile.role === "ANCIANO" && profile.active && profile.group_id).map((profile) => profile.group_id));
    return (
      <Panel title="Ventanas de reserva" description="Publica las fechas y define hasta cuando los ancianos pueden responder." action={<AddButton onClick={() => setModal({ type: "window" })}>Ventana</AddButton>}>
        <DataTable headers={["Ventana", "Fechas", "Limite", "Respuestas", "Estado", "Acciones"]}>
          {data.reservationWindows.map((window) => {
            const windowReservations = data.reservations.filter((item) => item.reservation_window_id === window.id && item.status === "ACTIVE");
            const expectedDates = [window.saturday_date, window.sunday_date].filter(Boolean).length;
            const expectedReservations = elderGroupIds.size * expectedDates;
            const expired = new Date(window.booking_deadline).getTime() < loadedAt;
            return (
              <tr key={window.id}>
                <Cell><strong>{window.name}</strong></Cell>
                <Cell>{[window.saturday_date, window.sunday_date].filter(Boolean).map((date) => displayDate(String(date))).join(" - ")}</Cell>
                <Cell>{displayDateTime(window.booking_deadline)}</Cell>
                <Cell><strong>{windowReservations.length}/{expectedReservations}</strong> reservas</Cell>
                <Cell><Badge className={!window.active || expired ? "border-slate-200 bg-slate-100 text-slate-700" : "border-emerald-200 bg-emerald-50 text-emerald-700"}>{!window.active ? "Inactiva" : expired ? "Cerrada" : "Abierta"}</Badge></Cell>
                <Actions>
                  <IconButton label="Editar" onClick={() => setModal({ type: "window", item: window })}><Edit3 size={16} /></IconButton>
                  <DeleteButton onClick={() => void mutate("deleteWindow", { id: window.id })} />
                </Actions>
              </tr>
            );
          })}
        </DataTable>
      </Panel>
    );
  }

  if (activeView === "reservations") {
    return (
      <Panel title="Reservas recibidas" description="Todas las respuestas enviadas por los ancianos para las ventanas publicadas.">
        <DataTable headers={["Ventana", "Fecha", "Territorio", "Grupo", "Responsable", "Lugar de salida", "Estado", "Acciones"]}>
          {data.reservations.map((reservation) => (
            <tr key={reservation.id}>
              <Cell>{reservation.reservation_windows?.name ?? "-"}</Cell>
              <Cell>{displayDate(reservation.service_date)}<span className="mt-1 block text-xs text-slate-500">{serviceDayLabels[reservation.service_day]}</span></Cell>
              <Cell><strong>#{reservation.territories?.number}</strong></Cell>
              <Cell>{reservation.groups?.name ?? "-"}</Cell>
              <Cell>{reservation.profiles?.full_name ?? "-"}</Cell>
              <Cell>{reservation.departure_location}</Cell>
              <Cell><Badge className={reservationStyles[reservation.status]}>{reservationStatusLabels[reservation.status]}</Badge></Cell>
              <Actions>
                <select
                  aria-label={`Estado de territorio ${reservation.territories?.number}`}
                  className={compactSelectClass}
                  value={reservation.status}
                  onChange={(event) => void mutate("updateReservationStatus", { id: reservation.id, status: event.target.value })}
                >
                  {(["ACTIVE", "COMPLETED", "CANCELLED", "EXPIRED"] as ReservationStatus[]).map((status) => (
                    <option key={status} value={status}>{reservationStatusLabels[status]}</option>
                  ))}
                </select>
                <DeleteButton onClick={() => void mutate("deleteReservation", { id: reservation.id })} />
              </Actions>
            </tr>
          ))}
        </DataTable>
      </Panel>
    );
  }

  if (activeView === "notifications") {
    return (
      <Panel
        title="Avisos"
        description="Confirmaciones recibidas al completar una reserva."
        action={data.notifications.some((item) => !item.read_at) ? <button className={secondaryButtonClass} onClick={() => void mutate("markNotificationRead")} type="button"><Check size={17} />Marcar leidos</button> : null}
      >
        <div className="divide-y divide-slate-200">
          {data.notifications.map((notification) => (
            <div className="flex gap-3 py-4 first:pt-0 last:pb-0" key={notification.id}>
              <span className={cn("mt-0.5 inline-flex h-9 w-9 shrink-0 items-center justify-center rounded-md", notification.read_at ? "bg-slate-100 text-slate-600" : "bg-blue-50 text-blue-700")}>
                <Bell size={17} />
              </span>
              <div className="min-w-0">
                <p className={cn("text-sm", !notification.read_at && "font-semibold")}>{notification.message}</p>
                <p className="mt-1 text-xs text-slate-500">{displayDateTime(notification.created_at)}</p>
              </div>
            </div>
          ))}
          {!data.notifications.length ? <p className="py-6 text-center text-sm text-slate-500">Todavia no hay avisos.</p> : null}
        </div>
      </Panel>
    );
  }

  if (activeView === "territories") {
    return (
      <Panel title="Territorios" description="Administra el numero del territorio y sus manzanas desde un solo lugar." action={<AddButton onClick={() => setModal({ type: "territory" })}>Territorio</AddButton>}>
        <DataTable headers={["Territorio", "Avance actual", "Manzanas", "Activo", "Acciones"]}>
          {data.territories.map((territory) => {
            const progress = data.territoryProgress.find((item) => item.territory_id === territory.id);
            const completed = Boolean(progress?.total_blocks && progress.completed_blocks === progress.total_blocks);
            return (
              <tr key={territory.id}>
                <Cell>
                  <strong>Territorio #{territory.number}</strong>
                  {!openRound ? <span className="mt-1 block text-xs text-slate-500">Sin vuelta abierta</span> : null}
                </Cell>
                <Cell>
                  {progress?.total_blocks ? (
                    <div className="min-w-40">
                      <div className="flex items-center gap-2">
                        <Badge className={completed ? "border-emerald-200 bg-emerald-50 text-emerald-700" : "border-blue-200 bg-blue-50 text-blue-700"}>
                          {completed ? "Completo" : `${progress.completed_blocks}/${progress.total_blocks}`}
                        </Badge>
                        <span className="text-xs text-slate-500">en {openRound?.name ?? "la vuelta"}</span>
                      </div>
                      {!completed && progress.completed_blocks > 0 ? <p className="mt-1 text-xs text-slate-500">Faltan {progress.pending_labels.join(", ")}</p> : null}
                    </div>
                  ) : (
                    <span className="text-sm text-slate-500">Sin manzanas</span>
                  )}
                </Cell>
                <Cell>{data.blocks.filter((block) => block.territory_id === territory.id).length}</Cell>
                <Cell>{territory.active ? "Si" : "No"}</Cell>
                <Actions>
                  <IconButton label="Manzanas" onClick={() => setModal({ type: "territoryBlocks", territory })}><Grid3X3 size={16} /></IconButton>
                  <IconButton label="Editar" onClick={() => setModal({ type: "territory", item: territory })}><Edit3 size={16} /></IconButton>
                  <DeleteButton onClick={() => void mutate("deleteRow", { table: "territories", id: territory.id })} />
                </Actions>
              </tr>
            );
          })}
        </DataTable>
      </Panel>
    );
  }

  if (activeView === "rounds") {
    return (
      <Panel title="Vueltas" description="Crea varias vueltas por ano y administra su estado." action={<AddButton onClick={() => setModal({ type: "round" })}>Vuelta</AddButton>}>
        <DataTable headers={["Ano", "Vuelta", "Estado", "Manzanas", "Acciones"]}>
          {data.rounds.map((round) => (
            <tr key={round.id}><Cell>{round.year}</Cell><Cell><strong>{round.name}</strong></Cell><Cell><Badge className={round.status === "OPEN" ? "border-emerald-200 bg-emerald-50 text-emerald-700" : "border-slate-200 bg-slate-50 text-slate-700"}>{round.status === "OPEN" ? "Abierta" : "Cerrada"}</Badge></Cell><Cell>{data.blockStatuses.filter((item) => item.annual_round_id === round.id).length}</Cell><Actions><IconButton label="Editar" onClick={() => setModal({ type: "round", item: round })}><Edit3 size={16} /></IconButton><DeleteButton onClick={() => void mutate("deleteRow", { table: "annual_rounds", id: round.id })} /></Actions></tr>
          ))}
        </DataTable>
      </Panel>
    );
  }

  if (activeView === "groups") {
    return (
      <Panel title="Grupos" description="Administra los grupos disponibles." action={<AddButton onClick={() => setModal({ type: "group" })}>Grupo</AddButton>}>
        <DataTable headers={["Grupo", "Activo", "Acciones"]}>
          {data.groups.map((group) => <tr key={group.id}><Cell><strong>{group.name}</strong></Cell><Cell>{group.active ? "Si" : "No"}</Cell><Actions><IconButton label="Editar" onClick={() => setModal({ type: "group", item: group })}><Edit3 size={16} /></IconButton><DeleteButton onClick={() => void mutate("deleteRow", { table: "groups", id: group.id })} /></Actions></tr>)}
        </DataTable>
      </Panel>
    );
  }

  return (
    <Panel title="Usuarios" description="Asigna cada anciano a su grupo." action={<AddButton onClick={() => setModal({ type: "user" })}>Usuario</AddButton>}>
      <DataTable headers={["Usuario", "Nombre", "Grupo", "Rol", "Activo", "Estado", "Acciones"]}>
        {data.profiles.map((item) => (
          <tr key={item.id}>
            <Cell>@{item.username}</Cell><Cell>{item.full_name}</Cell><Cell>{item.groups?.name ?? "-"}</Cell><Cell>{item.role === "ADMIN" ? "Super admin" : "Anciano"}</Cell><Cell>{item.active ? "Si" : "No"}</Cell>
            <Cell>{item.must_change_password ? <Badge className="border-amber-200 bg-amber-50 text-amber-700">Temporal</Badge> : <Badge className="border-emerald-200 bg-emerald-50 text-emerald-700">Activa</Badge>}</Cell>
            <Actions><IconButton label="Editar" onClick={() => setModal({ type: "user", item })}><Edit3 size={16} /></IconButton><IconButton label="Cambiar contrasena" onClick={() => setModal({ type: "password", item })}><KeyRound size={16} /></IconButton>{item.role !== "ADMIN" ? <DeleteButton onClick={() => void mutate("deleteUser", { id: item.id })} /> : null}</Actions>
          </tr>
        ))}
      </DataTable>
    </Panel>
  );
}

function renderModal({
  modal,
  data,
  saving,
  passwordMode,
  setPasswordMode,
  setTemporaryPassword,
  mutate,
  submitFromForm,
}: {
  modal: NonNullable<ModalState>;
  data: AppData;
  saving: boolean;
  passwordMode: "manual" | "generate";
  setPasswordMode: (mode: "manual" | "generate") => void;
  setTemporaryPassword: (password: string) => void;
  mutate: (action: string, payload?: Record<string, unknown>, form?: HTMLFormElement) => Promise<unknown>;
  submitFromForm: (event: FormEvent<HTMLFormElement>, action: string, map: (form: FormData) => Record<string, unknown>) => void;
}) {
  if (modal.type === "territoryBlocks") {
    return <TerritoryBlocksModal data={data} mutate={mutate} saving={saving} territory={modal.territory} />;
  }
  if (modal.type === "territory") {
    return <FormModal title={modal.item ? "Editar territorio" : "Nuevo territorio"} onSubmit={(event) => submitFromForm(event, modal.item ? "updateTerritory" : "createTerritory", (form) => ({ id: modal.item?.id, number: Number(form.get("number")) }))} saving={saving}><Field label="Numero"><input className={inputClass} name="number" min="1" type="number" defaultValue={modal.item?.number} required /></Field></FormModal>;
  }
  if (modal.type === "group") {
    return <FormModal title={modal.item ? "Editar grupo" : "Nuevo grupo"} onSubmit={(event) => submitFromForm(event, modal.item ? "updateGroup" : "createGroup", (form) => ({ id: modal.item?.id, name: form.get("name") }))} saving={saving}><Field label="Nombre"><input className={inputClass} name="name" defaultValue={modal.item?.name} required /></Field></FormModal>;
  }
  if (modal.type === "block") {
    return <FormModal title={modal.item ? "Editar manzana" : "Nueva manzana"} onSubmit={(event) => submitFromForm(event, modal.item ? "updateBlock" : "createBlock", (form) => ({ id: modal.item?.id, territory_id: form.get("territory_id"), label: form.get("label") }))} saving={saving}><Field label="Territorio"><select className={inputClass} name="territory_id" defaultValue={modal.item?.territory_id ?? ""} required><option value="">Seleccionar</option>{data.territories.map((territory) => <option key={territory.id} value={territory.id}>Territorio #{territory.number}</option>)}</select></Field><Field label="Manzana"><input className={inputClass} name="label" placeholder="M1" defaultValue={modal.item?.label} required /></Field></FormModal>;
  }
  if (modal.type === "round") {
    return <FormModal title={modal.item ? "Editar vuelta" : "Nueva vuelta"} onSubmit={(event) => submitFromForm(event, modal.item ? "updateRound" : "createRound", (form) => ({ id: modal.item?.id, year: Number(form.get("year")), name: form.get("name"), status: form.get("status") }))} saving={saving}><Field label="Ano"><input className={inputClass} name="year" type="number" defaultValue={modal.item?.year ?? new Date().getFullYear()} required /></Field><Field label="Nombre de vuelta"><input className={inputClass} name="name" placeholder="Vuelta 1" defaultValue={modal.item?.name} required /></Field>{modal.item ? <Field label="Estado"><select className={inputClass} name="status" defaultValue={modal.item.status}><option value="OPEN">Abierta</option><option value="CLOSED">Cerrada</option></select></Field> : null}</FormModal>;
  }
  if (modal.type === "window") {
    return (
      <FormModal title={modal.item ? "Editar ventana" : "Nueva ventana"} onSubmit={(event) => submitFromForm(event, modal.item ? "updateWindow" : "createWindow", (form) => ({ id: modal.item?.id, name: form.get("name"), saturday_date: form.get("saturday_date") || null, sunday_date: form.get("sunday_date") || null, booking_deadline: new Date(String(form.get("booking_deadline"))).toISOString(), active: form.get("active") === "true" }))} saving={saving}>
        <Field label="Nombre"><input className={inputClass} name="name" placeholder="Fin de semana 12 y 13 de julio" defaultValue={modal.item?.name} required /></Field>
        <div className="grid gap-3 sm:grid-cols-2">
          <Field label="Sabado"><input className={inputClass} name="saturday_date" type="date" defaultValue={modal.item?.saturday_date ?? ""} /></Field>
          <Field label="Domingo"><input className={inputClass} name="sunday_date" type="date" defaultValue={modal.item?.sunday_date ?? ""} /></Field>
        </div>
        <Field label="Fecha y hora limite"><input className={inputClass} name="booking_deadline" type="datetime-local" defaultValue={localDateTimeValue(modal.item?.booking_deadline)} required /></Field>
        <Field label="Estado"><select className={inputClass} name="active" defaultValue={modal.item?.active === false ? "false" : "true"}><option value="true">Publicada</option><option value="false">Inactiva</option></select></Field>
      </FormModal>
    );
  }
  if (modal.type === "reservation") {
    const unavailable = new Set([
      ...data.unavailableReservations
        .filter((item) => item.service_date === modal.date && item.territory_id !== modal.item?.territory_id)
        .map((item) => item.territory_id),
      ...data.reservations.filter((item) => item.service_date === modal.date && item.status === "ACTIVE" && item.id !== modal.item?.id).map((item) => item.territory_id),
    ]);
    const defaultDeparture = modal.item?.departure_location ?? data.reservations.find(
      (item) => item.reservation_window_id === modal.window.id && item.service_date === modal.date,
    )?.departure_location;
    return (
      <FormModal title={modal.item ? "Editar reserva" : "Agregar territorios"} subtitle={`${modal.window.name} - ${displayDate(modal.date)}`} onSubmit={(event) => submitFromForm(event, modal.item ? "updateReservation" : "createReservation", (form) => ({ id: modal.item?.id, reservation_window_id: modal.window.id, service_date: modal.date, territory_id: form.get("territory_id"), territory_ids: form.getAll("territory_ids"), departure_location: form.get("departure_location") }))} saving={saving}>
        {modal.item ? (
          <Field label="Territorio">
            <select className={inputClass} name="territory_id" defaultValue={modal.item.territory_id} required>
              {data.territories.map((territory) => {
                const progress = data.territoryProgress.find((item) => item.territory_id === territory.id);
                const completed = Boolean(progress?.total_blocks && progress.completed_blocks === progress.total_blocks);
                const disabled = territory.id !== modal.item?.territory_id && (unavailable.has(territory.id) || completed);
                return <option disabled={disabled} key={territory.id} value={territory.id}>{territorySelectionLabel(territory, progress)}{unavailable.has(territory.id) ? " - No disponible" : ""}</option>;
              })}
            </select>
          </Field>
        ) : (
          <fieldset>
            <legend className="text-sm font-medium">Territorios</legend>
            <div className="mt-2 max-h-64 space-y-1 overflow-y-auto rounded-md border border-slate-300 p-2">
              {data.territories.map((territory) => {
                const progress = data.territoryProgress.find((item) => item.territory_id === territory.id);
                const completed = Boolean(progress?.total_blocks && progress.completed_blocks === progress.total_blocks);
                const disabled = unavailable.has(territory.id) || completed;
                return (
                  <label className={cn("flex min-h-11 items-center gap-3 rounded-md px-3 py-2 text-sm", disabled ? "cursor-not-allowed bg-slate-50 text-slate-400" : "cursor-pointer hover:bg-blue-50")} key={territory.id}>
                    <input className="h-4 w-4 accent-blue-700" disabled={disabled} name="territory_ids" type="checkbox" value={territory.id} />
                    <span>{territorySelectionLabel(territory, progress)}{unavailable.has(territory.id) ? " - No disponible" : ""}</span>
                  </label>
                );
              })}
            </div>
          </fieldset>
        )}
        <Field label="Lugar de salida"><div className="relative"><MapPin className="pointer-events-none absolute left-3 top-4 text-slate-400" size={17} /><input className={inputClass + " pl-10"} name="departure_location" placeholder="Ej. Salon del Reino" defaultValue={defaultDeparture} maxLength={180} required /></div></Field>
      </FormModal>
    );
  }
  if (modal.type === "user") {
    return (
      <FormModal title={modal.item ? "Editar usuario" : "Nuevo usuario"} onSubmit={(event) => submitFromForm(event, modal.item ? "updateUser" : "createUser", (form) => ({ id: modal.item?.id, username: form.get("username"), full_name: form.get("full_name"), group_id: form.get("group_id") || null, role: form.get("role"), active: form.get("active") === "true", passwordMode, password: form.get("password") }))} saving={saving}>
        {!modal.item ? <Field label="Usuario"><input className={inputClass} name="username" required /></Field> : null}
        <Field label="Nombre completo"><input className={inputClass} name="full_name" defaultValue={modal.item?.full_name} required /></Field>
        <Field label="Grupo"><select className={inputClass} name="group_id" defaultValue={modal.item?.group_id ?? ""}><option value="">Sin grupo</option>{data.groups.map((group) => <option key={group.id} value={group.id}>{group.name}</option>)}</select></Field>
        <Field label="Rol"><select className={inputClass} name="role" defaultValue={modal.item?.role ?? "ANCIANO"}><option value="ANCIANO">Anciano</option><option value="ADMIN">Super admin</option></select></Field>
        {modal.item ? <Field label="Activo"><select className={inputClass} name="active" defaultValue={modal.item.active ? "true" : "false"}><option value="true">Si</option><option value="false">No</option></select></Field> : null}
        {!modal.item ? <><Field label="Contrasena"><select className={inputClass} value={passwordMode} onChange={(event) => setPasswordMode(event.target.value as "manual" | "generate")}><option value="generate">Generar temporal</option><option value="manual">Escribir manual</option></select></Field><Field label="Contrasena manual"><input className={inputClass} name="password" disabled={passwordMode === "generate"} type="password" /></Field></> : null}
      </FormModal>
    );
  }
  return (
    <FormModal title={`Cambiar contrasena de @${modal.item.username}`} onSubmit={(event) => submitFromForm(event, "updateUser", (form) => ({ id: modal.item.id, password: form.get("password"), must_change_password: true }))} saving={saving}>
      <Field label="Nueva contrasena"><input className={inputClass} name="password" type="password" minLength={8} required /></Field>
      <button className={secondaryButtonClass} type="button" onClick={() => {
        const temp = crypto.getRandomValues(new Uint32Array(3)).join("").slice(0, 12);
        void mutate("updateUser", { id: modal.item.id, password: temp, must_change_password: true }).then((result) => {
          if (result) setTemporaryPassword(temp);
        });
      }}><Wand2 size={16} />Generar temporal</button>
    </FormModal>
  );
}

function TerritoryBlocksModal({
  data,
  mutate,
  saving,
  territory,
}: {
  data: AppData;
  mutate: (action: string, payload?: Record<string, unknown>) => Promise<unknown>;
  saving: boolean;
  territory: Territory;
}) {
  const defaultRoundId = data.activeRound?.id ?? data.rounds.find((round) => round.status === "OPEN")?.id ?? data.rounds[0]?.id ?? "";
  const [roundId, setRoundId] = useState(defaultRoundId);
  const [completedIds, setCompletedIds] = useState<Set<string>>(new Set());
  const [newLabels, setNewLabels] = useState<string[]>([]);

  const blocks = useMemo(
    () => data.blocks
      .filter((block) => block.territory_id === territory.id)
      .sort((a, b) => a.label.localeCompare(b.label, "es", { numeric: true })),
    [data.blocks, territory.id],
  );
  const round = data.rounds.find((item) => item.id === roundId);
  const existingLabels = new Set(blocks.map((block) => block.label.toUpperCase()));

  useEffect(() => {
    setCompletedIds(new Set(
      data.blockStatuses
        .filter((status) => status.annual_round_id === roundId && status.status === "COMPLETED")
        .map((status) => status.block_id),
    ));
    setNewLabels([]);
  }, [data.blockStatuses, roundId]);

  function nextBlockLabel() {
    const numbers = [...blocks.map((block) => block.label), ...newLabels]
      .map((label) => Number(label.replace(/^\D+/g, "")))
      .filter((number) => Number.isFinite(number));
    return `M${Math.max(0, ...numbers) + 1}`;
  }

  function addBlock() {
    const label = nextBlockLabel();
    if (existingLabels.has(label.toUpperCase()) || newLabels.includes(label)) return;
    setNewLabels((current) => [...current, label]);
  }

  function toggle(id: string) {
    setCompletedIds((current) => {
      const next = new Set(current);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  }

  function selectAll() {
    setCompletedIds(new Set([...blocks.map((block) => block.id), ...newLabels.map((label) => `new:${label}`)]));
  }

  function clearAll() {
    setCompletedIds(new Set());
  }

  const completedExistingIds = blocks.filter((block) => completedIds.has(block.id)).map((block) => block.id);
  const completedNewLabels = newLabels.filter((label) => completedIds.has(`new:${label}`));
  const total = blocks.length + newLabels.length;
  const completedTotal = completedExistingIds.length + completedNewLabels.length;

  return (
    <form
      className="space-y-5 p-5"
      onSubmit={(event) => {
        event.preventDefault();
        void mutate("setTerritoryBlockProgress", {
          annual_round_id: roundId,
          territory_id: territory.id,
          completed_block_ids: completedExistingIds,
          new_block_labels: newLabels,
          completed_new_block_labels: completedNewLabels,
        });
      }}
    >
      <div>
        <p className="text-sm font-semibold uppercase tracking-[0.14em] text-blue-700">Manzanas</p>
        <h2 className="mt-1 text-xl font-semibold">Territorio #{territory.number}</h2>
        <p className="mt-2 text-sm leading-6 text-slate-600">
          {round ? `${round.name} (${round.year})` : "Selecciona una vuelta para guardar el avance."}
        </p>
      </div>

      <Field label="Vuelta">
        <select className={inputClass} value={roundId} onChange={(event) => setRoundId(event.target.value)} required>
          <option value="">Seleccionar vuelta</option>
          {data.rounds.map((item) => (
            <option key={item.id} value={item.id}>
              {item.name} ({item.year}) - {item.status === "OPEN" ? "Abierta" : "Cerrada"}
            </option>
          ))}
        </select>
      </Field>

      <div className="flex flex-col gap-3 rounded-md border border-slate-200 bg-slate-50 p-3 sm:flex-row sm:items-center sm:justify-between">
        <div>
          <p className="text-sm font-semibold text-slate-900">{completedTotal}/{total || 0} completadas</p>
          <p className="mt-1 text-xs text-slate-500">{total > 0 && completedTotal === total ? "El territorio queda completo en esta vuelta." : "Toca cada manzana para marcarla o desmarcarla."}</p>
        </div>
        <div className="flex flex-wrap gap-2">
          <button className={miniButtonClass} type="button" onClick={addBlock}><Plus size={15} />Agregar manzana</button>
          <button className={miniButtonClass} type="button" onClick={selectAll} disabled={!total}>Todas</button>
          <button className={miniButtonClass} type="button" onClick={clearAll} disabled={!total}>Limpiar</button>
        </div>
      </div>

      {total ? (
        <div className="grid grid-cols-3 gap-2 sm:grid-cols-4 md:grid-cols-6">
          {blocks.map((block) => {
            const selected = completedIds.has(block.id);
            return (
              <button
                className={cn(
                  "flex aspect-square min-h-20 cursor-pointer flex-col items-center justify-center rounded-md border text-sm font-semibold transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-blue-500",
                  selected ? "border-emerald-300 bg-emerald-50 text-emerald-800" : "border-slate-200 bg-white text-slate-700 hover:bg-blue-50",
                )}
                key={block.id}
                onClick={() => toggle(block.id)}
                type="button"
              >
                <span>{block.label}</span>
                <span className="mt-1 text-[11px] font-medium">{selected ? "Completa" : "Pendiente"}</span>
              </button>
            );
          })}
          {newLabels.map((label) => {
            const id = `new:${label}`;
            const selected = completedIds.has(id);
            return (
              <button
                className={cn(
                  "flex aspect-square min-h-20 cursor-pointer flex-col items-center justify-center rounded-md border border-dashed text-sm font-semibold transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-blue-500",
                  selected ? "border-emerald-300 bg-emerald-50 text-emerald-800" : "border-blue-300 bg-blue-50 text-blue-800 hover:bg-blue-100",
                )}
                key={id}
                onClick={() => toggle(id)}
                type="button"
              >
                <span>{label}</span>
                <span className="mt-1 text-[11px] font-medium">{selected ? "Nueva completa" : "Nueva"}</span>
              </button>
            );
          })}
        </div>
      ) : (
        <div className="rounded-md border border-dashed border-slate-300 bg-slate-50 px-4 py-8 text-center">
          <Grid3X3 className="mx-auto text-slate-400" size={28} />
          <p className="mt-3 text-sm font-medium text-slate-700">Este territorio todavia no tiene manzanas.</p>
          <button className={primarySmallButtonClass + " mt-4"} type="button" onClick={addBlock}><Plus size={16} />Agregar primera manzana</button>
        </div>
      )}

      <button className={primaryButtonClass} disabled={saving || !roundId} type="submit">
        {saving ? "Guardando..." : "Guardar avance"}
      </button>
    </form>
  );
}

const inputClass = "mt-1 min-h-11 w-full rounded-md border border-slate-300 bg-white px-3 py-2 text-sm text-slate-950 outline-none transition focus:border-blue-600 focus:ring-2 focus:ring-blue-100 disabled:bg-slate-100";
const primaryButtonClass = "inline-flex min-h-11 w-full cursor-pointer items-center justify-center gap-2 rounded-md bg-blue-700 px-4 py-2 text-sm font-semibold text-white transition-colors hover:bg-blue-800 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-blue-500 focus-visible:ring-offset-2 disabled:cursor-not-allowed disabled:opacity-60";
const primarySmallButtonClass = "inline-flex min-h-11 cursor-pointer items-center justify-center gap-2 rounded-md bg-blue-700 px-4 py-2 text-sm font-semibold text-white transition-colors hover:bg-blue-800 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-blue-500 focus-visible:ring-offset-2 disabled:cursor-not-allowed disabled:opacity-60";
const secondaryButtonClass = "inline-flex min-h-11 cursor-pointer items-center justify-center gap-2 rounded-md border border-slate-300 bg-white px-4 py-2 text-sm font-semibold text-slate-800 transition-colors hover:bg-slate-50 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-blue-500";
const miniButtonClass = "inline-flex min-h-9 cursor-pointer items-center gap-2 rounded-md border border-slate-300 bg-white px-3 py-1 text-xs font-semibold text-slate-800 transition-colors hover:bg-slate-50 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-blue-500";
const compactSelectClass = "min-h-10 cursor-pointer rounded-md border border-slate-300 bg-white px-3 py-2 text-sm text-slate-900 outline-none focus:border-blue-600 focus:ring-2 focus:ring-blue-100 disabled:cursor-not-allowed disabled:bg-slate-100";

function tabClass(active: boolean) {
  return cn("inline-flex min-h-10 shrink-0 cursor-pointer items-center gap-2 rounded-md px-3 py-2 text-sm font-semibold transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-blue-500", active ? "bg-blue-700 text-white" : "bg-white text-slate-700 hover:bg-slate-50");
}
function Field({ label, children }: { label: string; children: React.ReactNode }) {
  return <label className="block text-sm font-medium">{label}{children}</label>;
}
function Toast({ toast, onClose }: { toast: { type: "success" | "error"; text: string } | null; onClose: () => void }) {
  if (!toast) return null;
  return <div className={cn("fixed right-4 top-4 z-50 flex max-w-sm items-center gap-3 rounded-lg border bg-white px-4 py-3 text-sm shadow-lg", toast.type === "success" ? "border-emerald-200 text-emerald-800" : "border-rose-200 text-rose-800")} role="status"><CheckCircle2 size={18} /><span>{toast.text}</span><button className="ml-2 cursor-pointer text-slate-500" onClick={onClose} type="button" aria-label="Cerrar"><X size={16} /></button></div>;
}
function TemporaryPasswordModal({ password, onClose }: { password: string; onClose: () => void }) {
  useEffect(() => {
    if (password) void navigator.clipboard?.writeText(password);
  }, [password]);
  if (!password) return null;
  return <div className="fixed inset-0 z-50 grid place-items-center bg-slate-950/40 px-4 py-6"><div className="w-full max-w-md rounded-lg border border-emerald-200 bg-white shadow-xl"><div className="border-b border-slate-200 p-5"><h2 className="text-xl font-semibold">Contrasena temporal</h2><p className="mt-2 text-sm leading-6 text-slate-600">Ya fue copiada al portapapeles.</p></div><div className="space-y-4 p-5"><div className="break-all rounded-md border border-emerald-200 bg-emerald-50 px-3 py-3 font-mono text-sm font-semibold text-emerald-900">{password}</div><div className="grid gap-2 sm:grid-cols-2"><button className={secondaryButtonClass} type="button" onClick={() => void navigator.clipboard?.writeText(password)}><Copy size={16} />Copiar</button><button className={primarySmallButtonClass} type="button" onClick={onClose}>Listo</button></div></div></div></div>;
}
function AddButton({ children, onClick }: { children: React.ReactNode; onClick: () => void }) {
  return <button className={primarySmallButtonClass} onClick={onClick} type="button"><Plus size={16} />{children}</button>;
}
function Metric({ icon, label, value }: { icon: React.ReactNode; label: string; value: number | string }) {
  return <article className="rounded-lg border border-slate-200 bg-white p-4"><span className="inline-flex h-10 w-10 items-center justify-center rounded-md bg-blue-50 text-blue-700">{icon}</span><p className="mt-4 text-sm font-medium text-slate-600">{label}</p><p className="mt-1 text-3xl font-semibold">{value}</p></article>;
}
function EmptyState({ icon, title, text }: { icon: React.ReactNode; title: string; text: string }) {
  return <section className="rounded-lg border border-slate-200 bg-white px-5 py-12 text-center"><span className="mx-auto inline-flex h-12 w-12 items-center justify-center rounded-md bg-blue-50 text-blue-700">{icon}</span><h2 className="mt-4 text-lg font-semibold">{title}</h2><p className="mx-auto mt-2 max-w-md text-sm leading-6 text-slate-600">{text}</p></section>;
}
function Panel({ title, description, action, children }: { title: string; description: string; action?: React.ReactNode; children: React.ReactNode }) {
  return <section className="rounded-lg border border-slate-200 bg-white"><div className="flex flex-col gap-3 border-b border-slate-200 p-4 sm:flex-row sm:items-center sm:justify-between"><div><h2 className="text-lg font-semibold">{title}</h2><p className="mt-1 text-sm text-slate-600">{description}</p></div>{action}</div><div className="space-y-4 p-4">{children}</div></section>;
}
function DataTable({ headers, children }: { headers: string[]; children: React.ReactNode }) {
  return <div className="overflow-x-auto"><table className="w-full min-w-[760px] border-collapse text-left text-sm"><thead className="bg-slate-50 text-xs uppercase tracking-[0.08em] text-slate-500"><tr>{headers.map((header) => <th className="px-3 py-3 font-semibold" key={header}>{header}</th>)}</tr></thead><tbody className="divide-y divide-slate-200">{children}</tbody></table></div>;
}
function Cell({ children }: { children: React.ReactNode }) {
  return <td className="px-3 py-3 align-middle">{children}</td>;
}
function Actions({ children }: { children: React.ReactNode }) {
  return <td className="px-3 py-3"><div className="flex justify-end gap-2">{children}</div></td>;
}
function Badge({ children, className }: { children: React.ReactNode; className: string }) {
  return <span className={cn("inline-flex rounded-md border px-2 py-1 text-xs font-semibold", className)}>{children}</span>;
}
function IconButton({ label, onClick, children }: { label: string; onClick: () => void; children: React.ReactNode }) {
  return <button className="inline-flex min-h-9 cursor-pointer items-center justify-center rounded-md border border-slate-300 bg-white px-3 text-slate-700 transition-colors hover:bg-slate-50 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-blue-500" onClick={onClick} type="button" aria-label={label} title={label}>{children}</button>;
}
function DeleteButton({ onClick, label = "Eliminar" }: { onClick: () => void; label?: string }) {
  return <button className="inline-flex min-h-9 cursor-pointer items-center justify-center rounded-md border border-rose-200 bg-rose-50 px-3 text-rose-700 transition-colors hover:bg-rose-100 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-rose-500" onClick={onClick} type="button" aria-label={label} title={label}><Trash2 size={16} aria-hidden="true" /></button>;
}
function ModalShell({ modal, onClose, children }: { modal: ModalState; onClose: () => void; children: React.ReactNode }) {
  if (!modal) return null;
  return <div className="fixed inset-0 z-40 grid place-items-center overflow-y-auto bg-slate-950/40 px-4 py-6"><div className={cn("w-full rounded-lg border border-slate-200 bg-white shadow-xl", modal.type === "territoryBlocks" ? "max-w-3xl" : "max-w-lg")} role="dialog" aria-modal="true"><div className="flex justify-end border-b border-slate-200 p-3"><button className="inline-flex h-9 w-9 cursor-pointer items-center justify-center rounded-md text-slate-600 hover:bg-slate-100 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-blue-500" onClick={onClose} type="button" aria-label="Cerrar"><X size={18} /></button></div>{children}</div></div>;
}
function FormModal({ title, subtitle, saving, onSubmit, children }: { title: string; subtitle?: string; saving: boolean; onSubmit: (event: FormEvent<HTMLFormElement>) => void; children: React.ReactNode }) {
  return <form className="space-y-4 p-5" onSubmit={onSubmit}><div><h2 className="text-xl font-semibold">{title}</h2>{subtitle ? <p className="mt-1 text-sm text-slate-600">{subtitle}</p> : null}</div><div className="space-y-3">{children}</div><button className={primaryButtonClass} disabled={saving} type="submit">{saving ? "Guardando..." : "Guardar"}</button></form>;
}
