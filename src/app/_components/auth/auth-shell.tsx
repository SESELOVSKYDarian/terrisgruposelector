"use client";

import { ReactNode } from "react";
import { ThemeToggle } from "../theme-toggle";

export function AuthShell({ children }: { children: ReactNode }) {
  return (
    <main className="relative z-10 grid min-h-screen place-items-center overflow-hidden px-4 py-8">
      <div aria-hidden="true" className="absolute inset-0 bg-cover bg-center" style={{ backgroundImage: "url(/auth-bg.jpg)" }} />
      <div aria-hidden="true" className="absolute inset-0 bg-[var(--overlay-strong)]" />
      <div className="absolute right-4 top-4 z-10">
        <ThemeToggle />
      </div>
      <div className="relative z-10 w-full max-w-md">{children}</div>
    </main>
  );
}
