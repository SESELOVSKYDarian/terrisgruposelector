"use client";

import { motion } from "framer-motion";
import { SELF_REGISTRATION_ENABLED } from "@/lib/feature-flags";
import { LightAuthCard, LightAuthHeader, lightPrimaryButtonClass, lightSecondaryButtonClass } from "./light-auth-card";

export function AuthChoiceScreen({ onLogin, onRegister }: { onLogin: () => void; onRegister: () => void }) {
  return (
    <LightAuthCard>
      <LightAuthHeader subtitle="Gestión de territorios y salidas de la congregación" title="PR Territorios" />
      <div className="space-y-2.5 p-8">
        <motion.button className={lightPrimaryButtonClass} onClick={onLogin} type="button" whileHover={{ scale: 1.015 }} whileTap={{ scale: 0.98 }}>
          Iniciar sesión
        </motion.button>
        {SELF_REGISTRATION_ENABLED ? (
          <motion.button className={lightSecondaryButtonClass} onClick={onRegister} type="button" whileHover={{ scale: 1.015 }} whileTap={{ scale: 0.98 }}>
            Crear cuenta
          </motion.button>
        ) : null}
      </div>
    </LightAuthCard>
  );
}
