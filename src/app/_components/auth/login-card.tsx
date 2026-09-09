"use client";

import { FormEvent, useState } from "react";
import { Eye, EyeOff, KeyRound, Lock, User } from "lucide-react";
import { AuthPhotoHeader } from "./auth-photo-header";
import { primaryButtonClass, secondaryButtonClass } from "../ui-classes";

export function LoginCard({
  error,
  hasPasskeyHint,
  loading,
  onBack,
  onForgotPassword,
  onPasskeyLogin,
  onRegister,
  onSubmit,
}: {
  error: string;
  hasPasskeyHint: boolean;
  loading: boolean;
  onBack: () => void;
  onForgotPassword: () => void;
  onPasskeyLogin: () => void;
  onRegister: () => void;
  onSubmit: (username: string, password: string, deviceSecure: boolean) => void;
}) {
  const [showPassword, setShowPassword] = useState(false);

  function handleSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const form = new FormData(event.currentTarget);
    onSubmit(String(form.get("username") ?? ""), String(form.get("password") ?? ""), form.get("deviceSecure") === "on");
  }

  return (
    <main className="flex min-h-screen flex-col">
      <AuthPhotoHeader onBack={onBack} />
      <section className="flex-1 px-6 py-7 sm:px-8">
        <p className="text-xs font-semibold uppercase tracking-[0.28em] text-primary-hover/90">PR Territorios</p>
        <h1 className="mt-2 text-2xl font-semibold tracking-tight text-foreground">Bienvenido de nuevo</h1>
        <p className="mt-2 text-sm leading-6 text-muted">Usa tu usuario y contrasena para ingresar.</p>

        {hasPasskeyHint ? (
          <button className={`mt-5 w-full ${secondaryButtonClass}`} onClick={onPasskeyLogin} type="button">
            <KeyRound aria-hidden="true" size={16} />
            Ingresar con llave de acceso
          </button>
        ) : null}

        <form className="mt-6 space-y-4" onSubmit={handleSubmit}>
          <label className="block text-sm font-medium text-foreground/90">
            Usuario
            <div className="relative mt-1">
              <User aria-hidden="true" className="pointer-events-none absolute left-3.5 top-1/2 -translate-y-1/2 text-muted" size={16} />
              <input autoComplete="username" className="min-h-11 w-full rounded-lg border border-border bg-background pl-10 pr-4 py-3 text-sm text-foreground outline-none transition focus:border-primary/60 focus:ring-4 focus:ring-primary/10" name="username" required />
            </div>
          </label>
          <label className="block text-sm font-medium text-foreground/90">
            Contrasena
            <div className="relative mt-1">
              <Lock aria-hidden="true" className="pointer-events-none absolute left-3.5 top-1/2 -translate-y-1/2 text-muted" size={16} />
              <input autoComplete="current-password" className="min-h-11 w-full rounded-lg border border-border bg-background pl-10 pr-11 py-3 text-sm text-foreground outline-none transition focus:border-primary/60 focus:ring-4 focus:ring-primary/10" name="password" required type={showPassword ? "text" : "password"} />
              <button aria-label={showPassword ? "Ocultar contrasena" : "Mostrar contrasena"} className="absolute right-3 top-1/2 -translate-y-1/2 text-muted transition hover:text-foreground" onClick={() => setShowPassword((current) => !current)} type="button">
                {showPassword ? <EyeOff aria-hidden="true" size={16} /> : <Eye aria-hidden="true" size={16} />}
              </button>
            </div>
          </label>
          <label className="flex items-center gap-2 text-sm text-muted">
            <input className="h-4 w-4 rounded border-border accent-primary" name="deviceSecure" type="checkbox" />
            Este dispositivo es seguro
          </label>
          {error ? <p className="text-sm text-danger">{error}</p> : null}
          <button className={primaryButtonClass} disabled={loading} type="submit">
            <KeyRound aria-hidden="true" size={18} />
            {loading ? "Ingresando..." : "Ingresar"}
          </button>
        </form>

        <button className="mt-5 block w-full text-center text-sm text-primary-hover transition hover:underline" onClick={onForgotPassword} type="button">
          ¿Olvidaste tu contrasena?
        </button>
        <p className="mt-3 text-center text-sm text-muted">
          ¿No tenes cuenta?{" "}
          <button className="text-primary-hover transition hover:underline" onClick={onRegister} type="button">
            Crear cuenta
          </button>
        </p>
      </section>
    </main>
  );
}
