"use client";

import { useEffect, useState } from "react";
import { Moon, Sun } from "lucide-react";
import { cn } from "@/lib/utils";

function readTheme(): "light" | "dark" {
  if (typeof document === "undefined") return "dark";
  return document.documentElement.dataset.theme === "light" ? "light" : "dark";
}

function applyTheme(theme: "light" | "dark") {
  document.documentElement.dataset.theme = theme;
  document.cookie = `theme=${theme}; path=/; max-age=${60 * 60 * 24 * 365}; samesite=lax`;
}

export function ThemeToggle({ className }: { className?: string }) {
  const [theme, setTheme] = useState<"light" | "dark">("dark");

  useEffect(() => {
    // eslint-disable-next-line react-hooks/set-state-in-effect -- avoid SSR/client hydration mismatch, mirrors page.tsx's own exemption
    setTheme(readTheme());
  }, []);

  function toggle() {
    const next = theme === "light" ? "dark" : "light";
    setTheme(next);
    applyTheme(next);
  }

  return (
    <button
      aria-label={theme === "light" ? "Cambiar a modo oscuro" : "Cambiar a modo claro"}
      className={cn(
        "inline-flex h-10 w-10 shrink-0 cursor-pointer items-center justify-center rounded-xl border border-border bg-foreground/[0.04] text-muted transition hover:border-foreground/18 hover:text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-foreground/30",
        className,
      )}
      onClick={toggle}
      title={theme === "light" ? "Cambiar a modo oscuro" : "Cambiar a modo claro"}
      type="button"
    >
      {theme === "light" ? <Moon size={17} aria-hidden="true" /> : <Sun size={17} aria-hidden="true" />}
    </button>
  );
}
