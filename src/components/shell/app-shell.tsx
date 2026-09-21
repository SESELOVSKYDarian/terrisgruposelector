"use client";

import { useEffect, useState } from "react";
import { AnimatePresence, motion, useReducedMotion } from "framer-motion";
import {
  Bell,
  CalendarDays,
  ChevronDown,
  ChevronsLeft,
  ClipboardList,
  Keyboard,
  LogOut,
  Menu,
  MonitorSmartphone,
  Moon,
  Search,
  Settings,
  ShieldCheck,
  SlidersHorizontal,
  UserRound,
  Users,
  X,
} from "lucide-react";
import { cn } from "@/lib/utils";
import { CommandPalette } from "@/components/command-palette/command-palette";
import { NotificationCenter } from "@/components/notifications/notification-center";
import { PushPermissionPrompt } from "@/components/push/push-permission-prompt";

export type ShellAccess = {
  canManageUsers: boolean;
  canManageSystem: boolean;
  canManageTerritories: boolean;
  canViewS13?: boolean;
  canPlanOutings: boolean;
  canUseReservations: boolean;
  isConductor: boolean;
  hasOperationalResponsibility: boolean;
};

type ShellUser = { full_name: string; username: string };
type NavItem = { id: string; label: string; icon: typeof ShieldCheck; visible?: boolean };

const sectionItems = (access: ShellAccess): { label?: string; items: NavItem[] }[] => [
  { items: [{ id: "dashboard", label: "Resumen", icon: ShieldCheck }] },
  {
    label: "OPERACION",
    items: [
      { id: "outings", label: "Salidas", icon: CalendarDays },
      { id: "myOutings", label: "Mis salidas", icon: ClipboardList, visible: access.isConductor },
      { id: "territories", label: "Territorios", icon: SlidersHorizontal, visible: access.canManageTerritories },
      { id: "reservations", label: "Reservas", icon: CalendarDays, visible: access.canUseReservations },
    ],
  },
  { label: "ADMINISTRACION", items: [{ id: "users", label: "Usuarios", icon: Users, visible: access.canManageUsers }] },
  { label: "SISTEMA", items: [{ id: "settings", label: "Ajustes", icon: Settings, visible: access.canManageSystem }] },
];

export function AppShell({
  access,
  activeView,
  children,
  onChange,
  onCreateOuting,
  onLogout,
  user,
}: {
  access: ShellAccess;
  activeView: string;
  children: React.ReactNode;
  onChange: (view: string) => void;
  onCreateOuting?: () => void;
  onLogout: () => void;
  user: ShellUser;
}) {
  const [collapsed, setCollapsed] = useState(false);
  const [mobileOpen, setMobileOpen] = useState(false);
  const [commandPaletteOpen, setCommandPaletteOpen] = useState(false);
  const [notificationCenterOpen, setNotificationCenterOpen] = useState(false);
  const [unreadNotifications, setUnreadNotifications] = useState(0);
  useEffect(() => {
    void fetch("/api/notifications", { cache: "no-store" })
      .then((response) => response.ok ? response.json() as Promise<{ unreadCount: number }> : null)
      .then((data) => { if (data) setUnreadNotifications(data.unreadCount); })
      .catch(() => {});
  }, []);
  const reduceMotion = useReducedMotion();
  const sections = sectionItems(access).map((section) => ({ ...section, items: section.items.filter((item) => item.visible !== false) })).filter((section) => section.items.length);
  const transition = reduceMotion ? { duration: 0 } : { duration: 0.18, ease: "easeOut" as const };

  const sidebar = (mobile = false) => (
    <motion.aside
      animate={mobile ? { x: 0 } : { width: collapsed ? 68 : 230 }}
      className={cn("app-sidebar flex h-full flex-col border-r border-border bg-background-soft", mobile && "w-[min(84vw,300px)]")}
      initial={mobile ? { x: -310 } : false}
      transition={transition}
      aria-label="Navegación principal"
    >
      <div className="flex h-16 items-center gap-2 border-b border-border px-3">
        <span className="inline-flex h-9 w-9 shrink-0 items-center justify-center rounded-lg border border-border bg-surface p-1.5"><img alt="PR" className="h-full w-full object-contain" src="/PR.svg" /></span>
        {!collapsed || mobile ? <span className="min-w-0 flex-1 truncate text-sm font-semibold">PR Territorios</span> : null}
        <button className="shell-icon-button" onClick={() => setCommandPaletteOpen(true)} type="button" aria-label="Abrir paleta de comandos"><Search size={18} /></button>
        <button className="shell-icon-button relative" onClick={() => setNotificationCenterOpen(true)} type="button" aria-label={unreadNotifications ? `${unreadNotifications} notificaciones sin leer` : "Notificaciones"}><Bell size={18} />{unreadNotifications ? <span className="absolute -right-1 -top-1 grid h-4 min-w-4 place-items-center rounded-full bg-primary px-1 text-[10px] font-bold text-primary-foreground">{unreadNotifications > 99 ? "99+" : unreadNotifications}</span> : null}</button>
        {mobile ? <button className="shell-icon-button" onClick={() => setMobileOpen(false)} type="button" aria-label="Cerrar menú"><X size={18} /></button> : <button className="shell-icon-button hidden lg:inline-flex" onClick={() => setCollapsed((value) => !value)} type="button" aria-label={collapsed ? "Expandir barra lateral" : "Contraer barra lateral"}><ChevronsLeft className={cn(collapsed && "rotate-180")} size={18} /></button>}
      </div>
      <nav className="min-h-0 flex-1 space-y-5 overflow-y-auto px-2 py-4">
        {sections.map((section, index) => <div key={section.label ?? index}>
          {section.label && (!collapsed || mobile) ? <p className="mb-1 px-2 text-[10px] font-semibold tracking-[0.14em] text-muted">{section.label}</p> : null}
          <div className="space-y-1">{section.items.map((item) => <NavButton collapsed={collapsed && !mobile} item={item} key={item.id} active={activeView === item.id} onClick={() => { onChange(item.id); setMobileOpen(false); }} />)}</div>
        </div>)}
      </nav>
      <AccountBlock collapsed={collapsed && !mobile} onChange={onChange} onLogout={onLogout} user={user} />
    </motion.aside>
  );

  return <div className="min-h-screen lg:flex">
    <div className="hidden lg:sticky lg:top-0 lg:block lg:h-screen">{sidebar()}</div>
    <AnimatePresence>{mobileOpen ? <><motion.button aria-label="Cerrar menú" className="fixed inset-0 z-40 bg-black/45 lg:hidden" initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }} transition={transition} onClick={() => setMobileOpen(false)} type="button" /><div className="fixed inset-y-0 left-0 z-50 lg:hidden">{sidebar(true)}</div></> : null}</AnimatePresence>
    <div className="min-w-0 flex-1 pb-18 lg:pb-0">
      <div className="flex h-14 items-center border-b border-border bg-background-soft px-3 lg:hidden"><button className="shell-icon-button" onClick={() => setMobileOpen(true)} type="button" aria-label="Abrir menú"><Menu size={20} /></button><span className="ml-3 text-sm font-semibold">PR Territorios</span></div>
      <PushPermissionPrompt userId={user.username} />
      {children}
    </div>
    <nav className="fixed inset-x-0 bottom-0 z-30 flex h-16 items-center justify-around border-t border-border bg-background-soft px-2 lg:hidden" aria-label="Navegación rápida">
      {sections.flatMap((section) => section.items).slice(0, 4).map((item) => <NavButton compact item={item} key={item.id} active={activeView === item.id} onClick={() => onChange(item.id)} />)}
    </nav>
    <CommandPalette access={access} onCreateOuting={onCreateOuting} onNavigate={onChange} open={commandPaletteOpen} onOpenChange={setCommandPaletteOpen} userId={user.username} />
    <NotificationCenter onNavigate={onChange} onUnreadCount={setUnreadNotifications} open={notificationCenterOpen} onOpenChange={setNotificationCenterOpen} />
  </div>;
}

function NavButton({ item, active, collapsed, compact, onClick }: { item: NavItem; active: boolean; collapsed?: boolean; compact?: boolean; onClick: () => void }) {
  const Icon = item.icon;
  return <button className={cn("shell-nav-item", active && "shell-nav-item-active", collapsed && "justify-center px-2", compact && "h-12 flex-col gap-0.5 px-2 text-[10px]")} title={collapsed ? item.label : undefined} onClick={onClick} type="button" aria-current={active ? "page" : undefined}><Icon size={compact ? 18 : 17} /><span className={cn(collapsed && "sr-only")}>{item.label}</span></button>;
}

function AccountBlock({ collapsed, onChange, onLogout, user }: { collapsed: boolean; onChange: (view: string) => void; onLogout: () => void; user: ShellUser }) {
  const [open, setOpen] = useState(false);
  const initials = user.full_name.split(" ").filter(Boolean).slice(0, 2).map((part) => part[0]).join("").toUpperCase();
  const personalItems = [
    ["Mi cuenta", UserRound, "account"], ["Apariencia", Moon, "appearance"], ["Notificaciones", Bell, "notifications"], ["Dispositivos", MonitorSmartphone, "devices"], ["Atajos", Keyboard, "shortcuts"],
  ] as const;
  return <div className="relative border-t border-border p-2">
    {open ? <><button className="fixed inset-0 z-40" aria-label="Cerrar menú de cuenta" onClick={() => setOpen(false)} type="button" /><div className="absolute bottom-[calc(100%+4px)] left-2 z-50 w-64 overflow-hidden rounded-lg border border-border bg-surface shadow-lg"><div className="border-b border-border px-3 py-3"><p className="truncate text-sm font-semibold">{user.full_name}</p><p className="truncate text-xs text-muted">@{user.username}</p></div>{personalItems.map(([label, Icon, view]) => <button className="shell-menu-item" key={view} onClick={() => { onChange(view); setOpen(false); }} type="button"><Icon size={16} />{label}</button>)}<button className="shell-menu-item text-danger" onClick={onLogout} type="button"><LogOut size={16} />Cerrar sesión</button></div></> : null}
    <button className={cn("flex w-full items-center gap-2 rounded-lg p-2 text-left hover:bg-surface-strong", collapsed && "justify-center")} onClick={() => setOpen((value) => !value)} type="button" aria-expanded={open}><span className="inline-flex h-8 w-8 shrink-0 items-center justify-center rounded-full bg-primary text-xs font-bold text-white">{initials}</span>{!collapsed ? <><span className="min-w-0 flex-1"><span className="block truncate text-sm font-medium">{user.full_name}</span><span className="block truncate text-xs text-muted">@{user.username}</span></span><ChevronDown size={16} className={cn("text-muted transition-transform", open && "rotate-180")} /></> : null}</button>
  </div>;
}
