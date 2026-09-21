"use client";

import type { ReactNode } from "react";
import { cn } from "@/lib/utils";
import { tabClass } from "@/app/_components/ui-classes";

export function SubTabs<T extends string>({ tabs, value, onChange }: { tabs: { id: T; label: string }[]; value: T; onChange: (id: T) => void }) {
  return (
    <div className="flex gap-1 overflow-x-auto pb-1" role="tablist">
      {tabs.map((tab) => (
        <button aria-selected={value === tab.id} className={tabClass(value === tab.id)} key={tab.id} onClick={() => onChange(tab.id)} role="tab" type="button">
          {tab.label}
        </button>
      ))}
    </div>
  );
}

export function Card({ title, description, action, children }: { title?: string; description?: string; action?: ReactNode; children: ReactNode }) {
  return (
    <section className="glass-panel rounded-[1.5rem]">
      {title ? (
        <div className="flex flex-col gap-2 border-b border-border/60 p-4 sm:flex-row sm:items-center sm:justify-between">
          <div>
            <h2 className="text-base font-semibold text-foreground">{title}</h2>
            {description ? <p className="mt-0.5 text-sm text-muted">{description}</p> : null}
          </div>
          {action}
        </div>
      ) : null}
      <div className="space-y-3 p-4">{children}</div>
    </section>
  );
}

export function Notice({ tone = "info", children }: { tone?: "info" | "error" | "warning" | "success"; children: ReactNode }) {
  const tones = {
    info: "border-sky-400/25 bg-sky-500/10 text-sky-100",
    error: "border-rose-400/30 bg-rose-500/12 text-rose-100",
    warning: "border-amber-400/30 bg-amber-500/12 text-amber-100",
    success: "border-emerald-400/30 bg-emerald-500/12 text-emerald-100",
  };
  return <p className={cn("rounded-xl border px-3 py-2 text-sm", tones[tone])} role={tone === "error" ? "alert" : undefined}>{children}</p>;
}

export function Empty({ children }: { children: ReactNode }) {
  return <p className="rounded-xl border border-dashed border-border px-3 py-6 text-center text-sm text-muted">{children}</p>;
}

export function Pill({ tone, children }: { tone: "slate" | "amber" | "emerald" | "rose" | "sky"; children: ReactNode }) {
  const tones = {
    slate: "border-slate-400/25 bg-slate-500/10 text-slate-300",
    amber: "border-amber-400/30 bg-amber-500/12 text-amber-200",
    emerald: "border-emerald-400/30 bg-emerald-500/12 text-emerald-200",
    rose: "border-rose-400/30 bg-rose-500/12 text-rose-200",
    sky: "border-sky-400/30 bg-sky-500/12 text-sky-200",
  };
  return <span className={cn("inline-flex items-center rounded-full border px-2.5 py-0.5 text-xs font-medium", tones[tone])}>{children}</span>;
}

export const fieldClass = "min-h-9 rounded-lg border border-border bg-background px-2.5 py-1.5 text-sm text-foreground outline-none transition focus:border-primary/60";
