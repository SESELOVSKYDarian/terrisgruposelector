"use client";

import { useCallback, useEffect, useState } from "react";

type Result<T> = { data: T | null; error: string; loading: boolean; busy: boolean; reload: () => Promise<void>; run: (action: string, payload?: Record<string, unknown>) => Promise<boolean> };

async function request(path: string, init?: RequestInit) {
  const response = await fetch(path, { ...init, headers: { "Content-Type": "application/json", ...(init?.headers ?? {}) }, credentials: "same-origin" });
  const body = await response.json().catch(() => ({}));
  if (!response.ok) throw new Error(typeof body?.error === "string" ? body.error : "No se pudo completar la solicitud.");
  return body;
}

/**
 * Client access to a V2 module route: GET loads the module state, POST { action, payload }
 * mutates it and reloads. Authorization always lives on the server.
 */
export function useModuleApi<T>(path: string): Result<T> {
  const [data, setData] = useState<T | null>(null);
  const [error, setError] = useState("");
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState(false);

  const reload = useCallback(async () => {
    try {
      setData((await request(path)) as T);
      setError("");
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "Error inesperado.");
    } finally {
      setLoading(false);
    }
  }, [path]);

  useEffect(() => {
    // eslint-disable-next-line react-hooks/set-state-in-effect -- initial fetch of the module state
    void reload();
  }, [reload]);

  const run = useCallback(
    async (action: string, payload?: Record<string, unknown>) => {
      setBusy(true);
      try {
        await request(path, { method: "POST", body: JSON.stringify({ action, payload }) });
        await reload();
        return true;
      } catch (cause) {
        setError(cause instanceof Error ? cause.message : "Error inesperado.");
        return false;
      } finally {
        setBusy(false);
      }
    },
    [path, reload],
  );

  return { data, error, loading, busy, reload, run };
}
