"use client";

import { useEffect, useMemo, useRef, useState, type MouseEvent } from "react";
import { Pencil, Trash2, Undo2 } from "lucide-react";
import { Select } from "@/app/_components/select";
import { miniButtonClass, primarySmallButtonClass, secondaryButtonClass } from "@/app/_components/ui-classes";
import { polygonCentroid, toNormalizedPoint, type Point, type TerritoryMapState } from "@/modules/map/geometry";
import { formatS13Date } from "@/modules/s13/layout";
import { cn } from "@/lib/utils";
import { Card, Empty, Notice, Pill, fieldClass } from "../ui";
import { useModuleApi } from "../use-module-api";

type Stats = { territory_id: string; number: number; name: string; total_blocks: number; completed_blocks: number; pending_labels: string[]; state: TerritoryMapState; open_round: { conductor: string; assigned_on: string } | null; last_completed_on: string | null; last_activity_on: string | null; do_not_visit: number; buildings: number };
type Feature = { id: string; territory_id: string; block_id: string | null; points: Point[] };
type Label = { id: string; kind: "LABEL" | "AREA"; text: string | null; x: number | null; y: number | null; rotation: number; size: number; bold: boolean; tone: "street" | "zone" | "title"; points: Point[] | null };
type State = {
  layer: { id: string; name: string; image_url: string; image_width: number | null; image_height: number | null } | null;
  features: Feature[];
  labels: Label[];
  badges: { territory_id: string; x: number; y: number }[];
  stats: Stats[];
  blocks: { id: string; territory_id: string; label: string }[];
  rounds: { id: string; name: string; status: "OPEN" | "CLOSED" }[];
  selectedRoundId: string | null;
  blockStatuses: Record<string, { status: string; completed_on: string | null }>;
  canEdit: boolean;
};

const stateStyles: Record<TerritoryMapState, { label: string; pill: "slate" | "amber" | "emerald" }> = {
  SIN_INICIAR: { label: "Sin iniciar", pill: "slate" },
  EN_CURSO: { label: "En curso", pill: "amber" },
  COMPLETADO: { label: "Completado", pill: "emerald" },
};

const labelTone = { street: "fill-muted", zone: "fill-white/85", title: "fill-foreground" } as const;
const blockNumber = (label: string) => label.replace(/\D/g, "") || label;

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

function NumberField({ label, initial, busy, hint, onSave }: { label: string; initial: number; busy: boolean; hint?: string; onSave: (number: number) => void }) {
  const [value, setValue] = useState(String(initial));
  const parsed = Number(value);
  return (
    <form className="flex flex-wrap items-end gap-2" onSubmit={(event) => { event.preventDefault(); if (Number.isInteger(parsed) && parsed > 0) onSave(parsed); }}>
      <label className="text-sm text-muted">{label}<input className={cn(fieldClass, "mt-1 block w-24")} inputMode="numeric" min={1} onChange={(event) => setValue(event.target.value)} type="number" value={value} /></label>
      <button className={primarySmallButtonClass} disabled={busy || !Number.isInteger(parsed) || parsed < 1 || parsed === initial} type="submit">Cambiar</button>
      {hint ? <span className="text-xs text-muted">{hint}</span> : null}
    </form>
  );
}

/**
 * Territorios → Mapa: the system's own drawing of the territory map. Every block is a shape bound to a
 * block of the database: green when it is done in the chosen vuelta, grey while it is pending. Numbers,
 * names and the territory badges come from the data, so renumbering here renumbers the whole app.
 */
export function MapView() {
  const [roundId, setRoundId] = useState("");
  const { data, error, loading, busy, run } = useModuleApi<State>(roundId ? `/api/v2/map?round=${roundId}` : "/api/v2/map");
  const svgRef = useRef<SVGSVGElement>(null);
  const [selected, setSelected] = useState<string | null>(null);
  const [hovered, setHovered] = useState<string | null>(null);
  const [editing, setEditing] = useState(false);
  const [editMode, setEditMode] = useState<"numbers" | "draw">("numbers");
  const [editBlockId, setEditBlockId] = useState<string | null>(null);
  const [editTerritory, setEditTerritory] = useState("");
  const [editBlock, setEditBlock] = useState("");
  const [draft, setDraft] = useState<Point[]>([]);

  // Ctrl+Z (or Backspace) removes the last point while drawing a shape.
  useEffect(() => {
    if (!editing || editMode !== "draw" || !draft.length) return;
    function onKeyDown(event: KeyboardEvent) {
      const target = event.target as HTMLElement | null;
      if (target && ["INPUT", "TEXTAREA", "SELECT"].includes(target.tagName)) return;
      if (((event.ctrlKey || event.metaKey) && event.key.toLowerCase() === "z") || event.key === "Backspace") {
        event.preventDefault();
        setDraft((current) => current.slice(0, -1));
      }
    }
    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, [editing, editMode, draft.length]);

  const statsById = useMemo(() => new Map((data?.stats ?? []).map((stat) => [stat.territory_id, stat])), [data]);
  if (loading) return <Notice>Cargando mapa…</Notice>;
  if (!data) return <Notice tone="error">{error || "No se pudo cargar el mapa."}</Notice>;
  if (!data.layer) return <div className="space-y-3">{error ? <Notice tone="error">{error}</Notice> : null}<CreateLayerCard busy={busy} run={run} /></div>;

  const layer = data.layer;
  const VW = layer.image_width ?? 2000;
  const VH = layer.image_height ?? 1429;
  const px = (points: Point[]) => points.map(([x, y]) => `${(x * VW).toFixed(1)},${(y * VH).toFixed(1)}`).join(" ");
  const territoryFeatures = data.features.filter((feature) => !feature.block_id);
  const blockFeatures = data.features.filter((feature) => feature.block_id);
  const blockById = new Map(data.blocks.map((block) => [block.id, block]));
  const isDone = (blockId: string | null) => data.blockStatuses[blockId ?? ""]?.status === "COMPLETED";

  // The numbered badge of each territory: its saved position, else the middle of its shape (or of its blocks).
  const savedBadge = new Map(data.badges.map((badge) => [badge.territory_id, [Number(badge.x), Number(badge.y)] as Point]));
  const badges = data.stats.flatMap((stat) => {
    const shape = territoryFeatures.find((feature) => feature.territory_id === stat.territory_id);
    const own = blockFeatures.filter((feature) => feature.territory_id === stat.territory_id);
    const centers = own.map((feature) => polygonCentroid(feature.points));
    const center: Point | null = savedBadge.get(stat.territory_id) ?? (shape ? polygonCentroid(shape.points) : centers.length ? [centers.reduce((sum, c) => sum + c[0], 0) / centers.length, centers.reduce((sum, c) => sum + c[1], 0) / centers.length] : null);
    return center ? [{ stat, center }] : [];
  });

  const focus = statsById.get(hovered ?? selected ?? "");
  const detail = selected ? statsById.get(selected) : null;
  const focusBadge = badges.find((badge) => badge.stat.territory_id === hovered);
  const blocksOfTerritory = data.blocks.filter((block) => block.territory_id === editTerritory);
  const savedShape = data.features.find((feature) => feature.territory_id === editTerritory && (feature.block_id ?? "") === editBlock);
  const editedBlock = editBlockId ? blockById.get(editBlockId) : undefined;
  const editedTerritory = editedBlock ? statsById.get(editedBlock.territory_id) : selected ? statsById.get(selected) : undefined;

  function pickTerritory(territoryId: string, blockId: string | null) {
    if (editing && editMode === "draw") return;
    setSelected(territoryId);
    if (editing) setEditBlockId(blockId);
  }

  function onCanvasClick(event: MouseEvent<SVGSVGElement>) {
    if (!editing || editMode !== "draw" || !editTerritory || !svgRef.current) return;
    setDraft((current) => [...current, toNormalizedPoint(event.clientX, event.clientY, svgRef.current!.getBoundingClientRect())]);
  }

  async function saveShape() {
    if (await run("saveFeature", { layer_id: layer.id, territory_id: editTerritory, block_id: editBlock || null, points: draft })) setDraft([]);
  }

  return (
    <div className="space-y-4">
      {error ? <Notice tone="error">{error}</Notice> : null}
      <div className="flex flex-wrap items-center gap-2">
        {data.rounds.length ? (
          <div className="w-64">
            <Select onChange={(value) => { setRoundId(value); setSelected(null); }} options={data.rounds.map((round) => ({ value: round.id, label: `${round.name}${round.status === "OPEN" ? " (abierta)" : ""}` }))} size="compact" value={roundId || data.selectedRoundId || ""} />
          </div>
        ) : null}
        <Pill tone="emerald">Manzana hecha</Pill><Pill tone="slate">Manzana pendiente</Pill>
        {data.canEdit ? (
          <button className={cn(miniButtonClass, "ml-auto")} onClick={() => { setEditing((current) => !current); setDraft([]); setEditBlockId(null); }} type="button">
            <Pencil size={14} aria-hidden="true" />{editing ? "Salir de edición" : "Editar mapa"}
          </button>
        ) : null}
      </div>

      {editing ? (
        <Card title="Editar el mapa" description="Números: tocá una manzana o un territorio del mapa y cambiá su número. Formas: dibujá o reemplazá el contorno de una manzana.">
          <div className="mb-3 flex gap-2">
            <button className={cn(miniButtonClass, editMode === "numbers" && "border-primary/40 bg-primary/15")} onClick={() => { setEditMode("numbers"); setDraft([]); }} type="button">Números</button>
            <button className={cn(miniButtonClass, editMode === "draw" && "border-primary/40 bg-primary/15")} onClick={() => setEditMode("draw")} type="button">Formas</button>
          </div>
          {editMode === "numbers" ? (
            editedTerritory ? (
              <div className="space-y-3">
                <NumberField busy={busy} hint="Si otro territorio ya usa ese número, se intercambian. Cambia también el S-13 y el resto de la app." initial={editedTerritory.number} key={`t-${editedTerritory.territory_id}-${editedTerritory.number}`} label={`Número del territorio ${editedTerritory.number}`} onSave={(number) => void run("setTerritoryNumber", { territory_id: editedTerritory.territory_id, number })} />
                {editedBlock ? (
                  <NumberField busy={busy} hint="Si esa manzana ya existe en el territorio, se intercambian." initial={Number(blockNumber(editedBlock.label))} key={`b-${editedBlock.id}-${editedBlock.label}`} label={`Número de la manzana ${blockNumber(editedBlock.label)}`} onSave={(number) => void run("setBlockNumber", { block_id: editedBlock.id, number })} />
                ) : (
                  <p className="text-xs text-muted">Tocá una manzana para cambiar también su número.</p>
                )}
              </div>
            ) : (
              <p className="text-sm text-muted">Tocá una manzana del mapa para elegirla.</p>
            )
          ) : (
            <div className="space-y-3">
              <p className="text-xs text-muted">Elegí el territorio (y la manzana) y hacé clic sobre el mapa para marcar cada vértice. Con 3 puntos o más podés guardar. Ctrl+Z deshace el último punto; guardar sobre una forma ya dibujada la reemplaza.</p>
              <div className="flex flex-wrap items-end gap-3">
                <div className="w-56"><Select onChange={(value) => { setEditTerritory(value); setEditBlock(""); setDraft([]); }} options={data.stats.map((stat) => ({ value: stat.territory_id, label: `Territorio ${stat.number}` }))} placeholder="Territorio" size="compact" value={editTerritory} /></div>
                <div className="w-44"><Select onChange={setEditBlock} options={[{ value: "", label: "Territorio completo" }, ...blocksOfTerritory.map((block) => ({ value: block.id, label: `Manzana ${blockNumber(block.label)}` }))]} size="compact" value={editBlock} /></div>
                <button className={miniButtonClass} disabled={!draft.length} onClick={() => setDraft((current) => current.slice(0, -1))} type="button"><Undo2 size={14} aria-hidden="true" />Deshacer punto</button>
                <button className={primarySmallButtonClass} disabled={busy || draft.length < 3 || !editTerritory} onClick={() => void saveShape()} type="button">Guardar forma ({draft.length} puntos)</button>
                <button className={secondaryButtonClass} disabled={!draft.length} onClick={() => setDraft([])} type="button">Descartar</button>
                {savedShape ? (
                  <button className={secondaryButtonClass} disabled={busy} onClick={() => void run("deleteFeature", { id: savedShape.id })} title="Borra la forma que ya estaba guardada para esta selección" type="button"><Trash2 size={14} aria-hidden="true" />Borrar forma guardada</button>
                ) : null}
              </div>
            </div>
          )}
        </Card>
      ) : null}

      <div className="grid gap-4 xl:grid-cols-[minmax(0,1fr)_320px]">
        <div className="relative w-full overflow-hidden rounded-2xl border border-border bg-surface/40">
          <svg aria-label="Mapa de territorios" className="block h-auto w-full select-none" onClick={onCanvasClick} ref={svgRef} role="group" style={{ cursor: editing && editMode === "draw" && editTerritory ? "crosshair" : undefined }} viewBox={`0 0 ${VW} ${VH}`}>
            {data.labels.filter((label) => label.kind === "AREA" && label.points).map((label) => (
              <polygon className="fill-slate-500/25 stroke-slate-400/40" key={label.id} points={px(label.points as Point[])} strokeWidth={2} />
            ))}

            {blockFeatures.map((feature) => {
              const done = isDone(feature.block_id);
              const active = hovered === feature.territory_id || selected === feature.territory_id;
              return (
                <polygon
                  className={cn("transition-colors", done ? "fill-emerald-500/80 stroke-emerald-200/60" : "fill-foreground/[0.09] stroke-foreground/25", active && "stroke-primary", editBlockId === feature.block_id && "stroke-amber-300")}
                  key={feature.id}
                  onClick={(event) => { if (editing && editMode === "draw") return; event.stopPropagation(); pickTerritory(feature.territory_id, feature.block_id); }}
                  onMouseEnter={() => setHovered(feature.territory_id)}
                  onMouseLeave={() => setHovered(null)}
                  points={px(feature.points)}
                  strokeLinejoin="round"
                  strokeWidth={active || editBlockId === feature.block_id ? 3.5 : 2}
                  style={{ cursor: editing && editMode === "draw" ? undefined : "pointer", pointerEvents: editing && editMode === "draw" ? "none" : "auto" }}
                />
              );
            })}

            {blockFeatures.map((feature) => {
              const label = feature.block_id ? blockById.get(feature.block_id)?.label : undefined;
              if (!label) return null;
              const [cx, cy] = polygonCentroid(feature.points);
              return <text className={isDone(feature.block_id) ? "fill-white" : "fill-muted"} dominantBaseline="central" fontSize={26} fontWeight={600} key={`n-${feature.id}`} pointerEvents="none" textAnchor="middle" x={cx * VW} y={cy * VH}>{blockNumber(label)}</text>;
            })}

            {data.labels.filter((label) => label.kind === "LABEL" && label.text && label.x !== null && label.y !== null).map((label) => (
              <text className={labelTone[label.tone]} dominantBaseline="central" fontSize={label.size * VW} fontWeight={label.bold ? 700 : 500} key={label.id} pointerEvents="none" textAnchor="middle" transform={`rotate(${label.rotation} ${(label.x as number) * VW} ${(label.y as number) * VH})`} x={(label.x as number) * VW} y={(label.y as number) * VH}>{label.text}</text>
            ))}

            {badges.map(({ stat, center }) => (
              <g key={`badge-${stat.territory_id}`} onClick={(event) => { if (editing && editMode === "draw") return; event.stopPropagation(); pickTerritory(stat.territory_id, null); }} onMouseEnter={() => setHovered(stat.territory_id)} onMouseLeave={() => setHovered(null)} style={{ cursor: editing && editMode === "draw" ? undefined : "pointer", pointerEvents: editing && editMode === "draw" ? "none" : "auto" }}>
                <circle className={cn("stroke-2", stat.state === "COMPLETADO" ? "fill-emerald-700 stroke-emerald-200" : selected === stat.territory_id ? "fill-black stroke-primary" : "fill-black/85 stroke-white/30")} cx={center[0] * VW} cy={center[1] * VH} r={23} />
                <text dominantBaseline="central" fill="white" fontSize={stat.number > 9 ? 24 : 27} fontWeight={700} pointerEvents="none" textAnchor="middle" x={center[0] * VW} y={center[1] * VH}>{stat.number}</text>
              </g>
            ))}

            {draft.length ? <polyline className="fill-primary/20 stroke-primary" points={px(draft)} strokeWidth={3} style={{ pointerEvents: "none" }} /> : null}
          </svg>

          {focus && focusBadge && !editing ? (
            <div className="pointer-events-none absolute z-10 w-56 -translate-x-1/2 -translate-y-[125%] rounded-xl border border-border bg-background/95 p-3 text-xs shadow-lg" style={{ left: `${focusBadge.center[0] * 100}%`, top: `${focusBadge.center[1] * 100}%` }}>
              <p className="text-sm font-semibold text-foreground">Territorio {focus.number}</p>
              <p className="text-muted">{focus.total_blocks} manzana{focus.total_blocks === 1 ? "" : "s"} · {focus.completed_blocks} completada{focus.completed_blocks === 1 ? "" : "s"}</p>
              <p className="text-muted">Última fecha: {formatS13Date(focus.last_completed_on) || "sin registro"}</p>
            </div>
          ) : null}
        </div>

        <aside>
          {detail ? (
            <Card title={`Territorio ${detail.number}`} description={detail.name || undefined} action={<Pill tone={stateStyles[detail.state].pill}>{stateStyles[detail.state].label}</Pill>}>
              <dl className="space-y-2 text-sm">
                <div><dt className="text-xs text-muted">Manzanas</dt><dd className="text-foreground">{detail.completed_blocks} de {detail.total_blocks} completadas</dd></div>
                {detail.pending_labels.length ? <div><dt className="text-xs text-muted">Pendientes</dt><dd className="text-foreground">{detail.pending_labels.map(blockNumber).map((number) => `M${number}`).join(", ")}</dd></div> : null}
                <div><dt className="text-xs text-muted">Asignación S-13</dt><dd className="text-foreground">{detail.open_round ? `${detail.open_round.conductor} desde ${formatS13Date(detail.open_round.assigned_on)}` : "Sin asignación abierta"}</dd></div>
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
      {!blockFeatures.length ? <Notice tone="info">Todavía no hay formas cargadas. Usá «Editar mapa» → «Formas» para dibujar cada manzana.</Notice> : null}
    </div>
  );
}
