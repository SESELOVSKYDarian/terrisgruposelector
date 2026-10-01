"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import { miniButtonClass, primarySmallButtonClass } from "@/app/_components/ui-classes";
import { Select } from "@/app/_components/select";
import { cn } from "@/lib/utils";
import { Card, Empty, Notice, fieldClass } from "../ui";

type Point = [number, number];
type DrawnBlock = { label: string; points: Point[] };
type StreetLabel = { text: string; x: number; y: number; rotate: number };
type Layout = { territory_id: string; view_box: string; blocks: DrawnBlock[]; street_labels: StreetLabel[] };
type TerritoryEntry = { id: string; number: number; blocks: string[] };
type State = { layouts: Record<string, Layout>; territories: TerritoryEntry[] | null };

const VIEW_BOX = "0 0 400 400";

async function post(action: string, payload: Record<string, unknown>) {
  const response = await fetch("/api/v2/territories/card-layout", { method: "POST", credentials: "same-origin", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ action, payload }) });
  const body = await response.json().catch(() => ({}));
  if (!response.ok) throw new Error(body.error ?? "No se pudo guardar.");
  return body;
}

function pathFor(points: Point[]) {
  return points.map(([x, y], index) => `${index === 0 ? "M" : "L"}${x},${y}`).join(" ") + (points.length > 2 ? " Z" : "");
}

function centroid(points: Point[]): Point {
  const [sx, sy] = points.reduce(([ax, ay], [x, y]) => [ax + x, ay + y], [0, 0]);
  return [sx / points.length, sy / points.length];
}

/**
 * Draws the real territory card, manzana by manzana: pick a block, click points on the canvas to
 * trace its shape, close it. Street names go the same way — type the text, click where it sits.
 * Saved per territory; the conductor's visit form renders this exact shape read-only.
 */
export function CardLayoutEditor() {
  const [state, setState] = useState<State | null>(null);
  const [error, setError] = useState("");
  const [territoryId, setTerritoryId] = useState("");
  const [blocks, setBlocks] = useState<DrawnBlock[]>([]);
  const [streetLabels, setStreetLabels] = useState<StreetLabel[]>([]);
  const [activeBlock, setActiveBlock] = useState("");
  const [drawPoints, setDrawPoints] = useState<Point[]>([]);
  const [labelText, setLabelText] = useState("");
  const [placingLabel, setPlacingLabel] = useState(false);
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState("");
  const svgRef = useRef<SVGSVGElement>(null);

  async function load() {
    try {
      const response = await fetch("/api/v2/territories/card-layout", { credentials: "same-origin" });
      const body = await response.json();
      if (!response.ok) throw new Error(body.error ?? "No se pudo cargar.");
      setState(body as State);
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "Error inesperado.");
    }
  }
  useEffect(() => { void load(); }, []);

  const territory = useMemo(() => state?.territories?.find((entry) => entry.id === territoryId) ?? null, [state, territoryId]);
  const drawnLabels = new Set(blocks.map((block) => block.label));
  const availableBlocks = (territory?.blocks ?? []).filter((label) => !drawnLabels.has(label) || label === activeBlock);

  function selectTerritory(id: string) {
    setTerritoryId(id);
    const existing = state?.layouts[id];
    setBlocks(existing?.blocks ?? []);
    setStreetLabels(existing?.street_labels ?? []);
    setActiveBlock("");
    setDrawPoints([]);
    setPlacingLabel(false);
    setMessage("");
  }

  function pointFromEvent(event: React.MouseEvent<SVGSVGElement>): Point | null {
    const svg = svgRef.current;
    if (!svg) return null;
    const ctm = svg.getScreenCTM();
    if (!ctm) return null;
    const point = svg.createSVGPoint();
    point.x = event.clientX;
    point.y = event.clientY;
    const local = point.matrixTransform(ctm.inverse());
    return [Math.round(local.x), Math.round(local.y)];
  }

  function handleCanvasClick(event: React.MouseEvent<SVGSVGElement>) {
    const point = pointFromEvent(event);
    if (!point) return;
    if (placingLabel) {
      if (!labelText.trim()) return;
      setStreetLabels((current) => [...current, { text: labelText.trim(), x: point[0], y: point[1], rotate: 0 }]);
      setPlacingLabel(false);
      setLabelText("");
      return;
    }
    if (activeBlock) setDrawPoints((current) => [...current, point]);
  }

  function closeBlock() {
    if (!activeBlock || drawPoints.length < 3) return;
    setBlocks((current) => [...current.filter((block) => block.label !== activeBlock), { label: activeBlock, points: drawPoints }]);
    setActiveBlock("");
    setDrawPoints([]);
  }

  function editBlock(label: string) {
    const block = blocks.find((entry) => entry.label === label);
    if (!block) return;
    setBlocks((current) => current.filter((entry) => entry.label !== label));
    setActiveBlock(label);
    setDrawPoints(block.points);
  }

  function rotateLabel(index: number) {
    setStreetLabels((current) => current.map((label, i) => (i === index ? { ...label, rotate: label.rotate === 0 ? -90 : label.rotate === -90 ? 90 : 0 } : label)));
  }

  async function save() {
    if (!territoryId) return;
    setBusy(true);
    setError("");
    setMessage("");
    try {
      await post("save", { territory_id: territoryId, view_box: VIEW_BOX, blocks, street_labels: streetLabels });
      setMessage("Guardado.");
      await load();
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "Error inesperado.");
    } finally {
      setBusy(false);
    }
  }

  async function clearLayout() {
    if (!territoryId) return;
    setBusy(true);
    setError("");
    try {
      await post("delete", { territory_id: territoryId });
      setBlocks([]);
      setStreetLabels([]);
      setMessage("Tarjeta borrada.");
      await load();
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "Error inesperado.");
    } finally {
      setBusy(false);
    }
  }

  if (!state) return <Notice>Cargando…</Notice>;
  if (!state.territories) return <Notice tone="error">No tenés permiso para editar tarjetas de territorio.</Notice>;

  return (
    <Card description="Dibujá cada manzana tal cual está en la tarjeta de papel: elegí la manzana, tocá sus esquinas en orden y cerrala. Después agregá los nombres de calle. Se guarda por territorio." title="Tarjeta del territorio">
      <div className="space-y-4">
        {error ? <Notice tone="error">{error}</Notice> : null}
        {message ? <Notice tone="success">{message}</Notice> : null}

        <div className="w-56"><Select onChange={selectTerritory} options={state.territories.map((entry) => ({ value: entry.id, label: `Territorio ${entry.number}` }))} placeholder="Elegir territorio" value={territoryId} /></div>

        {!territoryId ? (
          <Empty>Elegí un territorio para empezar a dibujar.</Empty>
        ) : (
          <div className="grid gap-4 md:grid-cols-[1fr_320px]">
            <svg className="w-full cursor-crosshair rounded-2xl border border-white/15 bg-black/20" onClick={handleCanvasClick} ref={svgRef} viewBox={VIEW_BOX}>
              {blocks.map((block) => {
                const [cx, cy] = centroid(block.points);
                return (
                  <g key={block.label}>
                    <path d={pathFor(block.points)} fill="rgba(56,189,248,0.12)" stroke="rgba(56,189,248,0.6)" strokeWidth={2} />
                    <text dominantBaseline="middle" fill="#e2e8f0" fontSize={18} fontWeight={700} textAnchor="middle" x={cx} y={cy}>{block.label}</text>
                  </g>
                );
              })}
              {drawPoints.length ? (
                <g>
                  <path d={pathFor(drawPoints)} fill="rgba(52,211,153,0.15)" stroke="#34d399" strokeDasharray="4 3" strokeWidth={2} />
                  {drawPoints.map(([x, y], index) => <circle cx={x} cy={y} fill="#34d399" key={index} r={4} />)}
                </g>
              ) : null}
              {streetLabels.map((label, index) => (
                <text fill="#94a3b8" fontSize={11} fontWeight={700} key={index} letterSpacing={1} textAnchor="middle" transform={label.rotate ? `rotate(${label.rotate} ${label.x} ${label.y})` : undefined} x={label.x} y={label.y}>
                  {label.text.toUpperCase()}
                </text>
              ))}
            </svg>

            <div className="space-y-4">
              <div className="space-y-2 rounded-xl border border-white/10 p-3">
                <p className="text-xs font-semibold text-slate-300">Manzanas</p>
                {activeBlock ? (
                  <div className="space-y-2">
                    <p className="text-xs text-slate-400">Dibujando <strong className="text-white">{activeBlock}</strong>: {drawPoints.length} punto{drawPoints.length === 1 ? "" : "s"}. Tocá el plano para agregar esquinas.</p>
                    <div className="flex gap-2">
                      <button className={primarySmallButtonClass} disabled={drawPoints.length < 3} onClick={closeBlock} type="button">Cerrar manzana</button>
                      <button className={miniButtonClass} onClick={() => { setActiveBlock(""); setDrawPoints([]); }} type="button">Cancelar</button>
                    </div>
                  </div>
                ) : availableBlocks.length ? (
                  <div className="flex flex-wrap gap-1.5">
                    {availableBlocks.map((label) => (
                      <button className={miniButtonClass} key={label} onClick={() => { setActiveBlock(label); setDrawPoints([]); }} type="button">+ {label}</button>
                    ))}
                  </div>
                ) : (
                  <p className="text-xs text-slate-500">Todas las manzanas de este territorio ya tienen forma.</p>
                )}
                {blocks.length ? (
                  <ul className="divide-y divide-white/5 text-sm">
                    {blocks.map((block) => (
                      <li className="flex items-center justify-between py-1.5" key={block.label}>
                        <span>{block.label} <span className="text-xs text-slate-500">({block.points.length} puntos)</span></span>
                        <div className="flex gap-1">
                          <button className={miniButtonClass} onClick={() => editBlock(block.label)} type="button">Editar</button>
                          <button className={miniButtonClass} onClick={() => setBlocks((current) => current.filter((entry) => entry.label !== block.label))} type="button">Borrar</button>
                        </div>
                      </li>
                    ))}
                  </ul>
                ) : null}
              </div>

              <div className="space-y-2 rounded-xl border border-white/10 p-3">
                <p className="text-xs font-semibold text-slate-300">Calles</p>
                <div className="flex gap-2">
                  <input className={cn(fieldClass, "flex-1")} onChange={(event) => setLabelText(event.target.value)} placeholder="Nombre de la calle" value={labelText} />
                  <button className={cn(miniButtonClass, placingLabel && "bg-primary/20 text-primary")} disabled={!labelText.trim()} onClick={() => setPlacingLabel((value) => !value)} type="button">{placingLabel ? "Tocá el plano…" : "Ubicar"}</button>
                </div>
                {streetLabels.length ? (
                  <ul className="divide-y divide-white/5 text-sm">
                    {streetLabels.map((label, index) => (
                      <li className="flex items-center justify-between gap-2 py-1.5" key={index}>
                        <span className="truncate">{label.text}</span>
                        <div className="flex gap-1">
                          <button className={miniButtonClass} onClick={() => rotateLabel(index)} title="Rotar" type="button">↻</button>
                          <button className={miniButtonClass} onClick={() => setStreetLabels((current) => current.filter((_, i) => i !== index))} type="button">Borrar</button>
                        </div>
                      </li>
                    ))}
                  </ul>
                ) : null}
              </div>

              <div className="flex gap-2">
                <button className={primarySmallButtonClass} disabled={busy} onClick={() => void save()} type="button">Guardar tarjeta</button>
                {state.layouts[territoryId] ? <button className={miniButtonClass} disabled={busy} onClick={() => void clearLayout()} type="button">Borrar tarjeta</button> : null}
              </div>
            </div>
          </div>
        )}
      </div>
    </Card>
  );
}
