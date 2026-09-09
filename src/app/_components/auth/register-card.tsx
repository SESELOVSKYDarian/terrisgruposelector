"use client";

import { FormEvent, useState } from "react";
import { Check, Eye, EyeOff, Lock, Mail, User, X } from "lucide-react";
import { isEmailValid, passwordRequirements } from "@/lib/domain";
import { AuthPhotoHeader } from "./auth-photo-header";
import { primaryButtonClass } from "../ui-classes";

export function RegisterCard({
  error,
  loading,
  onBack,
  onLogin,
  onSubmit,
}: {
  error: string;
  loading: boolean;
  onBack: () => void;
  onLogin: () => void;
  onSubmit: (username: string, fullName: string, email: string, password: string) => void;
}) {
  const [password, setPassword] = useState("");
  const [confirm, setConfirm] = useState("");
  const [email, setEmail] = useState("");
  const [showPassword, setShowPassword] = useState(false);
  const [touchedPassword, setTouchedPassword] = useState(false);

  const passwordOk = passwordRequirements.every((requirement) => requirement.test(password));
  const emailOk = email === "" || isEmailValid(email);
  const confirmOk = confirm === "" || confirm === password;

  function handleSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setTouchedPassword(true);
    if (!passwordOk || confirm !== password || !isEmailValid(email)) return;
    const form = new FormData(event.currentTarget);
    onSubmit(String(form.get("username") ?? ""), String(form.get("full_name") ?? ""), email, password);
  }

  return (
    <main className="flex min-h-screen flex-col">
      <AuthPhotoHeader onBack={onBack} />
      <section className="flex-1 px-6 py-7 sm:px-8">
        <p className="text-xs font-semibold uppercase tracking-[0.28em] text-primary-hover/90">PR Territorios</p>
        <h1 className="mt-2 text-2xl font-semibold tracking-tight text-foreground">Crear cuenta</h1>
        <p className="mt-2 text-sm leading-6 text-muted">Un administrador tiene que aprobar tu cuenta antes de que puedas ingresar.</p>

        <button className="mt-5 flex w-full min-h-11 cursor-not-allowed items-center justify-center gap-2 rounded-lg border border-border bg-foreground/[0.03] px-4 py-2.5 text-sm font-medium text-muted" disabled title="Disponible pronto" type="button">
          <svg aria-hidden="true" height="16" viewBox="0 0 24 24" width="16"><path d="M22.56 12.25c0-.78-.07-1.53-.2-2.25H12v4.26h5.92c-.26 1.37-1.04 2.53-2.21 3.31v2.77h3.57c2.08-1.92 3.28-4.74 3.28-8.09z" fill="#4285F4" /><path d="M12 23c2.97 0 5.46-.98 7.28-2.66l-3.57-2.77c-.98.66-2.23 1.06-3.71 1.06-2.86 0-5.29-1.93-6.16-4.53H2.18v2.84C3.99 20.53 7.7 23 12 23z" fill="#34A853" /><path d="M5.84 14.09c-.22-.66-.35-1.36-.35-2.09s.13-1.43.35-2.09V7.07H2.18C1.43 8.55 1 10.22 1 12s.43 3.45 1.18 4.93z" fill="#FBBC05" /><path d="M12 5.38c1.62 0 3.06.56 4.21 1.64l3.15-3.15C17.45 2.09 14.97 1 12 1 7.7 1 3.99 3.47 2.18 7.07l3.66 2.84c.87-2.6 3.3-4.53 6.16-4.53z" fill="#EA4335" /></svg>
          Continuar con Google (proximamente)
        </button>

        <form className="mt-5 space-y-4" onSubmit={handleSubmit}>
          <label className="block text-sm font-medium text-foreground/90">
            Usuario
            <div className="relative mt-1">
              <User aria-hidden="true" className="pointer-events-none absolute left-3.5 top-1/2 -translate-y-1/2 text-muted" size={16} />
              <input autoComplete="username" className="min-h-11 w-full rounded-lg border border-border bg-background pl-10 pr-4 py-3 text-sm text-foreground outline-none transition focus:border-primary/60 focus:ring-4 focus:ring-primary/10" name="username" required />
            </div>
          </label>
          <label className="block text-sm font-medium text-foreground/90">
            Nombre completo
            <input className="mt-1 min-h-11 w-full rounded-lg border border-border bg-background px-4 py-3 text-sm text-foreground outline-none transition focus:border-primary/60 focus:ring-4 focus:ring-primary/10" name="full_name" required />
          </label>
          <label className="block text-sm font-medium text-foreground/90">
            Mail
            <div className="relative mt-1">
              <Mail aria-hidden="true" className="pointer-events-none absolute left-3.5 top-1/2 -translate-y-1/2 text-muted" size={16} />
              <input autoComplete="email" className="min-h-11 w-full rounded-lg border border-border bg-background pl-10 pr-9 py-3 text-sm text-foreground outline-none transition focus:border-primary/60 focus:ring-4 focus:ring-primary/10" onChange={(event) => setEmail(event.target.value.trim())} required type="email" value={email} />
              {email ? (
                emailOk ? <Check aria-hidden="true" className="absolute right-3 top-1/2 -translate-y-1/2 text-success" size={16} /> : <X aria-hidden="true" className="absolute right-3 top-1/2 -translate-y-1/2 text-danger" size={16} />
              ) : null}
            </div>
          </label>
          <label className="block text-sm font-medium text-foreground/90">
            Contrasena
            <div className="relative mt-1">
              <Lock aria-hidden="true" className="pointer-events-none absolute left-3.5 top-1/2 -translate-y-1/2 text-muted" size={16} />
              <input autoComplete="new-password" className="min-h-11 w-full rounded-lg border border-border bg-background pl-10 pr-11 py-3 text-sm text-foreground outline-none transition focus:border-primary/60 focus:ring-4 focus:ring-primary/10" onChange={(event) => setPassword(event.target.value)} onFocus={() => setTouchedPassword(true)} required type={showPassword ? "text" : "password"} value={password} />
              <button aria-label={showPassword ? "Ocultar contrasena" : "Mostrar contrasena"} className="absolute right-3 top-1/2 -translate-y-1/2 text-muted transition hover:text-foreground" onClick={() => setShowPassword((current) => !current)} type="button">
                {showPassword ? <EyeOff aria-hidden="true" size={16} /> : <Eye aria-hidden="true" size={16} />}
              </button>
            </div>
          </label>
          {touchedPassword ? (
            <ul className="grid grid-cols-2 gap-1.5 text-xs">
              {passwordRequirements.map((requirement) => {
                const met = requirement.test(password);
                return (
                  <li className={met ? "flex items-center gap-1.5 text-success" : "flex items-center gap-1.5 text-muted"} key={requirement.id}>
                    {met ? <Check aria-hidden="true" size={13} /> : <X aria-hidden="true" size={13} />}
                    {requirement.label}
                  </li>
                );
              })}
            </ul>
          ) : null}
          <label className="block text-sm font-medium text-foreground/90">
            Repetir contrasena
            <input autoComplete="new-password" className="mt-1 min-h-11 w-full rounded-lg border border-border bg-background px-4 py-3 text-sm text-foreground outline-none transition focus:border-primary/60 focus:ring-4 focus:ring-primary/10" onChange={(event) => setConfirm(event.target.value)} required type={showPassword ? "text" : "password"} value={confirm} />
          </label>
          {!confirmOk ? <p className="text-sm text-danger">Las contrasenas no coinciden.</p> : null}
          {error ? <p className="text-sm text-danger">{error}</p> : null}
          <button className={primaryButtonClass} disabled={loading} type="submit">
            {loading ? "Creando cuenta..." : "Crear cuenta"}
          </button>
        </form>

        <p className="mt-4 text-center text-sm text-muted">
          ¿Ya tenes cuenta?{" "}
          <button className="text-primary-hover transition hover:underline" onClick={onLogin} type="button">
            Iniciar sesion
          </button>
        </p>
      </section>
    </main>
  );
}
