import { zipSync } from "fflate";

/** UTF-8 nativo do navegador (preserva acentos e emojis corretamente) */
const utf8 = (texto: string) => new Uint8Array(new TextEncoder().encode(texto));

/**
 * Backup do código-fonte do projeto, para levar ao GitHub sem precisar de token.
 * Os arquivos de texto são embutidos no app no momento do build (import.meta.glob ?raw).
 * Imagens e arquivos binários não entram (não foram alterados).
 */
const arquivos = {
  ...import.meta.glob("/src/**/*.{ts,tsx,css}", { query: "?raw", import: "default", eager: true }),
  ...import.meta.glob("/public/*.{js,webmanifest,json,txt,svg}", { query: "?raw", import: "default", eager: true }),
  ...import.meta.glob("/supabase/*.sql", { query: "?raw", import: "default", eager: true }),
  ...import.meta.glob("/*.{md,json,toml,html,sh}", { query: "?raw", import: "default", eager: true }),
  ...import.meta.glob(["/vite.config.ts", "/.gitignore", "/.env.example", "/.npmrc"], { query: "?raw", import: "default", eager: true }),
} as Record<string, string>;

/** Lista de caminhos incluídos (sem a barra inicial), em ordem alfabética */
export const arquivosBackup = Object.keys(arquivos)
  .map((k) => k.replace(/^\//, ""))
  .sort((a, b) => a.localeCompare(b));

/** Gera o .zip com a estrutura de pastas do repositório e inicia o download */
export function baixarBackupProjeto(extras: Record<string, string> = {}): { arquivos: number; nome: string } {
  const conteudo: Record<string, Uint8Array> = {};
  // um módulo não consegue importar o próprio código; ele chega por "extras"
  for (const [caminho, texto] of Object.entries({ ...arquivos, ...extras })) {
    conteudo[caminho.replace(/^\//, "")] = utf8(texto);
  }
  conteudo["LEIA-ME-BACKUP.txt"] = utf8(
    [
      "Backup do projeto NKWAY gerado no arena.ai em " + new Date().toLocaleString("pt-BR"),
      "",
      "COMO ATUALIZAR O GITHUB:",
      "1. GitHub Desktop: Fetch origin e depois Pull origin (traz o que já está no GitHub).",
      "2. Repository > Show in Explorer: abre a pasta do repositório.",
      "3. Copie TUDO desta pasta (exceto este arquivo) para dentro da pasta do repositório.",
      "   Quando perguntar, escolha 'Substituir os arquivos no destino'.",
      "4. GitHub Desktop: confira a aba Changes, escreva um resumo e clique em Commit to main.",
      "5. Clique em Push origin.",
      "",
      `Arquivos incluídos (${arquivosBackup.length + Object.keys(extras).length}):`,
      ...[...arquivosBackup, ...Object.keys(extras).map((k) => k.replace(/^\//, ""))].sort().map((a) => " - " + a),
    ].join("\r\n"),
  );

  const zip = zipSync(conteudo, { level: 9 });
  const nome = `nkway-backup-${new Date().toISOString().slice(0, 10)}.zip`;
  const url = URL.createObjectURL(new Blob([zip as Uint8Array<ArrayBuffer>], { type: "application/zip" }));
  const a = document.createElement("a");
  a.href = url;
  a.download = nome;
  document.body.appendChild(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 2000);
  return { arquivos: Object.keys(conteudo).length - 1, nome };
}
