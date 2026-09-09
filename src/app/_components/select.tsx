"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import { Check, ChevronDown, Search } from "lucide-react";
import { cn } from "@/lib/utils";

const SEARCH_THRESHOLD = 7;

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
  const [query, setQuery] = useState("");
  const rootRef = useRef<HTMLDivElement>(null);
  const selected = options.find((option) => option.value === value);
  const showSearch = options.length > SEARCH_THRESHOLD;
  const filteredOptions = useMemo(() => {
    if (!showSearch || !query.trim()) return options;
    const term = query.trim().toLowerCase();
    return options.filter((option) => option.label.toLowerCase().includes(term));
  }, [options, query, showSearch]);

  useEffect(() => {
    if (!open) return;
    function onPointerDown(event: MouseEvent) {
      if (rootRef.current && !rootRef.current.contains(event.target as Node)) setOpen(false);
    }
    document.addEventListener("mousedown", onPointerDown);
    return () => document.removeEventListener("mousedown", onPointerDown);
  }, [open]);

  useEffect(() => {
    // eslint-disable-next-line react-hooks/set-state-in-effect -- clear search box after the closing animation, not mid-render
    if (!open) setQuery("");
  }, [open]);

  return (
    <div className="relative" ref={rootRef}>
      <button
        aria-expanded={open}
        className={cn(
          "flex w-full cursor-pointer items-center justify-between gap-2 rounded-lg border border-border bg-background text-left text-foreground outline-none transition hover:border-foreground/20 focus-visible:border-primary/60 focus-visible:ring-4 focus-visible:ring-primary/10",
          size === "compact" ? "min-h-9 px-2.5 py-1.5 text-sm" : "min-h-11 px-4 py-3 text-sm",
          className,
        )}
        onClick={() => setOpen((current) => !current)}
        type="button"
      >
        <span className={cn("truncate", !selected && "text-muted")}>{selected?.label ?? placeholder}</span>
        <ChevronDown aria-hidden="true" className={cn("shrink-0 text-muted transition-transform", open && "rotate-180")} size={14} />
      </button>
      {open ? (
        <div className="absolute left-0 top-full z-50 mt-1 w-full min-w-[180px] overflow-hidden rounded-lg border border-border bg-surface-strong shadow-2xl">
          {showSearch ? (
            <div className="relative border-b border-border p-1.5">
              <Search aria-hidden="true" className="pointer-events-none absolute left-4 top-1/2 -translate-y-1/2 text-muted" size={13} />
              <input
                autoFocus
                className="h-8 w-full rounded-md bg-background pl-7 pr-2 text-sm text-foreground outline-none placeholder:text-muted"
                onChange={(event) => setQuery(event.target.value)}
                onClick={(event) => event.stopPropagation()}
                placeholder="Buscar..."
                value={query}
              />
            </div>
          ) : null}
          <div className="max-h-64 overflow-y-auto py-1">
          {filteredOptions.map((option) => (
            <button
              className={cn(
                "flex w-full items-center justify-between gap-2 px-3 py-2 text-left text-sm transition hover:bg-foreground/[0.06]",
                option.value === value ? "text-foreground" : "text-foreground/70",
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
          {!filteredOptions.length ? <p className="px-3 py-2 text-sm text-muted">Sin opciones.</p> : null}
          </div>
        </div>
      ) : null}
    </div>
  );
}
