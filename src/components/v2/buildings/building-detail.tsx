"use client";

import { useState } from "react";
import { AlertTriangle, ArrowDown, ArrowLeft, ArrowRight, ArrowUp, Pencil, Plus, X } from "lucide-react";
import { miniButtonClass, primarySmallButtonClass, secondaryButtonClass } from "@/app/_components/ui-classes";
import { gridSize, normalizeLabel, type Unit } from "@/modules/buildings/structure";
import { cn } from "@/lib/utils";
import { Card, Notice, Pill, fieldClass } from "../ui";
import { CensusReportForm } from "./census-report-form";
import { UnitCell, type UnitStatusView } from "./unit-cell";
import type { CensusRow } from "./census-inbox";
import { describeDiff } from "@/modules/buildings/structure";
import { useModuleApi } from "../use-module-api";

export type BuildingData = { id: string; territory_id: string; territory_number: number; address: string; status: string; structure_version: number; units: Unit[] };
type Detail = { canManage: boolean; me: string; me_name: string; building: BuildingData; statuses: Record<string, UnitStatusView>; round: { current: { round_number: number; started_at: string; total: number; done: number } | null; history: { round_number: number; started_at: string; closed_at: string }[] } };

function StructureEditor({ building, onSaved, onCancel }: { building: BuildingData; onSaved: () => void; onCancel: () => void }) {
  const [units, setUnits] = useState<Unit[]>(building.units.map((unit) => ({ ...unit })));
  const [error, setError] = useState("");
  const [saving, setSaving] = useState(false);
  const size = gridSize(units);
  const rows = size.rows + 1;
  const cols = Math.max(size.cols + 1, 2);
  const at = (row: number, col: number) => units.findIndex((unit) => unit.row === row && unit.col === col);

  function move(index: number, dRow: number, dCol: number) {
    setUnits((current) => {
      const unit = current[index];
      const row = unit.row + dRow;
      const col = unit.col + dCol;
      if (row < 0 || col < 0) return current;
      const other = current.findIndex((entry) => entry.row === row && entry.col === col);
      return current.map((entry, position) => (position === index ? { ...entry, row, col } : position === other ? { ...entry, row: unit.row, col: unit.col } : entry));
    });
  }

  async function save() {
    setSaving(true);
    setError("");
    try {
      const response = await fetch("/api/v2/buildings", { method: "POST", credentials: "same-origin", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ action: "saveStructure", payload: { building_id: building.id, expected_version: building.structure_version, units } }) });
      const body = await response.json();
      if (!response.ok) throw new Error(body.error ?? "No se pudo guardar.");
      onSaved();
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "Error inesperado.");
    } finally {
      setSaving(false);
    }
  }

  return (
    <div className="space-y-3">
      {error ? <Notice tone="error">{error}</Notice> : null}
      <div className="grid gap-2" style={{ gridTemplateColumns: `repeat(${cols}, minmax(0, 1fr))` }}>
        {Array.from({ length: rows * cols }, (_, index) => {
          const row = Math.floor(index / cols);
          const col = index % cols;
          const position = at(row, col);
          if (position === -1) {
            return <button aria-label="Agregar timbre" className="flex min-h-16 items-center justify-center rounded-lg border border-dashed border-border text-muted transition hover:bg-foreground/[0.05]" key={`${row}:${col}`} onClick={() => setUnits((current) => [...current, { id: null, label: `${String.fromCharCode(65 + (row % 26))}${col + 1}`, row, col }])} type="button"><Plus size={16} aria-hidden="true" /></button>;
          }
          const unit = units[position];
          return (
            <div className="space-y-1 rounded-lg border border-border bg-foreground/[0.04] p-1.5" key={`${row}:${col}`}>
              <input aria-label="Nombre del timbre" className={cn(fieldClass, "w-full text-center font-semibold")} onChange={(event) => setUnits((current) => current.map((entry, index) => (index === position ? { ...entry, label: event.target.value } : entry)))} onBlur={() => setUnits((current) => current.map((entry, index) => (index === position ? { ...entry, label: normalizeLabel(entry.label) || entry.label } : entry)))} value={unit.label} />
              <div className="flex justify-between text-muted">
                <button aria-label="Mover a la izquierda" className="p-1 hover:text-foreground" onClick={() => move(position, 0, -1)} type="button"><ArrowLeft size={13} /></button>
                <button aria-label="Mover arriba" className="p-1 hover:text-foreground" onClick={() => move(position, -1, 0)} type="button"><ArrowUp size={13} /></button>
                <button aria-label="Mover abajo" className="p-1 hover:text-foreground" onClick={() => move(position, 1, 0)} type="button"><ArrowDown size={13} /></button>
                <button aria-label="Mover a la derecha" className="p-1 hover:text-foreground" onClick={() => move(position, 0, 1)} type="button"><ArrowRight size={13} /></button>
                <button aria-label="Quitar timbre" className="p-1 hover:text-rose-300" onClick={() => setUnits((current) => current.filter((_, index) => index !== position))} type="button"><X size={13} /></button>
              </div>
            </div>
          );
        })}
      </div>
      <div className="flex gap-2">
        <button className={primarySmallButtonClass} disabled={saving} onClick={() => void save()} type="button">Guardar estructura</button>
        <button className={secondaryButtonClass} onClick={onCancel} type="button">Cancelar</button>
      </div>
    </div>
  );
}

/** Read-only grid of the building's doorbells; managers can switch to the structure editor. */
export function BuildingDetail({ buildingId, onBack, renderUnit, evidence, startEditing }: { buildingId: string; onBack: () => void; renderUnit?: (unit: Unit, building: BuildingData) => React.ReactNode; evidence?: CensusRow | null; startEditing?: boolean }) {
  const { data, error, loading, reload } = useModuleApi<Detail>(`/api/v2/buildings?building=${buildingId}`);
  const [editing, setEditing] = useState(Boolean(startEditing));
  const [reporting, setReporting] = useState(false);
  const [reported, setReported] = useState(false);
  const [unlockConfirm, setUnlockConfirm] = useState<"building" | "territory" | null>(null);
  const [unlockMessage, setUnlockMessage] = useState("");
  const [roundNote, setRoundNote] = useState("");
  if (loading) return <Notice>Cargando edificio…</Notice>;
  if (!data) return <Notice tone="error">{error || "No se pudo cargar el edificio."}</Notice>;

  const { building, canManage } = data;
  const size = gridSize(building.units);

  async function unlock(scope: "BUILDING" | "TERRITORY") {
    const response = await fetch("/api/v2/buildings", { method: "POST", credentials: "same-origin", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ action: "unlock", payload: { scope, id: scope === "BUILDING" ? building.id : building.territory_id } }) });
    const body = await response.json().catch(() => ({}));
    setUnlockConfirm(null);
    setUnlockMessage(response.ok ? `Desbloqueado: ${body.unlocked ?? 0} registro(s) liberados.` : body.error ?? "No se pudo desbloquear.");
    if (response.ok) void reload();
  }
  return (
    <div className="space-y-3">
      <button className={miniButtonClass} onClick={onBack} type="button"><ArrowLeft size={14} aria-hidden="true" />Volver</button>
      {evidence ? (
        <Notice tone="warning">
          Evidencia del informe: {evidence.description || "sin descripción"}{evidence.diff ? ` · Propuesta: ${describeDiff(evidence.diff)}` : ""}{evidence.base_version !== building.structure_version ? " · El edificio cambió desde que se informó." : ""}
        </Notice>
      ) : null}
      {unlockMessage ? <Notice tone="info">{unlockMessage}</Notice> : null}
      {roundNote ? <Notice tone="success">{roundNote}</Notice> : null}
      {reported ? <Notice tone="success">Informe enviado: Servicio y Territorios lo van a revisar.</Notice> : null}
      {reporting ? <CensusReportForm buildingId={building.id} onCancel={() => setReporting(false)} onDone={() => { setReporting(false); setReported(true); }} units={building.units} version={building.structure_version} /> : null}
      <Card title={building.address} description={`Territorio ${building.territory_number} · ${building.units.length} timbre${building.units.length === 1 ? "" : "s"}${data.round.current ? ` · Vuelta ${data.round.current.round_number}: ${data.round.current.done} de ${data.round.current.total} trabajados` : ""}`} action={<div className="flex items-center gap-2">{building.status !== "ACTIVE" ? <Pill tone="slate">Inactivo</Pill> : null}{!editing && !reporting ? <button className={miniButtonClass} onClick={() => setReporting(true)} type="button"><AlertTriangle size={14} aria-hidden="true" />Falta censar</button> : null}{canManage && !editing ? <button className={miniButtonClass} onClick={() => setEditing(true)} type="button"><Pencil size={14} aria-hidden="true" />Editar estructura</button> : null}{canManage && !editing ? (unlockConfirm ? (<><button className={miniButtonClass} onClick={() => void unlock(unlockConfirm === "building" ? "BUILDING" : "TERRITORY")} type="button">Confirmar desbloqueo {unlockConfirm === "building" ? "del edificio" : `del territorio ${building.territory_number}`}</button><button className={miniButtonClass} onClick={() => setUnlockConfirm(null)} type="button">Cancelar</button></>) : (<><button className={miniButtonClass} onClick={() => setUnlockConfirm("building")} type="button">Desbloquear edificio</button><button className={miniButtonClass} onClick={() => setUnlockConfirm("territory")} type="button">Desbloquear territorio</button></>)) : null}</div>}>
        {editing ? (
          <StructureEditor building={building} onCancel={() => setEditing(false)} onSaved={() => { setEditing(false); void reload(); }} />
        ) : building.units.length ? (
          <div className="grid gap-2" style={{ gridTemplateColumns: `repeat(${Math.max(size.cols, 1)}, minmax(0, 1fr))` }}>
            {Array.from({ length: size.rows * size.cols }, (_, index) => {
              const row = Math.floor(index / size.cols);
              const col = index % size.cols;
              const unit = building.units.find((entry) => entry.row === row && entry.col === col);
              if (!unit) return <div key={`${row}:${col}`} />;
              const status = unit.id ? data.statuses[unit.id] : undefined;
              if (renderUnit) return <div key={unit.id ?? `${row}:${col}`}>{renderUnit(unit, building)}</div>;
              return status ? <UnitCell building={building} canManage={canManage} key={unit.id ?? `${row}:${col}`} me={data.me} meName={data.me_name} onChanged={(result) => { const closed = result?.round_closed as number | null | undefined; setRoundNote(closed ? `Vuelta ${closed} completada: todos los departamentos fueron trabajados. Empieza la vuelta ${closed + 1}.` : result?.round_reopened ? "Se reabrió la vuelta porque se deshizo el último departamento." : ""); void reload(); }} status={status} unit={unit} /> : <div className="flex min-h-14 items-center justify-center rounded-lg border border-border bg-foreground/[0.04] text-sm font-semibold text-foreground" key={unit.id ?? `${row}:${col}`}>{unit.label}</div>;
            })}
          </div>
        ) : (
          <p className="text-sm text-muted">Este edificio todavía no tiene timbres cargados.{canManage ? " Usá «Editar estructura» para agregarlos." : " Informá que falta censarlo."}</p>
        )}
      </Card>
      {data.round.history.length ? (
        <p className="px-1 text-xs text-muted">
          Vueltas cerradas: {data.round.history.map((round) => `#${round.round_number} (${new Date(round.closed_at).toLocaleDateString("es-AR", { timeZone: "America/Argentina/Buenos_Aires" })})`).join(" · ")}
        </p>
      ) : null}
    </div>
  );
}
