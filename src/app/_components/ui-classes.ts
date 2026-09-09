import { cn } from "@/lib/utils";

export const inputClass = "mt-1 min-h-11 w-full rounded-lg border border-border bg-background px-4 py-3 text-sm text-foreground outline-none transition placeholder:text-muted focus:border-primary/60 focus:ring-4 focus:ring-primary/10 disabled:cursor-not-allowed disabled:opacity-60";
export const primaryButtonClass = "inline-flex min-h-11 w-full cursor-pointer items-center justify-center gap-2 rounded-lg border border-white/10 bg-primary px-4 py-3 text-sm font-medium text-white transition hover:bg-primary-hover active:scale-[0.98] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary-hover focus-visible:ring-offset-2 focus-visible:ring-offset-background disabled:cursor-not-allowed disabled:opacity-60";
export const primarySmallButtonClass = "inline-flex min-h-11 cursor-pointer items-center justify-center gap-2 rounded-lg border border-white/10 bg-primary px-4 py-2.5 text-sm font-medium text-white transition hover:bg-primary-hover active:scale-[0.98] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary-hover focus-visible:ring-offset-2 focus-visible:ring-offset-background disabled:cursor-not-allowed disabled:opacity-60";
export const secondaryButtonClass = "inline-flex min-h-11 cursor-pointer items-center justify-center gap-2 rounded-lg border border-border bg-foreground/[0.04] px-4 py-2.5 text-sm font-medium text-foreground transition hover:border-foreground/18 hover:bg-foreground/[0.08] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-foreground/30";
export const miniButtonClass = "inline-flex min-h-9 cursor-pointer items-center gap-2 rounded-lg border border-border bg-foreground/[0.04] px-3 py-1.5 text-xs font-medium text-foreground transition hover:border-foreground/18 hover:bg-foreground/[0.08] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-foreground/30";
export const compactSelectClass = "min-h-10 cursor-pointer rounded-lg border border-border bg-background px-3 py-2 text-sm text-foreground outline-none transition focus:border-primary/60 focus:ring-4 focus:ring-primary/10 disabled:cursor-not-allowed disabled:opacity-60";

export function tabClass(active: boolean) {
  return cn(
    "inline-flex min-h-11 w-auto shrink-0 cursor-pointer items-center gap-2 rounded-xl border px-3 py-2.5 text-sm font-medium transition-colors duration-200 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-foreground/30 lg:w-full",
    active ? "border-foreground/12 bg-foreground/[0.09] text-foreground" : "border-transparent bg-transparent text-muted hover:bg-foreground/[0.045] hover:text-foreground",
  );
}
