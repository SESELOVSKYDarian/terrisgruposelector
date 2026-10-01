"use client";

import { ReactNode } from "react";

/**
 * Same look as cperalta.com.ar's login (admin/login.php): light "glass" card on a soft blurred
 * background, not the app's usual dark theme. Scoped to the choice/login screens only — the rest
 * of auth (OTP, forgot password, register) keeps the existing AuthLayout.
 */
export function LightAuthCard({ children }: { children: ReactNode }) {
  return (
    <main className="relative flex min-h-dvh items-center justify-center overflow-hidden bg-[#eef1f6] p-6">
      <div aria-hidden="true" className="pointer-events-none absolute -left-[10%] -top-[10%] h-[50%] w-[50%] rounded-full bg-[#007aff]/10 blur-[120px]" />
      <div aria-hidden="true" className="pointer-events-none absolute -bottom-[10%] -right-[10%] h-[50%] w-[50%] rounded-full bg-[#5856d6]/10 blur-[120px]" />
      <div className="relative z-10 w-full max-w-sm">
        <div className="overflow-hidden rounded-[28px] border border-white/60 bg-white/80 shadow-[0_24px_60px_-16px_rgba(16,24,40,0.25)] backdrop-blur-2xl">
          {children}
        </div>
        <p className="mt-8 text-center text-[11px] font-bold uppercase tracking-[0.2em] text-slate-400">Congregación Peralta Ramos © {new Date().getFullYear()}</p>
      </div>
    </main>
  );
}

export function LightAuthHeader({ title, subtitle }: { title: string; subtitle: string }) {
  return (
    <div className="border-b border-slate-100 p-8 text-center">
      <img alt="PR Territorios" className="mx-auto mb-4 h-16 w-16 rounded-2xl bg-white object-contain p-2 shadow-lg" src="/PR.svg" />
      <h1 className="text-2xl font-bold tracking-tight text-slate-900">{title}</h1>
      <p className="mt-1 text-sm font-medium italic text-slate-500">{subtitle}</p>
    </div>
  );
}

export const lightInputClass = "min-h-11 w-full rounded-xl border border-slate-200 bg-slate-50 px-4 py-3 text-sm text-slate-900 outline-none transition placeholder:text-slate-400 focus:border-[#007aff]/60 focus:bg-white focus:ring-4 focus:ring-[#007aff]/10";
export const lightPrimaryButtonClass = "inline-flex min-h-11 w-full cursor-pointer items-center justify-center gap-2 rounded-xl bg-[#007aff] px-4 py-3.5 text-base font-semibold text-white shadow-[0_10px_28px_-8px_rgba(0,122,255,0.5)] transition disabled:cursor-not-allowed disabled:opacity-60";
export const lightSecondaryButtonClass = "inline-flex min-h-11 w-full cursor-pointer items-center justify-center gap-2 rounded-xl border border-slate-200 bg-white px-4 py-3 text-sm font-semibold text-slate-700 transition hover:bg-slate-50";
