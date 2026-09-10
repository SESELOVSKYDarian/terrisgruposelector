"use client";

import { FormEvent, useState } from "react";
import { Mail } from "lucide-react";
import { AuthLayout } from "./auth-layout";
import { primaryButtonClass } from "../ui-classes";

export function ForgotPasswordCard({ loading, onBack, onSubmit, sent }: { loading: boolean; onBack: () => void; onSubmit: (usernameOrEmail: string) => void; sent: boolean }) {
  const [value, setValue] = useState("");

  function handleSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    onSubmit(value);
  }

  return (
    <AuthLayout onBack={onBack}>
      <h1 className="text-2xl font-semibold tracking-tight text-foreground">Recuperar contraseña</h1>
      <p className="mt-2 text-sm leading-6 text-muted">Ingresa tu usuario o tu mail. Si esta registrado, te llega un link para elegir una contraseña nueva.</p>

      {sent ? (
        <p className="mt-6 rounded-lg border border-emerald-400/25 bg-emerald-500/12 px-4 py-3 text-sm text-emerald-300">
          Si el usuario existe, te llega un mail con un link para restablecer la contraseña.
        </p>
      ) : (
        <form className="mt-6 space-y-4" onSubmit={handleSubmit}>
          <label className="block text-sm font-medium text-foreground/90">
            Usuario o mail
            <div className="relative mt-1">
              <Mail aria-hidden="true" className="pointer-events-none absolute left-3.5 top-1/2 -translate-y-1/2 text-muted" size={16} />
              <input className="min-h-11 w-full rounded-xl border border-border bg-background pl-10 pr-4 py-3 text-sm text-foreground outline-none transition focus:border-primary/60 focus:ring-4 focus:ring-primary/10" onChange={(event) => setValue(event.target.value)} required value={value} />
            </div>
          </label>
          <button className={primaryButtonClass} disabled={loading} type="submit">
            {loading ? "Enviando..." : "Enviar link"}
          </button>
        </form>
      )}
    </AuthLayout>
  );
}
