"use client";

import { Clock } from "lucide-react";
import { AuthLayout } from "./auth-layout";
import { primaryButtonClass } from "../ui-classes";

export function PendingApprovalScreen({ onBack }: { onBack: () => void }) {
  return (
    <AuthLayout>
      <div className="text-center">
        <span className="inline-flex h-14 w-14 items-center justify-center rounded-2xl border border-primary/25 bg-primary/12 text-primary-hover">
          <Clock aria-hidden="true" size={24} />
        </span>
        <h1 className="mt-5 text-2xl font-semibold tracking-tight text-foreground">Cuenta en revision</h1>
        <p className="mt-2 text-sm leading-6 text-muted">Tu cuenta esta esperando la aprobacion de un administrador. Te van a poder asignar rol una vez que la revisen.</p>
        <button className={`mt-7 ${primaryButtonClass}`} onClick={onBack} type="button">
          Volver
        </button>
      </div>
    </AuthLayout>
  );
}
