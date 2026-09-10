"use client";

import { FormEvent, useState } from "react";
import { AnimatePresence, motion } from "framer-motion";
import { Check, Eye, EyeOff, Lock, Mail, User, X } from "lucide-react";
import { isEmailValid, passwordRequirements } from "@/lib/domain";
import { AuthLayout } from "./auth-layout";
import { cn } from "@/lib/utils";
import { primaryButtonClass } from "../ui-classes";

const steps = ["Cuenta", "Mail", "Contrasena"] as const;

const slideVariants = {
  enter: (direction: number) => ({ x: direction > 0 ? 48 : -48, opacity: 0 }),
  center: { x: 0, opacity: 1 },
  exit: (direction: number) => ({ x: direction > 0 ? -48 : 48, opacity: 0 }),
};

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
  onSubmit: (username: string, email: string, password: string) => void;
}) {
  const [step, setStep] = useState(0);
  const [direction, setDirection] = useState(1);
  const [username, setUsername] = useState("");
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [confirm, setConfirm] = useState("");
  const [showPassword, setShowPassword] = useState(false);
  const [stepError, setStepError] = useState("");

  const passwordOk = passwordRequirements.every((requirement) => requirement.test(password));
  const emailOk = isEmailValid(email);
  const confirmOk = confirm === password;

  function goTo(next: number) {
    setDirection(next > step ? 1 : -1);
    setStepError("");
    setStep(next);
  }

  function handleNext() {
    if (step === 0) {
      if (!username.trim()) {
        setStepError("Completa tu usuario.");
        return;
      }
      goTo(1);
    } else if (step === 1) {
      if (!emailOk) {
        setStepError("El mail no es valido.");
        return;
      }
      goTo(2);
    }
  }

  function handleSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!passwordOk) {
      setStepError("La contrasena no cumple los requisitos.");
      return;
    }
    if (!confirmOk) {
      setStepError("Las contrasenas no coinciden.");
      return;
    }
    onSubmit(username.trim(), email, password);
  }

  return (
    <AuthLayout onBack={step === 0 ? onBack : () => goTo(step - 1)}>
      <p className="text-xs font-semibold uppercase tracking-[0.28em] text-primary-hover/90">PR Territorios</p>
      <h1 className="mt-1.5 text-2xl font-semibold tracking-tight text-foreground">Crear cuenta</h1>
      {step === 0 ? <p className="mt-1.5 text-sm leading-6 text-muted">Un administrador tiene que aprobar tu cuenta antes de que puedas ingresar.</p> : null}

      <div className="mt-4 flex items-center gap-2">
        {steps.map((label, index) => (
          <div className="flex flex-1 items-center gap-2" key={label}>
            <motion.div
              animate={{
                backgroundColor: index <= step ? "var(--primary)" : "rgba(255,255,255,0)",
                borderColor: index <= step ? "var(--primary)" : "var(--border)",
                color: index <= step ? "#fff" : "var(--muted)",
              }}
              className="flex h-7 w-7 shrink-0 items-center justify-center rounded-full border text-xs font-semibold"
            >
              {index < step ? <Check aria-hidden="true" size={13} /> : index + 1}
            </motion.div>
            {index < steps.length - 1 ? (
              <div className="h-0.5 flex-1 overflow-hidden rounded-full bg-border">
                <motion.div animate={{ scaleX: index < step ? 1 : 0 }} className="h-full origin-left bg-primary" transition={{ duration: 0.3 }} />
              </div>
            ) : null}
          </div>
        ))}
      </div>

      <form className="relative mt-4 overflow-hidden" onSubmit={handleSubmit}>
        <AnimatePresence custom={direction} initial={false} mode="wait">
          {step === 0 ? (
            <motion.div animate="center" className="space-y-4" custom={direction} exit="exit" initial="enter" key="step-0" transition={{ duration: 0.24, ease: "easeOut" }} variants={slideVariants}>
              <button className="flex w-full min-h-11 cursor-not-allowed items-center justify-center gap-2 rounded-xl border border-border bg-foreground/[0.03] px-4 py-2.5 text-sm font-medium text-muted" disabled title="Disponible pronto" type="button">
                <svg aria-hidden="true" height="16" viewBox="0 0 24 24" width="16"><path d="M22.56 12.25c0-.78-.07-1.53-.2-2.25H12v4.26h5.92c-.26 1.37-1.04 2.53-2.21 3.31v2.77h3.57c2.08-1.92 3.28-4.74 3.28-8.09z" fill="#4285F4" /><path d="M12 23c2.97 0 5.46-.98 7.28-2.66l-3.57-2.77c-.98.66-2.23 1.06-3.71 1.06-2.86 0-5.29-1.93-6.16-4.53H2.18v2.84C3.99 20.53 7.7 23 12 23z" fill="#34A853" /><path d="M5.84 14.09c-.22-.66-.35-1.36-.35-2.09s.13-1.43.35-2.09V7.07H2.18C1.43 8.55 1 10.22 1 12s.43 3.45 1.18 4.93z" fill="#FBBC05" /><path d="M12 5.38c1.62 0 3.06.56 4.21 1.64l3.15-3.15C17.45 2.09 14.97 1 12 1 7.7 1 3.99 3.47 2.18 7.07l3.66 2.84c.87-2.6 3.3-4.53 6.16-4.53z" fill="#EA4335" /></svg>
                Continuar con Google (proximamente)
              </button>
              <label className="block text-sm font-medium text-foreground/90">
                Usuario
                <div className="relative mt-1">
                  <User aria-hidden="true" className="pointer-events-none absolute left-3.5 top-1/2 -translate-y-1/2 text-muted" size={16} />
                  <input autoComplete="username" autoFocus className="min-h-11 w-full rounded-xl border border-border bg-background pl-10 pr-4 py-3 text-sm text-foreground outline-none transition focus:border-primary/60 focus:ring-4 focus:ring-primary/10" onChange={(event) => setUsername(event.target.value)} placeholder="JPerez" value={username} />
                </div>
              </label>
            </motion.div>
          ) : step === 1 ? (
            <motion.div animate="center" className="space-y-4" custom={direction} exit="exit" initial="enter" key="step-1" transition={{ duration: 0.24, ease: "easeOut" }} variants={slideVariants}>
              <label className="block text-sm font-medium text-foreground/90">
                Mail
                <div className="relative mt-1">
                  <Mail aria-hidden="true" className="pointer-events-none absolute left-3.5 top-1/2 -translate-y-1/2 text-muted" size={16} />
                  <input autoComplete="email" autoFocus className="min-h-11 w-full rounded-xl border border-border bg-background pl-10 pr-9 py-3 text-sm text-foreground outline-none transition focus:border-primary/60 focus:ring-4 focus:ring-primary/10" onChange={(event) => setEmail(event.target.value.trim())} type="email" value={email} />
                  {email ? (
                    emailOk ? <Check aria-hidden="true" className="absolute right-3 top-1/2 -translate-y-1/2 text-success" size={16} /> : <X aria-hidden="true" className="absolute right-3 top-1/2 -translate-y-1/2 text-danger" size={16} />
                  ) : null}
                </div>
              </label>
            </motion.div>
          ) : (
            <motion.div animate="center" className="space-y-2.5" custom={direction} exit="exit" initial="enter" key="step-2" transition={{ duration: 0.24, ease: "easeOut" }} variants={slideVariants}>
              <label className="block text-sm font-medium text-foreground/90">
                Contrasena
                <div className="relative mt-1">
                  <Lock aria-hidden="true" className="pointer-events-none absolute left-3.5 top-1/2 -translate-y-1/2 text-muted" size={16} />
                  <input autoComplete="new-password" autoFocus className="min-h-11 w-full rounded-xl border border-border bg-background pl-10 pr-11 py-2.5 text-sm text-foreground outline-none transition focus:border-primary/60 focus:ring-4 focus:ring-primary/10" onChange={(event) => setPassword(event.target.value)} type={showPassword ? "text" : "password"} value={password} />
                  <button aria-label={showPassword ? "Ocultar contrasena" : "Mostrar contrasena"} className="absolute right-3 top-1/2 -translate-y-1/2 text-muted transition hover:text-foreground" onClick={() => setShowPassword((current) => !current)} type="button">
                    {showPassword ? <EyeOff aria-hidden="true" size={16} /> : <Eye aria-hidden="true" size={16} />}
                  </button>
                </div>
              </label>
              <ul className="grid grid-cols-2 gap-1 text-[11px] leading-tight">
                {passwordRequirements.map((requirement) => {
                  const met = requirement.test(password);
                  return (
                    <li className={cn("flex items-center gap-1.5", met ? "text-success" : "text-muted")} key={requirement.id}>
                      {met ? <Check aria-hidden="true" size={12} /> : <X aria-hidden="true" size={12} />}
                      {requirement.label}
                    </li>
                  );
                })}
              </ul>
              <label className="block text-sm font-medium text-foreground/90">
                Repetir contrasena
                <input autoComplete="new-password" className="mt-1 min-h-11 w-full rounded-xl border border-border bg-background px-4 py-2.5 text-sm text-foreground outline-none transition focus:border-primary/60 focus:ring-4 focus:ring-primary/10" onChange={(event) => setConfirm(event.target.value)} type={showPassword ? "text" : "password"} value={confirm} />
              </label>
              {confirm && !confirmOk ? <p className="text-xs text-danger">Las contrasenas no coinciden.</p> : null}
            </motion.div>
          )}
        </AnimatePresence>

        {stepError ? <p className="mt-3 text-sm text-danger">{stepError}</p> : null}
        {error ? <p className="mt-3 text-sm text-danger">{error}</p> : null}

        <div className="mt-5">
          {step < 2 ? (
            <motion.button className={primaryButtonClass} onClick={handleNext} type="button" whileHover={{ scale: 1.015 }} whileTap={{ scale: 0.98 }}>
              Continuar
            </motion.button>
          ) : (
            <motion.button className={primaryButtonClass} disabled={loading} type="submit" whileHover={loading ? undefined : { scale: 1.015 }} whileTap={loading ? undefined : { scale: 0.98 }}>
              {loading ? "Creando cuenta..." : "Crear cuenta"}
            </motion.button>
          )}
        </div>
      </form>

      <p className="mt-4 text-center text-sm text-muted">
        ¿Ya tenes cuenta?{" "}
        <button className="text-primary-hover transition hover:underline" onClick={onLogin} type="button">
          Iniciar sesion
        </button>
      </p>
    </AuthLayout>
  );
}
