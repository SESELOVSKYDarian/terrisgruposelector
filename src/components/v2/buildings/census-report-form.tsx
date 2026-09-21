"use client";

import { useState } from "react";
import { Camera, Plus, X } from "lucide-react";
import { Select } from "@/app/_components/select";
import { miniButtonClass, primarySmallButtonClass, secondaryButtonClass } from "@/app/_components/ui-classes";
import { censusReasonLabels, censusReasons, type CensusReason, type DiffOp, type Unit } from "@/modules/buildings/structure";
import { cn } from "@/lib/utils";
import { Notice, fieldClass } from "../ui";
import { compressPhoto } from "./image";

type Draft = { kind: "ADD" | "REMOVE" | "RENAME"; label: string; to: string };

/** "Falta censar": reason, description, optional photo and an optional structured proposal (date/user/building are automatic). */
export function CensusReportForm({ buildingId, version, units, onDone, onCancel }: { buildingId: string; version: number; units: Unit[]; onDone: () => void; onCancel: () => void }) {
  const [reason, setReason] = useState<CensusReason>("FALTAN_TIMBRES");
  const [description, setDescription] = useState("");
  const [photo, setPhoto] = useState<string | null>(null);
  const [drafts, setDrafts] = useState<Draft[]>([]);
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);

  async function choosePhoto(file: File | undefined) {
    if (!file) return;
    try {
      setPhoto(await compressPhoto(file));
      setError("");
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "No se pudo cargar la foto.");
    }
  }

  function toOps(): DiffOp[] {
    return drafts.flatMap((draft): DiffOp[] => {
      if (!draft.label.trim()) return [];
      if (draft.kind === "ADD") return [{ op: "ADD", label: draft.label }];
      if (draft.kind === "REMOVE") return [{ op: "REMOVE", label: draft.label }];
      return draft.to.trim() ? [{ op: "RENAME", from: draft.label, to: draft.to }] : [];
    });
  }

  async function submit() {
    setBusy(true);
    setError("");
    try {
      const ops = toOps();
      const response = await fetch("/api/v2/buildings", { method: "POST", credentials: "same-origin", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ action: "reportCensus", payload: { building_id: buildingId, base_version: version, reason, description: description || null, photo_data: photo, diff: ops.length ? ops : null } }) });
      const body = await response.json();
      if (!response.ok) throw new Error(body.error ?? "No se pudo enviar.");
      onDone();
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "Error inesperado.");
    } finally {
      setBusy(false);
    }
  }

  const unitOptions = units.map((unit) => ({ value: unit.label, label: unit.label }));

  return (
    <div className="space-y-3 rounded-xl border border-amber-400/30 bg-amber-500/[0.06] p-3">
      <p className="text-sm font-semibold text-foreground">Falta censar</p>
      <div className="w-64"><Select onChange={(value) => setReason(value as CensusReason)} options={censusReasons.map((entry) => ({ value: entry, label: censusReasonLabels[entry] }))} size="compact" value={reason} /></div>
      <label className="block text-xs text-muted">Descripción
        <textarea className={cn(fieldClass, "mt-1 block min-h-16 w-full")} onChange={(event) => setDescription(event.target.value)} placeholder="Ej. En la planta baja hay un timbre A3 que no figura." value={description} />
      </label>

      <div className="space-y-2">
        <p className="text-xs text-muted">Propuesta de cambios (opcional): permite que Servicio o Territorios la apliquen con un toque.</p>
        {drafts.map((draft, index) => (
          <div className="flex flex-wrap items-center gap-2" key={index}>
            <div className="w-32"><Select onChange={(value) => setDrafts((current) => current.map((entry, position) => (position === index ? { ...entry, kind: value as Draft["kind"], label: "", to: "" } : entry)))} options={[{ value: "ADD", label: "Agregar" }, { value: "REMOVE", label: "Quitar" }, { value: "RENAME", label: "Renombrar" }]} size="compact" value={draft.kind} /></div>
            {draft.kind === "ADD" ? (
              <input aria-label="Nombre del timbre nuevo" className={cn(fieldClass, "w-36")} onChange={(event) => setDrafts((current) => current.map((entry, position) => (position === index ? { ...entry, label: event.target.value } : entry)))} placeholder="Ej. A3" value={draft.label} />
            ) : (
              <div className="w-36"><Select onChange={(value) => setDrafts((current) => current.map((entry, position) => (position === index ? { ...entry, label: value } : entry)))} options={unitOptions} placeholder="Timbre" size="compact" value={draft.label} /></div>
            )}
            {draft.kind === "RENAME" ? <input aria-label="Nombre nuevo" className={cn(fieldClass, "w-36")} onChange={(event) => setDrafts((current) => current.map((entry, position) => (position === index ? { ...entry, to: event.target.value } : entry)))} placeholder="Nombre nuevo" value={draft.to} /> : null}
            <button aria-label="Quitar cambio" className="text-muted hover:text-rose-300" onClick={() => setDrafts((current) => current.filter((_, position) => position !== index))} type="button"><X size={15} /></button>
          </div>
        ))}
        <button className={miniButtonClass} onClick={() => setDrafts((current) => [...current, { kind: "ADD", label: "", to: "" }])} type="button"><Plus size={14} aria-hidden="true" />Agregar cambio</button>
      </div>

      <div className="flex flex-wrap items-center gap-2">
        <label className={cn(miniButtonClass, "cursor-pointer")}>
          <Camera size={14} aria-hidden="true" />{photo ? "Cambiar foto" : "Adjuntar foto"}
          <input accept="image/*" capture="environment" className="sr-only" onChange={(event) => void choosePhoto(event.target.files?.[0])} type="file" />
        </label>
        {photo ? <span className="text-xs text-muted">Foto adjunta</span> : null}
      </div>

      {error ? <Notice tone="error">{error}</Notice> : null}
      <div className="flex gap-2">
        <button className={primarySmallButtonClass} disabled={busy} onClick={() => void submit()} type="button">Enviar informe</button>
        <button className={secondaryButtonClass} onClick={onCancel} type="button">Cancelar</button>
      </div>
    </div>
  );
}
