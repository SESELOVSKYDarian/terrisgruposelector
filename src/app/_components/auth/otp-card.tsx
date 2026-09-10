"use client";

import { FormEvent, useState } from "react";
import { AuthLayout } from "./auth-layout";
import { primaryButtonClass } from "../ui-classes";

export function OtpCard({
  error,
  loading,
  onBack,
  onResend,
  onSubmit,
  resent,
}: {
  error: string;
  loading: boolean;
  onBack: () => void;
  onResend: () => void;
  onSubmit: (code: string) => void;
  resent: boolean;
}) {
  const [code, setCode] = useState("");

  function handleSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    onSubmit(code);
  }

  return (
    <AuthLayout onBack={onBack}>
      <h1 className="text-2xl font-semibold tracking-tight text-foreground">Verifica tu identidad</h1>
      <p className="mt-2 text-sm leading-6 text-muted">Te enviamos un codigo de 6 numeros a tu mail. Ingresalo para continuar.</p>

      <form className="mt-6 space-y-4" onSubmit={handleSubmit}>
        <input
          autoFocus
          className="min-h-14 w-full rounded-xl border border-border bg-background text-center text-2xl font-semibold tracking-[0.5em] text-foreground outline-none transition focus:border-primary/60 focus:ring-4 focus:ring-primary/10"
          inputMode="numeric"
          maxLength={6}
          name="code"
          onChange={(event) => setCode(event.target.value.replace(/\D/g, ""))}
          pattern="[0-9]{6}"
          value={code}
        />
        {error ? <p className="text-sm text-danger">{error}</p> : null}
        {resent ? <p className="text-sm text-success">Te enviamos un codigo nuevo.</p> : null}
        <button className={primaryButtonClass} disabled={loading || code.length !== 6} type="submit">
          {loading ? "Verificando..." : "Verificar"}
        </button>
      </form>

      <button className="mt-5 block w-full text-center text-sm text-primary-hover transition hover:underline" onClick={onResend} type="button">
        Reenviar codigo
      </button>
    </AuthLayout>
  );
}
