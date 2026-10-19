import { useEffect, useState } from "react";
import { estadoBloqueio, validarSenha } from "./devAuth";

export default function DevLock({
  onOk,
  onCancel,
}: {
  onOk: () => void;
  onCancel: () => void;
}) {
  const [senha, setSenha] = useState("");
  const [erro, setErro] = useState<string | null>(null);
  const [checando, setChecando] = useState(false);
  const [bloqueio, setBloqueio] = useState(estadoBloqueio());

  // Atualiza o contador de bloqueio a cada segundo
  useEffect(() => {
    const t = setInterval(() => setBloqueio(estadoBloqueio()), 1000);
    return () => clearInterval(t);
  }, []);

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    setChecando(true);
    const r = await validarSenha(senha);
    setChecando(false);
    setBloqueio(estadoBloqueio());
    if (r.ok) return onOk();
    setErro(r.erro);
    setSenha("");
  }

  return (
    <div className="fixed inset-0 z-[60] flex items-center justify-center bg-slate-950/80 p-4 backdrop-blur-sm">
      <form
        onSubmit={submit}
        className="w-full max-w-sm rounded-2xl border border-slate-700 bg-slate-900 p-7 shadow-2xl"
      >
        <div className="mb-5 text-center">
          <div className="mx-auto mb-3 flex h-14 w-14 items-center justify-center rounded-2xl bg-gradient-to-br from-violet-500 to-violet-700 text-2xl">
            🛠️
          </div>
          <h2 className="text-lg font-bold text-white">Console do desenvolvedor</h2>
          <p className="mt-1 text-xs text-slate-400">
            Área restrita. Expõe dados brutos, simuladores e controles do sistema.
          </p>
        </div>

        <input
          autoFocus
          type="password"
          value={senha}
          onChange={(e) => setSenha(e.target.value)}
          disabled={bloqueio.bloqueado}
          placeholder="Senha de desenvolvedor"
          className="w-full rounded-lg border border-slate-700 bg-slate-800 px-4 py-2.5 text-sm text-white outline-none transition placeholder:text-slate-500 focus:border-violet-500 disabled:opacity-50"
        />

        {erro && (
          <p className="mt-3 rounded-lg bg-rose-500/15 px-3 py-2 text-xs font-medium text-rose-300">
            {erro}
          </p>
        )}

        {bloqueio.bloqueado && (
          <p className="mt-3 rounded-lg bg-amber-500/15 px-3 py-2 text-xs text-amber-300">
            🔒 Bloqueado por tentativas. Libera em {bloqueio.segundos}s.
          </p>
        )}

        {!bloqueio.bloqueado && bloqueio.restantes < 5 && (
          <p className="mt-2 text-[11px] text-slate-500">
            {bloqueio.restantes} tentativa(s) antes do bloqueio temporário.
          </p>
        )}

        <div className="mt-5 flex gap-2">
          <button
            type="button"
            onClick={onCancel}
            className="flex-1 rounded-lg border border-slate-700 py-2.5 text-sm font-semibold text-slate-300 transition hover:bg-slate-800"
          >
            Cancelar
          </button>
          <button
            type="submit"
            disabled={checando || bloqueio.bloqueado || !senha}
            className="flex-1 rounded-lg bg-violet-600 py-2.5 text-sm font-bold text-white transition hover:bg-violet-700 disabled:opacity-40"
          >
            {checando ? "Verificando..." : "Desbloquear"}
          </button>
        </div>

        <p className="mt-5 border-t border-slate-800 pt-4 text-center text-[10px] leading-relaxed text-slate-500">
          A senha é validada apenas no navegador (SHA-256). Serve para evitar
          acesso acidental — não substitui controle de permissão no servidor.
        </p>
      </form>
    </div>
  );
}
