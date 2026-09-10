"use client";

import { useState } from "react";
import { startRegistration } from "@simplewebauthn/browser";
import { Fingerprint } from "lucide-react";
import { primaryButtonClass, secondaryButtonClass } from "../ui-classes";

export function PasskeyPromptModal({ onClose }: { onClose: () => void }) {
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");

  async function createPasskey() {
    setBusy(true);
    setError("");
    try {
      const optionsResponse = await fetch("/api/auth/passkey/register-options", { method: "POST" });
      if (!optionsResponse.ok) throw new Error("No se pudo iniciar la llave de acceso.");
      const optionsJSON = await optionsResponse.json();
      const attestation = await startRegistration({ optionsJSON });
      const verifyResponse = await fetch("/api/auth/passkey/register-verify", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(attestation),
      });
      if (!verifyResponse.ok) throw new Error((await verifyResponse.json().catch(() => null))?.error ?? "No se pudo crear la llave de acceso.");
      onClose();
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "No se pudo crear la llave de acceso.");
    } finally {
      setBusy(false);
    }
  }

  async function declineAndRememberDevice() {
    setBusy(true);
    try {
      await fetch("/api/auth/device-trust", { method: "POST" });
    } finally {
      setBusy(false);
      onClose();
    }
  }

  return (
    <div className="modal-overlay fixed inset-0 z-[90] grid place-items-center bg-[var(--overlay-strong)] px-4 py-6 backdrop-blur-sm">
      <div className="modal-panel glass-panel w-full max-w-md rounded-[1.5rem] border border-primary/20 p-6">
        <span className="inline-flex h-12 w-12 items-center justify-center rounded-2xl border border-primary/25 bg-primary/12 text-primary-hover">
          <Fingerprint aria-hidden="true" size={22} />
        </span>
        <h2 className="mt-5 text-xl font-semibold tracking-tight text-foreground">¿Crear una llave de acceso?</h2>
        <p className="mt-2 text-sm leading-6 text-muted">
          Usa tu huella, cara o PIN de este dispositivo para volver a entrar sin escribir la contraseña. Si preferis no hacerlo ahora, vamos a recordar este dispositivo por 7 dias.
        </p>
        {error ? <p className="mt-3 text-sm text-danger">{error}</p> : null}
        <div className="mt-6 grid gap-2 sm:grid-cols-2">
          <button className={secondaryButtonClass} disabled={busy} onClick={declineAndRememberDevice} type="button">
            No, por ahora
          </button>
          <button className={primaryButtonClass} disabled={busy} onClick={createPasskey} type="button">
            {busy ? "Creando..." : "Crear llave de acceso"}
          </button>
        </div>
      </div>
    </div>
  );
}
