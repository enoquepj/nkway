"use client";

import { useMemo, useState } from "react";
import {
  Abas,
  Badge,
  BarraFiltros,
  Button,
  Campo,
  FiltroMulti,
  FiltrosSalvos,
  FiltroTexto,
  Icon,
  Input,
  Kpi,
  Modal,
  PageHeader,
  Select,
  cn,
  useToast,
} from "@/components/ui";
import { Tabela, type Coluna } from "@/components/Tabela";
import { alternarItem, casaTexto } from "@/lib/filtros";
import { UFS, dataBR, mascaraDocumento, moeda, round2 } from "@/lib/dominio";
import { excluirCliente, excluirFornecedor, salvarCliente, salvarFornecedor } from "@/server/acoes/cadastros";
import type { listarClientes, listarFornecedores } from "@/server/dados";

type Cliente = Awaited<ReturnType<typeof listarClientes>>[number];
type Fornecedor = Awaited<ReturnType<typeof listarFornecedores>>[number];
type Doc = {
  id: string;
  clienteId: string | null;
  numero: number;
  numeroNota: number | null;
  modelo: string | null;
  data: string;
  total: number;
  status: string;
  tipo: string;
  forma: string;
  itens: number;
};

const CONDICOES = ["a vista", "7d", "14d", "30d", "60d"];

export function ClientesView({
  clientes,
  fornecedores,
  historico,
}: {
  clientes: Cliente[];
  fornecedores: Fornecedor[];
  historico: Doc[];
}) {
  const toast = useToast();
  const [aba, setAba] = useState("clientes");
  const [busca, setBusca] = useState("");
  const [ufs, setUfs] = useState<string[]>([]);
  const [condicoes, setCondicoes] = useState<string[]>([]);
  const [soComSaldo, setSoComSaldo] = useState(false);
  const [editando, setEditando] = useState<null | Partial<Cliente & Fornecedor & { tipo: "cliente" | "fornecedor" }>>(null);
  const [vendo, setVendo] = useState<Cliente | null>(null);
  const [ocupado, setOcupado] = useState(false);
  const [erro, setErro] = useState("");

  const filtro = { busca, ufs, condicoes, soComSaldo };
  const linhas = useMemo(
    () =>
      clientes.filter((c) => {
        if (!casaTexto(`${c.nome} ${c.documento} ${c.email} ${c.telefone} ${c.cidade}`, busca)) return false;
        if (ufs.length && !ufs.includes(c.uf ?? "")) return false;
        if (condicoes.length && !condicoes.includes(c.condicaoPadrao)) return false;
        if (soComSaldo && c.saldoEmAberto <= 0) return false;
        return true;
      }),
    [clientes, busca, ufs, condicoes, soComSaldo],
  );
  const linhasF = useMemo(
    () =>
      fornecedores.filter((f) => {
        if (!casaTexto(`${f.nome} ${f.cnpj} ${f.cidade} ${f.email} ${f.telefone}`, busca)) return false;
        if (ufs.length && !ufs.includes(f.uf ?? "")) return false;
        return true;
      }),
    [fornecedores, busca, ufs],
  );

  const colunas: Coluna<Cliente>[] = [
    {
      id: "nome",
      rotulo: "Cliente",
      valor: (c) => c.nome,
      render: (c) => (
        <div className="min-w-0">
          <p className="truncate text-[12.5px] font-semibold text-ink-900">{c.nome}</p>
          <p className="font-mono text-[10px] text-ink-400">{c.documento || "sem documento"}</p>
        </div>
      ),
    },
    { id: "contato", rotulo: "Contato", valor: (c) => c.cidade, render: (c) => <span className="text-[12px] text-ink-500">{c.cidade ? `${c.cidade}/${c.uf}` : "—"}{c.telefone && <span className="block text-[10.5px]">{c.telefone}</span>}</span> },
    { id: "condicao", rotulo: "Condição", alinhar: "centro", valor: (c) => c.condicaoPadrao, render: (c) => <Badge tom={c.condicaoPadrao === "a vista" ? "neutro" : "info"}>{c.condicaoPadrao}</Badge> },
    { id: "compras", rotulo: "Vendas", alinhar: "direita", valor: (c) => c.qtdVendas, render: (c) => <span className="tabular text-[12px] text-ink-600">{c.qtdVendas}</span> },
    { id: "total", rotulo: "Total comprado", alinhar: "direita", valor: (c) => c.totalComprado, render: (c) => <span className="tabular text-[13px] font-bold text-ink-900">{moeda(c.totalComprado)}</span> },
    {
      id: "saldo",
      rotulo: "Em aberto",
      alinhar: "direita",
      valor: (c) => c.saldoEmAberto,
      render: (c) => (
        <div className="leading-tight">
          <p className={cn("tabular text-[12.5px] font-bold", c.saldoEmAberto > c.limiteCredito && c.limiteCredito > 0 ? "text-rose-600" : "text-amber-600")}>{moeda(c.saldoEmAberto)}</p>
          <p className="tabular text-[10px] text-ink-400">lim. {moeda(c.limiteCredito)}</p>
        </div>
      ),
    },
    { id: "ultima", rotulo: "Última compra", alinhar: "direita", valor: (c) => c.ultimaCompra, render: (c) => <span className="text-[11.5px] text-ink-500">{c.ultimaCompra ? dataBR(c.ultimaCompra) : "—"}</span> },
    {
      id: "acoes",
      rotulo: "",
      alinhar: "direita",
      ocultoNoCsv: true,
      render: (c) => (
        <div className="flex justify-end gap-1">
          <button type="button" title="Histórico" onClick={() => setVendo(c)} className="rounded-md p-1 text-ink-400 hover:bg-ink-100 hover:text-ink-800">
            <Icon name="documento" className="size-4" />
          </button>
          <button type="button" title="Editar" onClick={() => { setErro(""); setEditando({ ...c, tipo: "cliente" }); }} className="rounded-md p-1 text-ink-400 hover:bg-ink-100 hover:text-ink-800">
            <Icon name="pessoas" className="size-4" />
          </button>
          <button
            type="button"
            title="Excluir"
            onClick={async () => {
              const r = await excluirCliente(c.id);
              toast(r.ok ? "Cliente removido." : r.erro, r.ok ? "ok" : "erro");
            }}
            className="rounded-md p-1 text-ink-300 hover:bg-rose-50 hover:text-rose-600"
          >
            <Icon name="lixo" className="size-4" />
          </button>
        </div>
      ),
    },
  ];

  const colunasF: Coluna<Fornecedor>[] = [
    {
      id: "nome",
      rotulo: "Fornecedor",
      valor: (f) => f.nome,
      render: (f) => (
        <div className="min-w-0">
          <p className="truncate text-[12.5px] font-semibold text-ink-900">{f.nome}</p>
          <p className="font-mono text-[10px] text-ink-400">{f.cnpj || "sem CNPJ"}</p>
        </div>
      ),
    },
    { id: "local", rotulo: "Praça", valor: (f) => f.cidade, render: (f) => <span className="text-[12px] text-ink-500">{f.cidade ? `${f.cidade}/${f.uf}` : "—"}</span> },
    { id: "contato", rotulo: "Contato", valor: (f) => f.telefone, render: (f) => <span className="text-[11.5px] text-ink-500">{f.telefone || "—"}{f.email && <span className="block text-[10.5px]">{f.email}</span>}</span> },
    { id: "prazo", rotulo: "Prazo", alinhar: "centro", valor: (f) => f.prazoPagDias, render: (f) => <span className="tabular text-[12px] font-semibold text-ink-700">{f.prazoPagDias} dias</span> },
    { id: "notas", rotulo: "Notas", alinhar: "direita", valor: (f) => f.qtdNotas, render: (f) => <span className="tabular text-[12px] text-ink-600">{f.qtdNotas}</span> },
    { id: "total", rotulo: "Volume comprado", alinhar: "direita", valor: (f) => f.totalComprado, render: (f) => <span className="tabular text-[13px] font-bold text-ink-900">{moeda(f.totalComprado)}</span> },
    { id: "ultima", rotulo: "Última nota", alinhar: "direita", valor: (f) => f.ultimaNota, render: (f) => <span className="text-[11.5px] text-ink-500">{f.ultimaNota ? dataBR(f.ultimaNota) : "—"}</span> },
    {
      id: "acoes",
      rotulo: "",
      alinhar: "direita",
      ocultoNoCsv: true,
      render: (f) => (
        <div className="flex justify-end gap-1">
          <button type="button" title="Editar" onClick={() => { setErro(""); setEditando({ ...f, tipo: "fornecedor" }); }} className="rounded-md p-1 text-ink-400 hover:bg-ink-100 hover:text-ink-800">
            <Icon name="pessoas" className="size-4" />
          </button>
          <button
            type="button"
            title="Excluir"
            onClick={async () => {
              const r = await excluirFornecedor(f.id);
              toast(r.ok ? "Fornecedor removido." : r.erro, r.ok ? "ok" : "erro");
            }}
            className="rounded-md p-1 text-ink-300 hover:bg-rose-50 hover:text-rose-600"
          >
            <Icon name="lixo" className="size-4" />
          </button>
        </div>
      ),
    },
  ];

  const aReceber = round2(clientes.reduce((s, c) => s + c.saldoEmAberto, 0));
  const comSaldo = clientes.filter((c) => c.saldoEmAberto > 0).length;
  const docsDoCliente = vendo ? historico.filter((h) => h.clienteId === vendo.id) : [];

  return (
    <>
      <PageHeader
        titulo="Clientes e fornecedores"
        subtitulo="Cadastro completo para emissão de NF-e (endereço, IE, município) e histórico de compras por contraparte"
        acao={
          <Button
            icone="mais"
            onClick={() => {
              setErro("");
              setEditando(aba === "clientes" ? { tipo: "cliente", nome: "", documento: "", email: "", telefone: "", cidade: "", uf: "", condicaoPadrao: "a vista", limiteCredito: 0, indIe: "9", observacao: "" } : { tipo: "fornecedor", nome: "", cnpj: "", cidade: "", uf: "", telefone: "", email: "", prazoPagDias: 28 });
            }}
          >
            {aba === "clientes" ? "Novo cliente" : "Novo fornecedor"}
          </Button>
        }
      />

      <div className="mb-4 grid grid-cols-2 gap-3 lg:grid-cols-4">
        <Kpi rotulo="Clientes cadastrados" valor={String(clientes.length)} icone="pessoas" detalhe={`${comSaldo} com saldo em aberto`} />
        <Kpi rotulo="A receber de clientes" valor={moeda(aReceber)} tom="info" icone="carteira" detalhe="títulos em aberto gerados por boleto/prazo" />
        <Kpi rotulo="Fornecedores" valor={String(fornecedores.length)} icone="caminhoes" detalhe={`${fornecedores.filter((f) => f.qtdNotas > 0).length} com notas de entrada`} />
        <Kpi rotulo="Crédito concedido" valor={moeda(round2(clientes.reduce((s, c) => s + c.limiteCredito, 0)))} icone="cadeado" detalhe="soma dos limites cadastrados" />
      </div>

      <Abas
        abas={[
          { id: "clientes", rotulo: "Clientes", contagem: clientes.length },
          { id: "fornecedores", rotulo: "Fornecedores", contagem: fornecedores.length },
        ]}
        atual={aba}
        aoTrocar={setAba}
      />

      <BarraFiltros>
        <FiltroTexto rotulo="Busca" valor={busca} aoMudar={setBusca} placeholder={aba === "clientes" ? "nome, CPF/CNPJ, cidade" : "razão social, CNPJ, cidade"} largura="w-72" />
        <FiltroMulti
          rotulo="UF"
          opcoes={[...new Set((aba === "clientes" ? clientes.map((c) => c.uf ?? "") : fornecedores.map((f) => f.uf ?? "")).filter(Boolean))].sort().map((u) => ({ valor: u, rotulo: `${u} · ${UFS[u as string] ?? ""}` }))}
          selecionados={ufs}
          aoAlternar={(v) => setUfs(alternarItem(ufs, v))}
        />
        {aba === "clientes" && (
          <FiltroMulti rotulo="Condição" opcoes={CONDICOES.map((c) => ({ valor: c, rotulo: c, contagem: clientes.filter((x) => x.condicaoPadrao === c).length }))} selecionados={condicoes} aoAlternar={(v) => setCondicoes(alternarItem(condicoes, v))} />
        )}
        {aba === "clientes" && (
          <label className="flex items-center gap-1.5 pb-1.5 text-[12px] font-medium text-ink-500">
            <input type="checkbox" checked={soComSaldo} onChange={(e) => setSoComSaldo(e.target.checked)} className="size-3.5 accent-way-600" />
            Só com saldo em aberto
          </label>
        )}
        <div className="ml-auto flex items-center gap-2">
          <FiltrosSalvos chave={aba === "clientes" ? "clientes" : "fornecedores"} atual={filtro} aoAplicar={(f) => { setBusca(f.busca); setUfs(f.ufs); setCondicoes(f.condicoes ?? []); setSoComSaldo(f.soComSaldo ?? false); }} />
        </div>
      </BarraFiltros>

      {aba === "clientes" ? (
        <Tabela colunas={colunas} linhas={linhas} chave={(c) => c.id} nomeExportar="nkway-clientes" tamanhoPagina={20} vazio="Nenhum cliente neste filtro." />
      ) : (
        <Tabela colunas={colunasF} linhas={linhasF} chave={(f) => f.id} nomeExportar="nkway-fornecedores" tamanhoPagina={20} vazio="Nenhum fornecedor neste filtro." />
      )}

      <Modal
        aberto={!!editando}
        aoFechar={() => setEditando(null)}
        titulo={editando?.tipo === "fornecedor" ? (editando.id ? "Editar fornecedor" : "Novo fornecedor") : editando?.id ? "Editar cliente" : "Novo cliente"}
        descricao="Endereço e documento alimentam o destino da NF-e"
        rodape={
          <>
            <Button variante="secundario" onClick={() => setEditando(null)}>
              Cancelar
            </Button>
            <Button
              disabled={ocupado}
              onClick={async () => {
                if (!editando) return;
                setOcupado(true);
                const r =
                  editando.tipo === "fornecedor"
                    ? await salvarFornecedor({
                        id: editando.id,
                        nome: editando.nome ?? "",
                        cnpj: editando.cnpj ?? "",
                        cidade: editando.cidade ?? "",
                        uf: editando.uf ?? "",
                        telefone: editando.telefone ?? "",
                        email: editando.email ?? "",
                        prazoPagDias: Number(editando.prazoPagDias ?? 30),
                      })
                    : await salvarCliente({
                        id: editando.id,
                        nome: editando.nome ?? "",
                        documento: editando.documento ?? "",
                        email: editando.email ?? "",
                        telefone: editando.telefone ?? "",
                        cidade: editando.cidade ?? "",
                        uf: editando.uf ?? "",
                        limiteCredito: Number(editando.limiteCredito ?? 0),
                        condicaoPadrao: editando.condicaoPadrao ?? "a vista",
                        indIe: editando.indIe ?? "9",
                        observacao: editando.observacao ?? "",
                      });
                setOcupado(false);
                if (!r.ok) return setErro(r.erro);
                toast("Cadastro salvo.");
                setEditando(null);
              }}
            >
              Salvar
            </Button>
          </>
        }
      >
        {editando && (
          <div className="space-y-3">
            {erro && <p className="rounded-lg bg-rose-50 px-3 py-2 text-[12px] font-medium text-rose-700">{erro}</p>}
            <Campo rotulo={editando.tipo === "fornecedor" ? "Razão social" : "Nome / razão social"} obrigatorio>
              <Input valor={editando.nome ?? ""} aoMudar={(v) => setEditando({ ...editando, nome: v })} />
            </Campo>
            <div className="grid gap-3 sm:grid-cols-3">
              <Campo rotulo={editando.tipo === "fornecedor" ? "CNPJ" : "CPF / CNPJ"}>
                <Input valor={(editando.documento ?? editando.cnpj ?? "") as string} aoMudar={(v) => setEditando({ ...editando, ...(editando.tipo === "fornecedor" ? { cnpj: mascaraDocumento(v) } : { documento: mascaraDocumento(v) }) })} placeholder="00.000.000/0000-00" />
              </Campo>
              <Campo rotulo="Telefone">
                <Input valor={editando.telefone ?? ""} aoMudar={(v) => setEditando({ ...editando, telefone: v })} />
              </Campo>
              <Campo rotulo="E-mail">
                <Input valor={editando.email ?? ""} aoMudar={(v) => setEditando({ ...editando, email: v })} />
              </Campo>
            </div>
            <div className="grid gap-3 sm:grid-cols-3">
              <Campo rotulo="Cidade">
                <Input valor={editando.cidade ?? ""} aoMudar={(v) => setEditando({ ...editando, cidade: v })} />
              </Campo>
              <Campo rotulo="UF">
                <Select valor={editando.uf ?? ""} aoMudar={(v) => setEditando({ ...editando, uf: v })} opcoes={[{ valor: "", rotulo: "—" }, ...Object.keys(UFS).map((u) => ({ valor: u, rotulo: u }))]} />
              </Campo>
              {editando.tipo === "fornecedor" ? (
                <Campo rotulo="Prazo de pagamento (dias)">
                  <Input dinheiro valor={String(editando.prazoPagDias ?? 30)} aoMudar={(v) => setEditando({ ...editando, prazoPagDias: Number(v.replace(",", ".")) || 0 })} />
                </Campo>
              ) : (
                <Campo rotulo="Condição padrão">
                  <Select valor={editando.condicaoPadrao ?? "a vista"} aoMudar={(v) => setEditando({ ...editando, condicaoPadrao: v })} opcoes={CONDICOES.map((c) => ({ valor: c, rotulo: c }))} />
                </Campo>
              )}
            </div>
            {editando.tipo === "cliente" && (
              <div className="grid gap-3 sm:grid-cols-3">
                <Campo rotulo="Limite de crédito (R$)">
                  <Input dinheiro valor={String(editando.limiteCredito ?? 0)} aoMudar={(v) => setEditando({ ...editando, limiteCredito: Number(v.replace(",", ".")) || 0 })} />
                </Campo>
                <Campo rotulo="Inscrição estadual (SEFAZ)">
                  <Select
                    valor={editando.indIe ?? "9"}
                    aoMudar={(v) => setEditando({ ...editando, indIe: v })}
                    opcoes={[
                      { valor: "1", rotulo: "1 - Contribuinte ICMS" },
                      { valor: "2", rotulo: "2 - Isento" },
                      { valor: "9", rotulo: "9 - Não contribuinte" },
                    ]}
                  />
                </Campo>
                <Campo rotulo="Observação interna">
                  <Input valor={editando.observacao ?? ""} aoMudar={(v) => setEditando({ ...editando, observacao: v })} placeholder="ex.: entrega só de manhã" />
                </Campo>
              </div>
            )}
          </div>
        )}
      </Modal>

      <Modal aberto={!!vendo} aoFechar={() => setVendo(null)} titulo={vendo ? `Histórico · ${vendo.nome}` : ""} descricao="Documentos emitidos para este cliente" largura="max-w-3xl">
        {docsDoCliente.length === 0 ? (
          <p className="py-8 text-center text-[13px] text-ink-400">Nenhum documento para este cliente.</p>
        ) : (
          <ul className="divide-y divide-ink-50">
            {docsDoCliente.slice(0, 40).map((d) => (
              <li key={d.id} className="flex items-center gap-3 py-2">
                <Badge tom={d.status === "cancelado" ? "erro" : d.tipo === "dav" ? "alerta" : "ok"}>{d.tipo === "dav" ? "DAV" : d.modelo}</Badge>
                <span className="tabular w-16 text-[12px] text-ink-500">nº {d.numeroNota ?? d.numero}</span>
                <span className="text-[11.5px] text-ink-400">{dataBR(d.data)}</span>
                <span className="ml-auto text-[11.5px] text-ink-500">{d.itens} item(ns)</span>
                <span className="tabular w-24 text-right text-[13px] font-bold text-ink-900">{moeda(d.total)}</span>
              </li>
            ))}
          </ul>
        )}
      </Modal>
    </>
  );
}
