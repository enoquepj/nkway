import { createClient, type SupabaseClient } from "@supabase/supabase-js";

const url = import.meta.env.VITE_SUPABASE_URL as string | undefined;
const anonKey = import.meta.env.VITE_SUPABASE_ANON_KEY as string | undefined;

/**
 * Modo de operação do NKWAY:
 *  - "cloud": variáveis configuradas → dados no Supabase, isolados por empresa
 *  - "demo" : sem variáveis → tudo em localStorage (ideal para demonstração)
 */
export const modo: "cloud" | "demo" = url && anonKey ? "cloud" : "demo";

export const supabase: SupabaseClient | null =
  modo === "cloud" ? createClient(url!, anonKey!) : null;

export const isCloud = modo === "cloud";
