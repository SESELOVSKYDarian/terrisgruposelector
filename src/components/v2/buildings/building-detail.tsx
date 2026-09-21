"use client";

import { useState } from "react";
import { ArrowDown, ArrowLeft, ArrowRight, ArrowUp, Pencil, Plus, X } from "lucide-react";
import { miniButtonClass, primarySmallButtonClass, secondaryButtonClass } from "@/app/_components/ui-classes";
import { gridSize, normalizeLabel, type Unit } from "@/modules/buildings/structure";
import { cn } from "@/lib/utils";
import { Card, Notice, Pill, fieldClass } from "../ui";
import { useModuleApi } from "../use-module-api";

export type BuildingData = { id: string; territory_id: string; territory_number: number; address: string; status: string; structure_version: number; units: Unit[] };
type Detail = { canManage: boolean; building: BuildingData };

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
export function BuildingDetail({ buildingId, onBack, renderUnit }: { buildingId: string; onBack: () => void; renderUnit?: (unit: Unit, building: BuildingData) => React.ReactNode }) {
  const { data, error, loading, reload } = useModuleApi<Detail>(`/api/v2/buildings?building=${buildingId}`);
  const [editing, setEditing] = useState(false);
  if (loading) return <Notice>Cargando edificio…</Notice>;
  if (!data) return <Notice tone="error">{error || "No se pudo cargar el edificio."}</Notice>;

  const { building, canManage } = data;
  const size = gridSize(building.units);
  return (
    <div className="space-y-3">
      <button className={miniButtonClass} onClick={onBack} type="button"><ArrowLeft size={14} aria-hidden="true" />Volver</button>
      <Card title={building.address} description={`Territorio ${building.territory_number} · ${building.units.length} timbre${building.units.length === 1 ? "" : "s"}`} action={<div className="flex items-center gap-2">{building.status !== "ACTIVE" ? <Pill tone="slate">Inactivo</Pill> : null}{canManage && !editing ? <button className={miniButtonClass} onClick={() => setEditing(true)} type="button"><Pencil size={14} aria-hidden="true" />Editar estructura</button> : null}</div>}>
        {editing ? (
          <StructureEditor building={building} onCancel={() => setEditing(false)} onSaved={() => { setEditing(false); void reload(); }} />
        ) : building.units.length ? (
          <div className="grid gap-2" style={{ gridTemplateColumns: `repeat(${Math.max(size.cols, 1)}, minmax(0, 1fr))` }}>
            {Array.from({ length: size.rows * size.cols }, (_, index) => {
              const row = Math.floor(index / size.cols);
              const col = index % size.cols;
              const unit = building.units.find((entry) => entry.row === row && entry.col === col);
              if (!unit) return <div key={`${row}:${col}`} />;
              return renderUnit ? <div key={unit.id ?? `${row}:${col}`}>{renderUnit(unit, building)}</div> : <div className="flex min-h-14 items-center justify-center rounded-lg border border-border bg-foreground/[0.04] text-sm font-semibold text-foreground" key={unit.id ?? `${row}:${col}`}>{unit.label}</div>;
            })}
          </div>
        ) : (
          <p className="text-sm text-muted">Este edificio todavía no tiene timbres cargados.{canManage ? " Usá «Editar estructura» para agregarlos." : " Informá que falta censarlo."}</p>
        )}
      </Card>
    </div>
  );
}
