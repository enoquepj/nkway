import { useRef, useState } from "react";
import contexto from "../CONTEXTO.md?raw";

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

  return (
    <>
      <button
        onClick={() => setOpen(true)}
        className="fixed bottom-4 left-4 z-[9999] rounded-full bg-amber-500 px-4 py-2.5 text-sm font-bold text-white shadow-lg ring-4 ring-amber-200 transition hover:bg-amber-600"
      >
        📋 Copiar CONTEXTO.md
      </button>

      {open && (
        <div className="fixed inset-0 z-[10000] flex items-center justify-center bg-black/60 p-3" onClick={() => setOpen(false)}>
          <div className="flex max-h-[95vh] w-full max-w-3xl flex-col overflow-hidden rounded-2xl bg-white shadow-2xl" onClick={(e) => e.stopPropagation()}>
            <div className="flex items-center justify-between border-b border-slate-200 px-5 py-3">
              <div>
                <h2 className="text-lg font-bold text-slate-900">CONTEXTO.md</h2>
                <p className="text-xs text-slate-500">Copie e cole no GitHub: Add file → Create new file</p>
              </div>
              <button onClick={() => setOpen(false)} className="rounded-lg px-3 py-1 text-2xl text-slate-400 hover:bg-slate-100" aria-label="Fechar">×</button>
            </div>

            <ol className="space-y-1 bg-amber-50 px-5 py-3 text-sm text-amber-900">
              <li><b>1.</b> Clique em <b>Copiar texto</b> (botão verde abaixo).</li>
              <li><b>2.</b> Abra <b>github.com/enoquepj/nkway</b> → <b>Add file</b> → <b>Create new file</b>.</li>
              <li><b>3.</b> No nome, digite <b>CONTEXTO.md</b>. Na área grande, cole com <b>Ctrl+V</b>.</li>
              <li><b>4.</b> Clique em <b>Commit changes…</b> → <b>Commit changes</b>.</li>
            </ol>

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
