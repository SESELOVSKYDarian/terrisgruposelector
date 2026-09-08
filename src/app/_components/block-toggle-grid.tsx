import { cn } from "@/lib/utils";

export type ToggleBlock = { id: string; label: string; variant?: "existing" | "new" };

export function BlockToggleGrid({
  blocks,
  selectedIds,
  onToggle,
}: {
  blocks: ToggleBlock[];
  selectedIds: Set<string>;
  onToggle: (id: string) => void;
}) {
  return (
    <div className="grid grid-cols-3 gap-2 sm:grid-cols-4 md:grid-cols-6">
      {blocks.map((block) => {
        const selected = selectedIds.has(block.id);
        const isNew = block.variant === "new";
        return (
          <button
            className={cn(
              "flex aspect-square min-h-20 cursor-pointer flex-col items-center justify-center rounded-2xl border text-sm font-semibold transition focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-sky-400",
              isNew && "border-dashed",
              selected
                ? "border-emerald-400/35 bg-emerald-500/12 text-emerald-100"
                : isNew
                  ? "border-sky-400/35 bg-sky-500/10 text-sky-100 hover:bg-sky-500/14"
                  : "border-white/10 bg-white/[0.03] text-slate-200 hover:border-teal-300/35 hover:bg-teal-400/10",
            )}
            key={block.id}
            onClick={() => onToggle(block.id)}
            type="button"
          >
            <span>{block.label}</span>
            <span className="mt-1 text-[11px] font-medium">
              {selected ? (isNew ? "Nueva completa" : "Completa") : isNew ? "Nueva" : "Pendiente"}
            </span>
          </button>
        );
      })}
    </div>
  );
}
