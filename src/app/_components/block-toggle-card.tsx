import { useEffect, useState } from "react";
import { BlockToggleGrid, type ToggleBlock } from "./block-toggle-grid";

export type CardLayout = { territory_id: string; view_box: string; blocks: { label: string; points: [number, number][] }[]; street_labels: { text: string; x: number; y: number; rotate: number }[] };

/** Every drawn territory card, keyed by territory_id. Fetched once; cheap (shapes only, no photos). */
export function useCardLayouts(): Record<string, CardLayout> {
  const [layouts, setLayouts] = useState<Record<string, CardLayout>>({});
  useEffect(() => {
    let active = true;
    fetch("/api/v2/territories/card-layout", { credentials: "same-origin" })
      .then((response) => response.json())
      .then((body) => { if (active && body?.layouts) setLayouts(body.layouts); })
      .catch(() => {});
    return () => { active = false; };
  }, []);
  return layouts;
}

function centroid(points: [number, number][]): [number, number] {
  const [sx, sy] = points.reduce(([ax, ay], [x, y]) => [ax + x, ay + y], [0, 0]);
  return [sx / points.length, sy / points.length];
}

function pathFor(points: [number, number][]) {
  return points.map(([x, y], index) => `${index === 0 ? "M" : "L"}${x},${y}`).join(" ") + " Z";
}

/**
 * Same shape as the real paper territory card: each manzana keeps its actual drawn shape, tap to
 * mark done (green) / pending. Falls back to the plain grid when this territory has no card drawn
 * yet, or the drawing doesn't cover every block currently shown.
 */
export function BlockToggleCard({ blocks, selectedIds, onToggle, layout, disabled }: { blocks: ToggleBlock[]; selectedIds: Set<string>; onToggle: (id: string) => void; layout: CardLayout | null | undefined; disabled?: boolean }) {
  const layoutLabels = new Set((layout?.blocks ?? []).map((block) => block.label));
  const coversEverything = Boolean(layout) && blocks.every((block) => layoutLabels.has(block.id));
  if (!coversEverything || !layout) return <BlockToggleGrid blocks={blocks} disabled={disabled} onToggle={onToggle} selectedIds={selectedIds} />;

  return (
    <svg className="w-full rounded-2xl border border-white/10 bg-white/[0.02]" viewBox={layout.view_box}>
      {layout.blocks.map((block) => {
        const selected = selectedIds.has(block.label);
        const [cx, cy] = centroid(block.points);
        return (
          <g className={disabled ? "pointer-events-none opacity-50" : "cursor-pointer"} key={block.label} onClick={() => onToggle(block.label)}>
            <path d={pathFor(block.points)} fill={selected ? "rgba(16,185,129,0.35)" : "rgba(255,255,255,0.05)"} stroke={selected ? "#34d399" : "rgba(255,255,255,0.3)"} strokeWidth={2} />
            <text dominantBaseline="middle" fill={selected ? "#34d399" : "#e2e8f0"} fontSize={Number(layout.view_box.split(" ")[2] ?? 400) / 18} fontWeight={700} textAnchor="middle" x={cx} y={cy}>
              {block.label}
            </text>
          </g>
        );
      })}
      {layout.street_labels.map((label, index) => (
        <text
          fill="#94a3b8"
          fontSize={Number(layout.view_box.split(" ")[2] ?? 400) / 36}
          fontWeight={700}
          key={index}
          letterSpacing={1}
          textAnchor="middle"
          transform={label.rotate ? `rotate(${label.rotate} ${label.x} ${label.y})` : undefined}
          x={label.x}
          y={label.y}
        >
          {label.text.toUpperCase()}
        </text>
      ))}
    </svg>
  );
}
