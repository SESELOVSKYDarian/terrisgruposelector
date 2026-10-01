"use client";

import { FormEvent, useState } from "react";
import { motion } from "framer-motion";
import { ChevronLeft, Eye, EyeOff, KeyRound } from "lucide-react";
import { SELF_REGISTRATION_ENABLED } from "@/lib/feature-flags";
import { LightAuthCard, LightAuthHeader, lightInputClass, lightPrimaryButtonClass, lightSecondaryButtonClass } from "./light-auth-card";

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
    <LightAuthCard>
      <LightAuthHeader subtitle="Usá tu usuario y contraseña para ingresar" title="Bienvenido de nuevo" />
      <div className="p-8">
        {hasPasskeyHint ? (
          <button className={`mb-5 ${lightSecondaryButtonClass}`} onClick={onPasskeyLogin} type="button">
            <KeyRound aria-hidden="true" size={16} />
            Ingresar con llave de acceso
          </button>
        ) : null}

        <form className="space-y-5" onSubmit={handleSubmit}>
          <label className="block space-y-1.5" htmlFor="login-user">
            <span className="px-1 text-[10px] font-bold uppercase tracking-widest text-slate-500">Usuario</span>
            <input autoComplete="username" autoFocus className={lightInputClass} id="login-user" name="username" placeholder="nombre de usuario" required />
          </label>
          <label className="block space-y-1.5" htmlFor="login-pass">
            <span className="px-1 text-[10px] font-bold uppercase tracking-widest text-slate-500">Contraseña</span>
            <div className="relative">
              <input autoComplete="current-password" className={`${lightInputClass} pr-11`} id="login-pass" name="password" placeholder="••••••••" required type={showPassword ? "text" : "password"} />
              <button aria-label={showPassword ? "Ocultar contraseña" : "Mostrar contraseña"} className="absolute right-3 top-1/2 flex h-8 w-8 -translate-y-1/2 items-center justify-center text-slate-400 transition hover:text-[#007aff]" onClick={() => setShowPassword((current) => !current)} type="button">
                {showPassword ? <EyeOff aria-hidden="true" size={16} /> : <Eye aria-hidden="true" size={16} />}
              </button>
            </div>
          </label>
          <label className="flex cursor-pointer items-center gap-3 px-1">
            <input className="h-4 w-4 rounded border-slate-300 accent-[#007aff]" name="deviceSecure" type="checkbox" />
            <span className="text-xs font-bold text-slate-500">Este dispositivo es seguro (recordarlo 30 días)</span>
          </label>
          {error ? <div className="rounded-xl border border-red-100 bg-red-50 p-3 text-center text-xs font-bold text-red-600">{error}</div> : null}
          <motion.button className={lightPrimaryButtonClass} disabled={loading} type="submit" whileHover={loading ? undefined : { scale: 1.015 }} whileTap={loading ? undefined : { scale: 0.98 }}>
            <KeyRound aria-hidden="true" size={18} />
            {loading ? "Ingresando…" : "Entrar"}
          </motion.button>
        </form>

        <button className="mt-5 block w-full text-center text-sm font-semibold text-[#007aff] transition hover:underline" onClick={onForgotPassword} type="button">
          ¿Olvidaste tu contraseña?
        </button>
        {SELF_REGISTRATION_ENABLED ? (
          <p className="mt-3 text-center text-sm text-slate-500">
            ¿No tenés cuenta?{" "}
            <button className="font-semibold text-[#007aff] transition hover:underline" onClick={onRegister} type="button">
              Crear cuenta
            </button>
          </p>
        ) : null}

        <div className="mt-8 border-t border-slate-100 pt-6 text-center">
          <button className="inline-flex items-center justify-center gap-2 text-xs font-bold text-slate-400 transition hover:text-slate-600" onClick={onBack} type="button">
            <ChevronLeft aria-hidden="true" size={14} />
            Volver al inicio
          </button>
        </div>
      </div>
    </LightAuthCard>
  );
}
