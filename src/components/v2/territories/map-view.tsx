"use client";

import { useMemo, useRef, useState, type MouseEvent } from "react";
import { Pencil, Undo2 } from "lucide-react";
import { Select } from "@/app/_components/select";
import { miniButtonClass, primarySmallButtonClass, secondaryButtonClass } from "@/app/_components/ui-classes";
import { polygonCentroid, toNormalizedPoint, toSvgPoints, type Point, type TerritoryMapState } from "@/modules/map/geometry";
import { formatS13Date } from "@/modules/s13/layout";
import { cn } from "@/lib/utils";
import { Card, Empty, Notice, Pill, fieldClass } from "../ui";
import { useModuleApi } from "../use-module-api";

type Stats = { territory_id: string; number: number; name: string; total_blocks: number; completed_blocks: number; pending_labels: string[]; state: TerritoryMapState; open_round: { conductor: string; assigned_on: string } | null; last_completed_on: string | null; last_activity_on: string | null; do_not_visit: number; buildings: number };
type Feature = { id: string; territory_id: string; block_id: string | null; points: Point[] };
type State = { layer: { id: string; name: string; image_url: string; image_width: number | null; image_height: number | null } | null; features: Feature[]; stats: Stats[]; blocks: { id: string; territory_id: string; label: string }[]; canEdit: boolean };

const stateStyles: Record<TerritoryMapState, { polygon: string; label: string; pill: "slate" | "amber" | "emerald" }> = {
  SIN_INICIAR: { polygon: "fill-slate-400/25 stroke-slate-300", label: "Sin iniciar", pill: "slate" },
  EN_CURSO: { polygon: "fill-amber-400/35 stroke-amber-300", label: "En curso", pill: "amber" },
  COMPLETADO: { polygon: "fill-emerald-400/35 stroke-emerald-300", label: "Completado", pill: "emerald" },
};

function CreateLayerCard({ run, busy }: { run: (action: string, payload?: Record<string, unknown>) => Promise<boolean>; busy: boolean }) {
  const [name, setName] = useState("Mapa de territorios");
  const [imageUrl, setImageUrl] = useState("/maps/territorios.jpg");
  return (
    <Card title="Configurar el mapa" description="Subí el JPG del mapa a la carpeta public/maps del proyecto y escribí su ruta (o una URL https). Después dibujás cada territorio sobre la imagen.">
      <div className="flex flex-wrap items-end gap-3">
        <label className="text-sm text-muted">Nombre<input className={cn(fieldClass, "mt-1 block")} onChange={(event) => setName(event.target.value)} value={name} /></label>
        <label className="min-w-64 flex-1 text-sm text-muted">Imagen<input className={cn(fieldClass, "mt-1 block w-full")} onChange={(event) => setImageUrl(event.target.value)} value={imageUrl} /></label>
        <button className={primarySmallButtonClass} disabled={busy || !name.trim() || !imageUrl.trim()} onClick={() => void run("createLayer", { name, image_url: imageUrl })} type="button">Crear mapa</button>
      </div>
    </Card>
  );
}

/** Territorios → Mapa: the original JPG with clickable SVG polygons; managers draw the shapes. */
export function MapView() {
  const { data, error, loading, busy, run } = useModuleApi<State>("/api/v2/map");
  const imageRef = useRef<HTMLDivElement>(null);
  const [selected, setSelected] = useState<string | null>(null);
  const [hovered, setHovered] = useState<string | null>(null);
  const [editing, setEditing] = useState(false);
  const [editTerritory, setEditTerritory] = useState("");
  const [editBlock, setEditBlock] = useState("");
  const [draft, setDraft] = useState<Point[]>([]);

  const statsById = useMemo(() => new Map((data?.stats ?? []).map((stat) => [stat.territory_id, stat])), [data]);
  if (loading) return <Notice>Cargando mapa…</Notice>;
  if (!data) return <Notice tone="error">{error || "No se pudo cargar el mapa."}</Notice>;
  if (!data.layer) return <div className="space-y-3">{error ? <Notice tone="error">{error}</Notice> : null}<CreateLayerCard busy={busy} run={run} /></div>;

  const layer = data.layer;
  const territoryFeatures = data.features.filter((feature) => !feature.block_id);
  const blockFeatures = data.features.filter((feature) => feature.block_id);
  const focus = statsById.get(hovered ?? selected ?? "");
  const detail = selected ? statsById.get(selected) : null;
  const aspect = layer.image_width && layer.image_height ? `${layer.image_width} / ${layer.image_height}` : "4 / 3";
  const blocksOfTerritory = data.blocks.filter((block) => block.territory_id === editTerritory);

  function onImageClick(event: MouseEvent<HTMLDivElement>) {
    if (!editing || !editTerritory || !imageRef.current) return;
    setDraft((current) => [...current, toNormalizedPoint(event.clientX, event.clientY, imageRef.current!.getBoundingClientRect())]);
  }

  async function saveShape() {
    if (await run("saveFeature", { layer_id: layer.id, territory_id: editTerritory, block_id: editBlock || null, points: draft })) setDraft([]);
  }

  return (
    <div className="space-y-4">
      {error ? <Notice tone="error">{error}</Notice> : null}
      <div className="flex flex-wrap items-center gap-2">
        <Pill tone="slate">Sin iniciar</Pill><Pill tone="amber">En curso</Pill><Pill tone="emerald">Completado (última vuelta)</Pill>
        {data.canEdit ? (
          <button className={cn(miniButtonClass, "ml-auto")} onClick={() => { setEditing((current) => !current); setDraft([]); }} type="button">
            <Pencil size={14} aria-hidden="true" />{editing ? "Salir de edición" : "Editar formas"}
          </button>
        ) : null}
      </div>

      {editing ? (
        <Card title="Dibujar forma" description="Elegí el territorio (y opcionalmente una manzana) y hacé clic sobre el mapa para marcar cada vértice. Con 3 puntos o más podés guardar.">
          <div className="flex flex-wrap items-end gap-3">
            <div className="w-56"><Select onChange={(value) => { setEditTerritory(value); setEditBlock(""); setDraft([]); }} options={data.stats.map((stat) => ({ value: stat.territory_id, label: `Territorio ${stat.number}` }))} placeholder="Territorio" size="compact" value={editTerritory} /></div>
            <div className="w-44"><Select onChange={setEditBlock} options={[{ value: "", label: "Territorio completo" }, ...blocksOfTerritory.map((block) => ({ value: block.id, label: `Manzana ${block.label}` }))]} size="compact" value={editBlock} /></div>
            <button className={miniButtonClass} disabled={!draft.length} onClick={() => setDraft((current) => current.slice(0, -1))} type="button"><Undo2 size={14} aria-hidden="true" />Deshacer punto</button>
            <button className={primarySmallButtonClass} disabled={busy || draft.length < 3 || !editTerritory} onClick={() => void saveShape()} type="button">Guardar forma ({draft.length} puntos)</button>
            <button className={secondaryButtonClass} disabled={!draft.length} onClick={() => setDraft([])} type="button">Descartar</button>
          </div>
        </Card>
      ) : null}

      <div className="grid gap-4 xl:grid-cols-[minmax(0,1fr)_320px]">
        <div className="relative w-full overflow-hidden rounded-2xl border border-border bg-black/20" onClick={onImageClick} ref={imageRef} style={{ aspectRatio: aspect, cursor: editing && editTerritory ? "crosshair" : undefined }}>
          {/* The original JPG stays as the reference layer; polygons are an SVG overlay on top. */}
          {/* eslint-disable-next-line @next/next/no-img-element */}
          <img alt={layer.name} className="absolute inset-0 h-full w-full select-none object-fill" draggable={false} onLoad={(event) => { const image = event.currentTarget; if (!layer.image_width && data.canEdit) void run("setImageSize", { layer_id: layer.id, width: image.naturalWidth, height: image.naturalHeight }); }} src={layer.image_url} />
          <svg aria-label="Territorios" className="absolute inset-0 h-full w-full" preserveAspectRatio="none" role="group" viewBox="0 0 1 1">
            {blockFeatures.map((feature) => <polygon className="fill-transparent stroke-white/60" key={feature.id} points={toSvgPoints(feature.points)} strokeDasharray="0.01 0.008" strokeWidth={1} style={{ vectorEffect: "non-scaling-stroke", pointerEvents: "none" }} />)}
            {territoryFeatures.map((feature) => {
              const stat = statsById.get(feature.territory_id);
              if (!stat) return null;
              const active = selected === feature.territory_id;
              return (
                <polygon
                  aria-label={`Territorio ${stat.number}: ${stateStyles[stat.state].label}`}
                  className={cn("cursor-pointer transition-opacity", stateStyles[stat.state].polygon, active ? "opacity-100" : "opacity-80 hover:opacity-100")}
                  key={feature.id}
                  onClick={(event) => { if (editing) return; event.stopPropagation(); setSelected(feature.territory_id); }}
                  onKeyDown={(event) => { if (event.key === "Enter" || event.key === " ") { event.preventDefault(); setSelected(feature.territory_id); } }}
                  onMouseEnter={() => setHovered(feature.territory_id)}
                  onMouseLeave={() => setHovered(null)}
                  points={toSvgPoints(feature.points)}
                  role="button"
                  strokeWidth={active ? 3 : 1.5}
                  style={{ vectorEffect: "non-scaling-stroke", pointerEvents: editing ? "none" : "auto" }}
                  tabIndex={0}
                />
              );
            })}
            {draft.length ? <polyline className="fill-primary/20 stroke-primary" points={toSvgPoints(draft)} strokeWidth={2} style={{ vectorEffect: "non-scaling-stroke", pointerEvents: "none" }} /> : null}
          </svg>
          {territoryFeatures.map((feature) => {
            const stat = statsById.get(feature.territory_id);
            if (!stat) return null;
            const [cx, cy] = polygonCentroid(feature.points);
            return <span className="pointer-events-none absolute -translate-x-1/2 -translate-y-1/2 rounded bg-black/55 px-1.5 text-[11px] font-semibold text-white" key={`label-${feature.id}`} style={{ left: `${cx * 100}%`, top: `${cy * 100}%` }}>{stat.number}</span>;
          })}
          {focus && !editing ? (() => {
            const shape = territoryFeatures.find((feature) => feature.territory_id === focus.territory_id);
            if (!shape || !hovered) return null;
            const [cx, cy] = polygonCentroid(shape.points);
            return (
              <div className="pointer-events-none absolute z-10 w-56 -translate-x-1/2 -translate-y-[115%] rounded-xl border border-border bg-background/95 p-3 text-xs shadow-lg" style={{ left: `${cx * 100}%`, top: `${cy * 100}%` }}>
                <p className="text-sm font-semibold text-foreground">Territorio {focus.number}</p>
                <p className="text-muted">{focus.total_blocks} manzana{focus.total_blocks === 1 ? "" : "s"} · {focus.completed_blocks} completada{focus.completed_blocks === 1 ? "" : "s"}</p>
                <p className="text-muted">Última fecha: {formatS13Date(focus.last_completed_on) || "sin registro"}</p>
              </div>
            );
          })() : null}
        </div>

        <aside>
          {detail ? (
            <Card title={`Territorio ${detail.number}`} description={detail.name || undefined} action={<Pill tone={stateStyles[detail.state].pill}>{stateStyles[detail.state].label}</Pill>}>
              <dl className="space-y-2 text-sm">
                <div><dt className="text-xs text-muted">Manzanas</dt><dd className="text-foreground">{detail.completed_blocks} de {detail.total_blocks} completadas</dd></div>
                {detail.pending_labels.length ? <div><dt className="text-xs text-muted">Pendientes</dt><dd className="text-foreground">{detail.pending_labels.join(", ")}</dd></div> : null}
                <div><dt className="text-xs text-muted">Vuelta actual</dt><dd className="text-foreground">{detail.open_round ? `${detail.open_round.conductor} desde ${formatS13Date(detail.open_round.assigned_on)}` : "Sin vuelta abierta"}</dd></div>
                <div><dt className="text-xs text-muted">Última vez completado</dt><dd className="text-foreground">{formatS13Date(detail.last_completed_on) || "Sin registro"}</dd></div>
                <div><dt className="text-xs text-muted">Última actividad</dt><dd className="text-foreground">{formatS13Date(detail.last_activity_on) || "Sin registro"}</dd></div>
                <div><dt className="text-xs text-muted">Edificios · No visitar</dt><dd className="text-foreground">{detail.buildings} · {detail.do_not_visit}</dd></div>
              </dl>
            </Card>
          ) : (
            <Empty>Tocá un territorio del mapa para ver su estado.</Empty>
          )}
        </aside>
      </div>
      {!territoryFeatures.length ? <Notice tone="info">Todavía no hay formas dibujadas. Usá «Editar formas» para marcar cada territorio sobre el mapa.</Notice> : null}
    </div>
  );
}
