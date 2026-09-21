"use client";

import { useEffect, useMemo, useRef, useState, type KeyboardEvent } from "react";
import { AnimatePresence, motion, useReducedMotion } from "framer-motion";
import { CalendarDays, ChevronRight, Command, CornerDownLeft, Hash, Megaphone, Search, UserRound, Users } from "lucide-react";
import { cn } from "@/lib/utils";
import type { ShellAccess } from "@/components/shell/app-shell";

type Entry = { id: string; type: "territory" | "user" | "outing" | "announcement"; label: string; sublabel?: string; view: string };
type Item = Entry & { icon: typeof Search; section: "Recientes" | "Acciones" | "Resultados"; onSelect: () => void };
const recentKey = (userId: string) => `pr-territorios:command-palette:recent:${userId}`;

function isEntry(value: unknown): value is Entry {
  if (!value || typeof value !== "object") return false;
  const entry = value as Partial<Entry>;
  return typeof entry.id === "string" && typeof entry.label === "string" && typeof entry.view === "string" && (entry.type === "territory" || entry.type === "user" || entry.type === "outing" || entry.type === "announcement");
}
function getRecents(userId: string) { try { const value: unknown = JSON.parse(window.localStorage.getItem(recentKey(userId)) ?? "[]"); return Array.isArray(value) ? value.filter(isEntry).slice(0, 6) : []; } catch { return []; } }
function storeRecent(userId: string, entry: Entry) { try { window.localStorage.setItem(recentKey(userId), JSON.stringify([entry, ...getRecents(userId).filter((item) => item.id !== entry.id)].slice(0, 6))); } catch { /* Recents are optional. */ } }
function iconFor(type: Entry["type"]) { return type === "territory" ? Hash : type === "user" ? UserRound : type === "announcement" ? Megaphone : CalendarDays; }

export function CommandPalette({ access, onCreateOuting, onNavigate, open, onOpenChange, userId }: { access: ShellAccess; onCreateOuting?: () => void; onNavigate: (view: string) => void; open: boolean; onOpenChange: (open: boolean) => void; userId: string }) {
  const [query, setQuery] = useState("");
  const [entries, setEntries] = useState<Entry[]>([]);
  const [recents, setRecents] = useState<Entry[]>([]);
  const [selected, setSelected] = useState(0);
  const [loading, setLoading] = useState(false);
  const inputRef = useRef<HTMLInputElement>(null);
  const reducedMotion = useReducedMotion();

  useEffect(() => {
    const listener = (event: globalThis.KeyboardEvent) => { if ((event.ctrlKey || event.metaKey) && event.key.toLowerCase() === "k") { event.preventDefault(); onOpenChange(!open); } };
    window.addEventListener("keydown", listener); return () => window.removeEventListener("keydown", listener);
  }, [onOpenChange, open]);
  useEffect(() => {
    if (!open) return;
    const timer = window.setTimeout(() => {
      setRecents(getRecents(userId));
      setSelected(0);
      inputRef.current?.focus();
    }, 20);
    return () => window.clearTimeout(timer);
  }, [open, userId]);
  useEffect(() => {
    if (!open) return;
    const controller = new AbortController();
    const timer = window.setTimeout(async () => {
      setLoading(true);
      try { const response = await fetch(`/api/command-palette?q=${encodeURIComponent(query)}`, { signal: controller.signal }); const body = response.ok ? await response.json() as { entries?: unknown } : {}; setEntries(Array.isArray(body.entries) ? body.entries.filter(isEntry) : []); }
      catch (error) { if (!(error instanceof DOMException && error.name === "AbortError")) setEntries([]); }
      finally { if (!controller.signal.aborted) setLoading(false); }
    }, query.trim() ? 120 : 0);
    return () => { controller.abort(); window.clearTimeout(timer); };
  }, [open, query]);

  const items = useMemo<Item[]>(() => {
    const selectEntry = (entry: Entry) => () => { storeRecent(userId, entry); setRecents(getRecents(userId)); onNavigate(entry.view); onOpenChange(false); setQuery(""); };
    const command = (id: string, label: string, sublabel: string, view: string, icon: typeof Search, type: Entry["type"], action?: () => void): Item => ({ id, label, sublabel, view, icon, type, section: "Acciones", onSelect: () => { action?.(); if (!action) onNavigate(view); onOpenChange(false); } });
    const commands = [command("command:dashboard", "Ir al resumen", "Inicio", "dashboard", Command, "outing"), ...(access.canManageTerritories ? [command("command:territories", "Ir a Territorios", "Operación", "territories", Hash, "territory")] : []), ...(access.canManageUsers ? [command("command:users", "Ir a Usuarios", "Administración", "users", Users, "user")] : []), ...(access.canPlanOutings ? [command("command:outings", "Ir a Salidas", "Operación", "outings", CalendarDays, "outing")] : []), ...[command("command:announcements", "Ir a Anuncios", "Inicio", "announcements", Megaphone, "announcement")], ...(access.canPublishAnnouncements ? [command("command:new-announcement", "Nuevo anuncio", "Publicar un aviso para todos", "announcements", Megaphone, "announcement")] : []), ...(onCreateOuting ? [command("command:new-outing", "Nueva salida", "Crear la próxima planificación semanal", "outings", CalendarDays, "outing", onCreateOuting)] : [])];
    const term = query.trim().toLocaleLowerCase();
    const matchingCommands = term ? commands.filter((item) => `${item.label} ${item.sublabel}`.toLocaleLowerCase().includes(term)) : commands;
    const results = entries.map((entry) => ({ ...entry, icon: iconFor(entry.type), section: "Resultados" as const, onSelect: selectEntry(entry) }));
    const canOpenRecent = (entry: Entry) => entry.type === "territory" ? access.canManageTerritories : entry.type === "user" ? access.canManageUsers : entry.type === "announcement" ? true : access.canPlanOutings;
    const recentItems = !term ? recents.filter(canOpenRecent).map((entry) => ({ ...entry, icon: iconFor(entry.type), section: "Recientes" as const, onSelect: selectEntry(entry) })) : [];
    return [...recentItems, ...matchingCommands, ...results];
  }, [access.canManageTerritories, access.canManageUsers, access.canPlanOutings, entries, onCreateOuting, onNavigate, onOpenChange, query, recents, userId]);
  const activeIndex = Math.min(selected, Math.max(items.length - 1, 0));
  const close = () => { onOpenChange(false); setQuery(""); };
  const keyboard = (event: KeyboardEvent<HTMLInputElement>) => { if (event.key === "Escape") { event.preventDefault(); close(); } else if (event.key === "ArrowDown") { event.preventDefault(); setSelected(items.length ? (activeIndex + 1) % items.length : 0); } else if (event.key === "ArrowUp") { event.preventDefault(); setSelected(items.length ? (activeIndex - 1 + items.length) % items.length : 0); } else if (event.key === "Enter" && items[activeIndex]) { event.preventDefault(); items[activeIndex].onSelect(); } };
  const transition = reducedMotion ? { duration: 0 } : { duration: 0.16, ease: [0.16, 1, 0.3, 1] as const };
  let priorSection: Item["section"] | null = null;

  return <AnimatePresence>{open ? <div className="fixed inset-0 z-[100] grid place-items-center p-3 sm:p-6" role="dialog" aria-modal="true" aria-label="Paleta de comandos"><motion.button aria-label="Cerrar paleta de comandos" className="absolute inset-0 cursor-default bg-black/65 backdrop-blur-sm" initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }} transition={transition} onClick={close} type="button" /><motion.div className="relative z-10 flex max-h-[min(680px,calc(100dvh-1.5rem))] w-full max-w-[780px] flex-col overflow-hidden rounded-2xl border border-border bg-surface shadow-2xl shadow-black/40" initial={reducedMotion ? false : { opacity: 0, scale: 0.98, y: 10 }} animate={{ opacity: 1, scale: 1, y: 0 }} exit={reducedMotion ? { opacity: 0 } : { opacity: 0, scale: 0.985, y: 6 }} transition={transition}><div className="flex items-center gap-3 border-b border-border px-4"><Search className="shrink-0 text-muted" size={20} /><input ref={inputRef} className="h-15 min-w-0 flex-1 bg-transparent text-base outline-none placeholder:text-muted" value={query} onChange={(event) => setQuery(event.target.value)} onKeyDown={keyboard} placeholder="Buscar comandos, territorios, usuarios o salidas…" role="combobox" aria-controls="command-palette-results" aria-expanded /><kbd className="rounded border border-border px-1.5 py-0.5 font-mono text-[11px] text-muted">ESC</kbd></div><div id="command-palette-results" className="min-h-0 overflow-y-auto p-2" role="listbox" aria-label="Resultados de comandos">{items.map((item, index) => { const section = item.section !== priorSection ? item.section : null; priorSection = item.section; const Icon = item.icon; return <div key={item.id}>{section ? <p className="px-2 pb-1 pt-2 text-[10px] font-semibold tracking-[0.14em] text-muted">{section.toUpperCase()}</p> : null}<button className={cn("flex w-full items-center gap-3 rounded-xl px-3 py-2.5 text-left transition-colors", index === activeIndex ? "bg-primary/16 text-foreground" : "text-foreground hover:bg-surface-strong")} onMouseEnter={() => setSelected(index)} onClick={item.onSelect} type="button" role="option" aria-selected={index === activeIndex}><span className={cn("inline-flex h-9 w-9 shrink-0 items-center justify-center rounded-lg", index === activeIndex ? "bg-primary/20 text-primary-hover" : "bg-surface-strong text-muted")}><Icon size={18} /></span><span className="min-w-0 flex-1"><span className="block truncate text-sm font-medium">{item.label}</span>{item.sublabel ? <span className="block truncate text-xs text-muted">{item.sublabel}</span> : null}</span>{index === activeIndex ? <CornerDownLeft className="shrink-0 text-muted" size={15} /> : <ChevronRight className="shrink-0 text-muted" size={15} />}</button></div>; })}{!items.length ? <div className="px-4 py-12 text-center"><p className="text-sm font-medium">{loading ? "Buscando…" : "Sin resultados"}</p><p className="mt-1 text-xs text-muted">Probá con otro término o elegí una sección disponible.</p></div> : null}</div><div className="flex items-center gap-4 border-t border-border px-4 py-2 text-[11px] text-muted"><span><kbd className="rounded border border-border px-1">↑↓</kbd> navegar</span><span><kbd className="rounded border border-border px-1">↵</kbd> abrir</span><span className="ml-auto hidden sm:inline">⌘K / Ctrl K</span></div></motion.div></div> : null}</AnimatePresence>;
}
