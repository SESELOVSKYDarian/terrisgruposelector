"use client";

import { useState } from "react";
import Link from "next/link";
import { ShieldCheck } from "lucide-react";
import { AuthShell } from "../_components/auth/auth-shell";
import { primaryButtonClass } from "../_components/ui-classes";

/**
 * A click-through confirmation instead of logging in straight off the GET link: some mail
 * clients and corporate security scanners open links automatically to check them, which would
 * otherwise burn the one-time link before the person ever sees it.
 */
export function MagicLoginForm({ token }: { token: string }) {
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");
  const [done, setDone] = useState(false);

  async function confirm() {
    setLoading(true);
    setError("");
    try {
      const response = await fetch("/api/auth/magic-login", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ token }),
      });
      if (!response.ok) throw new Error((await response.json().catch(() => null))?.error ?? "No se pudo iniciar sesión.");
      setDone(true);
      window.location.href = "/";
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "No se pudo iniciar sesión.");
    } finally {
      setLoading(false);
    }
  }

  return (
    <AuthShell>
      <section className="glass-panel floating-card w-full rounded-[1.75rem] p-6 sm:p-7">
        <span className="inline-flex h-12 w-12 items-center justify-center rounded-2xl border border-primary/25 bg-primary/12 text-primary-hover">
          <ShieldCheck aria-hidden="true" size={22} />
        </span>
        <h1 className="mt-5 text-2xl font-semibold tracking-tight text-foreground">Iniciar sesión</h1>

        {!token ? (
          <p className="mt-4 text-sm text-danger">El link no es válido. Pedí uno nuevo desde la pantalla de ingreso.</p>
        ) : done ? (
          <p className="mt-4 text-sm leading-6 text-muted">Listo, entrando…</p>
        ) : (
          <>
            <p className="mt-4 text-sm leading-6 text-muted">Confirmá para entrar a PR Territorios con este link.</p>
            {error ? <p className="mt-3 text-sm text-danger">{error}</p> : null}
            <button className={`mt-5 ${primaryButtonClass}`} disabled={loading} onClick={() => void confirm()} type="button">
              {loading ? "Entrando…" : "Confirmar e iniciar sesión"}
            </button>
            <Link className="mt-4 block text-center text-sm text-muted underline underline-offset-2" href="/">
              Prefiero usar el código
            </Link>
          </>
        )}
      </section>
    </AuthShell>
  );
}
