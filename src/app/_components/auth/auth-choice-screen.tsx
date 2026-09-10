"use client";

import { motion } from "framer-motion";

export function AuthChoiceScreen({ onLogin, onRegister }: { onLogin: () => void; onRegister: () => void }) {
  return (
    <main className="relative flex h-dvh flex-col items-center justify-center overflow-hidden px-6">
      <div aria-hidden="true" className="absolute inset-0 bg-cover bg-center" style={{ backgroundImage: "url(/auth-bg.jpg)" }} />
      <div aria-hidden="true" className="absolute inset-0 bg-black/60" />
      <motion.div
        animate={{ opacity: 1, y: 0, scale: 1 }}
        className="relative z-10 w-full max-w-sm rounded-[2rem] border border-white/15 bg-white/10 p-8 text-center shadow-[0_24px_60px_-16px_rgba(0,0,0,0.55)] backdrop-blur-2xl"
        initial={{ opacity: 0, y: 24, scale: 0.96 }}
        transition={{ duration: 0.5, ease: "easeOut" }}
      >
        <motion.img
          alt="PR Territorios"
          animate={{ opacity: 1, scale: 1 }}
          className="mx-auto h-16 w-16 rounded-2xl bg-white/90 object-contain p-2 shadow-lg"
          initial={{ opacity: 0, scale: 0.7 }}
          src="/PR.svg"
          transition={{ duration: 0.5, delay: 0.1, ease: "easeOut" }}
        />
        <motion.div animate={{ opacity: 1, y: 0 }} initial={{ opacity: 0, y: 10 }} transition={{ duration: 0.4, delay: 0.2 }}>
          <h1 className="mt-5 text-3xl font-semibold tracking-tight text-white">PR Territorios</h1>
          <p className="mt-2 text-sm leading-6 text-white/75">Gestion de territorios, reservas y salidas de la congregacion.</p>
        </motion.div>
        <motion.div animate={{ opacity: 1, y: 0 }} className="mt-7 space-y-2.5" initial={{ opacity: 0, y: 10 }} transition={{ duration: 0.4, delay: 0.3 }}>
          <motion.button
            className="inline-flex min-h-11 w-full cursor-pointer items-center justify-center gap-2 rounded-xl bg-primary px-4 py-3 text-sm font-medium text-white shadow-[0_10px_28px_-8px_rgba(94,106,210,0.7)]"
            onClick={onLogin}
            type="button"
            whileHover={{ scale: 1.02, boxShadow: "0 14px 32px -6px rgba(94,106,210,0.8)" }}
            whileTap={{ scale: 0.97 }}
          >
            Iniciar sesion
          </motion.button>
          <motion.button
            className="inline-flex min-h-11 w-full cursor-pointer items-center justify-center gap-2 rounded-xl border border-white/25 bg-white/10 px-4 py-3 text-sm font-medium text-white backdrop-blur-sm"
            onClick={onRegister}
            type="button"
            whileHover={{ scale: 1.02, backgroundColor: "rgba(255,255,255,0.18)" }}
            whileTap={{ scale: 0.97 }}
          >
            Crear cuenta
          </motion.button>
        </motion.div>
      </motion.div>
    </main>
  );
}
