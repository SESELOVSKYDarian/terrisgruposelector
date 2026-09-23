"use client";

import { Home, MapPin, X } from "lucide-react";
import { pointKindLabels, type PointKind } from "@/modules/outings/suggestions";
import { cn } from "@/lib/utils";

export type PlaceOption = {
  pointId: string;
  kind: PointKind;
  lugar: string;
  title: string;
  territoryId: string;
  territoryRoundId: string | null;
  territoryNumber: number | string;
  reason: string;
};

export function KindBadge({ kind }: { kind: PointKind }) {
  return (
    <span className={cn("inline-flex items-center gap-1 rounded-md border px-1.5 py-0.5 text-[11px] font-medium", kind === "CASA" ? "border-emerald-400/30 bg-emerald-500/12 text-emerald-200" : "border-white/10 bg-white/[0.05] text-slate-300")}>
      {kind === "CASA" ? <Home size={11} aria-hidden="true" /> : <MapPin size={11} aria-hidden="true" />}
      {pointKindLabels[kind]}
    </span>
  );
}

/** Ranked alternatives for where a slot can meet, with the territory each one would work. */
export function PlaceSuggestions({ options, weekend, hasHouses, onPick, onClose }: { options: PlaceOption[]; weekend: boolean; hasHouses: boolean; onPick: (option: PlaceOption) => void; onClose: () => void }) {
  return (
    <div className="mt-2 rounded-xl border border-primary/25 bg-primary/[0.05] p-2">
      <div className="flex items-center justify-between gap-2 px-1 pb-1.5">
        <p className="text-xs font-semibold text-foreground">{weekend ? "Lugares sugeridos (casas primero)" : "Lugares sugeridos"}</p>
        <button aria-label="Cerrar sugerencias" className="inline-flex h-6 w-6 cursor-pointer items-center justify-center rounded-md text-muted hover:bg-foreground/[0.06] hover:text-foreground" onClick={onClose} type="button"><X size={13} /></button>
      </div>
      {weekend && !hasHouses ? <p className="px-1 pb-1.5 text-xs text-amber-300">Todavía no hay puntos marcados como Casa. Marcalos en Puntos de salida para que se prioricen.</p> : null}
      {options.length ? (
        <ul className="space-y-1">
          {options.map((option) => (
            <li key={option.pointId}>
              <button className="w-full cursor-pointer rounded-lg bg-black/20 px-2.5 py-2 text-left transition hover:bg-primary/15" onClick={() => onPick(option)} type="button">
                <span className="flex flex-wrap items-center gap-1.5">
                  <KindBadge kind={option.kind} />
                  <span className="min-w-0 truncate text-sm font-medium text-foreground">{option.title}</span>
                </span>
                <span className="mt-0.5 block text-xs text-muted">Territorio {option.territoryNumber} · {option.reason}</span>
              </button>
            </li>
          ))}
        </ul>
      ) : (
        <p className="px-1 pb-1 text-xs text-muted">No hay otros puntos disponibles para este día con territorios libres.</p>
      )}
    </div>
  );
}
