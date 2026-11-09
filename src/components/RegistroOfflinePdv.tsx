"use client";

import { useEffect } from "react";

/** Registra o service worker do PDV (só em produção e só quando suportado); falha silenciosamente. */
export function RegistroOfflinePdv() {
  useEffect(() => {
    if (typeof navigator === "undefined" || !("serviceWorker" in navigator)) return;
    if (process.env.NODE_ENV !== "production") return;
    navigator.serviceWorker.register("/sw.js", { scope: "/" }).catch(() => undefined);
  }, []);
  return null;
}
