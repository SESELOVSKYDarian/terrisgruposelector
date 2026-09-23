"use client";

import { useEffect, useState } from "react";
import { X } from "lucide-react";
import { Select } from "@/app/_components/select";
import { primaryButtonClass } from "@/app/_components/ui-classes";
import { cn } from "@/lib/utils";
import {
  appointmentKinds,
  capabilityKinds,
  globalResponsibilityKinds,
  groupResponsibilityKinds,
  isEligibleForResponsibility,
  responsibilityEligibilityMessage,
  type AppointmentKind,
  type CapabilityKind,
  type GlobalResponsibilityKind,
  type GroupResponsibilityKind,
  type StructuredPermissions,
} from "@/modules/users/permissions";
import { Notice } from "../ui";

const appointmentLabels: Record<AppointmentKind, string> = { ANCIANO: "Anciano", SIERVO_MINISTERIAL: "Siervo ministerial", PUBLICADOR: "Publicador" };
const capabilityLabels: Record<CapabilityKind, string> = { CONDUCTOR: "Conductor", PRECURSOR: "Precursor" };
const globalLabels: Record<GlobalResponsibilityKind, string> = { COORDINADOR: "Coordinador", SUPERINTENDENTE_SERVICIO: "Superintendente de servicio", SIERVO_TERRITORIOS: "Siervo de territorios" };
const groupLabels: Record<GroupResponsibilityKind, string> = { SUPERINTENDENTE_GRUPO: "Superintendente de grupo", AUXILIAR_GRUPO: "Auxiliar de grupo" };

type State = StructuredPermissions;

async function requestJson(path: string, init?: RequestInit) {
  const response = await fetch(path, { ...init, credentials: "same-origin", headers: { "Content-Type": "application/json", ...(init?.headers ?? {}) } });
  const body = await response.json().catch(() => ({}));
  if (!response.ok) throw new Error(body.error ?? "Error inesperado.");
  return body;
}

/**
 * Condición / características / responsabilidades del modelo V2 — separado del modal legacy de
 * roles porque son dos modelos distintos que conviven (ver mapLegacyRolesToStructuredPermissions).
 */
export function UserPermissionsModal({ profile, groups, onClose, onSaved }: { profile: { id: string; full_name: string; group_id: string | null }; groups: { id: string; name: string }[]; onClose: () => void; onSaved: () => void }) {
  const [state, setState] = useState<State | null>(null);
  const [groupChoice, setGroupChoice] = useState(profile.group_id ?? "");
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState("");

  useEffect(() => {
    let cancelled = false;
    requestJson(`/api/v2/user-permissions?profileId=${profile.id}`)
      .then((body) => {
        if (cancelled) return;
        setState(body.permissions as State);
        if (body.permissions.groupResponsibilities[0]) setGroupChoice(body.permissions.groupResponsibilities[0].groupId);
      })
      .catch((cause) => !cancelled && setError(cause instanceof Error ? cause.message : "No se pudieron cargar los permisos."))
      .finally(() => !cancelled && setLoading(false));
    return () => {
      cancelled = true;
    };
  }, [profile.id]);

  if (loading) return <Overlay onClose={onClose} title={profile.full_name}><Notice>Cargando…</Notice></Overlay>;
  if (!state) return <Overlay onClose={onClose} title={profile.full_name}><Notice tone="error">{error || "No se pudieron cargar los permisos."}</Notice></Overlay>;

  const eligibility = { appointment: state.appointment, capabilities: state.capabilities };
  const groupResponsibility = state.groupResponsibilities[0]?.responsibility ?? "";

  function toggleCapability(capability: CapabilityKind) {
    setState((current) => current && { ...current, capabilities: current.capabilities.includes(capability) ? current.capabilities.filter((entry) => entry !== capability) : [...current.capabilities, capability] });
  }
  function toggleGlobal(responsibility: GlobalResponsibilityKind) {
    setState((current) => current && { ...current, globalResponsibilities: current.globalResponsibilities.includes(responsibility) ? current.globalResponsibilities.filter((entry) => entry !== responsibility) : [...current.globalResponsibilities, responsibility] });
  }
  function setGroupResponsibility(responsibility: GroupResponsibilityKind | "") {
    setState((current) => current && { ...current, groupResponsibilities: responsibility && groupChoice ? [{ groupId: groupChoice, responsibility }] : [] });
  }

  async function save() {
    if (!state) return;
    setSaving(true);
    setError("");
    try {
      await requestJson("/api/v2/user-permissions", { method: "POST", body: JSON.stringify({ profileId: profile.id, permissions: state }) });
      onSaved();
      onClose();
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "No se pudo guardar.");
    } finally {
      setSaving(false);
    }
  }

  return (
    <Overlay onClose={onClose} title={profile.full_name}>
      <div className="space-y-5">
        {error ? <Notice tone="error">{error}</Notice> : null}

        <div>
          <p className="mb-2 text-sm font-semibold text-foreground">Condición</p>
          <div className="w-56"><Select onChange={(value) => setState((current) => current && { ...current, appointment: value as AppointmentKind })} options={appointmentKinds.map((kind) => ({ value: kind, label: appointmentLabels[kind] }))} value={state.appointment} /></div>
        </div>

        <div>
          <p className="mb-2 text-sm font-semibold text-foreground">Características</p>
          <div className="flex flex-wrap gap-3">
            {capabilityKinds.map((capability) => (
              <label className="flex items-center gap-2 text-sm text-foreground/90" key={capability}>
                <input checked={state.capabilities.includes(capability)} className="h-4 w-4 accent-primary" onChange={() => toggleCapability(capability)} type="checkbox" />
                {capabilityLabels[capability]}
              </label>
            ))}
          </div>
        </div>

        <div>
          <p className="mb-2 text-sm font-semibold text-foreground">Responsabilidades</p>
          <div className="space-y-2">
            {globalResponsibilityKinds.map((responsibility) => {
              const eligible = isEligibleForResponsibility(eligibility, responsibility);
              const checked = state.globalResponsibilities.includes(responsibility);
              return (
                <label className={cn("flex items-start gap-2 text-sm", eligible ? "text-foreground/90" : "text-muted")} key={responsibility}>
                  <input checked={checked} className="mt-0.5 h-4 w-4 accent-primary" disabled={!eligible && !checked} onChange={() => toggleGlobal(responsibility)} type="checkbox" />
                  <span>
                    {globalLabels[responsibility]}
                    {!eligible ? <span className="block text-xs text-muted">{responsibilityEligibilityMessage(responsibility)}</span> : null}
                  </span>
                </label>
              );
            })}
          </div>
        </div>

        <div>
          <p className="mb-2 text-sm font-semibold text-foreground">Responsabilidad de grupo</p>
          <div className="flex flex-wrap items-end gap-3">
            <div className="w-48">
              <Select onChange={(value) => setGroupChoice(value)} options={groups.map((group) => ({ value: group.id, label: group.name }))} placeholder="Elegir grupo" value={groupChoice} />
            </div>
            <div className="w-56">
              <Select
                onChange={(value) => setGroupResponsibility(value as GroupResponsibilityKind | "")}
                options={groupChoice ? [{ value: "", label: "Ninguna" }, ...groupResponsibilityKinds.filter((kind) => isEligibleForResponsibility(eligibility, kind)).map((kind) => ({ value: kind, label: groupLabels[kind] }))] : [{ value: "", label: "Elegí un grupo primero" }]}
                value={groupResponsibility}
              />
            </div>
          </div>
          {!groupResponsibilityKinds.some((kind) => isEligibleForResponsibility(eligibility, kind)) ? <p className="mt-1 text-xs text-muted">{responsibilityEligibilityMessage("SUPERINTENDENTE_GRUPO")}</p> : null}
        </div>

        <button className={primaryButtonClass} disabled={saving} onClick={() => void save()} type="button">
          {saving ? "Guardando…" : "Guardar permisos"}
        </button>
      </div>
    </Overlay>
  );
}

function Overlay({ title, onClose, children }: { title: string; onClose: () => void; children: React.ReactNode }) {
  return (
    <div className="modal-overlay fixed inset-0 z-50 grid place-items-center overflow-y-auto bg-[var(--overlay-soft)] px-4 py-6 backdrop-blur-sm" onMouseDown={(event) => event.target === event.currentTarget && onClose()}>
      <div className="modal-panel glass-panel w-full max-w-lg rounded-[1.5rem]" role="dialog" aria-modal="true">
        <div className="flex items-center justify-between border-b border-border/60 p-4">
          <div>
            <h2 className="text-lg font-semibold text-foreground">Permisos de {title}</h2>
            <p className="text-xs text-muted">Condición, características y responsabilidades (modelo V2)</p>
          </div>
          <button aria-label="Cerrar" className="inline-flex h-10 w-10 items-center justify-center rounded-xl text-muted transition-colors hover:bg-foreground/[0.06] hover:text-foreground" onClick={onClose} type="button"><X size={18} /></button>
        </div>
        <div className="p-5">{children}</div>
      </div>
    </div>
  );
}
