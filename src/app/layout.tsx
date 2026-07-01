import type { Metadata } from "next";
import "./globals.css";

export const metadata: Metadata = {
  title: "Terris Grupo Selector",
  description: "Gestion de territorios, reservas y vueltas anuales.",
};

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <html lang="es" className="h-full bg-slate-950 antialiased" suppressHydrationWarning>
      <body className="min-h-full bg-slate-950 text-slate-100" suppressHydrationWarning>
        {children}
      </body>
    </html>
  );
}
