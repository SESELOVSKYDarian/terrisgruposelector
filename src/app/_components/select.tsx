"use client";

import { useEffect, useRef, useState } from "react";
import { Check, ChevronDown } from "lucide-react";
import { cn } from "@/lib/utils";

export type SelectOption = { value: string; label: string };

export function Select({
  value,
  onChange,
  options,
  placeholder = "Seleccionar",
  className,
  size = "default",
}: {
  value: string;
  onChange: (value: string) => void;
  options: SelectOption[];
  placeholder?: string;
  className?: string;
  size?: "default" | "compact";
}) {
  const [open, setOpen] = useState(false);
  const rootRef = useRef<HTMLDivElement>(null);
  const selected = options.find((option) => option.value === value);

  useEffect(() => {
    if (!open) return;
    function onPointerDown(event: MouseEvent) {
      if (rootRef.current && !rootRef.current.contains(event.target as Node)) setOpen(false);
    }
    document.addEventListener("mousedown", onPointerDown);
    return () => document.removeEventListener("mousedown", onPointerDown);
  }, [open]);

  return (
    <div className="relative" ref={rootRef}>
      <button
        aria-expanded={open}
        className={cn(
          "flex w-full cursor-pointer items-center justify-between gap-2 rounded-lg border border-white/10 bg-black/20 text-left text-white outline-none transition hover:border-white/20 focus-visible:border-primary/60 focus-visible:ring-4 focus-visible:ring-primary/10",
          size === "compact" ? "min-h-9 px-2.5 py-1.5 text-sm" : "min-h-11 px-4 py-3 text-sm",
          className,
        )}
        onClick={() => setOpen((current) => !current)}
        type="button"
      >
        <span className={cn("truncate", !selected && "text-slate-500")}>{selected?.label ?? placeholder}</span>
        <ChevronDown aria-hidden="true" className={cn("shrink-0 text-slate-500 transition-transform", open && "rotate-180")} size={14} />
      </button>
      {open ? (
        <div className="absolute left-0 top-full z-50 mt-1 max-h-64 w-full min-w-[180px] overflow-y-auto rounded-lg border border-white/10 bg-[#0c1615] py-1 shadow-2xl">
          {options.map((option) => (
            <button
              className={cn(
                "flex w-full items-center justify-between gap-2 px-3 py-2 text-left text-sm transition hover:bg-white/[0.06]",
                option.value === value ? "text-white" : "text-slate-300",
              )}
              key={option.value}
              onClick={() => {
                onChange(option.value);
                setOpen(false);
              }}
              type="button"
            >
              <span className="truncate">{option.label}</span>
              {option.value === value ? <Check aria-hidden="true" className="shrink-0 text-primary-hover" size={14} /> : null}
            </button>
          ))}
          {!options.length ? <p className="px-3 py-2 text-sm text-slate-500">Sin opciones.</p> : null}
        </div>
      ) : null}
    </div>
  );
}
