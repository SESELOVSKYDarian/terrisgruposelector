"use client";

import { ReactNode } from "react";
import { motion } from "framer-motion";
import { ChevronLeft } from "lucide-react";

export function AuthLayout({ children, onBack }: { children: ReactNode; onBack?: () => void }) {
  return (
    <main className="flex h-dvh flex-col overflow-hidden lg:flex-row">
      <div className="relative h-[20vh] min-h-[110px] shrink-0 overflow-hidden sm:h-[32vh] lg:h-full lg:w-[42%] lg:shrink">
        <div aria-hidden="true" className="absolute inset-0 bg-cover bg-center" style={{ backgroundImage: "url(/auth-bg.jpg)" }} />
        <div aria-hidden="true" className="absolute inset-0 bg-black/35" />
        {onBack ? (
          <motion.button
            aria-label="Volver"
            className="absolute left-4 top-4 z-10 inline-flex h-9 w-9 items-center justify-center rounded-full bg-white/15 text-white backdrop-blur-md transition hover:bg-white/25"
            onClick={onBack}
            type="button"
            whileHover={{ scale: 1.08 }}
            whileTap={{ scale: 0.92 }}
          >
            <ChevronLeft aria-hidden="true" size={18} />
          </motion.button>
        ) : null}
        <motion.img
          alt="PR Territorios"
          animate={{ opacity: 1, scale: 1 }}
          className="absolute left-1/2 top-1/2 h-14 w-14 -translate-x-1/2 -translate-y-1/2 rounded-2xl bg-white/90 object-contain p-2 shadow-lg lg:h-20 lg:w-20"
          initial={{ opacity: 0, scale: 0.85 }}
          src="/PR.svg"
          transition={{ duration: 0.4, ease: "easeOut" }}
        />
        <svg aria-hidden="true" className="absolute bottom-0 left-0 h-8 w-full text-background lg:hidden" fill="currentColor" preserveAspectRatio="none" viewBox="0 0 400 40">
          <path d="M0 40 C 100 0, 300 0, 400 40 Z" />
        </svg>
        <svg aria-hidden="true" className="absolute right-0 top-0 hidden h-full w-8 text-background lg:block" fill="currentColor" preserveAspectRatio="none" viewBox="0 0 40 400">
          <path d="M40 0 C 0 130, 0 270, 40 400 Z" />
        </svg>
      </div>
      <div className="flex min-h-0 flex-1 flex-col overflow-y-auto px-6 py-4 sm:px-8 sm:py-6 lg:items-center lg:justify-center lg:overflow-visible lg:px-12">
        <div className="mx-auto w-full max-w-sm lg:my-auto">{children}</div>
      </div>
    </main>
  );
}
