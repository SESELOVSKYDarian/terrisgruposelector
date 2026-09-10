"use client";

import { FormEvent, useState } from "react";
import { Check, Eye, EyeOff, KeyRound, X } from "lucide-react";
import { passwordRequirements } from "@/lib/domain";
import { primaryButtonClass } from "../ui-classes";

export function ForcePasswordChangeScreen({ onDone, onLogout }: { onDone: () => Promise<void>; onLogout: () => void }) {
  const [password, setPassword] = useState("");
  const [confirm, setConfirm] = useState("");
  const [showPassword, setShowPassword] = useState(false);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");

  const passwordOk = passwordRequirements.every((requirement) => requirement.test(password));

  async function handleSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!passwordOk) {
      setError("La contraseña no cumple los requisitos.");
      return;
    }
    if (password !== confirm) {
      setError("Las contraseñas no coinciden.");
      return;
    }
    setLoading(true);
    setError("");
    try {
      const response = await fetch("/api/auth/change-password", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ newPassword: password }),
      });
      if (!response.ok) throw new Error((await response.json().catch(() => null))?.error ?? "No se pudo cambiar la contraseña.");
      await onDone();
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "No se pudo cambiar la contraseña.");
    } finally {
      setLoading(false);
    }
  }

  return (
    <main className="relative z-10 grid min-h-screen place-items-center px-4 py-8">
      <section className="glass-panel floating-card w-full max-w-md rounded-[1.75rem] p-6 sm:p-7">
        <span className="inline-flex h-12 w-12 items-center justify-center rounded-2xl border border-primary/25 bg-primary/12 text-primary-hover">
          <KeyRound aria-hidden="true" size={22} />
        </span>
        <h1 className="mt-5 text-2xl font-semibold tracking-tight text-foreground">Elegi una contraseña nueva</h1>
        <p className="mt-2 text-sm leading-6 text-muted">Tu contraseña actual es temporal. Elegi una nueva para seguir.</p>

        <form className="mt-6 space-y-4" onSubmit={handleSubmit}>
          <label className="block text-sm font-medium text-foreground/90">
            Contraseña nueva
            <div className="relative mt-1">
              <input autoComplete="new-password" className="min-h-11 w-full rounded-lg border border-border bg-background pl-4 pr-11 py-3 text-sm text-foreground outline-none transition focus:border-primary/60 focus:ring-4 focus:ring-primary/10" onChange={(event) => setPassword(event.target.value)} type={showPassword ? "text" : "password"} value={password} />
              <button aria-label={showPassword ? "Ocultar contraseña" : "Mostrar contraseña"} className="absolute right-3 top-1/2 -translate-y-1/2 text-muted transition hover:text-foreground" onClick={() => setShowPassword((current) => !current)} type="button">
                {showPassword ? <EyeOff aria-hidden="true" size={16} /> : <Eye aria-hidden="true" size={16} />}
              </button>
            </div>
          </label>
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
          <label className="block text-sm font-medium text-foreground/90">
            Repetir contraseña
            <input autoComplete="new-password" className="mt-1 min-h-11 w-full rounded-lg border border-border bg-background px-4 py-3 text-sm text-foreground outline-none transition focus:border-primary/60 focus:ring-4 focus:ring-primary/10" onChange={(event) => setConfirm(event.target.value)} type={showPassword ? "text" : "password"} value={confirm} />
          </label>
          {error ? <p className="text-sm text-danger">{error}</p> : null}
          <button className={primaryButtonClass} disabled={loading} type="submit">
            {loading ? "Guardando..." : "Guardar y continuar"}
          </button>
        </form>

        <button className="mt-5 block w-full text-center text-sm text-muted transition hover:text-foreground" onClick={onLogout} type="button">
          Cerrar sesion
        </button>
      </section>
    </main>
  );
}
