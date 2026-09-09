"use client";

import { FormEvent, useState } from "react";
import Link from "next/link";
import { Eye, EyeOff, KeyRound } from "lucide-react";
import { AuthShell } from "../_components/auth/auth-shell";
import { primaryButtonClass } from "../_components/ui-classes";

export function ResetPasswordForm({ token }: { token: string }) {
  const [password, setPassword] = useState("");
  const [confirm, setConfirm] = useState("");
  const [showPassword, setShowPassword] = useState(false);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");
  const [done, setDone] = useState(false);

  async function handleSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (password.length < 8) {
      setError("La contrasena tiene que tener al menos 8 caracteres.");
      return;
    }
    if (password !== confirm) {
      setError("Las contrasenas no coinciden.");
      return;
    }
    setLoading(true);
    setError("");
    try {
      const response = await fetch("/api/auth/reset-password", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ token, password }),
      });
      if (!response.ok) throw new Error((await response.json().catch(() => null))?.error ?? "No se pudo restablecer la contrasena.");
      setDone(true);
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "No se pudo restablecer la contrasena.");
    } finally {
      setLoading(false);
    }
  }

  return (
    <AuthShell>
      <section className="glass-panel floating-card w-full rounded-[1.75rem] p-6 sm:p-7">
        <span className="inline-flex h-12 w-12 items-center justify-center rounded-2xl border border-primary/25 bg-primary/12 text-primary-hover">
          <KeyRound aria-hidden="true" size={22} />
        </span>
        <h1 className="mt-5 text-2xl font-semibold tracking-tight text-foreground">Elegir nueva contrasena</h1>

        {!token ? (
          <p className="mt-4 text-sm text-danger">El link no es valido. Pedi uno nuevo desde la pantalla de ingreso.</p>
        ) : done ? (
          <>
            <p className="mt-4 text-sm leading-6 text-muted">Tu contrasena se actualizo. Ya podes volver a ingresar.</p>
            <Link className={`mt-5 block w-full text-center ${primaryButtonClass}`} href="/">
              Ir a ingresar
            </Link>
          </>
        ) : (
          <form className="mt-6 space-y-4" onSubmit={handleSubmit}>
            <label className="block text-sm font-medium text-foreground/90">
              Contrasena nueva
              <div className="relative mt-1">
                <input className="min-h-11 w-full rounded-lg border border-border bg-background pl-4 pr-11 py-3 text-sm text-foreground outline-none transition focus:border-primary/60 focus:ring-4 focus:ring-primary/10" onChange={(event) => setPassword(event.target.value)} type={showPassword ? "text" : "password"} value={password} />
                <button aria-label={showPassword ? "Ocultar contrasena" : "Mostrar contrasena"} className="absolute right-3 top-1/2 -translate-y-1/2 text-muted transition hover:text-foreground" onClick={() => setShowPassword((current) => !current)} type="button">
                  {showPassword ? <EyeOff aria-hidden="true" size={16} /> : <Eye aria-hidden="true" size={16} />}
                </button>
              </div>
            </label>
            <label className="block text-sm font-medium text-foreground/90">
              Repetir contrasena
              <input className="mt-1 min-h-11 w-full rounded-lg border border-border bg-background px-4 py-3 text-sm text-foreground outline-none transition focus:border-primary/60 focus:ring-4 focus:ring-primary/10" onChange={(event) => setConfirm(event.target.value)} type={showPassword ? "text" : "password"} value={confirm} />
            </label>
            {error ? <p className="text-sm text-danger">{error}</p> : null}
            <button className={primaryButtonClass} disabled={loading} type="submit">
              {loading ? "Guardando..." : "Guardar contrasena"}
            </button>
          </form>
        )}
      </section>
    </AuthShell>
  );
}
