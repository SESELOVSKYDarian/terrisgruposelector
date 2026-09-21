"use client";

import { useEffect } from "react";

const KEY = "v2:highlight";
const FLASH = ["ring-2", "ring-primary", "ring-offset-2", "ring-offset-background"];

/** A notification deep link asks the destination panel to scroll to an entity and flash it. */
export function rememberHighlight(entityId: string | null) {
  try {
    if (entityId) window.sessionStorage.setItem(KEY, entityId);
  } catch {
    // Highlighting is a nicety; a blocked sessionStorage must never break navigation.
  }
}

/**
 * Call from a panel once its data is rendered (`ready`). Elements opt in with
 * `data-entity-id="<id>"`; the first match is scrolled into view and briefly outlined.
 */
export function useHighlight(ready: boolean) {
  useEffect(() => {
    if (!ready) return;
    let id: string | null = null;
    try {
      id = window.sessionStorage.getItem(KEY);
    } catch {
      return;
    }
    if (!id) return;
    const target = document.querySelector<HTMLElement>(`[data-entity-id="${CSS.escape(id)}"]`);
    if (!target) return;
    try {
      window.sessionStorage.removeItem(KEY);
    } catch {
      // ignore
    }
    target.scrollIntoView({ block: "center", behavior: "smooth" });
    target.classList.add(...FLASH);
    const timer = window.setTimeout(() => target.classList.remove(...FLASH), 2600);
    return () => window.clearTimeout(timer);
  }, [ready]);
}
