import type { Metadata } from "next";
import type { ReactNode } from "react";
import "./globals.css";
import { ToastProvider } from "@/components/ui";

export const metadata: Metadata = {
  title: { default: "NKWAY — ERP e PDV", template: "%s · NKWAY" },
  description:
    "Sistema de gestão para pequenos negócios: PDV offline-first, DAV, NFC-e/NF-e simulada, entrada por XML, estoque com kardex e financeiro.",
};

export default function RootLayout({ children }: { children: ReactNode }) {
  return (
    <html lang="pt-BR">
      <body className="antialiased">
        <ToastProvider>{children}</ToastProvider>
      </body>
    </html>
  );
}
