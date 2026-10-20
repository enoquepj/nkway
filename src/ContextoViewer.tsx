import { useRef, useState } from "react";
import contexto from "../CONTEXTO.md?raw";
import { arquivosBackup, baixarBackupProjeto } from "./backupProjeto";
import codigoBackup from "./backupProjeto.ts?raw";

/**
 * Botão flutuante que mostra o CONTEXTO.md para o usuário copiar.
 * Ferramenta de apoio ao desenvolvimento. Pode ser removida depois.
 */
export default function ContextoViewer() {
  const [open, setOpen] = useState(false);
  const [status, setStatus] = useState("");
  const ref = useRef<HTMLTextAreaElement>(null);

  const flash = (msg: string) => {
    setStatus(msg);
    setTimeout(() => setStatus(""), 3000);
  };

  const selecionar = () => {
    ref.current?.focus();
    ref.current?.select();
  };

  const copiar = async () => {
    try {
      await navigator.clipboard.writeText(contexto);
      flash("✓ Copiado! Agora cole no GitHub (Ctrl+V).");
      return;
    } catch {
      /* usa o método alternativo abaixo */
    }
    selecionar();
    try {
      if (document.execCommand("copy")) {
        flash("✓ Copiado! Agora cole no GitHub (Ctrl+V).");
        return;
      }
    } catch {
      /* ignora */
    }
    flash("Texto selecionado. Aperte Ctrl+C para copiar.");
  };

  const baixar = () => {
    try {
      const url = URL.createObjectURL(new Blob([contexto], { type: "text/markdown" }));
      const a = document.createElement("a");
      a.href = url;
      a.download = "CONTEXTO.md";
      document.body.appendChild(a);
      a.click();
      a.remove();
      setTimeout(() => URL.revokeObjectURL(url), 1000);
      flash("Download iniciado. Se não baixar, use o botão Copiar.");
    } catch {
      flash("Não foi possível baixar aqui. Use o botão Copiar.");
    }
  };

  const baixarProjeto = () => {
    try {
      const r = baixarBackupProjeto({ "/src/backupProjeto.ts": codigoBackup });
      flash(`✓ ${r.nome} baixado (${r.arquivos} arquivos). Veja a pasta Downloads.`);
    } catch {
      flash("Não foi possível gerar o .zip neste navegador.");
    }
  };

  return (
    <>
      <button
        onClick={() => setOpen(true)}
        className="fixed bottom-4 left-4 z-[9999] rounded-full bg-amber-500 px-4 py-2.5 text-sm font-bold text-white shadow-lg ring-4 ring-amber-200 transition hover:bg-amber-600"
      >
        📋 Contexto / Backup
      </button>

      {open && (
        <div className="fixed inset-0 z-[10000] flex items-center justify-center bg-black/60 p-3" onClick={() => setOpen(false)}>
          <div className="flex max-h-[95vh] w-full max-w-3xl flex-col overflow-hidden rounded-2xl bg-white shadow-2xl" onClick={(e) => e.stopPropagation()}>
            <div className="flex items-center justify-between border-b border-slate-200 px-5 py-3">
              <div>
                <h2 className="text-lg font-bold text-slate-900">Contexto e backup do projeto</h2>
                <p className="text-xs text-slate-500">Leve esta versão para o GitHub</p>
              </div>
              <button onClick={() => setOpen(false)} className="rounded-lg px-3 py-1 text-2xl text-slate-400 hover:bg-slate-100" aria-label="Fechar">×</button>
            </div>

            <div className="flex flex-wrap items-center gap-3 border-b border-indigo-100 bg-indigo-50 px-5 py-3">
              <div className="min-w-[220px] flex-1 text-sm text-indigo-900">
                <b>Projeto completo (.zip)</b> · {arquivosBackup.length + 1} arquivos de código e documentação, incluindo o CONTEXTO.md.
                <span className="block text-xs text-indigo-700">Use com o GitHub Desktop: Pull → copiar e substituir → Commit → Push.</span>
              </div>
              <button onClick={baixarProjeto} className="rounded-xl bg-indigo-600 px-5 py-2.5 font-semibold text-white shadow hover:bg-indigo-700">
                📦 Baixar projeto (.zip)
              </button>
            </div>

            <details className="border-b border-indigo-100 bg-white px-5 py-3 text-sm text-slate-700">
              <summary className="cursor-pointer font-semibold text-indigo-800">
                Como levar para o GitHub (só cliques, sem comando prompt e sem comandos)
              </summary>
              <ol className="mt-2 list-decimal space-y-1.5 pl-5">
                <li><b>Baixar:</b> clique em <b>📦 Baixar projeto (.zip)</b>. O arquivo vai para a pasta <b>Downloads</b>.</li>
                <li><b>Extrair:</b> botão direito no .zip → <b>Extrair tudo…</b> → <b>Extrair</b>.</li>
                <li><b>GitHub Desktop:</b> confira se o repositório <b>nkway</b> está selecionado e clique em <b>Fetch origin</b>. Se aparecer <b>Pull origin</b>, clique também.</li>
                <li>Menu <b>Repository</b> → <b>Show in Explorer</b>. Abre a pasta do repositório.</li>
                <li>Na pasta extraída: <b>Ctrl+A</b> e <b>Ctrl+C</b>. Na pasta do repositório: <b>Ctrl+V</b> → <b>Substituir os arquivos no destino</b>.</li>
                <li>No GitHub Desktop, a aba <b>Changes</b> mostra cerca de 20 a 25 arquivos. Se aparecerem milhares, pare.</li>
                <li>No <b>canto inferior esquerdo</b>, escreva qualquer resumo no campo <b>Summary (required)</b>. Só depois disso o botão azul <b>Commit to main</b> (logo abaixo) fica clicável.</li>
                <li>Depois do commit, clique em <b>Push origin</b> (barra do topo, à direita, com seta ↑1). Pronto.</li>
              </ol>
            </details>

            <p className="bg-amber-50 px-5 py-2 text-xs font-semibold uppercase tracking-wide text-amber-800">Somente o CONTEXTO.md</p>

            <textarea
              ref={ref}
              readOnly
              value={contexto}
              onFocus={(e) => e.currentTarget.select()}
              className="min-h-[300px] flex-1 resize-none border-y border-slate-200 bg-slate-900 p-4 font-mono text-xs leading-relaxed text-emerald-200 outline-none"
            />

            <div className="flex flex-wrap items-center gap-2 px-5 py-3">
              <button onClick={copiar} className="rounded-xl bg-emerald-600 px-5 py-2.5 font-semibold text-white hover:bg-emerald-700">📋 Copiar texto</button>
              <button onClick={selecionar} className="rounded-xl border border-slate-300 px-4 py-2.5 text-sm font-medium text-slate-700 hover:bg-slate-50">Selecionar tudo</button>
              <button onClick={baixar} className="rounded-xl border border-slate-300 px-4 py-2.5 text-sm font-medium text-slate-700 hover:bg-slate-50">⬇ Baixar arquivo</button>
              {status && <span className="text-sm font-medium text-emerald-700">{status}</span>}
            </div>
          </div>
        </div>
      )}
    </>
  );
}
