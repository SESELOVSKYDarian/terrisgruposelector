"use client";

import { ChevronLeft } from "lucide-react";

export function AuthPhotoHeader({ onBack }: { onBack?: () => void }) {
  return (
    <div className="relative h-52 shrink-0 overflow-hidden sm:h-60">
      <div aria-hidden="true" className="absolute inset-0 bg-cover bg-center" style={{ backgroundImage: "url(/auth-bg.jpg)" }} />
      <div aria-hidden="true" className="absolute inset-0 bg-black/35" />
      {onBack ? (
        <button aria-label="Volver" className="absolute left-4 top-4 z-10 inline-flex h-9 w-9 items-center justify-center rounded-full bg-black/35 text-white backdrop-blur-sm transition hover:bg-black/50" onClick={onBack} type="button">
          <ChevronLeft aria-hidden="true" size={18} />
        </button>
      ) : null}
      <img alt="PR Territorios" className="absolute left-1/2 top-1/2 h-14 w-14 -translate-x-1/2 -translate-y-1/2 rounded-2xl bg-white/90 object-contain p-2 shadow-lg" src="/PR.svg" />
      <svg aria-hidden="true" className="absolute bottom-0 left-0 h-8 w-full text-background" fill="currentColor" preserveAspectRatio="none" viewBox="0 0 400 40">
        <path d="M0 40 C 100 0, 300 0, 400 40 Z" />
      </svg>
    </div>
  );
}
