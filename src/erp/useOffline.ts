import { useCallback, useEffect, useState } from "react";
import { isCloud } from "../lib/supabase";
import { salvarVenda } from "./cloud";
import { filaAtual, sincronizar, type ItemFila } from "./offline";
import type { Venda } from "./types";

export function useOffline(empresaId?: string) {
  const [online, setOnline] = useState(navigator.onLine);
  const [fila, setFila] = useState<ItemFila[]>(filaAtual);
  const [sincronizando, setSincronizando] = useState(false);
  const [ultimoSync, setUltimoSync] = useState<number | null>(null);

  // Escuta mudanças de conexão e da própria fila
  useEffect(() => {
    const up = () => setOnline(true);
    const down = () => setOnline(false);
    const refresh = () => setFila(filaAtual());

    window.addEventListener("online", up);
    window.addEventListener("offline", down);
    window.addEventListener("nkway:fila", refresh);
    return () => {
      window.removeEventListener("online", up);
      window.removeEventListener("offline", down);
      window.removeEventListener("nkway:fila", refresh);
    };
  }, []);

  const enviar = useCallback(
    async (v: Venda) => {
      if (!isCloud) {
        // Modo demo: simula latência de rede para validar o fluxo
        await new Promise((r) => setTimeout(r, 400));
        return;
      }
      const { error } = await salvarVenda(empresaId!, v);
      if (error) throw new Error(error.message);
    },
    [empresaId],
  );

  const sync = useCallback(async () => {
    if (sincronizando || !navigator.onLine) return;
    setSincronizando(true);
    await sincronizar(enviar);
    setFila(filaAtual());
    setUltimoSync(Date.now());
    setSincronizando(false);
  }, [enviar, sincronizando]);

  // Sincroniza automaticamente assim que a conexão volta
  useEffect(() => {
    if (online && fila.length > 0) void sync();
  }, [online]);

  return { online, fila, sincronizando, ultimoSync, sync };
}
