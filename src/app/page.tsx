"use client";

/* eslint-disable react-hooks/set-state-in-effect */

import { FormEvent, useCallback, useEffect, useMemo, useRef, useState, type ReactNode } from "react";
import {
  Bell,
  CalendarClock,
  CalendarDays,
  Check,
  CheckCircle2,
  ChevronDown,
  ChevronUp,
  ClipboardList,
  Clock,
  Copy,
  Edit3,
  Grid3X3,
  KeyRound,
  Loader2,
  LogOut,
  Map as MapIcon,
  MapPin,
  Plus,
  RefreshCw,
  Save,
  Search,
  ShieldCheck,
  Star,
  Trash2,
  TriangleAlert,
  User,
  Users,
  Wand2,
  X,
} from "lucide-react";
import { startAuthentication } from "@simplewebauthn/browser";
import { AuthChoiceScreen } from "./_components/auth/auth-choice-screen";
import { ForcePasswordChangeScreen } from "./_components/auth/force-password-change-screen";
import { ForgotPasswordCard } from "./_components/auth/forgot-password-card";
import { LoginCard } from "./_components/auth/login-card";
import { OtpCard } from "./_components/auth/otp-card";
import { PasskeyPromptModal } from "./_components/auth/passkey-prompt-modal";
import { PendingApprovalScreen } from "./_components/auth/pending-approval-screen";
import { RegisterCard } from "./_components/auth/register-card";
import { ThemeToggle } from "./_components/theme-toggle";
import { compactSelectClass, inputClass, miniButtonClass, primaryButtonClass, primarySmallButtonClass, secondaryButtonClass, tabClass } from "./_components/ui-classes";
import {
  formatPendingBlocks,
  reservationStatusLabels,
  serviceDayLabels,
  type BlockStatus,
  type ReservationStatus,
  type Role,
  type ServiceDay,
} from "@/lib/domain";
import { cn } from "@/lib/utils";
import { BlockToggleGrid } from "./_components/block-toggle-grid";
import { Select } from "./_components/select";
import { ListToolbar, PaginationBar, useListControls } from "./_components/list-controls";

type Group = { id: string; name: string; active: boolean };
type Profile = {
  id: string;
  username: string;
  full_name: string;
  email: string | null;
  group_id: string | null;
  groups?: Pick<Group, "name"> | null;
  roles: Role[];
  active: boolean;
  must_change_password: boolean;
  approval_status: "pending" | "approved";
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
  last_completed_at?: string | null;
};
type Notification = {
  id: string;
  message: string;
  read_at: string | null;
  created_at: string;
  profiles?: Pick<Profile, "full_name" | "username"> | null;
};
type TerritoryRound = {
  id: string;
  territory_id: string;
  conductor_id: string;
  assigned_on: string;
  completed_on: string | null;
  pending_block_labels: string[];
  done_block_labels: string[];
  territories?: Pick<Territory, "number" | "name"> | null;
  profiles?: Pick<Profile, "full_name" | "username"> | null;
};
type TerritoryVisit = {
  id: string;
  territory_round_id: string;
  conductor_id: string;
  visit_date: string;
  done_labels: string[];
  pending_labels: string[];
  created_at: string;
  profiles?: Pick<Profile, "full_name" | "username"> | null;
  territory_rounds?: { territory_id: string; territories?: Pick<Territory, "number"> | null } | null;
};
type WeeklyOutingSlotTerritory = {
  id: string;
  slot_id: string;
  territory_id: string;
  territory_round_id: string | null;
  sort_order: number;
  display_override: string | null;
  territories?: Pick<Territory, "number"> | null;
  territory_rounds?: { pending_block_labels: string[]; conductor_id: string } | null;
};
type WeeklyOutingSlot = {
  id: string;
  weekly_outing_id: string;
  slot_date: string;
  sort_order: number;
  hora: string | null;
  lugar: string | null;
  conductor_id: string | null;
  highlighted: boolean;
  note: string | null;
  profiles?: Pick<Profile, "full_name" | "username"> | null;
  weekly_outing_slot_territories: WeeklyOutingSlotTerritory[];
};
type WeeklyOuting = {
  id: string;
  starts_on: string;
  weekly_outing_slots: WeeklyOutingSlot[];
};
type DeparturePoint = {
  id: string;
  name: string;
  address: string;
  departure_point_territories: {
    territory_id: string;
    sort_order: number;
    territories?: Pick<Territory, "number"> | null;
  }[];
};
type WeekendRosterEntry = {
  id: string;
  service_date: string;
  conductor_id: string;
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
  territoryRounds: TerritoryRound[];
  weeklyOutings: WeeklyOuting[];
  departurePoints: DeparturePoint[];
  weekendRoster: WeekendRosterEntry[];
  territoryVisits: TerritoryVisit[];
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
  | { type: "departurePoint"; item?: DeparturePoint }
  | { type: "territoryVisit"; item: TerritoryVisit }
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
  email: null,
  group_id: null,
  roles: [],
  active: false,
  must_change_password: false,
  approval_status: "approved",
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
  territoryRounds: [],
  weeklyOutings: [],
  departurePoints: [],
  weekendRoster: [],
  territoryVisits: [],
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
  const [authView, setAuthView] = useState<"choice" | "login" | "register" | "otp" | "forgot" | "pending">("choice");
  const [authError, setAuthError] = useState("");
  const [otpResent, setOtpResent] = useState(false);
  const [forgotSent, setForgotSent] = useState(false);
  const [showPasskeyPrompt, setShowPasskeyPrompt] = useState(false);
  const [hasPasskeyHint, setHasPasskeyHint] = useState(false);

  useEffect(() => {
    setHasPasskeyHint(document.cookie.includes("terris_has_passkey=1"));
  }, []);

  const isAdmin = Boolean(profile?.roles.includes("ADMIN"));
  const isAnciano = Boolean(profile?.roles.includes("ANCIANO"));
  const isConductor = Boolean(profile?.roles.includes("CONDUCTOR"));
  const openRound = data.rounds.find((round) => round.status === "OPEN");

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

  async function handleLoginSubmit(username: string, password: string, deviceSecure: boolean) {
    setSaving(true);
    setAuthError("");
    try {
      const result = await requestJson("/api/auth/login", {
        method: "POST",
        body: JSON.stringify({ username, password, deviceSecure }),
      });
      if (result.status === "otp") {
        setAuthView("otp");
        setOtpResent(false);
        return;
      }
      if (result.status === "pending") {
        setAuthView("pending");
        return;
      }
      await loadData({ throwOnError: true });
      setActiveView("windows");
      setToast({ type: "success", text: "Sesion iniciada." });
      if (result.offerPasskey) setShowPasskeyPrompt(true);
    } catch (error) {
      setAuthError(error instanceof Error ? error.message : "No se pudo ingresar.");
    } finally {
      setSaving(false);
    }
  }

  async function handleOtpSubmit(code: string) {
    setSaving(true);
    setAuthError("");
    try {
      await requestJson("/api/auth/verify-otp", { method: "POST", body: JSON.stringify({ code }) });
      await loadData({ throwOnError: true });
      setActiveView("windows");
      setAuthView("login");
      setToast({ type: "success", text: "Sesion iniciada." });
    } catch (error) {
      setAuthError(error instanceof Error ? error.message : "Codigo incorrecto.");
    } finally {
      setSaving(false);
    }
  }

  async function handleResendOtp() {
    setAuthError("");
    try {
      await requestJson("/api/auth/resend-otp", { method: "POST", body: "{}" });
      setOtpResent(true);
    } catch (error) {
      setAuthError(error instanceof Error ? error.message : "No se pudo reenviar el codigo.");
    }
  }

  async function handleForgotPassword(usernameOrEmail: string) {
    setSaving(true);
    try {
      await requestJson("/api/auth/forgot-password", { method: "POST", body: JSON.stringify({ usernameOrEmail }) });
      setForgotSent(true);
    } finally {
      setSaving(false);
    }
  }

  async function handleRegisterSubmit(username: string, fullName: string, email: string, password: string) {
    setSaving(true);
    setAuthError("");
    try {
      await requestJson("/api/auth/register", {
        method: "POST",
        body: JSON.stringify({ username, full_name: fullName, email, password }),
      });
      setAuthView("pending");
    } catch (error) {
      setAuthError(error instanceof Error ? error.message : "No se pudo crear la cuenta.");
    } finally {
      setSaving(false);
    }
  }

  async function handleChangePasswordDone() {
    await loadData({ throwOnError: true });
  }

  async function handlePasskeyLogin() {
    setAuthError("");
    try {
      const optionsJSON = await requestJson("/api/auth/passkey/login-options", { method: "POST", body: "{}" });
      const assertion = await startAuthentication({ optionsJSON });
      await requestJson("/api/auth/passkey/login-verify", { method: "POST", body: JSON.stringify(assertion) });
      await loadData({ throwOnError: true });
      setActiveView("windows");
      setToast({ type: "success", text: "Sesion iniciada." });
    } catch (error) {
      setAuthError(error instanceof Error ? error.message : "No se pudo ingresar con la llave de acceso.");
    }
  }

  async function logout() {
    await requestJson("/api/auth/logout", { method: "POST", body: "{}" });
    setProfile(null);
    setData(emptyData);
    setAuthView("choice");
    setAuthError("");
  }

  const silentActions = new Set([
    "markNotificationRead",
    "createWeeklyOuting",
    "createWeeklyOutingSlot",
    "updateWeeklyOutingSlot",
    "setSlotTerritories",
    "autoFillWeeklyOuting",
    "upsertWeekendRoster",
  ]);

  function requestConfirmation(action: string) {
    if (silentActions.has(action)) return Promise.resolve(true);
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
      <>
        <Toast toast={toast} onClose={() => setToast(null)} />
        {authView === "register" ? (
          <RegisterCard
            error={authError}
            loading={saving}
            onBack={() => {
              setAuthView("choice");
              setAuthError("");
            }}
            onLogin={() => {
              setAuthView("login");
              setAuthError("");
            }}
            onSubmit={handleRegisterSubmit}
          />
        ) : authView === "pending" ? (
          <PendingApprovalScreen onBack={() => setAuthView("choice")} />
        ) : authView === "otp" ? (
          <OtpCard
            error={authError}
            loading={saving}
            onBack={() => {
              setAuthView("login");
              setAuthError("");
            }}
            onResend={handleResendOtp}
            onSubmit={handleOtpSubmit}
            resent={otpResent}
          />
        ) : authView === "forgot" ? (
          <ForgotPasswordCard
            loading={saving}
            onBack={() => {
              setAuthView("login");
              setForgotSent(false);
            }}
            onSubmit={handleForgotPassword}
            sent={forgotSent}
          />
        ) : authView === "login" ? (
          <LoginCard
            error={authError}
            hasPasskeyHint={hasPasskeyHint}
            loading={saving || loading}
            onBack={() => {
              setAuthView("choice");
              setAuthError("");
            }}
            onForgotPassword={() => {
              setAuthView("forgot");
              setAuthError("");
            }}
            onPasskeyLogin={handlePasskeyLogin}
            onRegister={() => {
              setAuthView("register");
              setAuthError("");
            }}
            onSubmit={handleLoginSubmit}
          />
        ) : (
          <AuthChoiceScreen onLogin={() => setAuthView("login")} onRegister={() => setAuthView("register")} />
        )}
        {showPasskeyPrompt ? <PasskeyPromptModal onClose={() => setShowPasskeyPrompt(false)} /> : null}
      </>
    );
  }

  if (profile.must_change_password) {
    return <ForcePasswordChangeScreen onDone={handleChangePasswordDone} onLogout={logout} />;
  }

  return (
    <main className="relative z-10 min-h-screen text-foreground">
      <SmoothCursor />
      <Toast toast={toast} onClose={() => setToast(null)} />
      <div className="mx-auto flex w-full max-w-[1540px] flex-col gap-4 px-3 py-3 sm:px-5 sm:py-5 lg:px-6">
        {isAdmin ? (
          <div className="grid items-start gap-4 lg:grid-cols-[232px_minmax(0,1fr)]">
            <AdminNav
              activeView={activeView}
              onChange={setActiveView}
            />
            <div className="min-w-0 space-y-3">
              <AdminTopbar
                activeView={activeView}
                currentUser={profile}
                data={data}
                mutate={mutate}
                onLogout={logout}
                setActiveView={setActiveView}
                setModal={setModal}
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
        ) : isAnciano && isConductor ? (
          <>
            <header className="glass-panel flex flex-col gap-4 rounded-[1.75rem] p-5 lg:flex-row lg:items-center lg:justify-between">
              <div>
                <p className="text-[11px] font-semibold uppercase tracking-[0.24em] text-muted">PR Territorios</p>
                <h1 className="mt-2 text-2xl font-semibold tracking-tight text-foreground sm:text-3xl">{profile.full_name}</h1>
                <div className="mt-3 flex gap-2">
                  <button className={tabClass(activeView !== "conductorVisit")} onClick={() => setActiveView("reservations")} type="button">Reservas</button>
                  <button className={tabClass(activeView === "conductorVisit")} onClick={() => setActiveView("conductorVisit")} type="button">Actualizar territorio</button>
                </div>
              </div>
              <div className="flex flex-wrap gap-2">
                <ThemeToggle />
                <button className={secondaryButtonClass} onClick={() => void loadData()} type="button">
                  <RefreshCw size={18} aria-hidden="true" />Actualizar
                </button>
                <button className={secondaryButtonClass} onClick={logout} type="button">
                  <LogOut size={18} aria-hidden="true" />Salir
                </button>
              </div>
            </header>
            {activeView === "conductorVisit" ? (
              <ConductorVisitForm data={data} mutate={mutate} />
            ) : (
              <ElderReservations data={data} loadedAt={loadedAt} setModal={setModal} mutate={mutate} />
            )}
          </>
        ) : isConductor ? (
          <>
            <header className="glass-panel flex flex-col gap-4 rounded-[1.75rem] p-5 lg:flex-row lg:items-center lg:justify-between">
              <div>
                <p className="text-[11px] font-semibold uppercase tracking-[0.24em] text-muted">PR Territorios</p>
                <h1 className="mt-2 text-2xl font-semibold tracking-tight text-foreground sm:text-3xl">Actualizar territorio</h1>
                <p className="mt-2 text-sm text-muted">{profile.full_name}</p>
              </div>
              <div className="flex flex-wrap gap-2">
                <ThemeToggle />
                <button className={secondaryButtonClass} onClick={() => void loadData()} type="button">
                  <RefreshCw size={18} aria-hidden="true" />Actualizar
                </button>
                <button className={secondaryButtonClass} onClick={logout} type="button">
                  <LogOut size={18} aria-hidden="true" />Salir
                </button>
              </div>
            </header>
            <ConductorVisitForm data={data} mutate={mutate} />
          </>
        ) : isAnciano ? (
          <>
            <header className="glass-panel flex flex-col gap-4 rounded-[1.75rem] p-5 lg:flex-row lg:items-center lg:justify-between">
              <div>
                <p className="text-[11px] font-semibold uppercase tracking-[0.24em] text-muted">PR Territorios</p>
                <h1 className="mt-2 text-2xl font-semibold tracking-tight text-foreground sm:text-3xl">Reservas de mi grupo</h1>
                <p className="mt-2 text-sm text-muted">
                  {profile.full_name} - {data.groups[0]?.name ?? "Sin grupo asignado"}
                </p>
              </div>
              <div className="flex flex-wrap gap-2">
                <ThemeToggle />
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
        ) : (
          <>
            <header className="glass-panel flex flex-col gap-4 rounded-[1.75rem] p-5 lg:flex-row lg:items-center lg:justify-between">
              <div>
                <p className="text-[11px] font-semibold uppercase tracking-[0.24em] text-muted">PR Territorios</p>
                <p className="mt-2 text-sm text-muted">{profile.full_name}</p>
              </div>
              <div className="flex flex-wrap gap-2">
                <ThemeToggle />
                <button className={secondaryButtonClass} onClick={logout} type="button">
                  <LogOut size={18} aria-hidden="true" />Salir
                </button>
              </div>
            </header>
            <EmptyState icon={<ShieldCheck size={24} />} title="No tenes secciones asignadas" text="Contacta al administrador para que te asigne un rol." />
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
  onChange,
}: {
  activeView: string;
  onChange: (view: string) => void;
}) {
  const tabGroups: Array<{ label: string; items: Array<{ id: string; label: string; icon: ReactNode }> }> = [
    { label: "", items: [{ id: "dashboard", label: "Resumen", icon: <ShieldCheck size={17} /> }] },
    {
      label: "Territorios",
      items: [
        { id: "outings", label: "Salidas semanales", icon: <CalendarDays size={17} /> },
        { id: "weekendRoster", label: "Conductores de fin de semana", icon: <Users size={17} /> },
        { id: "territories", label: "Territorios", icon: <MapIcon size={17} /> },
        { id: "rounds", label: "Vueltas", icon: <Grid3X3 size={17} /> },
        { id: "departurePoints", label: "Puntos de salida", icon: <MapPin size={17} /> },
      ],
    },
    {
      label: "Reservas",
      items: [
        { id: "windows", label: "Ventanas", icon: <CalendarDays size={17} /> },
        { id: "reservations", label: "Reservas", icon: <CalendarClock size={17} /> },
        { id: "blocks", label: "Bloqueos", icon: <ShieldCheck size={17} /> },
      ],
    },
    {
      label: "Cuentas",
      items: [
        { id: "groups", label: "Grupos", icon: <Users size={17} /> },
        { id: "users", label: "Usuarios", icon: <KeyRound size={17} /> },
      ],
    },
    {
      label: "Conductores",
      items: [
        { id: "conductorVisit", label: "Actualizar territorio", icon: <MapIcon size={17} /> },
        { id: "s13", label: "Registro S-13", icon: <ClipboardList size={17} /> },
      ],
    },
  ];

  return (
    <aside className="admin-sidebar glass-panel flex min-w-0 flex-col gap-3 rounded-2xl p-3 lg:sticky lg:top-4 lg:h-[calc(100vh-2rem)]" aria-label="Administracion">
      <div className="flex shrink-0 items-center gap-3 px-2 py-2">
        <span className="inline-flex h-10 w-10 shrink-0 items-center justify-center rounded-2xl border border-border bg-foreground/[0.04] p-1.5">
          <img alt="PR Territorios" className="h-full w-full object-contain" src="/PR.svg" />
        </span>
        <div className="min-w-0">
          <p className="truncate text-sm font-semibold text-foreground">PR Territorios</p>
          <p className="truncate text-xs text-muted">Administración</p>
        </div>
      </div>

      <nav className="scrollbar-hidden flex gap-1 overflow-x-auto pb-1 lg:min-h-0 lg:flex-1 lg:flex-col lg:gap-3 lg:overflow-y-auto lg:pb-0" aria-label="Secciones">
        {tabGroups.map((group, index) => (
          <div className="shrink-0 lg:space-y-1" key={group.label || `group-${index}`}>
            {group.label ? <p className="hidden px-3 pb-1 text-[10px] font-semibold uppercase tracking-[0.14em] text-muted lg:block">{group.label}</p> : null}
            {group.items.map(({ id, label, icon }) => (
              <button key={id} className={tabClass(activeView === id)} onClick={() => onChange(id)} type="button" aria-current={activeView === id ? "page" : undefined}>
                <span className="shrink-0">{icon}</span>
                <span className="whitespace-nowrap">{label}</span>
              </button>
            ))}
          </div>
        ))}
      </nav>
    </aside>
  );
}

function AdminTopbar({
  activeView,
  currentUser,
  data,
  mutate,
  onLogout,
  setActiveView,
  setModal,
}: {
  activeView: string;
  currentUser: Profile;
  data: AppData;
  mutate: (action: string, payload?: Record<string, unknown>) => Promise<unknown>;
  onLogout: () => void;
  setActiveView: (view: string) => void;
  setModal: (modal: ModalState) => void;
}) {
  const sectionLabels: Record<string, string> = {
    dashboard: "Resumen",
    windows: "Ventanas",
    reservations: "Reservas",
    blocks: "Bloqueos",
    territories: "Territorios",
    rounds: "Vueltas",
    outings: "Salidas semanales",
    weekendRoster: "Conductores de fin de semana",
    departurePoints: "Puntos de salida",
    groups: "Grupos",
    users: "Usuarios",
    conductorVisit: "Actualizar territorio",
    s13: "Registro S-13",
  };
  return (
    <header className="glass-panel flex min-h-16 flex-wrap items-center gap-3 rounded-[1.35rem] px-3 py-2.5 sm:px-4">
      <h1 className="truncate text-lg font-semibold tracking-tight text-foreground">{sectionLabels[activeView] ?? "Administración"}</h1>
      <div className="ml-auto flex min-w-0 flex-1 items-center justify-end gap-2 sm:flex-none">
        <TopbarSearch data={data} setActiveView={setActiveView} setModal={setModal} />
        <ThemeToggle />
        <NotificationsBell data={data} mutate={mutate} />
        <AccountMenu currentUser={currentUser} onLogout={onLogout} />
      </div>
    </header>
  );
}

type SearchResult = { id: string; type: string; label: string; sublabel?: string; onSelect: () => void };

function TopbarSearch({
  data,
  setActiveView,
  setModal,
}: {
  data: AppData;
  setActiveView: (view: string) => void;
  setModal: (modal: ModalState) => void;
}) {
  const [query, setQuery] = useState("");
  const [open, setOpen] = useState(false);

  const results = useMemo<SearchResult[]>(() => {
    const term = query.trim().toLowerCase();
    if (!term) return [];
    const matches: SearchResult[] = [];

    for (const territory of data.territories) {
      if (!`territorio ${territory.number}`.includes(term)) continue;
      matches.push({
        id: `territory:${territory.id}`,
        type: "Territorio",
        label: `Territorio #${territory.number}`,
        onSelect: () => {
          setActiveView("territories");
          setModal({ type: "territoryBlocks", territory });
        },
      });
    }
    for (const item of data.profiles) {
      if (!item.full_name.toLowerCase().includes(term) && !item.username.toLowerCase().includes(term)) continue;
      matches.push({
        id: `user:${item.id}`,
        type: "Usuario",
        label: item.full_name,
        sublabel: `@${item.username}`,
        onSelect: () => setActiveView("users"),
      });
    }
    for (const window of data.reservationWindows) {
      if (!window.name.toLowerCase().includes(term)) continue;
      matches.push({
        id: `window:${window.id}`,
        type: "Ventana",
        label: window.name,
        onSelect: () => setActiveView("windows"),
      });
    }
    for (const group of data.groups) {
      if (!group.name.toLowerCase().includes(term)) continue;
      matches.push({
        id: `group:${group.id}`,
        type: "Grupo",
        label: group.name,
        onSelect: () => setActiveView("groups"),
      });
    }

    return matches.slice(0, 8);
  }, [data.groups, data.profiles, data.reservationWindows, data.territories, query, setActiveView, setModal]);

  function select(result: SearchResult) {
    result.onSelect();
    setQuery("");
    setOpen(false);
  }

  return (
    <div className="relative min-w-0 flex-1 sm:w-64 sm:flex-none">
      <Search className="pointer-events-none absolute left-3 top-1/2 -translate-y-1/2 text-slate-500" size={16} aria-hidden="true" />
      <input
        className="h-10 w-full rounded-xl border border-white/10 bg-black/25 pl-9 pr-3 text-sm text-white outline-none transition placeholder:text-slate-600 focus:border-primary/50 focus:ring-4 focus:ring-primary/10"
        onChange={(event) => { setQuery(event.target.value); setOpen(true); }}
        onFocus={() => setOpen(true)}
        placeholder="Buscar territorio, usuario, ventana..."
        type="text"
        value={query}
      />
      {open && query.trim() ? (
        <>
          <div className="fixed inset-0 z-40" onClick={() => setOpen(false)} />
          <div className="absolute left-0 top-full z-50 mt-2 w-full min-w-[280px] overflow-hidden rounded-[1.1rem] border border-white/10 bg-[#0c1615] shadow-2xl">
            {results.length ? (
              <div className="max-h-[60vh] divide-y divide-white/8 overflow-y-auto">
                {results.map((result) => (
                  <button className="flex w-full items-center justify-between gap-3 px-4 py-2.5 text-left transition hover:bg-white/[0.05]" key={result.id} onClick={() => select(result)} type="button">
                    <span className="min-w-0">
                      <span className="block truncate text-sm font-medium text-white">{result.label}</span>
                      {result.sublabel ? <span className="block truncate text-xs text-slate-500">{result.sublabel}</span> : null}
                    </span>
                    <span className="shrink-0 text-[10px] font-semibold uppercase tracking-[0.1em] text-slate-500">{result.type}</span>
                  </button>
                ))}
              </div>
            ) : (
              <p className="px-4 py-4 text-center text-sm text-slate-400">Sin resultados.</p>
            )}
          </div>
        </>
      ) : null}
    </div>
  );
}

function NotificationsBell({
  data,
  mutate,
}: {
  data: AppData;
  mutate: (action: string, payload?: Record<string, unknown>) => Promise<unknown>;
}) {
  const [open, setOpen] = useState(false);
  const notifications = data.notifications;
  const unread = notifications.filter((item) => !item.read_at);

  return (
    <div className="relative shrink-0">
      <button
        className={cn(
          "relative inline-flex h-10 w-10 shrink-0 cursor-pointer items-center justify-center rounded-2xl border transition-colors duration-200 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-white/30",
          open
            ? "border-sky-400/30 bg-sky-500/15 text-sky-200"
            : "border-white/10 bg-white/[0.04] text-slate-300 hover:bg-white/[0.08] hover:text-white",
        )}
        onClick={() => setOpen((current) => !current)}
        type="button"
        aria-expanded={open}
        aria-label={unread.length ? `Avisos, ${unread.length} sin leer` : "Avisos"}
      >
        <Bell size={17} aria-hidden="true" />
        {unread.length ? <span className="absolute -right-1 -top-1 min-w-5 rounded-full border-2 border-black bg-sky-400 px-1 text-center text-[10px] font-bold leading-4 text-slate-950">{unread.length > 99 ? "99+" : unread.length}</span> : null}
      </button>
      {open ? (
        <>
          <div className="fixed inset-0 z-40" onClick={() => setOpen(false)} />
          <div className="absolute right-0 top-full z-50 mt-2 w-[min(92vw,380px)] overflow-hidden rounded-[1.35rem] border border-white/10 bg-[#0c1615] shadow-2xl">
            <div className="flex items-center justify-between gap-3 border-b border-white/10 px-4 py-3">
              <p className="text-sm font-semibold text-white">Avisos</p>
              {unread.length ? (
                <button className="text-xs font-semibold text-primary hover:text-primary-hover" onClick={() => void mutate("markNotificationRead")} type="button">
                  Marcar todos
                </button>
              ) : null}
            </div>
            <div className="max-h-[60vh] divide-y divide-white/8 overflow-y-auto">
              {notifications.length ? notifications.map((notification) => (
                <button
                  className="flex w-full items-start gap-3 px-4 py-3 text-left transition hover:bg-white/[0.03]"
                  key={notification.id}
                  onClick={() => (!notification.read_at ? void mutate("markNotificationRead", { id: notification.id }) : undefined)}
                  type="button"
                >
                  <span className={cn("mt-0.5 inline-flex h-2.5 w-2.5 shrink-0 rounded-full", notification.read_at ? "bg-transparent" : "bg-sky-400")} aria-hidden="true" />
                  <span className="min-w-0">
                    <span className={cn("block text-sm", !notification.read_at && "font-semibold text-white")}>{notification.message}</span>
                    <span className="mt-1 block text-xs text-slate-500">{displayDateTime(notification.created_at)}</span>
                  </span>
                </button>
              )) : (
                <p className="px-4 py-6 text-center text-sm text-slate-400">Todavia no hay avisos.</p>
              )}
            </div>
          </div>
        </>
      ) : null}
    </div>
  );
}

function AccountMenu({
  currentUser,
  onLogout,
}: {
  currentUser: Profile;
  onLogout: () => void;
}) {
  const [open, setOpen] = useState(false);
  const initials = currentUser.full_name
    .split(" ")
    .slice(0, 2)
    .map((part) => part[0])
    .join("")
    .toUpperCase();

  return (
    <div className="relative shrink-0">
      <button
        className={cn(
          "inline-flex h-10 w-10 shrink-0 cursor-pointer items-center justify-center rounded-2xl border text-xs font-bold text-white transition-colors duration-200 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-white/30",
          open ? "border-primary/40 bg-primary/15" : "border-white/10 bg-white/[0.08] hover:bg-white/[0.12]",
        )}
        onClick={() => setOpen((current) => !current)}
        type="button"
        aria-expanded={open}
        aria-label="Cuenta"
      >
        {initials}
      </button>
      {open ? (
        <>
          <div className="fixed inset-0 z-40" onClick={() => setOpen(false)} />
          <div className="absolute right-0 top-full z-50 mt-2 w-[min(88vw,260px)] overflow-hidden rounded-[1.25rem] border border-white/10 bg-[#0c1615] shadow-2xl">
            <div className="border-b border-white/10 px-4 py-3">
              <p className="truncate text-sm font-semibold text-white">{currentUser.full_name}</p>
              <p className="truncate text-xs text-slate-500">@{currentUser.username}</p>
            </div>
            <button className="flex w-full items-center gap-2.5 px-4 py-3 text-left text-sm text-slate-200 transition hover:bg-white/[0.05]" onClick={onLogout} type="button">
              <LogOut size={16} aria-hidden="true" />Cerrar sesión
            </button>
          </div>
        </>
      ) : null}
    </div>
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
    return <AdminDashboard data={data} />;
  }

  if (activeView === "windows") {
    return <WindowsPanel data={data} loadedAt={loadedAt} mutate={mutate} setModal={setModal} />;
  }

  if (activeView === "reservations") {
    return <ReservationCollection data={data} blocked={false} setModal={setModal} mutate={mutate} />;
  }

  if (activeView === "blocks") {
    return <ReservationCollection data={data} blocked setModal={setModal} mutate={mutate} />;
  }

  if (activeView === "territories") {
    return <TerritoriesPanel data={data} openRound={openRound} mutate={mutate} setModal={setModal} />;
  }

  if (activeView === "rounds") {
    return <RoundsPanel data={data} mutate={mutate} setModal={setModal} />;
  }

  if (activeView === "outings") {
    return <WeeklyOutingsPanel data={data} mutate={mutate} />;
  }

  if (activeView === "weekendRoster") {
    return <WeekendRosterPanel data={data} mutate={mutate} />;
  }

  if (activeView === "departurePoints") {
    return <DeparturePointsPanel data={data} mutate={mutate} setModal={setModal} />;
  }

  if (activeView === "conductorVisit") {
    return <ConductorVisitForm data={data} mutate={mutate} />;
  }

  if (activeView === "s13") {
    return <S13Panel data={data} mutate={mutate} setModal={setModal} />;
  }

  if (activeView === "groups") {
    return <GroupsPanel data={data} mutate={mutate} setModal={setModal} />;
  }

  return <UsersPanel data={data} mutate={mutate} setModal={setModal} />;
}

function WindowsPanel({
  data,
  loadedAt,
  mutate,
  setModal,
}: {
  data: AppData;
  loadedAt: number;
  mutate: (action: string, payload?: Record<string, unknown>) => Promise<unknown>;
  setModal: (modal: ModalState) => void;
}) {
  const elderGroupIds = new Set(data.profiles.filter((profile) => profile.roles.includes("ANCIANO") && profile.active && profile.group_id).map((profile) => profile.group_id));
  const controls = useListControls({
    items: data.reservationWindows,
    searchText: (window) => window.name,
    dateValue: (window) => window.saturday_date ?? window.sunday_date,
  });

  return (
    <Panel title="Ventanas de reserva" description="Publica fechas, revisa cuántos territorios quedaron bloqueados y entra al bloqueo administrativo con un solo clic." action={<AddButton onClick={() => setModal({ type: "window" })}>Ventana</AddButton>}>
      <ListToolbar onQueryChange={controls.setQuery} placeholder="Buscar ventana..." query={controls.query} showDateFilter dateFrom={controls.dateFrom} dateTo={controls.dateTo} onDateFromChange={controls.setDateFrom} onDateToChange={controls.setDateTo} onQuickRange={controls.setQuickRange} />
      <DataTable headers={["Ventana", "Fechas", "Limite", "Respuestas", "Estado", "Acciones"]}>
        {controls.paged.map((window) => {
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
      <PaginationBar page={controls.page} pageSize={controls.pageSize} total={controls.total} totalPages={controls.totalPages} onPageChange={controls.setPage} />
    </Panel>
  );
}

function TerritoriesPanel({
  data,
  openRound,
  mutate,
  setModal,
}: {
  data: AppData;
  openRound?: Round;
  mutate: (action: string, payload?: Record<string, unknown>) => Promise<unknown>;
  setModal: (modal: ModalState) => void;
}) {
  const controls = useListControls({
    items: data.territories,
    searchText: (territory) => `territorio ${territory.number}`,
  });

  return (
    <Panel title="Territorios" description="Cada territorio reúne sus manzanas y el avance de la vuelta activa." action={<AddButton onClick={() => setModal({ type: "territory" })}>Territorio</AddButton>}>
      <ListToolbar onQueryChange={controls.setQuery} placeholder="Buscar por numero..." query={controls.query} />
      <DataTable headers={["Territorio", "Avance actual", "Manzanas", "Última completada", "Activo", "Acciones"]}>
        {controls.paged.map((territory) => {
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
              <Cell><span className="inline-flex items-center gap-2"><Grid3X3 size={15} className="text-primary" />{data.blocks.filter((block) => block.territory_id === territory.id).length}</span></Cell>
              <Cell>{progress?.last_completed_at ? displayDate(progress.last_completed_at) : <span className="text-slate-500">Sin registro</span>}</Cell>
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
      <PaginationBar page={controls.page} pageSize={controls.pageSize} total={controls.total} totalPages={controls.totalPages} onPageChange={controls.setPage} />
    </Panel>
  );
}

function RoundsPanel({
  data,
  mutate,
  setModal,
}: {
  data: AppData;
  mutate: (action: string, payload?: Record<string, unknown>) => Promise<unknown>;
  setModal: (modal: ModalState) => void;
}) {
  const controls = useListControls({
    items: data.rounds,
    searchText: (round) => `${round.year} ${round.name}`,
  });

  return (
    <Panel title="Vueltas" description="Abre una vuelta para registrar el avance y conserva las anteriores como historial." action={<AddButton onClick={() => setModal({ type: "round" })}>Vuelta</AddButton>}>
      <ListToolbar onQueryChange={controls.setQuery} placeholder="Buscar por ano o nombre..." query={controls.query} />
      <DataTable headers={["Ano", "Vuelta", "Estado", "Manzanas", "Acciones"]}>
        {controls.paged.map((round) => (
          <tr key={round.id}><Cell>{round.year}</Cell><Cell><strong>{round.name}</strong></Cell><Cell><Badge className={round.status === "OPEN" ? "border-emerald-400/30 bg-emerald-500/12 text-emerald-200" : "border-slate-400/25 bg-slate-500/10 text-slate-300"}>{round.status === "OPEN" ? "Abierta" : "Cerrada"}</Badge></Cell><Cell>{data.blockStatuses.filter((item) => item.annual_round_id === round.id).length}</Cell><Actions><IconButton label="Editar" onClick={() => setModal({ type: "round", item: round })}><Edit3 size={16} /></IconButton><DeleteButton onClick={() => void mutate("deleteRow", { table: "annual_rounds", id: round.id })} /></Actions></tr>
        ))}
      </DataTable>
      <PaginationBar page={controls.page} pageSize={controls.pageSize} total={controls.total} totalPages={controls.totalPages} onPageChange={controls.setPage} />
    </Panel>
  );
}

function DeparturePointsPanel({
  data,
  mutate,
  setModal,
}: {
  data: AppData;
  mutate: (action: string, payload?: Record<string, unknown>) => Promise<unknown>;
  setModal: (modal: ModalState) => void;
}) {
  const controls = useListControls({
    items: data.departurePoints,
    searchText: (point) => `${point.name} ${point.address}`,
  });

  return (
    <Panel title="Puntos de salida" description="Casas de hermanos u otros lugares para salir a predicar. Los territorios asociados son los mas cercanos a esa zona, en orden — el generador automatico de Salidas semanales los usa para elegir bien." action={<AddButton onClick={() => setModal({ type: "departurePoint" })}>Punto</AddButton>}>
      <ListToolbar onQueryChange={controls.setQuery} placeholder="Buscar por nombre o direccion..." query={controls.query} />
      <DataTable headers={["Nombre", "Direccion", "Territorios cercanos (de mas a menos)", "Acciones"]}>
        {controls.paged.map((point) => {
          const territories = [...point.departure_point_territories].sort((a, b) => a.sort_order - b.sort_order);
          return (
            <tr key={point.id}>
              <Cell><strong>{point.name}</strong></Cell>
              <Cell>{point.address}</Cell>
              <Cell>
                {territories.length ? (
                  <div className="flex flex-wrap items-center gap-1">
                    {territories.map((entry, index) => (
                      <span className="inline-flex items-center gap-1" key={entry.territory_id}>
                        <span className="rounded-md border border-white/10 bg-white/[0.05] px-1.5 py-0.5 text-xs font-medium text-slate-200">#{entry.territories?.number ?? "?"}</span>
                        {index < territories.length - 1 ? <span className="text-slate-600">&rarr;</span> : null}
                      </span>
                    ))}
                  </div>
                ) : (
                  <span className="text-slate-500">Sin asociar</span>
                )}
              </Cell>
              <Actions>
                <IconButton label="Editar" onClick={() => setModal({ type: "departurePoint", item: point })}><Edit3 size={16} /></IconButton>
                <DeleteButton onClick={() => void mutate("deleteRow", { table: "departure_points", id: point.id })} />
              </Actions>
            </tr>
          );
        })}
      </DataTable>
      <PaginationBar page={controls.page} pageSize={controls.pageSize} total={controls.total} totalPages={controls.totalPages} onPageChange={controls.setPage} />
    </Panel>
  );
}

function GroupsPanel({
  data,
  mutate,
  setModal,
}: {
  data: AppData;
  mutate: (action: string, payload?: Record<string, unknown>) => Promise<unknown>;
  setModal: (modal: ModalState) => void;
}) {
  const controls = useListControls({ items: data.groups, searchText: (group) => group.name });

  return (
    <Panel title="Grupos" description="Administra los grupos disponibles." action={<AddButton onClick={() => setModal({ type: "group" })}>Grupo</AddButton>}>
      <ListToolbar onQueryChange={controls.setQuery} placeholder="Buscar grupo..." query={controls.query} />
      <DataTable headers={["Grupo", "Activo", "Acciones"]}>
        {controls.paged.map((group) => <tr key={group.id}><Cell><strong>{group.name}</strong></Cell><Cell>{group.active ? "Si" : "No"}</Cell><Actions><IconButton label="Editar" onClick={() => setModal({ type: "group", item: group })}><Edit3 size={16} /></IconButton><DeleteButton onClick={() => void mutate("deleteRow", { table: "groups", id: group.id })} /></Actions></tr>)}
      </DataTable>
      <PaginationBar page={controls.page} pageSize={controls.pageSize} total={controls.total} totalPages={controls.totalPages} onPageChange={controls.setPage} />
    </Panel>
  );
}

function roleLabel(role: Role) {
  return role === "ADMIN" ? "Super admin" : role === "CONDUCTOR" ? "Conductor" : role === "PUBLICADOR" ? "Publicador" : "Anciano";
}

function UsersPanel({
  data,
  mutate,
  setModal,
}: {
  data: AppData;
  mutate: (action: string, payload?: Record<string, unknown>) => Promise<unknown>;
  setModal: (modal: ModalState) => void;
}) {
  const pendingProfiles = data.profiles.filter((item) => item.approval_status === "pending");
  const approvedProfiles = data.profiles.filter((item) => item.approval_status !== "pending");

  const pendingControls = useListControls({
    items: pendingProfiles,
    searchText: (item) => `${item.username} ${item.full_name} ${item.email ?? ""}`,
  });
  const controls = useListControls({
    items: approvedProfiles,
    searchText: (item) => `${item.username} ${item.full_name} ${item.groups?.name ?? ""}`,
  });

  return (
    <div className="space-y-4">
      {pendingProfiles.length ? (
        <Panel title="Por aprobar" description="Cuentas creadas por auto-registro, esperando revision.">
          <ListToolbar onQueryChange={pendingControls.setQuery} placeholder="Buscar por usuario, nombre o mail..." query={pendingControls.query} />
          <DataTable headers={["Usuario", "Nombre", "Mail", "Rol", "Acciones"]}>
            {pendingControls.paged.map((item) => (
              <tr key={item.id}>
                <Cell>@{item.username}</Cell><Cell>{item.full_name}</Cell><Cell>{item.email ?? "-"}</Cell>
                <Cell>
                  <div className="flex flex-wrap gap-1">
                    {item.roles.map((role) => (
                      <Badge className="border-white/10 bg-white/[0.05] text-slate-300" key={role}>
                        {roleLabel(role)}
                      </Badge>
                    ))}
                  </div>
                </Cell>
                <Actions>
                  <IconButton label="Editar" onClick={() => setModal({ type: "user", item })}><Edit3 size={16} /></IconButton>
                  <button className={miniButtonClass} onClick={() => void mutate("approveUser", { id: item.id })} type="button">
                    <Check size={14} aria-hidden="true" />Aprobar
                  </button>
                  <DeleteButton onClick={() => void mutate("deleteUser", { id: item.id })} />
                </Actions>
              </tr>
            ))}
          </DataTable>
          <PaginationBar page={pendingControls.page} pageSize={pendingControls.pageSize} total={pendingControls.total} totalPages={pendingControls.totalPages} onPageChange={pendingControls.setPage} />
        </Panel>
      ) : null}

      <Panel title="Usuarios" description="Asigna cada anciano a su grupo." action={<AddButton onClick={() => setModal({ type: "user" })}>Usuario</AddButton>}>
        <ListToolbar onQueryChange={controls.setQuery} placeholder="Buscar por usuario, nombre o grupo..." query={controls.query} />
        <DataTable headers={["Usuario", "Nombre", "Mail", "Grupo", "Rol", "Activo", "Estado", "Acciones"]}>
          {controls.paged.map((item) => (
            <tr key={item.id}>
              <Cell>@{item.username}</Cell><Cell>{item.full_name}</Cell><Cell>{item.email ?? <span className="text-muted">Sin mail</span>}</Cell><Cell>{item.groups?.name ?? "-"}</Cell>
              <Cell>
                <div className="flex flex-wrap gap-1">
                  {item.roles.map((role) => (
                    <Badge className="border-white/10 bg-white/[0.05] text-slate-300" key={role}>
                      {roleLabel(role)}
                    </Badge>
                  ))}
                </div>
              </Cell>
              <Cell>{item.active ? "Si" : "No"}</Cell>
              <Cell>{item.must_change_password ? <Badge className="border-amber-400/30 bg-amber-500/12 text-amber-200">Temporal</Badge> : <Badge className="border-emerald-400/30 bg-emerald-500/12 text-emerald-200">Activa</Badge>}</Cell>
              <Actions><IconButton label="Editar" onClick={() => setModal({ type: "user", item })}><Edit3 size={16} /></IconButton><IconButton label="Cambiar contrasena" onClick={() => setModal({ type: "password", item })}><KeyRound size={16} /></IconButton>{!item.roles.includes("ADMIN") ? <DeleteButton onClick={() => void mutate("deleteUser", { id: item.id })} /> : null}</Actions>
            </tr>
          ))}
        </DataTable>
        <PaginationBar page={controls.page} pageSize={controls.pageSize} total={controls.total} totalPages={controls.totalPages} onPageChange={controls.setPage} />
      </Panel>
    </div>
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
  const controls = useListControls({
    items: relevantReservations,
    searchText: (reservation) => `${reservation.territories?.number ?? ""} ${reservation.groups?.name ?? ""} ${reservation.profiles?.full_name ?? ""} ${reservation.departure_location}`,
    dateValue: (reservation) => reservation.service_date,
  });

  const windows = [...data.reservationWindows]
    .filter((window) => controls.filtered.some((reservation) => reservation.reservation_window_id === window.id))
    .sort((a, b) => new Date(b.booking_deadline).getTime() - new Date(a.booking_deadline).getTime());

  const WINDOWS_PER_PAGE = 5;
  const [windowPage, setWindowPage] = useState(1);
  const totalWindowPages = Math.max(1, Math.ceil(windows.length / WINDOWS_PER_PAGE));
  const clampedWindowPage = Math.min(windowPage, totalWindowPages);
  const pagedWindows = windows.slice((clampedWindowPage - 1) * WINDOWS_PER_PAGE, clampedWindowPage * WINDOWS_PER_PAGE);

  return (
    <section className="space-y-4" aria-label={blocked ? "Bloqueos por ventana" : "Reservas por ventana"}>
      <div className="px-1">
        <h2 className="text-xl font-semibold tracking-tight text-white">{blocked ? "Bloqueos administrativos" : "Reservas de los grupos"}</h2>
        <p className="mt-1 text-sm text-slate-400">
          {blocked ? "Separados de las respuestas para revisar rápidamente qué territorios no están disponibles." : "Organizadas por ventana para leer el estado operativo sin recorrer una tabla extensa."}
        </p>
      </div>

      <ListToolbar
        dateFrom={controls.dateFrom}
        dateTo={controls.dateTo}
        onDateFromChange={controls.setDateFrom}
        onDateToChange={controls.setDateTo}
        onQueryChange={(value) => { controls.setQuery(value); setWindowPage(1); }}
        onQuickRange={(days) => { controls.setQuickRange(days); setWindowPage(1); }}
        placeholder="Buscar por territorio, grupo o responsable..."
        query={controls.query}
        showDateFilter
      />

      {!windows.length ? (
        <EmptyState
          icon={blocked ? <ShieldCheck size={24} /> : <CalendarClock size={24} />}
          title={blocked ? "No hay bloqueos registrados" : "No hay reservas registradas"}
          text={blocked ? "Los territorios bloqueados administrativamente aparecerán agrupados por ventana." : "Las respuestas de los grupos aparecerán aquí, organizadas por ventana."}
        />
      ) : null}

      {pagedWindows.map((window) => {
        const windowReservations = controls.filtered
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
      <PaginationBar onPageChange={setWindowPage} page={clampedWindowPage} pageSize={WINDOWS_PER_PAGE} total={windows.length} totalPages={totalWindowPages} />
    </section>
  );
}

function AdminDashboard({ data }: { data: AppData }) {
  const activeWindows = data.reservationWindows.filter((item) => item.active);
  const blockedReservations = data.reservations.filter((item) => item.reserved_by_admin && item.status === "ACTIVE");
  const answeredReservations = data.reservations.filter((item) => !item.reserved_by_admin && item.status === "ACTIVE");
  const completedTerritories = data.territoryProgress.filter((item) => item.total_blocks > 0 && item.completed_blocks === item.total_blocks).length;
  const territoriesWithBlocks = data.territoryProgress.filter((item) => item.total_blocks > 0).length;
  const territoriesInProgress = data.territoryProgress.filter((item) => item.completed_blocks > 0 && item.completed_blocks < item.total_blocks).length;
  const completionRate = territoriesWithBlocks ? Math.round((completedTerritories / territoriesWithBlocks) * 100) : 0;
  const respondingGroups = new Set(answeredReservations.map((item) => item.group_id).filter(Boolean)).size;
  const unreadNotifications = data.notifications.filter((item) => !item.read_at).length;

  return (
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
              <p className="mt-1 text-xs font-medium text-primary-hover/85">Última completada: {progress?.last_completed_at ? displayDate(progress.last_completed_at) : "Sin registro"}</p>
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
            <p className="mt-2 text-sm text-muted">Selecciona uno o varios territorios para esta fecha. Los ya ocupados o completados quedan bloqueados automáticamente.</p>
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
      <FormModal
        title={modal.item ? "Editar usuario" : "Nuevo usuario"}
        onSubmit={(event) => submitFromForm(event, modal.item ? "updateUser" : "createUser", (form) => ({
          id: modal.item?.id,
          username: form.get("username"),
          full_name: form.get("full_name"),
          email: form.get("email") || null,
          group_id: form.get("group_id") || null,
          roles: form.getAll("roles"),
          active: form.get("active") === "true",
          passwordMode,
          password: form.get("password"),
        }))}
        saving={saving}
      >
        <Field label="Usuario"><input className={inputClass} defaultValue={modal.item?.username} name="username" required /></Field>
        <Field label="Nombre completo"><input className={inputClass} name="full_name" defaultValue={modal.item?.full_name} required /></Field>
        <Field label="Mail"><input className={inputClass} name="email" type="email" defaultValue={modal.item?.email ?? ""} placeholder="Para verificacion por codigo y llave de acceso" /></Field>
        <Field label="Grupo"><select className={inputClass} name="group_id" defaultValue={modal.item?.group_id ?? ""}><option value="">Sin grupo</option>{data.groups.map((group) => <option key={group.id} value={group.id}>{group.name}</option>)}</select></Field>
        <fieldset>
          <legend className="text-sm font-medium text-slate-200">Roles</legend>
          <div className="mt-2 grid gap-2 sm:grid-cols-3">
            {([["ADMIN", "Super admin"], ["ANCIANO", "Anciano"], ["CONDUCTOR", "Conductor"]] as const).map(([value, label]) => (
              <label className="flex cursor-pointer items-center gap-2 rounded-xl border border-white/10 bg-white/[0.03] px-3 py-2.5 text-sm text-slate-100" key={value}>
                <input className="h-4 w-4 accent-white" defaultChecked={modal.item?.roles.includes(value) ?? value === "ANCIANO"} name="roles" type="checkbox" value={value} />
                {label}
              </label>
            ))}
          </div>
        </fieldset>
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
  if (modal.type === "departurePoint") {
    return <DeparturePointModal data={data} item={modal.item} mutate={mutate} saving={saving} />;
  }
  if (modal.type === "territoryVisit") {
    return <TerritoryVisitEditModal data={data} item={modal.item} mutate={mutate} saving={saving} />;
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

function ConductorVisitForm({
  data,
  mutate,
}: {
  data: AppData;
  mutate: (action: string, payload?: Record<string, unknown>) => Promise<unknown>;
}) {
  const isAdmin = data.profile.roles.includes("ADMIN");
  const conductors = useMemo(() => data.profiles.filter((item) => item.roles.includes("CONDUCTOR")), [data.profiles]);
  const [pickedConductorId, setPickedConductorId] = useState("");
  const effectiveConductorId = isAdmin ? pickedConductorId : data.profile.id;

  const openRoundByTerritory = useMemo(
    () => new Map(data.territoryRounds.filter((round) => !round.completed_on).map((round) => [round.territory_id, round])),
    [data.territoryRounds],
  );
  const sortedTerritories = useMemo(() => {
    return [...data.territories].sort((a, b) => {
      const aMine = openRoundByTerritory.get(a.id)?.conductor_id === effectiveConductorId ? 0 : 1;
      const bMine = openRoundByTerritory.get(b.id)?.conductor_id === effectiveConductorId ? 0 : 1;
      return aMine - bMine || a.number - b.number;
    });
  }, [data.territories, effectiveConductorId, openRoundByTerritory]);

  const [territoryId, setTerritoryId] = useState(sortedTerritories[0]?.id ?? "");
  const [visitDate, setVisitDate] = useState(() => new Date().toISOString().slice(0, 10));
  const [doneLabels, setDoneLabels] = useState<Set<string>>(new Set());

  const territoryBlocks = useMemo(
    () => data.blocks.filter((block) => block.territory_id === territoryId).map((block) => block.label),
    [data.blocks, territoryId],
  );
  const openRound = openRoundByTerritory.get(territoryId);
  const pendingLabels = useMemo(() => {
    const base = openRound ? openRound.pending_block_labels : territoryBlocks;
    return [...base].sort((a, b) => a.localeCompare(b, "es", { numeric: true }));
  }, [openRound, territoryBlocks]);

  useEffect(() => {
    setDoneLabels(new Set());
  }, [territoryId]);

  function toggle(label: string) {
    setDoneLabels((current) => {
      const next = new Set(current);
      if (next.has(label)) next.delete(label);
      else next.add(label);
      return next;
    });
  }

  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!territoryId || !effectiveConductorId) return;
    const stillPending = pendingLabels.filter((label) => !doneLabels.has(label));
    const result = await mutate("submitTerritoryVisit", {
      territory_id: territoryId,
      visit_date: visitDate,
      done_labels: [...doneLabels],
      pending_labels: stillPending,
      ...(isAdmin ? { conductor_id: effectiveConductorId } : {}),
    });
    if (result) setDoneLabels(new Set());
  }

  if (isAdmin && !conductors.length) {
    return <EmptyState icon={<Users size={24} />} title="Todavia no hay conductores" text="Asignale el rol Conductor a un usuario en Usuarios para poder cargar visitas por el." />;
  }
  if (!sortedTerritories.length) {
    return <EmptyState icon={<MapIcon size={24} />} title="No hay territorios activos" text="Cuando el administrador cargue territorios, vas a poder registrar visitas aca." />;
  }

  return (
    <section className="glass-panel floating-card rounded-[1.75rem] p-5 sm:p-6">
      <form className="space-y-5" onSubmit={submit}>
        <div>
          <h2 className="text-xl font-semibold tracking-tight text-white">Actualizar territorio</h2>
          {isAdmin ? (
            <p className="mt-2 text-sm leading-6 text-slate-300">Carga una visita en nombre de un conductor.</p>
          ) : (
            <p className="mt-2 text-sm leading-6 text-slate-300">
              Vas a registrar esta visita como <strong className="text-white">{data.profile.full_name}</strong> (@{data.profile.username}).
            </p>
          )}
        </div>

        {isAdmin ? (
          <Field label="Conductor">
            <Select onChange={setPickedConductorId} options={conductors.map((item) => ({ value: item.id, label: item.full_name }))} placeholder="Elegir conductor" value={pickedConductorId} />
          </Field>
        ) : null}

        <Field label="Territorio">
          <select className={inputClass} onChange={(event) => setTerritoryId(event.target.value)} value={territoryId} required>
            {sortedTerritories.map((territory) => {
              const round = openRoundByTerritory.get(territory.id);
              const mine = round?.conductor_id === effectiveConductorId;
              const pendingText = round?.pending_block_labels.length ? ` - Faltan ${formatPendingBlocks(round.pending_block_labels)}` : "";
              return (
                <option key={territory.id} value={territory.id}>
                  Territorio #{territory.number}{pendingText}{mine ? " (asignado)" : ""}
                </option>
              );
            })}
          </select>
        </Field>

        <Field label="Fecha"><input className={inputClass} onChange={(event) => setVisitDate(event.target.value)} type="date" value={visitDate} required /></Field>

        <div>
          <p className="text-sm font-medium text-slate-200">Manzanas</p>
          <p className="mt-1 text-xs text-slate-400">Toca las que se completaron en esta visita. Las que queden sin tocar se guardan como pendientes.</p>
          <div className="mt-3">
            {pendingLabels.length ? (
              <BlockToggleGrid
                blocks={pendingLabels.map((label) => ({ id: label, label }))}
                onToggle={toggle}
                selectedIds={doneLabels}
              />
            ) : (
              <p className="rounded-2xl border border-dashed border-white/12 bg-white/[0.03] px-4 py-6 text-center text-sm text-slate-400">Este territorio no tiene manzanas cargadas.</p>
            )}
          </div>
        </div>

        <button className={primaryButtonClass} disabled={!pendingLabels.length || !effectiveConductorId} type="submit">
          <Save size={18} aria-hidden="true" />Guardar visita
        </button>
      </form>
    </section>
  );
}

function S13Panel({
  data,
  mutate,
  setModal,
}: {
  data: AppData;
  mutate: (action: string, payload?: Record<string, unknown>, form?: HTMLFormElement) => Promise<unknown>;
  setModal: (modal: ModalState) => void;
}) {
  const latestVisitByRound = new Map<string, TerritoryVisit>();
  for (const visit of data.territoryVisits) {
    const current = latestVisitByRound.get(visit.territory_round_id);
    if (!current || visit.visit_date > current.visit_date || (visit.visit_date === current.visit_date && visit.created_at > current.created_at)) {
      latestVisitByRound.set(visit.territory_round_id, visit);
    }
  }

  const sortedRounds = [...data.territoryRounds].sort(
    (a, b) => (a.territories?.number ?? 0) - (b.territories?.number ?? 0) || b.assigned_on.localeCompare(a.assigned_on),
  );
  const controls = useListControls({
    items: sortedRounds,
    searchText: (round) => `${round.territories?.number ?? ""} ${round.profiles?.full_name ?? ""}`,
    dateValue: (round) => round.assigned_on,
  });

  return (
    <Panel title="Registro S-13" description="Historial de asignaciones por territorio: quien lo tiene, desde cuando, y que falta. Editar o borrar actua sobre la ultima visita registrada; el estado se recalcula solo.">
      <ListToolbar onQueryChange={controls.setQuery} placeholder="Buscar por territorio o conductor..." query={controls.query} showDateFilter dateFrom={controls.dateFrom} dateTo={controls.dateTo} onDateFromChange={controls.setDateFrom} onDateToChange={controls.setDateTo} onQuickRange={controls.setQuickRange} />
      <DataTable headers={["Territorio", "Conductor", "Asignado", "Estado", "Manzanas", "Acciones"]}>
        {controls.paged.map((round) => {
          const latestVisit = latestVisitByRound.get(round.id);
          return (
            <tr key={round.id}>
              <Cell><strong>Territorio #{round.territories?.number ?? "?"}</strong></Cell>
              <Cell>{round.profiles?.full_name ?? "-"}</Cell>
              <Cell>{displayDate(round.assigned_on)}</Cell>
              <Cell>
                {round.completed_on ? (
                  <Badge className="border-emerald-400/30 bg-emerald-500/12 text-emerald-200">Completada {displayDate(round.completed_on)}</Badge>
                ) : (
                  <Badge className="border-primary/30 bg-primary/12 text-primary-hover">Abierta</Badge>
                )}
              </Cell>
              <Cell>{round.pending_block_labels.length ? `Faltan ${formatPendingBlocks(round.pending_block_labels)}` : "Completo"}</Cell>
              <Actions>
                {latestVisit ? (
                  <>
                    <IconButton label="Editar ultima visita" onClick={() => setModal({ type: "territoryVisit", item: latestVisit })}><Edit3 size={16} /></IconButton>
                    <DeleteButton label="Borrar ultima visita" onClick={() => void mutate("deleteTerritoryVisit", { id: latestVisit.id })} />
                  </>
                ) : null}
              </Actions>
            </tr>
          );
        })}
      </DataTable>
      <PaginationBar page={controls.page} pageSize={controls.pageSize} total={controls.total} totalPages={controls.totalPages} onPageChange={controls.setPage} />
    </Panel>
  );
}

function TerritoryVisitEditModal({
  data,
  mutate,
  saving,
  item,
}: {
  data: AppData;
  mutate: (action: string, payload?: Record<string, unknown>, form?: HTMLFormElement) => Promise<unknown>;
  saving: boolean;
  item: TerritoryVisit;
}) {
  const territoryId = item.territory_rounds?.territory_id ?? "";
  const territory = data.territories.find((t) => t.id === territoryId);
  const conductors = useMemo(() => data.profiles.filter((p) => p.roles.includes("CONDUCTOR")), [data.profiles]);
  const [visitDate, setVisitDate] = useState(item.visit_date);
  const [conductorId, setConductorId] = useState(item.conductor_id);
  const [doneLabels, setDoneLabels] = useState<Set<string>>(new Set(item.done_labels));

  const allLabels = useMemo(() => {
    const territoryBlockLabels = data.blocks.filter((block) => block.territory_id === territoryId).map((block) => block.label);
    const merged = new Set([...territoryBlockLabels, ...item.done_labels, ...item.pending_labels]);
    return [...merged].sort((a, b) => a.localeCompare(b, "es", { numeric: true }));
  }, [data.blocks, territoryId, item.done_labels, item.pending_labels]);

  function toggle(label: string) {
    setDoneLabels((current) => {
      const next = new Set(current);
      if (next.has(label)) next.delete(label);
      else next.add(label);
      return next;
    });
  }

  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const pendingLabels = allLabels.filter((label) => !doneLabels.has(label));
    await mutate("updateTerritoryVisit", {
      id: item.id,
      visit_date: visitDate,
      done_labels: [...doneLabels],
      pending_labels: pendingLabels,
      conductor_id: conductorId,
    });
  }

  return (
    <form className="space-y-5 p-5 sm:p-6" onSubmit={submit}>
      <div>
        <h2 className="text-xl font-semibold tracking-tight text-white">Editar visita</h2>
        <p className="mt-1 text-sm text-slate-400">Territorio #{territory?.number ?? "?"}</p>
      </div>

      <Field label="Conductor">
        <Select onChange={setConductorId} options={conductors.map((c) => ({ value: c.id, label: c.full_name }))} value={conductorId} />
      </Field>
      <Field label="Fecha"><input className={inputClass} onChange={(event) => setVisitDate(event.target.value)} type="date" value={visitDate} required /></Field>

      <div>
        <p className="text-sm font-medium text-slate-200">Manzanas</p>
        <p className="mt-1 text-xs text-slate-400">Verdes = registradas como hechas en esta visita.</p>
        <div className="mt-3">
          {allLabels.length ? (
            <BlockToggleGrid blocks={allLabels.map((label) => ({ id: label, label }))} onToggle={toggle} selectedIds={doneLabels} />
          ) : (
            <p className="rounded-2xl border border-dashed border-white/12 bg-white/[0.03] px-4 py-6 text-center text-sm text-slate-400">Sin manzanas registradas.</p>
          )}
        </div>
      </div>

      <button className={primaryButtonClass} disabled={saving} type="submit">{saving ? "Guardando..." : "Guardar"}</button>
    </form>
  );
}

const monthNamesEs = ["enero", "febrero", "marzo", "abril", "mayo", "junio", "julio", "agosto", "septiembre", "octubre", "noviembre", "diciembre"];
const outingDayLabels = ["Jueves", "Viernes", "Sabado", "Domingo", "Lunes", "Martes", "Miercoles"];

function addDays(date: string, days: number) {
  const [year, month, day] = date.split("-").map(Number);
  const result = new Date(Date.UTC(year, month - 1, day + days));
  return result.toISOString().slice(0, 10);
}

function displayDateEs(date: string) {
  const [year, month, day] = date.split("-").map(Number);
  return `${day} de ${monthNamesEs[month - 1]}`;
}

function WeeklyOutingsPanel({
  data,
  mutate,
}: {
  data: AppData;
  mutate: (action: string, payload?: Record<string, unknown>, form?: HTMLFormElement) => Promise<unknown>;
}) {
  const sortedOutings = useMemo(
    () => [...data.weeklyOutings].sort((a, b) => a.starts_on.localeCompare(b.starts_on)),
    [data.weeklyOutings],
  );
  const [selectedId, setSelectedId] = useState(sortedOutings[0]?.id ?? "");
  const outing = sortedOutings.find((item) => item.id === selectedId) ?? sortedOutings[0];
  const conductors = data.profiles.filter((item) => item.roles.includes("CONDUCTOR"));

  function nextThursdayDefault() {
    const existingStarts = new Set(data.weeklyOutings.map((item) => item.starts_on));
    const today = new Date();
    const day = today.getUTCDay();
    let candidate = addDays(today.toISOString().slice(0, 10), (4 - day + 7) % 7 || 7);
    while (existingStarts.has(candidate)) candidate = addDays(candidate, 7);
    return candidate;
  }

  async function createOuting() {
    const result = await mutate("createWeeklyOuting", { starts_on: nextThursdayDefault() });
    if (result && typeof result === "object" && "id" in result) setSelectedId(String((result as { id: string }).id));
  }

  return (
    <section className="space-y-4">
      <div className="glass-panel flex flex-wrap items-center gap-3 rounded-[1.5rem] p-3">
        <div className="w-full sm:w-auto sm:min-w-[260px]">
          <Select
            className="font-medium"
            onChange={setSelectedId}
            options={sortedOutings.map((item) => ({
              value: item.id,
              label: `Del ${displayDateEs(item.starts_on)} al ${displayDateEs(addDays(item.starts_on, 6))}`,
            }))}
            value={outing?.id ?? ""}
          />
        </div>
        <button className={primarySmallButtonClass} onClick={() => void createOuting()} type="button">
          <Plus size={16} aria-hidden="true" />Nueva semana
        </button>
        {outing ? (
          <button
            className={secondaryButtonClass}
            onClick={() => void mutate("autoFillWeeklyOuting", { weekly_outing_id: outing.id })}
            title="Completa los dias sin territorio con los que hace mas tiempo no se trabajan o los que quedaron a medias"
            type="button"
          >
            <Wand2 size={16} aria-hidden="true" />Generar automatico
          </button>
        ) : null}
        {outing ? (
          <button className="ml-auto inline-flex items-center gap-1.5 text-xs font-medium text-slate-500 transition hover:text-rose-300" onClick={() => void mutate("deleteWeeklyOuting", { id: outing.id })} type="button">
            <Trash2 size={14} aria-hidden="true" />Eliminar esta semana
          </button>
        ) : null}
      </div>

      {outing ? (
        <WeeklyOutingDays data={data} conductors={conductors} mutate={mutate} outing={outing} />
      ) : (
        <EmptyState icon={<CalendarDays size={24} />} title="Todavia no hay semanas cargadas" text="Crea una semana para empezar a completar horarios." />
      )}
    </section>
  );
}

function nextAvailableWeekendDate(existingDates: Set<string>) {
  const today = new Date();
  const cursor = new Date(Date.UTC(today.getUTCFullYear(), today.getUTCMonth(), today.getUTCDate()));
  const diffToSaturday = (6 - cursor.getUTCDay() + 7) % 7;
  cursor.setUTCDate(cursor.getUTCDate() + diffToSaturday);
  let candidate = cursor.toISOString().slice(0, 10);
  while (existingDates.has(candidate)) candidate = addDays(candidate, 1);
  return candidate;
}

function WeekendRosterPanel({
  data,
  mutate,
}: {
  data: AppData;
  mutate: (action: string, payload?: Record<string, unknown>, form?: HTMLFormElement) => Promise<unknown>;
}) {
  const conductors = data.profiles.filter((item) => item.roles.includes("CONDUCTOR"));
  const sortedRoster = [...data.weekendRoster].sort((a, b) => a.service_date.localeCompare(b.service_date));
  const conductorOptions = [{ value: "", label: "Sin asignar" }, ...conductors.map((item) => ({ value: item.id, label: item.full_name }))];
  const controls = useListControls({
    items: sortedRoster,
    searchText: (entry) => entry.profiles?.full_name ?? "",
    dateValue: (entry) => entry.service_date,
  });

  const [adding, setAdding] = useState(false);
  const [newDate, setNewDate] = useState("");
  const [newConductorId, setNewConductorId] = useState("");

  function startAdding() {
    const existing = new Set(data.weekendRoster.map((entry) => entry.service_date));
    setNewDate(nextAvailableWeekendDate(existing));
    setNewConductorId("");
    setAdding(true);
  }

  async function confirmAdd() {
    if (!newDate || !newConductorId) return;
    const result = await mutate("upsertWeekendRoster", { service_date: newDate, conductor_id: newConductorId });
    if (result) setAdding(false);
  }

  return (
    <Panel
      title="Conductores de fin de semana"
      description="Vos armas la lista: agrega cada sabado o domingo con su conductor. Se sugiere solo en las filas de Salidas semanales de ese dia."
      action={<AddButton onClick={startAdding}>Fecha</AddButton>}
    >
      <ListToolbar onQueryChange={controls.setQuery} placeholder="Buscar conductor..." query={controls.query} showDateFilter dateFrom={controls.dateFrom} dateTo={controls.dateTo} onDateFromChange={controls.setDateFrom} onDateToChange={controls.setDateTo} onQuickRange={controls.setQuickRange} />
      <div className="space-y-2">
        {adding ? (
          <div className="flex flex-wrap items-center gap-2 rounded-2xl border border-primary/25 bg-primary/[0.06] px-3.5 py-3">
            <input
              className="min-h-9 rounded-lg border border-white/10 bg-black/20 px-2.5 py-1.5 text-sm text-white outline-none"
              onChange={(event) => setNewDate(event.target.value)}
              type="date"
              value={newDate}
            />
            <div className="w-44">
              <Select onChange={setNewConductorId} options={conductors.map((item) => ({ value: item.id, label: item.full_name }))} placeholder="Elegir conductor" size="compact" value={newConductorId} />
            </div>
            <button className={miniButtonClass} onClick={() => setAdding(false)} type="button">Cancelar</button>
            <button className={cn(miniButtonClass, "border-primary/40 bg-primary/15 text-primary-hover")} disabled={!newDate || !newConductorId} onClick={() => void confirmAdd()} type="button">
              <Plus size={13} aria-hidden="true" />Agregar
            </button>
          </div>
        ) : null}

        {controls.paged.map((entry) => {
          const isSaturday = new Date(`${entry.service_date}T00:00:00Z`).getUTCDay() === 6;
          return (
            <div className="flex items-center gap-2.5 rounded-2xl border border-white/8 bg-white/[0.02] px-3.5 py-3" key={entry.id}>
              <span className={cn("inline-flex h-10 w-10 shrink-0 items-center justify-center rounded-xl border text-[10px] font-semibold uppercase", isSaturday ? "border-sky-400/25 bg-sky-500/10 text-sky-200" : "border-amber-400/25 bg-amber-500/10 text-amber-200")}>
                {isSaturday ? "Sab" : "Dom"}
              </span>
              <p className="w-32 shrink-0 truncate text-sm font-medium text-white">{displayDateEs(entry.service_date)}</p>
              <div className="w-48">
                <Select
                  onChange={(conductorId) => void mutate("upsertWeekendRoster", { service_date: entry.service_date, conductor_id: conductorId || null })}
                  options={conductorOptions}
                  size="compact"
                  value={entry.conductor_id}
                />
              </div>
              <DeleteButton onClick={() => void mutate("deleteRow", { table: "weekend_roster", id: entry.id })} />
            </div>
          );
        })}

        {!sortedRoster.length && !adding ? <EmptyState icon={<Users size={24} />} title="Todavia no hay conductores cargados" text="Agrega una fecha para empezar la lista." /> : null}
      </div>
      <PaginationBar page={controls.page} pageSize={controls.pageSize} total={controls.total} totalPages={controls.totalPages} onPageChange={controls.setPage} />
    </Panel>
  );
}

function WeeklyOutingDays({
  data,
  conductors,
  mutate,
  outing,
}: {
  data: AppData;
  conductors: Profile[];
  mutate: (action: string, payload?: Record<string, unknown>, form?: HTMLFormElement) => Promise<unknown>;
  outing: WeeklyOuting;
}) {
  return (
    <div className="grid gap-3 lg:grid-cols-2 2xl:grid-cols-3">
      {outingDayLabels.map((dayLabel, index) => {
        const slotDate = addDays(outing.starts_on, index);
        const slots = outing.weekly_outing_slots
          .filter((slot) => slot.slot_date === slotDate)
          .sort((a, b) => a.sort_order - b.sort_order);
        return (
          <div className="glass-panel-soft flex flex-col gap-3 rounded-[1.35rem] p-3.5" key={slotDate}>
            <div className="flex items-center justify-between gap-2 px-0.5">
              <div>
                <p className="text-sm font-semibold text-white">{dayLabel}</p>
                <p className="text-xs text-slate-500">{displayDateEs(slotDate)}</p>
              </div>
              <button
                className="inline-flex h-8 w-8 cursor-pointer items-center justify-center rounded-xl border border-white/10 bg-white/[0.04] text-slate-300 transition hover:border-primary/30 hover:bg-primary/10 hover:text-primary-hover"
                onClick={() => void mutate("createWeeklyOutingSlot", { weekly_outing_id: outing.id, slot_date: slotDate })}
                title="Agregar salida"
                type="button"
              >
                <Plus size={15} aria-hidden="true" />
              </button>
            </div>
            <div className="space-y-2.5">
              {slots.map((slot) => (
                <WeeklyOutingSlotCard conductors={conductors} data={data} key={slot.id} mutate={mutate} slot={slot} />
              ))}
              {!slots.length ? <p className="rounded-xl border border-dashed border-white/10 px-3 py-4 text-center text-xs text-slate-500">Sin salidas.</p> : null}
            </div>
          </div>
        );
      })}
    </div>
  );
}

function WeeklyOutingSlotCard({
  data,
  conductors,
  mutate,
  slot,
}: {
  data: AppData;
  conductors: Profile[];
  mutate: (action: string, payload?: Record<string, unknown>, form?: HTMLFormElement) => Promise<unknown>;
  slot: WeeklyOutingSlot;
}) {
  const [territoryModalOpen, setTerritoryModalOpen] = useState(false);
  const [hora, setHora] = useState(slot.hora ?? "");
  const [lugar, setLugar] = useState(slot.lugar ?? "");
  const [conductorId, setConductorId] = useState(slot.conductor_id ?? "");
  const [highlighted, setHighlighted] = useState(slot.highlighted);
  const [status, setStatus] = useState<"idle" | "saving" | "saved">("idle");
  const saveTimeout = useRef<number | undefined>(undefined);

  useEffect(() => {
    setHora(slot.hora ?? "");
    setLugar(slot.lugar ?? "");
    setConductorId(slot.conductor_id ?? "");
    setHighlighted(slot.highlighted);
  }, [slot.id, slot.hora, slot.lugar, slot.conductor_id, slot.highlighted]);

  useEffect(() => {
    const dirty = hora !== (slot.hora ?? "") || lugar !== (slot.lugar ?? "") || conductorId !== (slot.conductor_id ?? "") || highlighted !== slot.highlighted;
    if (!dirty) return;
    setStatus("saving");
    window.clearTimeout(saveTimeout.current);
    saveTimeout.current = window.setTimeout(() => {
      void mutate("updateWeeklyOutingSlot", {
        id: slot.id,
        hora: hora || null,
        lugar: lugar || null,
        conductor_id: conductorId || null,
        highlighted,
      }).then(() => setStatus("saved"));
    }, 700);
    return () => window.clearTimeout(saveTimeout.current);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [hora, lugar, conductorId, highlighted]);

  const sortedSlotTerritories = [...slot.weekly_outing_slot_territories].sort((a, b) => a.sort_order - b.sort_order);
  const territories = sortedSlotTerritories.map((entry) => {
    const number = entry.territories?.number ?? "?";
    const pending = entry.territory_rounds?.pending_block_labels ?? [];
    return pending.length ? `${number}(${formatPendingBlocks(pending)})` : `${number}`;
  });
  const suggestedPoint = sortedSlotTerritories.length
    ? data.departurePoints.find((point) => point.departure_point_territories.some((entry) => entry.territory_id === sortedSlotTerritories[0].territory_id))
    : undefined;
  const rosterEntry = data.weekendRoster.find((entry) => entry.service_date === slot.slot_date);

  return (
    <div className={cn("rounded-2xl border p-3 transition", highlighted ? "border-primary/30 bg-primary/[0.07]" : "border-white/8 bg-black/15")}>
      <div className="flex items-start justify-between gap-2">
        <span className="inline-flex items-center gap-1.5 rounded-lg border border-white/10 bg-black/25 px-2 py-1.5">
          <Clock className="text-slate-500" size={13} aria-hidden="true" />
          <input className="w-[68px] bg-transparent text-sm text-white outline-none" onChange={(event) => setHora(event.target.value)} type="time" value={hora} />
        </span>
        <div className="flex items-center gap-1">
          <SaveStatus status={status} />
          <button
            aria-label="Destacar salida"
            className={cn("inline-flex h-7 w-7 cursor-pointer items-center justify-center rounded-lg transition", highlighted ? "text-primary" : "text-slate-600 hover:text-slate-300")}
            onClick={() => setHighlighted((current) => !current)}
            title="Destacar salida"
            type="button"
          >
            <Star fill={highlighted ? "currentColor" : "none"} size={15} aria-hidden="true" />
          </button>
          <button aria-label="Eliminar salida" className="inline-flex h-7 w-7 cursor-pointer items-center justify-center rounded-lg text-slate-600 transition hover:text-rose-300" onClick={() => void mutate("deleteWeeklyOutingSlot", { id: slot.id })} title="Eliminar salida" type="button">
            <Trash2 size={14} aria-hidden="true" />
          </button>
        </div>
      </div>

      <div className="mt-2 flex items-center gap-2">
        <User className="shrink-0 text-slate-500" size={13} aria-hidden="true" />
        <Select
          className="border-transparent bg-black/20 px-2 py-1"
          onChange={setConductorId}
          options={[{ value: "", label: "Sin conductor" }, ...conductors.map((item) => ({ value: item.id, label: item.full_name }))]}
          size="compact"
          value={conductorId}
        />
      </div>
      {!conductorId && rosterEntry?.profiles ? (
        <button className="mt-1.5 inline-flex items-center gap-1 text-xs font-medium text-primary hover:text-primary-hover" onClick={() => setConductorId(rosterEntry.conductor_id)} type="button">
          <Wand2 size={12} aria-hidden="true" />Usar {rosterEntry.profiles.full_name} (roster)
        </button>
      ) : null}

      <label className="mt-2 flex items-center gap-2 rounded-lg border border-white/10 bg-black/20 px-2.5 py-1.5">
        <MapPin className="shrink-0 text-slate-500" size={13} aria-hidden="true" />
        <input className="w-full min-w-0 bg-transparent text-sm text-white outline-none placeholder:text-slate-600" onChange={(event) => setLugar(event.target.value)} placeholder="Lugar de salida" value={lugar} />
      </label>
      {!lugar && suggestedPoint ? (
        <button className="mt-1.5 inline-flex items-center gap-1 text-xs font-medium text-primary hover:text-primary-hover" onClick={() => setLugar(suggestedPoint.address)} type="button">
          <Wand2 size={12} aria-hidden="true" />Usar {suggestedPoint.name}
        </button>
      ) : null}

      <button className="mt-2 flex w-full flex-wrap items-center gap-1.5 rounded-lg border border-dashed border-white/12 px-2.5 py-1.5 text-left transition hover:border-primary/30 hover:bg-primary/5" onClick={() => setTerritoryModalOpen(true)} type="button">
        {territories.length ? territories.map((text, index) => (
          <span className="rounded-md border border-white/10 bg-white/[0.05] px-1.5 py-0.5 text-xs font-medium text-slate-200" key={index}>{text}</span>
        )) : (
          <span className="inline-flex items-center gap-1.5 text-xs text-slate-500"><MapIcon size={13} aria-hidden="true" />Elegir territorios</span>
        )}
      </button>

      {territoryModalOpen ? (
        <SlotTerritoryModal data={data} mutate={mutate} onClose={() => setTerritoryModalOpen(false)} slot={slot} />
      ) : null}
    </div>
  );
}

function SaveStatus({ status }: { status: "idle" | "saving" | "saved" }) {
  if (status === "idle") return null;
  if (status === "saving") {
    return <span className="inline-flex items-center gap-1 text-[10px] font-medium text-amber-300"><Loader2 className="animate-spin" size={11} aria-hidden="true" />Guardando</span>;
  }
  return <span className="inline-flex items-center gap-1 text-[10px] font-medium text-primary"><CheckCircle2 size={11} aria-hidden="true" />Guardado</span>;
}

function SlotTerritoryModal({
  data,
  mutate,
  onClose,
  slot,
}: {
  data: AppData;
  mutate: (action: string, payload?: Record<string, unknown>, form?: HTMLFormElement) => Promise<unknown>;
  onClose: () => void;
  slot: WeeklyOutingSlot;
}) {
  const openRoundByTerritory = useMemo(
    () => new Map(data.territoryRounds.filter((round) => !round.completed_on).map((round) => [round.territory_id, round])),
    [data.territoryRounds],
  );
  const [selectedIds, setSelectedIds] = useState<Set<string>>(
    () => new Set(slot.weekly_outing_slot_territories.map((entry) => entry.territory_id)),
  );

  function toggle(id: string) {
    setSelectedIds((current) => {
      const next = new Set(current);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  }

  async function save() {
    const territories = [...selectedIds]
      .sort((a, b) => (data.territories.find((item) => item.id === a)?.number ?? 0) - (data.territories.find((item) => item.id === b)?.number ?? 0))
      .map((territoryId) => ({
        territory_id: territoryId,
        territory_round_id: openRoundByTerritory.get(territoryId)?.id ?? null,
        display_override: null,
      }));
    const result = await mutate("setSlotTerritories", { slot_id: slot.id, territories });
    if (result) onClose();
  }

  return (
    <div className="modal-overlay fixed inset-0 z-[75] grid place-items-center bg-black/78 px-4 py-6 backdrop-blur-sm" onMouseDown={(event) => { if (event.target === event.currentTarget) onClose(); }}>
      <div className="modal-panel glass-panel w-full max-w-lg rounded-[1.5rem] border border-white/10 p-5 sm:p-6">
        <div className="flex items-start justify-between gap-3">
          <div>
            <h2 className="text-xl font-semibold tracking-tight text-white">Territorios de la fila</h2>
            <p className="mt-1 text-sm leading-6 text-slate-400">El texto se arma solo con las manzanas que faltan de la vuelta abierta de cada territorio.</p>
          </div>
          <button className="inline-flex h-9 w-9 shrink-0 cursor-pointer items-center justify-center rounded-xl text-slate-400 hover:bg-white/[0.06] hover:text-white" onClick={onClose} type="button"><X size={16} /></button>
        </div>

        <div className="mt-4 grid max-h-[22rem] gap-2 overflow-y-auto rounded-[1.35rem] border border-white/8 bg-black/20 p-2">
          {[...data.territories].sort((a, b) => a.number - b.number).map((territory) => {
            const round = openRoundByTerritory.get(territory.id);
            const selected = selectedIds.has(territory.id);
            return (
              <label
                className={cn(
                  "flex cursor-pointer items-center gap-3 rounded-2xl border px-4 py-3 transition",
                  selected ? "border-primary/35 bg-primary/10 text-white" : "border-white/8 bg-white/[0.03] text-slate-200 hover:border-white/14 hover:bg-white/[0.05]",
                )}
                key={territory.id}
              >
                <input checked={selected} className="h-4 w-4 accent-primary" onChange={() => toggle(territory.id)} type="checkbox" />
                <div className="min-w-0">
                  <p className="font-medium">Territorio #{territory.number}</p>
                  <p className="mt-1 text-xs text-slate-500">
                    {round?.pending_block_labels.length
                      ? `Faltan ${formatPendingBlocks(round.pending_block_labels)}`
                      : round
                        ? "Vuelta abierta, sin manzanas pendientes cargadas"
                        : "Sin vuelta abierta"}
                  </p>
                </div>
              </label>
            );
          })}
        </div>

        <div className="mt-5 grid grid-cols-2 gap-2">
          <button className={secondaryButtonClass} onClick={onClose} type="button">Cancelar</button>
          <button className={primarySmallButtonClass} onClick={() => void save()} type="button">Guardar</button>
        </div>
      </div>
    </div>
  );
}

function DeparturePointModal({
  data,
  item,
  mutate,
  saving,
}: {
  data: AppData;
  item?: DeparturePoint;
  mutate: (action: string, payload?: Record<string, unknown>, form?: HTMLFormElement) => Promise<unknown>;
  saving: boolean;
}) {
  const [name, setName] = useState(item?.name ?? "");
  const [address, setAddress] = useState(item?.address ?? "");
  const [territoryIds, setTerritoryIds] = useState<string[]>(
    () => [...(item?.departure_point_territories ?? [])].sort((a, b) => a.sort_order - b.sort_order).map((entry) => entry.territory_id),
  );
  const [pickerOpen, setPickerOpen] = useState(false);

  const availableToAdd = data.territories.filter((territory) => !territoryIds.includes(territory.id));

  function addTerritory(id: string) {
    setTerritoryIds((current) => (current.includes(id) ? current : [...current, id]));
  }

  function removeTerritory(id: string) {
    setTerritoryIds((current) => current.filter((territoryId) => territoryId !== id));
  }

  function moveTerritory(index: number, direction: -1 | 1) {
    setTerritoryIds((current) => {
      const target = index + direction;
      if (target < 0 || target >= current.length) return current;
      const next = [...current];
      [next[index], next[target]] = [next[target], next[index]];
      return next;
    });
  }

  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    await mutate(item ? "updateDeparturePoint" : "createDeparturePoint", {
      id: item?.id,
      name,
      address,
      territory_ids: territoryIds,
    });
  }

  return (
    <form className="space-y-5 p-5 sm:p-6" onSubmit={submit}>
      <h2 className="text-xl font-semibold tracking-tight text-white">{item ? "Editar punto de salida" : "Nuevo punto de salida"}</h2>

      <div className="space-y-4">
        <Field label="Nombre"><input className={inputClass} onChange={(event) => setName(event.target.value)} placeholder="Ej. Casa de Fulano" required value={name} /></Field>
        <Field label="Direccion / lugar"><input className={inputClass} onChange={(event) => setAddress(event.target.value)} placeholder="Ej. Calle 123, esquina..." required value={address} /></Field>

        <div>
          <p className="text-sm font-medium text-slate-200">Territorios cercanos</p>
          <p className="mt-1 text-xs text-slate-400">De mas cercano a mas lejano. El generador automatico de Salidas semanales elige de esta lista, en este orden.</p>

          <div className="mt-2 space-y-1.5">
            {territoryIds.map((id, index) => {
              const territory = data.territories.find((item2) => item2.id === id);
              return (
                <div className="flex items-center gap-2 rounded-lg border border-white/10 bg-black/20 px-2.5 py-1.5" key={id}>
                  <span className="w-5 shrink-0 text-center text-xs font-semibold text-slate-500">{index + 1}</span>
                  <span className="flex-1 truncate text-sm text-white">Territorio #{territory?.number ?? "?"}</span>
                  <button className="inline-flex h-7 w-7 shrink-0 cursor-pointer items-center justify-center rounded-md text-slate-400 transition hover:bg-white/[0.06] hover:text-white disabled:cursor-not-allowed disabled:opacity-30" disabled={index === 0} onClick={() => moveTerritory(index, -1)} title="Mas cerca" type="button">
                    <ChevronUp size={14} aria-hidden="true" />
                  </button>
                  <button className="inline-flex h-7 w-7 shrink-0 cursor-pointer items-center justify-center rounded-md text-slate-400 transition hover:bg-white/[0.06] hover:text-white disabled:cursor-not-allowed disabled:opacity-30" disabled={index === territoryIds.length - 1} onClick={() => moveTerritory(index, 1)} title="Mas lejos" type="button">
                    <ChevronDown size={14} aria-hidden="true" />
                  </button>
                  <button className="inline-flex h-7 w-7 shrink-0 cursor-pointer items-center justify-center rounded-md text-slate-400 transition hover:bg-rose-500/15 hover:text-rose-300" onClick={() => removeTerritory(id)} title="Quitar" type="button">
                    <X size={14} aria-hidden="true" />
                  </button>
                </div>
              );
            })}
            {!territoryIds.length ? <p className="rounded-lg border border-dashed border-white/12 px-3 py-3 text-center text-sm text-slate-500">Sin territorios asociados.</p> : null}
          </div>

          <button className={miniButtonClass + " mt-2"} onClick={() => setPickerOpen(true)} type="button">
            <Plus size={13} aria-hidden="true" />Agregar territorio
          </button>
        </div>
      </div>

      <button className={primaryButtonClass} disabled={saving} type="submit">{saving ? "Guardando..." : "Guardar"}</button>

      {pickerOpen ? (
        <TerritoryPickerPopup onAdd={addTerritory} onClose={() => setPickerOpen(false)} territories={availableToAdd} />
      ) : null}
    </form>
  );
}

function TerritoryPickerPopup({
  territories,
  onAdd,
  onClose,
}: {
  territories: Territory[];
  onAdd: (id: string) => void;
  onClose: () => void;
}) {
  const [query, setQuery] = useState("");
  const filtered = territories
    .filter((territory) => !query.trim() || String(territory.number).includes(query.trim()))
    .sort((a, b) => a.number - b.number);

  return (
    <div className="modal-overlay fixed inset-0 z-[70] grid place-items-center bg-black/78 px-4 py-6 backdrop-blur-sm" onMouseDown={(event) => { if (event.target === event.currentTarget) onClose(); }}>
      <div className="modal-panel glass-panel w-full max-w-lg rounded-[1.5rem] border border-white/10 p-5 sm:p-6" onMouseDown={(event) => event.stopPropagation()}>
        <div className="flex items-center justify-between gap-3">
          <h3 className="text-lg font-semibold tracking-tight text-white">Agregar territorio</h3>
          <button className="inline-flex h-9 w-9 shrink-0 cursor-pointer items-center justify-center rounded-xl text-slate-400 transition hover:bg-white/[0.06] hover:text-white" onClick={onClose} type="button"><X size={16} aria-hidden="true" /></button>
        </div>

        <div className="relative mt-3">
          <Search aria-hidden="true" className="pointer-events-none absolute left-3 top-1/2 -translate-y-1/2 text-slate-500" size={16} />
          <input autoFocus className={inputClass + " mt-0 pl-9"} onChange={(event) => setQuery(event.target.value)} placeholder="Buscar por numero..." value={query} />
        </div>

        <div className="mt-3 grid max-h-72 grid-cols-4 gap-2 overflow-y-auto sm:grid-cols-5">
          {filtered.map((territory) => (
            <button
              className="flex aspect-square cursor-pointer items-center justify-center rounded-xl border border-white/10 bg-white/[0.03] text-sm font-semibold text-slate-200 transition hover:border-primary/40 hover:bg-primary/10 hover:text-white"
              key={territory.id}
              onClick={() => onAdd(territory.id)}
              type="button"
            >
              #{territory.number}
            </button>
          ))}
          {!filtered.length ? <p className="col-span-full py-6 text-center text-sm text-slate-500">Sin resultados.</p> : null}
        </div>

        <button className={secondaryButtonClass + " mt-4 w-full"} onClick={onClose} type="button">Listo</button>
      </div>
    </div>
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
  const [completionDate, setCompletionDate] = useState(() => new Date().toISOString().slice(0, 10));
  const [isCompletionDateOpen, setCompletionDateOpen] = useState(false);

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
  const allCompleted = total > 0 && completedTotal === total;

  function saveProgress(completedOn?: string) {
    void mutate("setTerritoryBlockProgress", {
      annual_round_id: roundId,
      territory_id: territory.id,
      completed_block_ids: completedExistingIds,
      new_block_labels: newLabels,
      completed_new_block_labels: completedNewLabels,
      completed_on: completedOn,
    });
  }

  return (
    <form
      className="space-y-5 p-5"
      onSubmit={(event) => {
        event.preventDefault();
        if (allCompleted) {
          setCompletionDateOpen(true);
          return;
        }
        saveProgress();
      }}
    >
      <div>
        <h2 className="text-xl font-semibold tracking-tight text-white">Manzanas del territorio #{territory.number}</h2>
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

      <div className="rounded-2xl border border-primary/15 bg-primary/[0.045] p-4 sm:flex sm:items-center sm:justify-between">
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
        <BlockToggleGrid
          blocks={[
            ...blocks.map((block) => ({ id: block.id, label: block.label })),
            ...newLabels.map((label) => ({ id: `new:${label}`, label, variant: "new" as const })),
          ]}
          onToggle={toggle}
          selectedIds={completedIds}
        />
      ) : (
        <div className="rounded-2xl border border-dashed border-white/12 bg-white/[0.03] px-4 py-8 text-center">
          <Grid3X3 className="mx-auto text-slate-500" size={28} />
          <p className="mt-3 text-sm font-medium text-slate-200">Este territorio todavia no tiene manzanas.</p>
          <button className={primarySmallButtonClass + " mt-4"} type="button" onClick={addBlock}><Plus size={16} />Agregar primera manzana</button>
        </div>
      )}

      <button className={primaryButtonClass} disabled={saving || !roundId} type="submit">
        {saving ? "Guardando..." : allCompleted ? "Registrar finalización" : "Guardar avance"}
      </button>

      {isCompletionDateOpen ? (
        <div className="fixed inset-0 z-[60] grid place-items-center bg-black/55 p-4 backdrop-blur-sm" role="dialog" aria-modal="true" aria-labelledby="completion-date-title">
          <section className="w-full max-w-sm rounded-2xl border border-primary/25 bg-[#141516] p-5 shadow-2xl">
            <CalendarDays className="text-primary-hover" size={22} aria-hidden="true" />
            <h3 className="mt-4 text-lg font-semibold text-white" id="completion-date-title">Registrar territorio completado</h3>
            <p className="mt-2 text-sm leading-6 text-slate-300">Todas las manzanas están completas. Indica la fecha de finalización.</p>
            <label className="mt-4 block text-sm font-medium text-slate-200">Fecha de finalización<input className={inputClass} type="date" value={completionDate} onChange={(event) => setCompletionDate(event.target.value)} required /></label>
            <div className="mt-5 grid grid-cols-2 gap-2">
              <button className={secondaryButtonClass} type="button" onClick={() => setCompletionDateOpen(false)}>Volver</button>
              <button className={primarySmallButtonClass} type="button" disabled={saving || !completionDate} onClick={() => saveProgress(completionDate)}>Guardar fecha</button>
            </div>
          </section>
        </div>
      ) : null}
    </form>
  );
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
  return <label className="block text-sm font-medium text-foreground/90">{label}{children}</label>;
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
        <p className="text-sm font-semibold text-foreground">{success ? "Cambios aplicados" : "No se pudo completar"}</p>
        <p className="mt-1 text-sm leading-5 text-muted">{toast.text}</p>
      </div>
      <button className="absolute right-2.5 top-2.5 inline-flex h-8 w-8 cursor-pointer items-center justify-center rounded-lg text-muted transition-colors hover:bg-foreground/[0.06] hover:text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-foreground/30" onClick={onClose} type="button" aria-label="Cerrar aviso"><X size={15} /></button>
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
    <div className="modal-overlay fixed inset-0 z-[70] grid place-items-center bg-[var(--overlay-strong)] px-4 py-6 backdrop-blur-sm" onMouseDown={(event) => { if (event.target === event.currentTarget) onCancel(); }}>
      <div className={cn("modal-panel glass-panel w-full max-w-md rounded-[1.5rem] border", destructive ? "border-rose-400/25" : "border-sky-400/20")} role="alertdialog" aria-modal="true" aria-labelledby="confirmation-title" aria-describedby="confirmation-description">
        <div className="p-5 sm:p-6">
          <span className={cn("inline-flex h-12 w-12 items-center justify-center rounded-2xl border", destructive ? "border-rose-400/20 bg-rose-500/12 text-rose-300" : "border-sky-400/20 bg-sky-500/12 text-sky-300")}>
            {destructive ? <TriangleAlert size={22} aria-hidden="true" /> : <Save size={22} aria-hidden="true" />}
          </span>
          <h2 className="mt-5 text-xl font-semibold tracking-tight text-foreground" id="confirmation-title">{confirmation.title}</h2>
          <p className="mt-2 text-sm leading-6 text-muted" id="confirmation-description">{confirmation.description}</p>
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
  return <div className={cn("modal-overlay fixed inset-0 z-50 grid place-items-center bg-[var(--overlay-soft)] px-4 py-6 backdrop-blur-md", closing && "is-closing")}><div className="modal-panel glass-panel w-full max-w-md rounded-[1.5rem] border-emerald-400/20"><div className="border-b border-border p-5"><h2 className="text-xl font-semibold text-foreground">Contrasena temporal</h2><p className="mt-2 text-sm leading-6 text-muted">Ya fue copiada al portapapeles.</p></div><div className="space-y-4 p-5"><div className="break-all rounded-2xl border border-emerald-400/25 bg-emerald-500/12 px-4 py-3 font-mono text-sm font-semibold text-emerald-100">{password}</div><div className="grid gap-2 sm:grid-cols-2"><button className={secondaryButtonClass} type="button" onClick={() => void navigator.clipboard?.writeText(password)}><Copy size={16} />Copiar</button><button className={primarySmallButtonClass} type="button" onClick={close}>Listo</button></div></div></div></div>;
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
        <p className="text-3xl font-semibold tracking-tight text-foreground">{value}</p>
      </div>
      <p className="mt-4 text-sm font-semibold text-foreground/90">{label}</p>
      <p className="mt-1 text-xs text-muted">{detail}</p>
      {typeof progress === "number" ? <div className="mt-4 h-1.5 overflow-hidden rounded-full bg-foreground/[0.06]"><div className={cn("h-full rounded-full transition-[width] duration-500", bars[tone])} style={{ width: `${Math.min(100, Math.max(0, progress))}%` }} /></div> : null}
    </article>
  );
}
function EmptyState({ icon, title, text }: { icon: React.ReactNode; title: string; text: string }) {
  return <section className="glass-panel rounded-[1.75rem] px-5 py-12 text-center"><span className="mx-auto inline-flex h-12 w-12 items-center justify-center rounded-2xl border border-border bg-foreground/[0.04] text-foreground">{icon}</span><h2 className="mt-4 text-lg font-semibold text-foreground">{title}</h2><p className="mx-auto mt-2 max-w-md text-sm leading-6 text-muted">{text}</p></section>;
}
function Panel({ title, description, action, children }: { title: string; description: string; action?: React.ReactNode; children: React.ReactNode }) {
  return <section className="glass-panel rounded-[1.75rem]"><div className="flex flex-col gap-3 border-b border-border p-5 sm:flex-row sm:items-center sm:justify-between"><div><h2 className="text-lg font-semibold text-foreground">{title}</h2><p className="mt-1 text-sm text-muted">{description}</p></div>{action}</div><div className="space-y-4 p-5">{children}</div></section>;
}
function DataTable({ headers, children }: { headers: string[]; children: React.ReactNode }) {
  return <div className="overflow-x-auto rounded-2xl border border-border bg-foreground/[0.02]"><table className="w-full min-w-[760px] border-collapse text-left text-sm text-foreground/90"><thead className="bg-foreground/[0.04] text-xs uppercase tracking-[0.12em] text-muted"><tr>{headers.map((header) => <th className="px-3 py-3 font-semibold" key={header}>{header}</th>)}</tr></thead><tbody className="divide-y divide-border">{children}</tbody></table></div>;
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
  return <button className="inline-flex min-h-9 cursor-pointer items-center justify-center rounded-xl border border-border bg-foreground/[0.04] px-3 text-foreground/90 transition hover:border-foreground/18 hover:bg-foreground/[0.08] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-foreground/30" onClick={onClick} type="button" aria-label={label} title={label}>{children}</button>;
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
  return <div className={cn("modal-overlay fixed inset-0 z-40 grid place-items-center overflow-y-auto bg-[var(--overlay-soft)] px-4 py-6 backdrop-blur-sm", closing && "is-closing")} onMouseDown={(event) => { if (event.target === event.currentTarget) close(); }}><div className={cn("modal-panel glass-panel w-full rounded-[1.5rem]", modal.type === "territoryBlocks" || modal.type === "territoryVisit" ? "max-w-3xl" : "max-w-lg")} role="dialog" aria-modal="true"><div className="flex justify-end border-b border-border p-3"><button className="inline-flex h-10 w-10 cursor-pointer items-center justify-center rounded-xl text-muted transition-colors duration-200 hover:bg-foreground/[0.06] hover:text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-foreground/30" onClick={close} type="button" aria-label="Cerrar"><X size={18} /></button></div>{children}</div></div>;
}
function FormModal({ title, subtitle, saving, onSubmit, children, hideSubmit = false }: { title: string; subtitle?: string; saving: boolean; onSubmit: (event: FormEvent<HTMLFormElement>) => void; children: React.ReactNode; hideSubmit?: boolean }) {
  return <form className="space-y-5 p-5 sm:p-6" onSubmit={onSubmit}><div><h2 className="text-xl font-semibold tracking-tight text-foreground">{title}</h2>{subtitle ? <p className="mt-1 text-sm text-muted">{subtitle}</p> : null}</div><div className="space-y-4">{children}</div>{!hideSubmit ? <button className={primaryButtonClass} disabled={saving} type="submit">{saving ? "Guardando..." : "Guardar"}</button> : null}</form>;
}
