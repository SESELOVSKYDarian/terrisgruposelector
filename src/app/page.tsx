"use client";

/* eslint-disable react-hooks/set-state-in-effect */

import { FormEvent, useCallback, useEffect, useMemo, useRef, useState, type ReactNode } from "react";
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
  Map as MapIcon,
  MapPin,
  Plus,
  RefreshCw,
  Save,
  ShieldCheck,
  Trash2,
  TriangleAlert,
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
  group_id: string | null;
  responsible_user_id: string;
  service_date: string;
  service_day: ServiceDay;
  departure_location: string;
  status: ReservationStatus;
  reserved_by_admin: boolean;
  admin_note: string | null;
  territories?: Pick<Territory, "number" | "name"> | null;
  groups?: Pick<Group, "name"> | null;
  profiles?: Pick<Profile, "full_name" | "username"> | null;
  reservation_windows?: Pick<ReservationWindow, "name" | "booking_deadline"> | null;
};
type BlockRoundStatus = {
  id: string;
  annual_round_id: string;
  block_id: string;
  status: BlockStatus;
  updated_at?: string;
  blocks?: {
    label: string;
    territory_id: string;
    territories?: Pick<Territory, "number" | "name"> | null;
  } | null;
};
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
  | { type: "adminReservation"; window: ReservationWindow }
  | { type: "reservation"; window: ReservationWindow; date: string; item?: Reservation }
  | { type: "user"; item?: Profile }
  | { type: "password"; item: Profile }
  | null;
type ConfirmationState = {
  title: string;
  description: string;
  confirmLabel: string;
  tone: "danger" | "primary";
} | null;
type PendingConfirmation = NonNullable<ConfirmationState> & {
  resolve: (confirmed: boolean) => void;
};

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
  ACTIVE: "border-sky-400/30 bg-sky-500/12 text-sky-200",
  COMPLETED: "border-emerald-400/30 bg-emerald-500/12 text-emerald-200",
  CANCELLED: "border-slate-400/25 bg-slate-500/10 text-slate-300",
  EXPIRED: "border-rose-400/30 bg-rose-500/12 text-rose-200",
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
  const [activeView, setActiveView] = useState("dashboard");
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [toast, setToast] = useState<{ type: "success" | "error"; text: string } | null>(null);
  const [modal, setModal] = useState<ModalState>(null);
  const [temporaryPassword, setTemporaryPassword] = useState("");
  const [passwordMode, setPasswordMode] = useState<"manual" | "generate">("generate");
  const [loadedAt, setLoadedAt] = useState(0);
  const [pendingConfirmation, setPendingConfirmation] = useState<PendingConfirmation | null>(null);

  const isAdmin = profile?.role === "ADMIN";
  const openRound = data.rounds.find((round) => round.status === "OPEN");
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

  function requestConfirmation(action: string) {
    if (action === "markNotificationRead") return Promise.resolve(true);
    const deleting = action.startsWith("delete");
    return new Promise<boolean>((resolve) => {
      setPendingConfirmation({
        title: deleting ? "¿Eliminar definitivamente?" : "¿Guardar estos cambios?",
        description: deleting
          ? "Esta acción no se puede deshacer. Revisa que sea el registro correcto antes de continuar."
          : "Confirma que la información es correcta antes de aplicarla.",
        confirmLabel: deleting ? "Sí, eliminar" : "Sí, guardar",
        tone: deleting ? "danger" : "primary",
        resolve,
      });
    });
  }

  function resolveConfirmation(confirmed: boolean) {
    pendingConfirmation?.resolve(confirmed);
    setPendingConfirmation(null);
  }

  async function mutate(action: string, payload?: Record<string, unknown>, form?: HTMLFormElement) {
    if (!(await requestConfirmation(action))) return null;
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
      <main className="relative z-10 grid min-h-screen place-items-center px-4 py-8 text-slate-100">
        <Toast toast={toast} onClose={() => setToast(null)} />
        <section className="glass-panel floating-card w-full max-w-md rounded-[1.75rem] p-6 sm:p-7">
          <span className="inline-flex h-12 w-12 items-center justify-center rounded-2xl border border-sky-400/20 bg-sky-500/12 text-sky-300 shadow-[0_0_0_1px_rgba(56,189,248,0.06)]">
            <ShieldCheck size={22} aria-hidden="true" />
          </span>
          <p className="mt-5 text-xs font-semibold uppercase tracking-[0.28em] text-sky-300/90">Terris Grupo Selector</p>
          <h1 className="mt-3 text-3xl font-semibold tracking-tight text-white">Ingresar</h1>
          <p className="mt-2 text-sm leading-6 text-slate-300">Usa tu usuario interno y contrasena asignada.</p>
          <form className="mt-7 space-y-4" onSubmit={login}>
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
    <main className="relative z-10 min-h-screen text-slate-100">
      <SmoothCursor />
      <Toast toast={toast} onClose={() => setToast(null)} />
      <div className="mx-auto flex w-full max-w-[1540px] flex-col gap-4 px-3 py-3 sm:px-5 sm:py-5 lg:px-6">
        {isAdmin ? (
          <div className="grid items-start gap-4 lg:grid-cols-[236px_minmax(0,1fr)]">
            <AdminNav
              activeView={activeView}
              currentUser={profile}
              unreadCount={unreadCount}
              onChange={setActiveView}
              onLogout={logout}
            />
            <div className="min-w-0 space-y-3">
              <AdminTopbar
                activeView={activeView}
                unreadCount={unreadCount}
                onNotifications={() => setActiveView("notifications")}
              />
              <div className="view-transition min-w-0" key={activeView}>
                <AdminView
                  activeView={activeView}
                  data={data}
                  loadedAt={loadedAt}
                  openRound={openRound}
                  setModal={setModal}
                  mutate={mutate}
                />
              </div>
            </div>
          </div>
        ) : (
          <>
            <header className="glass-panel flex flex-col gap-4 rounded-[1.75rem] p-5 lg:flex-row lg:items-center lg:justify-between">
              <div>
                <p className="text-[11px] font-semibold uppercase tracking-[0.24em] text-slate-400">Terris Grupo Selector</p>
                <h1 className="mt-2 text-2xl font-semibold tracking-tight text-white sm:text-3xl">Reservas de mi grupo</h1>
                <p className="mt-2 text-sm text-slate-400">
                  {profile.full_name} - {data.groups[0]?.name ?? "Sin grupo asignado"}
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
            <ElderReservations data={data} loadedAt={loadedAt} setModal={setModal} mutate={mutate} />
          </>
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
      <ConfirmationModal
        confirmation={pendingConfirmation}
        onCancel={() => resolveConfirmation(false)}
        onConfirm={() => resolveConfirmation(true)}
      />
    </main>
  );
}

function AdminNav({
  activeView,
  currentUser,
  unreadCount,
  onChange,
  onLogout,
}: {
  activeView: string;
  currentUser: Profile;
  unreadCount: number;
  onChange: (view: string) => void;
  onLogout: () => void;
}) {
  const tabs: Array<{ id: string; label: string; icon: ReactNode }> = [
    { id: "dashboard", label: "Resumen", icon: <ShieldCheck size={17} /> },
    { id: "windows", label: "Ventanas", icon: <CalendarDays size={17} /> },
    { id: "reservations", label: "Reservas", icon: <CalendarClock size={17} /> },
    { id: "blocks", label: "Bloqueos", icon: <ShieldCheck size={17} /> },
    { id: "territories", label: "Territorios", icon: <MapIcon size={17} /> },
    { id: "rounds", label: "Vueltas", icon: <Grid3X3 size={17} /> },
    { id: "notifications", label: `Avisos${unreadCount ? ` (${unreadCount})` : ""}`, icon: <Bell size={17} /> },
    { id: "groups", label: "Grupos", icon: <Users size={17} /> },
    { id: "users", label: "Usuarios", icon: <KeyRound size={17} /> },
  ];
  const initials = currentUser.full_name
    .split(" ")
    .slice(0, 2)
    .map((part) => part[0])
    .join("")
    .toUpperCase();

  return (
    <aside className="glass-panel flex h-fit min-w-0 flex-col gap-3 rounded-[1.5rem] p-3 lg:sticky lg:top-4 lg:h-[calc(100vh-2rem)] lg:min-h-[620px]" aria-label="Administracion">
      <div className="flex items-center gap-3 px-2 py-2">
        <span className="inline-flex h-10 w-10 shrink-0 items-center justify-center rounded-2xl border border-white/10 bg-white text-black">
          <ShieldCheck size={19} aria-hidden="true" />
        </span>
        <div className="min-w-0">
          <p className="truncate text-sm font-semibold text-white">Terris</p>
          <p className="truncate text-xs text-slate-500">Administración</p>
        </div>
      </div>

      <nav className="scrollbar-hidden flex gap-1 overflow-x-auto pb-1 lg:block lg:space-y-1 lg:overflow-visible lg:pb-0" aria-label="Secciones">
        {tabs.map(({ id, label, icon }) => (
          <button key={id} className={tabClass(activeView === id)} onClick={() => onChange(id)} type="button" aria-current={activeView === id ? "page" : undefined}>
            <span className="shrink-0">{icon}</span>
            <span className="whitespace-nowrap">{label}</span>
          </button>
        ))}
      </nav>

      <div className="mt-auto flex items-center gap-2 rounded-[1.25rem] border border-white/8 bg-white/[0.025] p-2">
        <span className="inline-flex h-10 w-10 shrink-0 items-center justify-center rounded-2xl bg-white/[0.08] text-xs font-bold text-white">
          {initials}
        </span>
        <div className="min-w-0 flex-1">
          <p className="truncate text-sm font-semibold text-white">{currentUser.full_name}</p>
          <p className="truncate text-xs text-slate-500">@{currentUser.username} · Super admin</p>
        </div>
        <button className="inline-flex h-10 w-10 shrink-0 cursor-pointer items-center justify-center rounded-xl text-slate-400 transition-colors duration-200 hover:bg-white/[0.07] hover:text-white focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-white/30" onClick={onLogout} type="button" aria-label="Cerrar sesión" title="Cerrar sesión">
          <LogOut size={17} aria-hidden="true" />
        </button>
      </div>
    </aside>
  );
}

function AdminTopbar({
  activeView,
  unreadCount,
  onNotifications,
}: {
  activeView: string;
  unreadCount: number;
  onNotifications: () => void;
}) {
  const sectionLabels: Record<string, string> = {
    dashboard: "Resumen",
    windows: "Ventanas",
    reservations: "Reservas",
    blocks: "Bloqueos",
    notifications: "Avisos",
    territories: "Territorios",
    rounds: "Vueltas",
    groups: "Grupos",
    users: "Usuarios",
  };
  return (
    <header className="glass-panel flex min-h-16 items-center gap-3 rounded-[1.35rem] px-3 py-2.5 sm:px-4">
      <button
        className={cn(
          "relative inline-flex h-11 w-11 shrink-0 cursor-pointer items-center justify-center rounded-2xl border transition-colors duration-200 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-white/30",
          activeView === "notifications"
            ? "border-sky-400/30 bg-sky-500/15 text-sky-200"
            : "border-white/10 bg-white/[0.04] text-slate-300 hover:bg-white/[0.08] hover:text-white",
        )}
        onClick={onNotifications}
        type="button"
        aria-label={unreadCount ? `Avisos, ${unreadCount} sin leer` : "Avisos"}
      >
        <Bell size={18} aria-hidden="true" />
        {unreadCount ? <span className="absolute -right-1 -top-1 min-w-5 rounded-full border-2 border-black bg-sky-400 px-1 text-center text-[10px] font-bold leading-4 text-slate-950">{unreadCount > 99 ? "99+" : unreadCount}</span> : null}
      </button>
      <div className="min-w-0">
        <p className="text-[10px] font-semibold uppercase tracking-[0.2em] text-slate-500">Panel administrativo</p>
        <h1 className="truncate text-base font-semibold text-white sm:text-lg">{sectionLabels[activeView] ?? "Administración"}</h1>
      </div>
    </header>
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
          <article className="glass-panel floating-card overflow-hidden rounded-[1.5rem]" key={window.id}>
            <div className="flex flex-col gap-3 border-b border-white/10 p-5 sm:flex-row sm:items-center sm:justify-between">
              <div>
                <div className="flex flex-wrap items-center gap-2">
                  <h2 className="text-lg font-semibold text-white">{window.name}</h2>
                  <Badge className={expired ? "border-slate-400/25 bg-slate-500/10 text-slate-300" : "border-emerald-400/30 bg-emerald-500/12 text-emerald-200"}>
                    {expired ? "Cerrada" : "Disponible"}
                  </Badge>
                </div>
                <p className="mt-2 text-sm text-slate-300">Limite para responder: {displayDateTime(window.booking_deadline)}</p>
              </div>
            </div>
            <div className="grid divide-y divide-white/10 md:grid-cols-2 md:divide-x md:divide-y-0">
              {dates.map((date) => {
                const dayReservations = data.reservations.filter(
                  (item) => item.reservation_window_id === window.id && item.service_date === date && item.status === "ACTIVE",
                );
                return (
                  <div className="min-w-0 p-5" key={date}>
                    <p className="text-sm font-semibold text-slate-100">
                      {date === window.saturday_date ? "Sabado" : "Domingo"} {displayDate(date)}
                    </p>
                    {dayReservations.length ? (
                      <div className="mt-3 space-y-2">
                        {dayReservations.map((reservation) => (
                          <div className="rounded-2xl border border-sky-400/20 bg-sky-500/10 p-3.5 shadow-[inset_0_1px_0_rgba(255,255,255,0.03)]" key={reservation.id}>
                            <div className="flex items-start gap-3">
                              <CheckCircle2 className="mt-0.5 shrink-0 text-sky-300" size={20} />
                              <div className="min-w-0">
                                <p className="font-semibold text-sky-50">Territorio #{reservation.territories?.number}</p>
                                <p className="mt-1 break-words text-sm text-sky-100/90">Salida: {reservation.departure_location}</p>
                              </div>
                            </div>
                            {!expired ? (
                              <div className="mt-3 flex gap-2 border-t border-sky-400/15 pt-3">
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
                      <p className="mt-3 text-sm text-slate-400">
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
  if (activeView === "dashboard") {
    return <AdminDashboard data={data} loadedAt={loadedAt} openRound={openRound} setModal={setModal} />;
  }

  if (activeView === "windows") {
    const elderGroupIds = new Set(data.profiles.filter((profile) => profile.role === "ANCIANO" && profile.active && profile.group_id).map((profile) => profile.group_id));
    return (
      <Panel title="Ventanas de reserva" description="Publica fechas, revisa cuántos territorios quedaron bloqueados y entra al bloqueo administrativo con un solo clic." action={<AddButton onClick={() => setModal({ type: "window" })}>Ventana</AddButton>}>
        <DataTable headers={["Ventana", "Fechas", "Limite", "Respuestas", "Estado", "Acciones"]}>
          {data.reservationWindows.map((window) => {
            const elderWindowReservations = data.reservations.filter((item) => item.reservation_window_id === window.id && item.status === "ACTIVE" && !item.reserved_by_admin);
            const adminWindowReservations = data.reservations.filter((item) => item.reservation_window_id === window.id && item.status === "ACTIVE" && item.reserved_by_admin);
            const expectedDates = [window.saturday_date, window.sunday_date].filter(Boolean).length;
            const expectedReservations = elderGroupIds.size * expectedDates;
            const expired = new Date(window.booking_deadline).getTime() < loadedAt;
            return (
              <tr key={window.id}>
                <Cell><strong>{window.name}</strong></Cell>
                <Cell>{[window.saturday_date, window.sunday_date].filter(Boolean).map((date) => displayDate(String(date))).join(" - ")}</Cell>
                <Cell>{displayDateTime(window.booking_deadline)}</Cell>
                <Cell>
                  <strong>{elderWindowReservations.length}/{expectedReservations}</strong> reservas
                  {adminWindowReservations.length ? <span className="mt-1 block text-xs text-slate-400">{adminWindowReservations.length} bloqueos admin</span> : null}
                </Cell>
                <Cell><Badge className={!window.active || expired ? "border-slate-500/30 bg-slate-500/10 text-slate-300" : "border-emerald-400/30 bg-emerald-500/12 text-emerald-200"}>{!window.active ? "Inactiva" : expired ? "Cerrada" : "Abierta"}</Badge></Cell>
                <Actions>
                  <IconButton label="Bloquear territorios" onClick={() => setModal({ type: "adminReservation", window })}><ShieldCheck size={16} /></IconButton>
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
    return <ReservationCollection data={data} blocked={false} setModal={setModal} mutate={mutate} />;
  }

  if (activeView === "blocks") {
    return <ReservationCollection data={data} blocked setModal={setModal} mutate={mutate} />;
  }

  if (activeView === "notifications") {
    return (
      <Panel
        title="Avisos"
        description="Confirmaciones recibidas al completar una reserva."
        action={data.notifications.some((item) => !item.read_at) ? <button className={secondaryButtonClass} onClick={() => void mutate("markNotificationRead")} type="button"><Check size={17} />Marcar leidos</button> : null}
      >
        <div className="divide-y divide-white/10">
          {data.notifications.map((notification) => (
            <div className="flex gap-3 py-4 first:pt-0 last:pb-0" key={notification.id}>
              <span className={cn("mt-0.5 inline-flex h-9 w-9 shrink-0 items-center justify-center rounded-xl border", notification.read_at ? "border-white/10 bg-slate-800 text-slate-400" : "border-sky-400/20 bg-sky-500/12 text-sky-300")}>
                <Bell size={17} />
              </span>
              <div className="min-w-0">
                <p className={cn("text-sm", !notification.read_at && "font-semibold")}>{notification.message}</p>
                <p className="mt-1 text-xs text-slate-400">{displayDateTime(notification.created_at)}</p>
              </div>
            </div>
          ))}
          {!data.notifications.length ? <p className="py-6 text-center text-sm text-slate-400">Todavia no hay avisos.</p> : null}
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
                  {!openRound ? <span className="mt-1 block text-xs text-slate-400">Sin vuelta abierta</span> : null}
                </Cell>
                <Cell>
                  {progress?.total_blocks ? (
                    <div className="min-w-40">
                      <div className="flex items-center gap-2">
                        <Badge className={completed ? "border-emerald-400/30 bg-emerald-500/12 text-emerald-200" : "border-sky-400/30 bg-sky-500/12 text-sky-200"}>
                          {completed ? "Completo" : `${progress.completed_blocks}/${progress.total_blocks}`}
                        </Badge>
                        <span className="text-xs text-slate-400">en {openRound?.name ?? "la vuelta"}</span>
                      </div>
                      {!completed && progress.completed_blocks > 0 ? <p className="mt-1 text-xs text-slate-400">Faltan {progress.pending_labels.join(", ")}</p> : null}
                    </div>
                  ) : (
                    <span className="text-sm text-slate-400">Sin manzanas</span>
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
            <tr key={round.id}><Cell>{round.year}</Cell><Cell><strong>{round.name}</strong></Cell><Cell><Badge className={round.status === "OPEN" ? "border-emerald-400/30 bg-emerald-500/12 text-emerald-200" : "border-slate-400/25 bg-slate-500/10 text-slate-300"}>{round.status === "OPEN" ? "Abierta" : "Cerrada"}</Badge></Cell><Cell>{data.blockStatuses.filter((item) => item.annual_round_id === round.id).length}</Cell><Actions><IconButton label="Editar" onClick={() => setModal({ type: "round", item: round })}><Edit3 size={16} /></IconButton><DeleteButton onClick={() => void mutate("deleteRow", { table: "annual_rounds", id: round.id })} /></Actions></tr>
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
            <Cell>{item.must_change_password ? <Badge className="border-amber-400/30 bg-amber-500/12 text-amber-200">Temporal</Badge> : <Badge className="border-emerald-400/30 bg-emerald-500/12 text-emerald-200">Activa</Badge>}</Cell>
            <Actions><IconButton label="Editar" onClick={() => setModal({ type: "user", item })}><Edit3 size={16} /></IconButton><IconButton label="Cambiar contrasena" onClick={() => setModal({ type: "password", item })}><KeyRound size={16} /></IconButton>{item.role !== "ADMIN" ? <DeleteButton onClick={() => void mutate("deleteUser", { id: item.id })} /> : null}</Actions>
          </tr>
        ))}
      </DataTable>
    </Panel>
  );
}

function ReservationCollection({
  data,
  blocked,
  setModal,
  mutate,
}: {
  data: AppData;
  blocked: boolean;
  setModal: (modal: ModalState) => void;
  mutate: (action: string, payload?: Record<string, unknown>) => Promise<unknown>;
}) {
  const relevantReservations = data.reservations.filter((reservation) => reservation.reserved_by_admin === blocked);
  const windows = [...data.reservationWindows]
    .filter((window) => relevantReservations.some((reservation) => reservation.reservation_window_id === window.id))
    .sort((a, b) => new Date(b.booking_deadline).getTime() - new Date(a.booking_deadline).getTime());

  if (!windows.length) {
    return (
      <EmptyState
        icon={blocked ? <ShieldCheck size={24} /> : <CalendarClock size={24} />}
        title={blocked ? "No hay bloqueos registrados" : "No hay reservas registradas"}
        text={blocked ? "Los territorios bloqueados administrativamente aparecerán agrupados por ventana." : "Las respuestas de los grupos aparecerán aquí, organizadas por ventana."}
      />
    );
  }

  return (
    <section className="space-y-4" aria-label={blocked ? "Bloqueos por ventana" : "Reservas por ventana"}>
      <div className="px-1">
        <h2 className="text-xl font-semibold tracking-tight text-white">{blocked ? "Bloqueos administrativos" : "Reservas de los grupos"}</h2>
        <p className="mt-1 text-sm text-slate-400">
          {blocked ? "Separados de las respuestas para revisar rápidamente qué territorios no están disponibles." : "Organizadas por ventana para leer el estado operativo sin recorrer una tabla extensa."}
        </p>
      </div>

      {windows.map((window) => {
        const windowReservations = relevantReservations
          .filter((reservation) => reservation.reservation_window_id === window.id)
          .sort((a, b) => a.service_date.localeCompare(b.service_date) || Number(a.territories?.number ?? 0) - Number(b.territories?.number ?? 0));
        return (
          <article className="glass-panel overflow-hidden rounded-[1.5rem]" key={window.id}>
            <div className="flex flex-col gap-3 border-b border-white/8 bg-white/[0.018] p-4 sm:flex-row sm:items-center sm:justify-between sm:p-5">
              <div>
                <div className="flex flex-wrap items-center gap-2">
                  <h3 className="font-semibold text-white">{window.name}</h3>
                  <Badge className="border-white/10 bg-white/[0.05] text-slate-300">{windowReservations.length} {windowReservations.length === 1 ? "registro" : "registros"}</Badge>
                </div>
                <p className="mt-1.5 text-xs text-slate-500">
                  {[window.saturday_date, window.sunday_date].filter(Boolean).map((date) => displayDate(String(date))).join(" · ") || "Sin fechas"}
                </p>
              </div>
              {blocked ? <button className={miniButtonClass} onClick={() => setModal({ type: "adminReservation", window })} type="button"><Plus size={15} />Agregar bloqueo</button> : null}
            </div>

            <div className="grid gap-3 p-3 sm:p-4 xl:grid-cols-2 2xl:grid-cols-3">
              {windowReservations.map((reservation) => {
                const territory = data.territories.find((item) => item.id === reservation.territory_id);
                return (
                  <article className={cn("group flex min-h-56 flex-col rounded-[1.25rem] border p-4 transition-colors duration-200", blocked ? "border-amber-400/15 bg-amber-500/[0.055] hover:border-amber-400/25" : "border-white/8 bg-white/[0.025] hover:border-white/14")} key={reservation.id}>
                    <div className="flex items-start justify-between gap-3">
                      <div>
                        <p className="text-xs font-medium text-slate-500">{serviceDayLabels[reservation.service_day]} · {displayDate(reservation.service_date)}</p>
                        <h4 className="mt-1 text-lg font-semibold text-white">Territorio #{reservation.territories?.number ?? territory?.number}</h4>
                      </div>
                      <Badge className={reservationStyles[reservation.status]}>{reservationStatusLabels[reservation.status]}</Badge>
                    </div>

                    <dl className="mt-4 grid grid-cols-2 gap-x-4 gap-y-3 text-sm">
                      {blocked ? (
                        <>
                          <div><dt className="text-xs text-slate-500">Tipo</dt><dd className="mt-1 text-slate-200">Bloqueo admin</dd></div>
                          <div><dt className="text-xs text-slate-500">Responsable</dt><dd className="mt-1 truncate text-slate-200">{reservation.profiles?.full_name ?? "Administración"}</dd></div>
                          {reservation.admin_note ? <div className="col-span-2"><dt className="text-xs text-slate-500">Nota</dt><dd className="mt-1 break-words text-slate-300">{reservation.admin_note}</dd></div> : null}
                        </>
                      ) : (
                        <>
                          <div><dt className="text-xs text-slate-500">Grupo</dt><dd className="mt-1 truncate text-slate-200">{reservation.groups?.name ?? "Sin grupo"}</dd></div>
                          <div><dt className="text-xs text-slate-500">Responsable</dt><dd className="mt-1 truncate text-slate-200">{reservation.profiles?.full_name ?? "-"}</dd></div>
                          <div className="col-span-2"><dt className="text-xs text-slate-500">Lugar de salida</dt><dd className="mt-1 break-words text-slate-300">{reservation.departure_location}</dd></div>
                        </>
                      )}
                    </dl>

                    <div className="mt-auto flex flex-wrap items-center gap-2 border-t border-white/8 pt-4">
                      <select
                        aria-label={`Estado del territorio ${reservation.territories?.number ?? territory?.number}`}
                        className={compactSelectClass + " mr-auto"}
                        value={reservation.status}
                        onChange={(event) => void mutate("updateReservationStatus", { id: reservation.id, status: event.target.value })}
                      >
                        {(["ACTIVE", "COMPLETED", "CANCELLED", "EXPIRED"] as ReservationStatus[]).map((status) => (
                          <option key={status} value={status}>{reservationStatusLabels[status]}</option>
                        ))}
                      </select>
                      {!blocked && territory ? (
                        <IconButton label={`Marcar manzanas del territorio ${territory.number}`} onClick={() => setModal({ type: "territoryBlocks", territory })}>
                          <Grid3X3 size={16} />
                        </IconButton>
                      ) : null}
                      <DeleteButton onClick={() => void mutate("deleteReservation", { id: reservation.id })} />
                    </div>
                  </article>
                );
              })}
            </div>
          </article>
        );
      })}
    </section>
  );
}

function getTerritoryCompletionHistory(data: AppData) {
  const blockTotals = new Map<string, number>();
  for (const block of data.blocks) {
    blockTotals.set(block.territory_id, (blockTotals.get(block.territory_id) ?? 0) + 1);
  }

  const grouped = new Map<string, {
    territoryId: string;
    roundId: string;
    territoryNumber: number | string;
    territoryName: string;
    completedBlocks: Set<string>;
    updatedAt: string;
  }>();

  for (const status of data.blockStatuses) {
    if (status.status !== "COMPLETED" || !status.blocks?.territory_id || !status.updated_at) continue;
    const territoryId = status.blocks.territory_id;
    const key = `${status.annual_round_id}:${territoryId}`;
    const current = grouped.get(key) ?? {
      territoryId,
      roundId: status.annual_round_id,
      territoryNumber: status.blocks.territories?.number ?? "?",
      territoryName: status.blocks.territories?.name ?? `Territorio ${status.blocks.territories?.number ?? ""}`.trim(),
      completedBlocks: new Set<string>(),
      updatedAt: status.updated_at,
    };
    current.completedBlocks.add(status.block_id);
    if (new Date(status.updated_at).getTime() > new Date(current.updatedAt).getTime()) current.updatedAt = status.updated_at;
    grouped.set(key, current);
  }

  const roundMap = new Map(data.rounds.map((round) => [round.id, round]));

  return [...grouped.values()]
    .filter((entry) => {
      const totalBlocks = blockTotals.get(entry.territoryId) ?? 0;
      return totalBlocks > 0 && entry.completedBlocks.size === totalBlocks;
    })
    .sort((a, b) => new Date(b.updatedAt).getTime() - new Date(a.updatedAt).getTime())
    .map((entry) => ({
      ...entry,
      round: roundMap.get(entry.roundId),
    }));
}

function AdminDashboard({
  data,
  loadedAt,
  openRound,
  setModal,
}: {
  data: AppData;
  loadedAt: number;
  openRound?: Round;
  setModal: (modal: ModalState) => void;
}) {
  const activeWindows = data.reservationWindows.filter((item) => item.active);
  const blockedReservations = data.reservations.filter((item) => item.reserved_by_admin && item.status === "ACTIVE");
  const answeredReservations = data.reservations.filter((item) => !item.reserved_by_admin && item.status === "ACTIVE");
  const completedTerritories = data.territoryProgress.filter((item) => item.total_blocks > 0 && item.completed_blocks === item.total_blocks).length;
  const territoriesWithBlocks = data.territoryProgress.filter((item) => item.total_blocks > 0).length;
  const territoriesInProgress = data.territoryProgress.filter((item) => item.completed_blocks > 0 && item.completed_blocks < item.total_blocks).length;
  const completionRate = territoriesWithBlocks ? Math.round((completedTerritories / territoriesWithBlocks) * 100) : 0;
  const respondingGroups = new Set(answeredReservations.map((item) => item.group_id).filter(Boolean)).size;
  const unreadNotifications = data.notifications.filter((item) => !item.read_at).length;
  const completionHistory = getTerritoryCompletionHistory(data).slice(0, 6);
  const windowsHistory = [...data.reservationWindows]
    .sort((a, b) => new Date(b.booking_deadline).getTime() - new Date(a.booking_deadline).getTime())
    .slice(0, 6);

  return (
    <div className="space-y-5">
      <section className="grid gap-3 sm:grid-cols-2 2xl:grid-cols-4">
        <Metric
          icon={<MapIcon size={20} />}
          label="Avance de la vuelta"
          value={`${completionRate}%`}
          detail={`${completedTerritories} completos · ${territoriesInProgress} en curso`}
          progress={completionRate}
          tone="sky"
        />
        <Metric
          icon={<CalendarDays size={20} />}
          label="Reservas activas"
          value={answeredReservations.length}
          detail={`${respondingGroups} ${respondingGroups === 1 ? "grupo respondió" : "grupos respondieron"}`}
          tone="emerald"
        />
        <Metric
          icon={<ShieldCheck size={20} />}
          label="Bloqueos vigentes"
          value={blockedReservations.length}
          detail={`${activeWindows.length} ${activeWindows.length === 1 ? "ventana activa" : "ventanas activas"}`}
          tone="amber"
        />
        <Metric
          icon={<Bell size={20} />}
          label="Avisos pendientes"
          value={unreadNotifications}
          detail={unreadNotifications ? "Requieren revisión" : "Todo está al día"}
          tone="rose"
        />
      </section>

      <section className="grid gap-5 xl:grid-cols-[1.25fr_0.95fr]">
        <Panel
          title="Ventanas recientes"
          description="Un vistazo rápido para entrar a bloquear, editar o revisar el estado de cada ventana."
        >
          <div className="grid gap-3 lg:grid-cols-2">
            {windowsHistory.map((window) => {
              const expired = new Date(window.booking_deadline).getTime() < loadedAt;
              const blocked = data.reservations.filter((item) => item.reservation_window_id === window.id && item.reserved_by_admin && item.status === "ACTIVE").length;
              const answered = data.reservations.filter((item) => item.reservation_window_id === window.id && !item.reserved_by_admin && item.status === "ACTIVE").length;
              const dates = [window.saturday_date, window.sunday_date].filter(Boolean).map((date) => displayDate(String(date))).join(" · ");
              return (
                <article className="rounded-[1.35rem] border border-white/8 bg-white/[0.02] p-4" key={window.id}>
                  <div className="flex items-start justify-between gap-3">
                    <div>
                      <p className="text-sm font-semibold text-white">{window.name}</p>
                      <p className="mt-1 text-sm text-slate-400">{dates || "Sin fechas"}</p>
                    </div>
                    <Badge className={!window.active || expired ? "border-slate-500/30 bg-slate-500/10 text-slate-300" : "border-emerald-400/30 bg-emerald-500/12 text-emerald-200"}>
                      {!window.active ? "Inactiva" : expired ? "Cerrada" : "Abierta"}
                    </Badge>
                  </div>
                  <div className="mt-4 grid grid-cols-2 gap-2 text-sm">
                    <DashboardKpi label="Ancianos" value={answered} />
                    <DashboardKpi label="Bloqueados" value={blocked} />
                  </div>
                  <p className="mt-4 text-xs uppercase tracking-[0.14em] text-slate-500">
                    Limite {displayDateTime(window.booking_deadline)}
                  </p>
                  <div className="mt-4 flex flex-wrap gap-2">
                    <button className={secondaryButtonClass} onClick={() => setModal({ type: "adminReservation", window })} type="button">
                      <ShieldCheck size={16} />Bloquear
                    </button>
                    <button className={secondaryButtonClass} onClick={() => setModal({ type: "window", item: window })} type="button">
                      <Edit3 size={16} />Editar
                    </button>
                  </div>
                </article>
              );
            })}
          </div>
        </Panel>

        <Panel
          title="Estado de la vuelta"
          description="Resumen breve del avance actual y de los últimos territorios completados."
        >
          <div className="rounded-[1.35rem] border border-white/8 bg-white/[0.02] p-4">
            <p className="text-sm font-medium text-slate-400">Vuelta abierta</p>
            <p className="mt-2 text-2xl font-semibold text-white">{openRound?.name ?? "Sin vuelta abierta"}</p>
            <div className="mt-4 grid grid-cols-2 gap-2">
              <DashboardKpi label="Ventanas activas" value={activeWindows.length} />
              <DashboardKpi label="Territorios completos" value={completedTerritories} />
            </div>
          </div>
          <div className="space-y-2">
            {completionHistory.length ? completionHistory.map((entry) => (
              <div className="rounded-2xl border border-white/8 bg-white/[0.02] px-4 py-3" key={`${entry.roundId}-${entry.territoryId}`}>
                <div className="flex items-start justify-between gap-3">
                  <div>
                    <p className="font-medium text-white">Territorio #{entry.territoryNumber}</p>
                    <p className="mt-1 text-sm text-slate-400">{entry.round?.name ?? "Vuelta"} · {displayDateTime(entry.updatedAt)}</p>
                  </div>
                  <Badge className="border-emerald-400/30 bg-emerald-500/12 text-emerald-200">Completo</Badge>
                </div>
              </div>
            )) : <p className="rounded-2xl border border-white/8 bg-white/[0.02] px-4 py-5 text-sm text-slate-400">Todavia no hay territorios completados registrados.</p>}
          </div>
        </Panel>
      </section>
    </div>
  );
}

function DashboardKpi({ label, value }: { label: string; value: number | string }) {
  return (
    <div className="rounded-xl border border-white/8 bg-black/20 px-3 py-2.5">
      <p className="text-[11px] uppercase tracking-[0.14em] text-slate-500">{label}</p>
      <p className="mt-1 text-lg font-semibold text-white">{value}</p>
    </div>
  );
}

function TerritoryChoiceList({
  territories,
  progressById,
  blockedIds,
  name,
  type,
  defaultValue,
  allowValue,
}: {
  territories: Territory[];
  progressById: Map<string, TerritoryProgress>;
  blockedIds: Set<string>;
  name: string;
  type: "checkbox" | "radio";
  defaultValue?: string;
  allowValue?: string;
}) {
  return (
    <div className="grid max-h-[22rem] gap-2 overflow-y-auto rounded-[1.35rem] border border-white/8 bg-black/20 p-2">
      {territories.map((territory) => {
        const progress = progressById.get(territory.id);
        const completed = Boolean(progress?.total_blocks && progress.completed_blocks === progress.total_blocks);
        const blocked = blockedIds.has(territory.id);
        const disabled = territory.id === allowValue ? false : blocked || completed;
        return (
          <label
            className={cn(
              "group flex cursor-pointer items-center gap-3 rounded-2xl border px-4 py-3 transition",
              disabled
                ? "cursor-not-allowed border-white/6 bg-white/[0.02] text-slate-500"
                : "border-white/8 bg-white/[0.03] text-slate-100 hover:border-white/14 hover:bg-white/[0.05]",
            )}
            key={territory.id}
          >
            <input
              className="h-4 w-4 accent-white"
              defaultChecked={defaultValue === territory.id}
              disabled={disabled}
              name={name}
              type={type}
              value={territory.id}
            />
            <div className="min-w-0">
              <p className="font-medium">{territorySelectionLabel(territory, progress)}</p>
              <p className="mt-1 text-xs text-slate-500">
                {completed ? "Territorio completado" : blocked ? "Ya reservado o bloqueado" : "Disponible"}
              </p>
            </div>
          </label>
        );
      })}
    </div>
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
    const progressById = new Map(data.territoryProgress.map((item) => [item.territory_id, item]));
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
            <TerritoryChoiceList
              blockedIds={new Set([...unavailable].filter((id) => id !== modal.item?.territory_id))}
              defaultValue={modal.item.territory_id}
              name="territory_id"
              progressById={progressById}
              territories={data.territories}
              type="radio"
              allowValue={modal.item.territory_id}
            />
          </Field>
        ) : (
          <fieldset>
            <legend className="text-sm font-medium text-slate-200">Territorios disponibles</legend>
            <p className="mt-2 text-sm text-slate-400">Selecciona uno o varios territorios para esta fecha. Los ya ocupados o completados quedan bloqueados automáticamente.</p>
            <div className="mt-3">
              <TerritoryChoiceList
                blockedIds={unavailable}
                name="territory_ids"
                progressById={progressById}
                territories={data.territories}
                type="checkbox"
              />
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
  if (modal.type === "password") {
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
  if (modal.type === "adminReservation") {
    const progressById = new Map(data.territoryProgress.map((item) => [item.territory_id, item]));
    const blockedInWindow = new Set(
      data.reservations
        .filter((item) => item.reservation_window_id === modal.window.id && item.status === "ACTIVE")
        .map((item) => item.territory_id),
    );
    const dates = [modal.window.saturday_date, modal.window.sunday_date].filter(Boolean) as string[];
    return (
      <FormModal title="Bloquear territorios" subtitle={`${modal.window.name} · el bloqueo aplicará a toda la ventana`} saving={saving} onSubmit={(event) => submitFromForm(event, "createAdminReservations", (form) => ({ reservation_window_id: modal.window.id, territory_ids: form.getAll("territory_ids") }))}>
        <div className="rounded-[1.35rem] border border-white/8 bg-white/[0.02] p-4">
          <p className="text-sm font-medium text-white">Fechas cubiertas</p>
          <div className="mt-3 flex flex-wrap gap-2">
            {dates.map((date) => <Badge className="border-white/10 bg-black/20 text-slate-300" key={date}>{displayDate(date)}</Badge>)}
          </div>
          <p className="mt-3 text-sm leading-6 text-slate-400">
            Estos territorios quedarán bloqueados para que ningún anciano los agregue en esta ventana. No se pedirá lugar de salida ni selección por día.
          </p>
        </div>
        <Field label="Territorios a bloquear">
          <TerritoryChoiceList
            blockedIds={blockedInWindow}
            name="territory_ids"
            progressById={progressById}
            territories={data.territories}
            type="checkbox"
          />
        </Field>
      </FormModal>
    );
  }
  return null;
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
        <p className="text-xs font-semibold uppercase tracking-[0.24em] text-sky-300/85">Manzanas</p>
        <h2 className="mt-2 text-xl font-semibold text-white">Territorio #{territory.number}</h2>
        <p className="mt-2 text-sm leading-6 text-slate-300">
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

      <div className="rounded-2xl border border-white/10 bg-white/[0.03] p-4 sm:flex sm:items-center sm:justify-between">
        <div>
          <p className="text-sm font-semibold text-white">{completedTotal}/{total || 0} completadas</p>
          <p className="mt-1 text-xs text-slate-400">{total > 0 && completedTotal === total ? "El territorio queda completo en esta vuelta." : "Toca cada manzana para marcarla o desmarcarla."}</p>
        </div>
        <div className="mt-3 flex flex-wrap gap-2 sm:mt-0">
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
                  "flex aspect-square min-h-20 cursor-pointer flex-col items-center justify-center rounded-2xl border text-sm font-semibold transition focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-sky-400",
                  selected ? "border-emerald-400/35 bg-emerald-500/12 text-emerald-100" : "border-white/10 bg-white/[0.03] text-slate-200 hover:border-sky-400/30 hover:bg-sky-500/8",
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
                  "flex aspect-square min-h-20 cursor-pointer flex-col items-center justify-center rounded-2xl border border-dashed text-sm font-semibold transition focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-sky-400",
                  selected ? "border-emerald-400/35 bg-emerald-500/12 text-emerald-100" : "border-sky-400/35 bg-sky-500/10 text-sky-100 hover:bg-sky-500/14",
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
        <div className="rounded-2xl border border-dashed border-white/12 bg-white/[0.03] px-4 py-8 text-center">
          <Grid3X3 className="mx-auto text-slate-500" size={28} />
          <p className="mt-3 text-sm font-medium text-slate-200">Este territorio todavia no tiene manzanas.</p>
          <button className={primarySmallButtonClass + " mt-4"} type="button" onClick={addBlock}><Plus size={16} />Agregar primera manzana</button>
        </div>
      )}

      <button className={primaryButtonClass} disabled={saving || !roundId} type="submit">
        {saving ? "Guardando..." : "Guardar avance"}
      </button>
    </form>
  );
}

const inputClass = "mt-1 min-h-11 w-full rounded-2xl border border-white/10 bg-black px-4 py-3 text-sm text-white outline-none transition placeholder:text-slate-600 focus:border-white/20 focus:ring-4 focus:ring-white/6 disabled:cursor-not-allowed disabled:bg-zinc-950 disabled:text-slate-600";
const primaryButtonClass = "inline-flex min-h-11 w-full cursor-pointer items-center justify-center gap-2 rounded-2xl border border-white/14 bg-white px-4 py-3 text-sm font-semibold text-black transition hover:-translate-y-0.5 hover:bg-zinc-200 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-white focus-visible:ring-offset-2 focus-visible:ring-offset-black disabled:cursor-not-allowed disabled:opacity-60";
const primarySmallButtonClass = "inline-flex min-h-11 cursor-pointer items-center justify-center gap-2 rounded-2xl border border-white/14 bg-white px-4 py-2.5 text-sm font-semibold text-black transition hover:-translate-y-0.5 hover:bg-zinc-200 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-white focus-visible:ring-offset-2 focus-visible:ring-offset-black disabled:cursor-not-allowed disabled:opacity-60";
const secondaryButtonClass = "inline-flex min-h-11 cursor-pointer items-center justify-center gap-2 rounded-2xl border border-white/10 bg-white/[0.04] px-4 py-2.5 text-sm font-semibold text-white transition hover:-translate-y-0.5 hover:border-white/18 hover:bg-white/[0.08] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-white/30";
const miniButtonClass = "inline-flex min-h-9 cursor-pointer items-center gap-2 rounded-xl border border-white/10 bg-white/[0.04] px-3 py-1.5 text-xs font-semibold text-white transition hover:border-white/18 hover:bg-white/[0.08] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-white/30";
const compactSelectClass = "min-h-10 cursor-pointer rounded-2xl border border-white/10 bg-black px-3 py-2 text-sm text-white outline-none transition focus:border-white/20 focus:ring-4 focus:ring-white/6 disabled:cursor-not-allowed disabled:bg-zinc-950";

function tabClass(active: boolean) {
  return cn("inline-flex min-h-11 w-auto shrink-0 cursor-pointer items-center gap-2 rounded-xl border px-3 py-2.5 text-sm font-medium transition-colors duration-200 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-white/30 lg:w-full", active ? "border-white/12 bg-white/[0.09] text-white" : "border-transparent bg-transparent text-slate-400 hover:bg-white/[0.045] hover:text-white");
}
function SmoothCursor() {
  const cursorRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!window.matchMedia("(pointer: fine)").matches || window.matchMedia("(prefers-reduced-motion: reduce)").matches) return;
    let frame = 0;
    let currentX = -100;
    let currentY = -100;
    let targetX = -100;
    let targetY = -100;

    const move = (event: PointerEvent) => {
      targetX = event.clientX;
      targetY = event.clientY;
      cursorRef.current?.classList.add("is-visible");
    };
    const hide = () => cursorRef.current?.classList.remove("is-visible");
    const animate = () => {
      currentX += (targetX - currentX) * 0.18;
      currentY += (targetY - currentY) * 0.18;
      if (cursorRef.current) cursorRef.current.style.transform = `translate3d(${currentX}px, ${currentY}px, 0) translate(-50%, -50%)`;
      frame = window.requestAnimationFrame(animate);
    };

    window.addEventListener("pointermove", move, { passive: true });
    document.documentElement.addEventListener("mouseleave", hide);
    frame = window.requestAnimationFrame(animate);
    return () => {
      window.removeEventListener("pointermove", move);
      document.documentElement.removeEventListener("mouseleave", hide);
      window.cancelAnimationFrame(frame);
    };
  }, []);

  return <div className="smooth-cursor" ref={cursorRef} aria-hidden="true" />;
}
function Field({ label, children }: { label: string; children: ReactNode }) {
  return <label className="block text-sm font-medium text-slate-200">{label}{children}</label>;
}
function Toast({ toast, onClose }: { toast: { type: "success" | "error"; text: string } | null; onClose: () => void }) {
  if (!toast) return null;
  const success = toast.type === "success";
  return (
    <div className={cn("toast-card glass-panel fixed bottom-4 left-4 z-[80] flex max-w-[calc(100vw-2rem)] items-start gap-3 overflow-hidden rounded-[1.25rem] border px-3.5 py-3.5 pr-11 shadow-2xl sm:left-auto sm:right-4 sm:w-[360px]", success ? "border-emerald-400/25" : "border-rose-400/25")} role={success ? "status" : "alert"}>
      <span className={cn("inline-flex h-10 w-10 shrink-0 items-center justify-center rounded-xl border", success ? "border-emerald-400/20 bg-emerald-500/12 text-emerald-300" : "border-rose-400/20 bg-rose-500/12 text-rose-300")}>
        {success ? <CheckCircle2 size={19} aria-hidden="true" /> : <TriangleAlert size={19} aria-hidden="true" />}
      </span>
      <div className="min-w-0 pt-0.5">
        <p className="text-sm font-semibold text-white">{success ? "Cambios aplicados" : "No se pudo completar"}</p>
        <p className="mt-1 text-sm leading-5 text-slate-400">{toast.text}</p>
      </div>
      <button className="absolute right-2.5 top-2.5 inline-flex h-8 w-8 cursor-pointer items-center justify-center rounded-lg text-slate-500 transition-colors hover:bg-white/[0.06] hover:text-white focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-white/30" onClick={onClose} type="button" aria-label="Cerrar aviso"><X size={15} /></button>
      <span className={cn("toast-progress absolute inset-x-0 bottom-0 h-0.5 origin-left", success ? "bg-emerald-400" : "bg-rose-400")} aria-hidden="true" />
    </div>
  );
}
function ConfirmationModal({
  confirmation,
  onCancel,
  onConfirm,
}: {
  confirmation: ConfirmationState;
  onCancel: () => void;
  onConfirm: () => void;
}) {
  if (!confirmation) return null;
  const destructive = confirmation.tone === "danger";
  return (
    <div className="modal-overlay fixed inset-0 z-[70] grid place-items-center bg-black/80 px-4 py-6 backdrop-blur-sm" onMouseDown={(event) => { if (event.target === event.currentTarget) onCancel(); }}>
      <div className={cn("modal-panel glass-panel w-full max-w-md rounded-[1.5rem] border", destructive ? "border-rose-400/25" : "border-sky-400/20")} role="alertdialog" aria-modal="true" aria-labelledby="confirmation-title" aria-describedby="confirmation-description">
        <div className="p-5 sm:p-6">
          <span className={cn("inline-flex h-12 w-12 items-center justify-center rounded-2xl border", destructive ? "border-rose-400/20 bg-rose-500/12 text-rose-300" : "border-sky-400/20 bg-sky-500/12 text-sky-300")}>
            {destructive ? <TriangleAlert size={22} aria-hidden="true" /> : <Save size={22} aria-hidden="true" />}
          </span>
          <h2 className="mt-5 text-xl font-semibold tracking-tight text-white" id="confirmation-title">{confirmation.title}</h2>
          <p className="mt-2 text-sm leading-6 text-slate-400" id="confirmation-description">{confirmation.description}</p>
          <div className="mt-6 grid gap-2 sm:grid-cols-2">
            <button className={secondaryButtonClass} onClick={onCancel} type="button">Cancelar</button>
            <button className={cn(primarySmallButtonClass, destructive && "border-rose-300/20 bg-rose-500 text-white hover:bg-rose-400")} onClick={onConfirm} type="button">{confirmation.confirmLabel}</button>
          </div>
        </div>
      </div>
    </div>
  );
}
function TemporaryPasswordModal({ password, onClose }: { password: string; onClose: () => void }) {
  const [closing, setClosing] = useState(false);
  useEffect(() => {
    if (password) {
      setClosing(false);
      void navigator.clipboard?.writeText(password);
    }
  }, [password]);
  const close = () => {
    if (closing) return;
    setClosing(true);
    window.setTimeout(onClose, 180);
  };
  if (!password) return null;
  return <div className={cn("modal-overlay fixed inset-0 z-50 grid place-items-center bg-slate-950/68 px-4 py-6 backdrop-blur-md", closing && "is-closing")}><div className="modal-panel glass-panel w-full max-w-md rounded-[1.5rem] border-emerald-400/20"><div className="border-b border-white/10 p-5"><h2 className="text-xl font-semibold text-white">Contrasena temporal</h2><p className="mt-2 text-sm leading-6 text-slate-300">Ya fue copiada al portapapeles.</p></div><div className="space-y-4 p-5"><div className="break-all rounded-2xl border border-emerald-400/25 bg-emerald-500/12 px-4 py-3 font-mono text-sm font-semibold text-emerald-100">{password}</div><div className="grid gap-2 sm:grid-cols-2"><button className={secondaryButtonClass} type="button" onClick={() => void navigator.clipboard?.writeText(password)}><Copy size={16} />Copiar</button><button className={primarySmallButtonClass} type="button" onClick={close}>Listo</button></div></div></div></div>;
}
function AddButton({ children, onClick }: { children: React.ReactNode; onClick: () => void }) {
  return <button className={primarySmallButtonClass} onClick={onClick} type="button"><Plus size={16} />{children}</button>;
}
function Metric({
  icon,
  label,
  value,
  detail,
  progress,
  tone,
}: {
  icon: React.ReactNode;
  label: string;
  value: number | string;
  detail: string;
  progress?: number;
  tone: "sky" | "emerald" | "amber" | "rose";
}) {
  const tones = {
    sky: "border-sky-400/20 bg-sky-500/10 text-sky-300",
    emerald: "border-emerald-400/20 bg-emerald-500/10 text-emerald-300",
    amber: "border-amber-400/20 bg-amber-500/10 text-amber-300",
    rose: "border-rose-400/20 bg-rose-500/10 text-rose-300",
  };
  const bars = { sky: "bg-sky-400", emerald: "bg-emerald-400", amber: "bg-amber-400", rose: "bg-rose-400" };
  return (
    <article className="glass-panel-soft floating-card rounded-[1.5rem] p-4">
      <div className="flex items-start justify-between gap-3">
        <span className={cn("inline-flex h-11 w-11 items-center justify-center rounded-2xl border", tones[tone])}>{icon}</span>
        <p className="text-3xl font-semibold tracking-tight text-white">{value}</p>
      </div>
      <p className="mt-4 text-sm font-semibold text-slate-200">{label}</p>
      <p className="mt-1 text-xs text-slate-500">{detail}</p>
      {typeof progress === "number" ? <div className="mt-4 h-1.5 overflow-hidden rounded-full bg-white/[0.06]"><div className={cn("h-full rounded-full transition-[width] duration-500", bars[tone])} style={{ width: `${Math.min(100, Math.max(0, progress))}%` }} /></div> : null}
    </article>
  );
}
function EmptyState({ icon, title, text }: { icon: React.ReactNode; title: string; text: string }) {
  return <section className="glass-panel rounded-[1.75rem] px-5 py-12 text-center"><span className="mx-auto inline-flex h-12 w-12 items-center justify-center rounded-2xl border border-white/10 bg-white/[0.04] text-white">{icon}</span><h2 className="mt-4 text-lg font-semibold text-white">{title}</h2><p className="mx-auto mt-2 max-w-md text-sm leading-6 text-slate-400">{text}</p></section>;
}
function Panel({ title, description, action, children }: { title: string; description: string; action?: React.ReactNode; children: React.ReactNode }) {
  return <section className="glass-panel rounded-[1.75rem]"><div className="flex flex-col gap-3 border-b border-white/10 p-5 sm:flex-row sm:items-center sm:justify-between"><div><h2 className="text-lg font-semibold text-white">{title}</h2><p className="mt-1 text-sm text-slate-300">{description}</p></div>{action}</div><div className="space-y-4 p-5">{children}</div></section>;
}
function DataTable({ headers, children }: { headers: string[]; children: React.ReactNode }) {
  return <div className="overflow-x-auto rounded-2xl border border-white/8 bg-black/10"><table className="w-full min-w-[760px] border-collapse text-left text-sm text-slate-200"><thead className="bg-white/[0.04] text-xs uppercase tracking-[0.12em] text-slate-400"><tr>{headers.map((header) => <th className="px-3 py-3 font-semibold" key={header}>{header}</th>)}</tr></thead><tbody className="divide-y divide-white/8">{children}</tbody></table></div>;
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
  return <button className="inline-flex min-h-9 cursor-pointer items-center justify-center rounded-xl border border-white/10 bg-white/[0.04] px-3 text-slate-200 transition hover:border-white/18 hover:bg-white/[0.08] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-white/30" onClick={onClick} type="button" aria-label={label} title={label}>{children}</button>;
}
function DeleteButton({ onClick, label = "Eliminar" }: { onClick: () => void; label?: string }) {
  return <button className="inline-flex min-h-9 cursor-pointer items-center justify-center rounded-xl border border-rose-400/20 bg-rose-500/10 px-3 text-rose-200 transition hover:bg-rose-500/15 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-rose-400" onClick={onClick} type="button" aria-label={label} title={label}><Trash2 size={16} aria-hidden="true" /></button>;
}
function ModalShell({ modal, onClose, children }: { modal: ModalState; onClose: () => void; children: React.ReactNode }) {
  const [closing, setClosing] = useState(false);
  useEffect(() => {
    if (modal) setClosing(false);
  }, [modal]);
  const close = () => {
    if (closing) return;
    setClosing(true);
    window.setTimeout(onClose, 180);
  };
  if (!modal) return null;
  return <div className={cn("modal-overlay fixed inset-0 z-40 grid place-items-center overflow-y-auto bg-black/78 px-4 py-6 backdrop-blur-sm", closing && "is-closing")} onMouseDown={(event) => { if (event.target === event.currentTarget) close(); }}><div className={cn("modal-panel glass-panel w-full rounded-[1.5rem]", modal.type === "territoryBlocks" ? "max-w-3xl" : "max-w-lg")} role="dialog" aria-modal="true"><div className="flex justify-end border-b border-white/10 p-3"><button className="inline-flex h-10 w-10 cursor-pointer items-center justify-center rounded-xl text-slate-400 transition-colors duration-200 hover:bg-white/[0.06] hover:text-white focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-white/30" onClick={close} type="button" aria-label="Cerrar"><X size={18} /></button></div>{children}</div></div>;
}
function FormModal({ title, subtitle, saving, onSubmit, children, hideSubmit = false }: { title: string; subtitle?: string; saving: boolean; onSubmit: (event: FormEvent<HTMLFormElement>) => void; children: React.ReactNode; hideSubmit?: boolean }) {
  return <form className="space-y-5 p-5 sm:p-6" onSubmit={onSubmit}><div><h2 className="text-xl font-semibold tracking-tight text-white">{title}</h2>{subtitle ? <p className="mt-1 text-sm text-slate-300">{subtitle}</p> : null}</div><div className="space-y-4">{children}</div>{!hideSubmit ? <button className={primaryButtonClass} disabled={saving} type="submit">{saving ? "Guardando..." : "Guardar"}</button> : null}</form>;
}
