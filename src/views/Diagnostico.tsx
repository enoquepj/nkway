"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import { Badge, Button, Card, CardTitulo, Icon, Kpi, Select, Vazio, cn } from "@/components/ui";
import { Tabela, type Coluna } from "@/components/Tabela";

type Teste = {
  id: string;
  modulo: string;
  nome: string;
  passou: boolean;
  detalhe: string;
  critico: boolean;
};

type Resposta = {
  ok: boolean;
  erro?: string;
  empresa: { nome: string; cnpj: string; uf: string };
  usuario: string;
  geradoEm: string;
  duracaoMs: number;
  resumo: { total: number; passou: number; falhou: number; criticos: number };
  modulos: { modulo: string; total: number; falhou: number; criticosFalhos: number }[];
  testes: Teste[];
  estado: Record<string, number>;
};

const CHAVE = "nkway.diagnostico.ultimo";

/** Aba Ambiente → porta do DevConsole (Ctrl+Shift+D) do protótipo Vite */
export function PainelDiagnostico() {
  const [d, setD] = useState<Resposta | null>(null);
  const [carregando, setCarregando] = useState(false);
  const [erro, setErro] = useState("");
  const [modulo, setModulo] = useState("todos");
  const [soFalhas, setSoFalhas] = useState(false);

  const rodar = useCallback(async () => {
    setCarregando(true);
    setErro("");
    try {
      const r = await fetch("/api/diagnostico", { cache: "no-store" });
      const j = (await r.json()) as Resposta;
      if (!r.ok) throw new Error(j.erro || `HTTP ${r.status}`);
      setD(j);
      try {
        localStorage.setItem(`${CHAVE}.${j.empresa.cnpj}`, JSON.stringify({ em: j.geradoEm, resumo: j.resumo }));
      } catch {
        /* armazenamento indisponível — segue */
      }
    } catch (e) {
      setErro(e instanceof Error ? e.message : "Falha ao rodar os testes.");
    } finally {
      setCarregando(false);
    }
  }, []);

  useEffect(() => {
    void rodar();
  }, [rodar]);

  const linhas = useMemo(
    () => (d?.testes ?? []).filter((t) => (modulo === "todos" || t.modulo === modulo) && (!soFalhas || !t.passou)),
    [d, modulo, soFalhas],
  );

  const colunas: Coluna<Teste>[] = [
    { id: "id", rotulo: "#", valor: (t) => t.id, render: (t) => <span className="font-mono text-[11px] text-ink-400">{t.id}</span>, largura: "70px" },
    { id: "modulo", rotulo: "Módulo", valor: (t) => t.modulo, render: (t) => <Badge tom="info">{t.modulo}</Badge> },
    { id: "nome", rotulo: "Verificação", valor: (t) => t.nome, render: (t) => (
      <span className="flex items-start gap-2">
        <span className={cn("mt-0.5 grid size-4 shrink-0 place-items-center rounded-full", t.passou ? "bg-way-600 text-white" : t.critico ? "bg-rose-500 text-white" : "bg-signal-500 text-white")}>
          <Icon name={t.passou ? "check" : "alerta"} className="size-2.5" strokeWidth={3} />
        </span>
        <span className="text-[12.5px] font-medium text-ink-800">{t.nome}</span>
        {t.critico && !t.passou && <Badge tom="erro">crítico</Badge>}
      </span>
    ) },
    { id: "detalhe", rotulo: "Detalhe", valor: (t) => t.detalhe, render: (t) => <span className={cn("text-[11.5px]", t.passou ? "text-ink-400" : "text-rose-600")}>{t.detalhe}</span> },
    { id: "situacao", rotulo: "Resultado", valor: (t) => (t.passou ? "ok" : t.critico ? "crítico" : "atenção"), render: (t) => (
      <Badge tom={t.passou ? "ok" : t.critico ? "erro" : "alerta"}>{t.passou ? "ok" : t.critico ? "falhou" : "atenção"}</Badge>
    ) },
  ];

  const vermelho = !!d && d.resumo.criticos > 0;

  return (
    <div className="space-y-4">
      <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
        <Kpi rotulo="Testes executados" valor={d ? String(d.resumo.total) : "—"} detalhe={d ? `${d.duracaoMs} ms no servidor` : "rodando…"} tom="neutro" icone="raio" />
        <Kpi rotulo="Aprovados" valor={d ? String(d.resumo.passou) : "—"} detalhe={d ? `${Math.round((d.resumo.passou / Math.max(1, d.resumo.total)) * 100)}% da bateria` : "—"} tom={d && d.resumo.falhou === 0 ? "ok" : "neutro"} icone="check" barra={d ? (d.resumo.passou / Math.max(1, d.resumo.total)) * 100 : 0} />
        <Kpi rotulo="Reprovados" valor={d ? String(d.resumo.falhou) : "—"} detalhe={d && d.resumo.falhou ? "veja a lista abaixo" : "nenhuma pendência"} tom={d && d.resumo.falhou ? "alerta" : "ok"} icone="atualizar" />
        <Kpi rotulo="Falhas críticas" valor={d ? String(d.resumo.criticos) : "—"} detalhe={vermelho ? "bloqueiam emissão de nota" : "ambiente liberado"} tom={vermelho ? "erro" : "ok"} icone="cadeado" barra={d ? (d.resumo.criticos / Math.max(1, d.resumo.total)) * 100 : 0} />
      </div>

      <Card>
        <CardTitulo
          titulo="Console do dev"
          descricao="Bateria portada do protótipo: roda no servidor sobre os dados reais desta empresa (nada de estado falso no navegador)"
          icone="raio"
        />
        <div className="flex flex-wrap items-end gap-2">
          <div className="w-44">
            <Select
              valor={modulo}
              aoMudar={setModulo}
              opcoes={[{ valor: "todos", rotulo: "Todos os módulos" }, ...(d?.modulos ?? []).map((m) => ({ valor: m.modulo, rotulo: `${m.modulo} (${m.total})` }))]}
            />
          </div>
          <Button variante={soFalhas ? "primario" : "secundario"} icone="alerta" onClick={() => setSoFalhas((v) => !v)}>
            Só reprovados
          </Button>
          <Button variante="secundario" icone="baixar" onClick={() => void rodar()} disabled={carregando}>
            {carregando ? "Rodando…" : "Rodar de novo"}
          </Button>
          {d && (
            <span className="ml-auto text-[11.5px] text-ink-400">
              {d.empresa.nome} · {d.usuario} · {new Date(d.geradoEm).toLocaleString("pt-BR")}
            </span>
          )}
        </div>

        {erro && (
          <p className="mt-3 rounded-lg bg-rose-50 px-3 py-2 text-[12.5px] font-semibold text-rose-700 ring-1 ring-inset ring-rose-200">
            {erro}
          </p>
        )}

        <div className="mt-3 grid gap-2 sm:grid-cols-3 lg:grid-cols-4">
          {(d?.modulos ?? []).map((m) => (
            <button
              key={m.modulo}
              type="button"
              onClick={() => setModulo(m.modulo)}
              className={cn(
                "rounded-lg px-2.5 py-2 text-left ring-1 ring-inset transition",
                modulo === m.modulo ? "bg-way-50 ring-way-300" : "bg-ink-50/70 ring-transparent hover:ring-ink-200",
                m.criticosFalhos > 0 && "bg-rose-50 ring-rose-200",
              )}
            >
              <p className="text-[12px] font-bold text-ink-800">{m.modulo}</p>
              <p className={cn("text-[11px]", m.falhou ? "text-rose-600" : "text-way-700")}>
                {m.total - m.falhou}/{m.total} ok{m.criticosFalhos ? ` · ${m.criticosFalhos} crítico(s)` : ""}
              </p>
            </button>
          ))}
        </div>

        <div className="mt-4">
          <Tabela
            colunas={colunas}
            linhas={linhas}
            chave={(t) => t.id}
            tamanhoPagina={12}
            compacta
            alturaFixa
            nomeExportar="nkway-diagnostico"
            vazio={<Vazio>Nenhuma verificação com estes filtros — o ambiente está limpo.</Vazio>}
          />
        </div>
      </Card>

      {d && (
        <Card>
          <CardTitulo titulo="Estado dos dados" descricao="Contagens usadas pela bateria, todas filtradas por empresa_id" icone="carteira" />
          <dl className="grid grid-cols-2 gap-2 sm:grid-cols-4 lg:grid-cols-6">
            {[
              { r: "Produtos", v: d.estado.produtos },
              { r: "Ativos", v: d.estado.produtosAtivos },
              { r: "Clientes", v: d.estado.clientes },
              { r: "Fornecedores", v: d.estado.fornecedores },
              { r: "Documentos", v: d.estado.vendas },
              { r: "DAVs", v: d.estado.davs },
              { r: "Itens vendidos", v: d.estado.itens },
              { r: "Kardex", v: d.estado.movimentos },
              { r: "Entradas", v: d.estado.entradas },
              { r: "Títulos", v: d.estado.contas },
              { r: "MDF-e", v: d.estado.mdfes },
              { r: "Acessos", v: d.estado.equipe },
            ].map((x) => (
              <div key={x.r} className="rounded-lg bg-ink-50 px-2.5 py-2">
                <dt className="micro text-ink-400">{x.r}</dt>
                <dd className="tabular mt-0.5 text-[16px] font-bold text-ink-900">{x.v}</dd>
              </div>
            ))}
          </dl>
          <p className="mt-3 rounded-lg bg-ink-900 px-3 py-2.5 font-mono text-[11px] leading-relaxed text-ink-100">
            GET <b className="text-way-300">/api/diagnostico</b> · {d.resumo.total} verificações em {d.duracaoMs} ms
            {"\n"}módulos: {d.modulos.map((m) => m.modulo).join(" · ")}
            {"\n"}última execução guardada em nkway.diagnostico.ultimo.{d.empresa.cnpj}
          </p>
        </Card>
      )}
    </div>
  );
}
