"use client";

import { primaryButtonClass, secondaryButtonClass } from "../ui-classes";

export function AuthChoiceScreen({ onLogin, onRegister }: { onLogin: () => void; onRegister: () => void }) {
  return (
    <main className="relative flex min-h-screen flex-col overflow-hidden">
      <div aria-hidden="true" className="absolute inset-0 bg-cover bg-center" style={{ backgroundImage: "url(/auth-bg.jpg)" }} />
      <div aria-hidden="true" className="absolute inset-0 bg-black/55" />
      <div className="relative z-10 mt-auto flex flex-col items-center gap-6 px-6 pb-12 pt-10 text-center sm:pb-16">
        <img alt="PR Territorios" className="h-16 w-16 rounded-2xl bg-white/90 object-contain p-2 shadow-lg" src="/PR.svg" />
        <div>
          <h1 className="text-3xl font-semibold tracking-tight text-white">PR Territorios</h1>
          <p className="mt-2 text-sm leading-6 text-white/80">Gestion de territorios, reservas y salidas de la congregacion.</p>
        </div>
        <div className="w-full max-w-sm space-y-2.5">
          <button className={primaryButtonClass} onClick={onLogin} type="button">
            Iniciar sesion
          </button>
          <button className={`${secondaryButtonClass} !bg-white/10 !text-white hover:!bg-white/20`} onClick={onRegister} type="button">
            Crear cuenta
          </button>
        </div>
      </div>
    </main>
  );
}
