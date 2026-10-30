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
import { UFS, dataBR, documentoValido, mascaraDocumento, moeda, round2, soDigitos } from "@/lib/dominio";
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

  const [tipoPessoa, setTipoPessoa] = useState("todos");
  const [cidades, setCidades] = useState<string[]>([]);
  const [creditos, setCreditos] = useState<string[]>([]);
  const [sefaz, setSefaz] = useState("todos");
  const [contribuinte, setContribuinte] = useState<string[]>([]);
  const [recencia, setRecencia] = useState("todos");
  const [totalMin, setTotalMin] = useState("");
  const [totalMax, setTotalMax] = useState("");
  const [limiteMin, setLimiteMin] = useState("");
  const [limiteMax, setLimiteMax] = useState("");

  const filtro = { busca, ufs, condicoes, soComSaldo, tipoPessoa, cidades, creditos, sefaz, contribuinte, recencia, totalMin, totalMax, limiteMin, limiteiteMax: "", limiteMax };
  const linhas = useMemo(
    () =>
      clientes.filter((c) => {
        // FILTROS.md: nome · CPF/CNPJ (com ou sem máscara) · e-mail · telefone · cidade · bairro · endereço · CEP · UF · IE
        const digitos = soDigitos(busca);
        const casaDoc = digitos.length >= 5 && soDigitos(c.documento).includes(digitos);
        const texto = `${c.nome} ${c.documento} ${c.email} ${c.telefone} ${c.cidade} ${c.bairro} ${c.logradouro} ${c.cep} ${c.uf}`;
        if (!casaTexto(texto, busca) && !casaDoc) return false;
        if (ufs.length && !ufs.includes(c.uf ?? "")) return false;
        if (condicoes.length && !condicoes.includes(c.condicaoPadrao)) return false;
        if (soComSaldo && c.saldoEmAberto <= 0) return false;
        if (cidades.length && !cidades.includes(c.cidade ?? "")) return false;
        // tipo de pessoa: PF (11 dígitos) / PJ (14)
        const dv = soDigitos(c.documento).length;
        if (tipoPessoa === "pf" && dv !== 11) return false;
        if (tipoPessoa === "pj" && dv !== 14) return false;
        // crédito e inadimplência
        const usoLimite = c.limiteCredito > 0 ? (c.saldoEmAberto / c.limiteCredito) * 100 : 0;
        if (creditos.includes("em_aberto") && c.saldoEmAberto <= 0) return false;
        if (creditos.includes("acima_85") && !(c.limiteCredito > 0 && usoLimite > 85)) return false;
        if (creditos.includes("sem_limite") && c.limiteCredito > 0) return false;
        if (creditos.includes("limite_disponivel") && !(c.limiteCredito > c.saldoEmAberto)) return false;
        // cadastro SEFAZ (documento válido para autorização)
        if (sefaz === "ok" && !documentoValido(c.documento)) return false;
        if (sefaz === "pendencia" && documentoValido(c.documento)) return false;
        // contribuinte ICMS (indIEDest)
        if (contribuinte.length && !contribuinte.includes(String(c.indIe ?? "9"))) return false;
        // recência da última compra
        if (recencia !== "todos") {
          const dias = c.ultimaCompra ? (Date.now() - new Date(`${c.ultimaCompra}T12:00:00`).getTime()) / 86_400_000 : Infinity;
          if (recencia === "nunca" && c.ultimaCompra) return false;
          if (recencia === "30d" && !(dias <= 30)) return false;
          if (recencia === "30_60" && !(dias > 30 && dias <= 60)) return false;
          if (recencia === "60_90" && !(dias > 60 && dias <= 90)) return false;
          if (recencia === "90mais" && !(dias > 90)) return false;
        }
        const tn = Number(totalMin.replace(",", ".")) || 0;
        const tx = Number(totalMax.replace(",", ".")) || 0;
        if (totalMin && c.totalComprado < tn) return false;
        if (totalMax && c.totalComprado > tx) return false;
        const ln = Number(limiteMin.replace(",", ".")) || 0;
        const lx = Number(limiteMax.replace(",", ".")) || 0;
        if (limiteMin && c.limiteCredito < ln) return false;
        if (limiteMax && c.limiteCredito > lx) return false;
        return true;
      }),
    [clientes, busca, ufs, condicoes, soComSaldo, tipoPessoa, cidades, creditos, sefaz, contribuinte, recencia, totalMin, totalMax, limiteMin, limiteMax],
  );
  const linhasF = useMemo(
    () =>
      fornecedores.filter((f) => {
        const digitosF = soDigitos(busca);
        if (!casaTexto(`${f.nome} ${f.cnpj} ${f.cidade} ${f.email} ${f.telefone}`, busca) && !(digitosF.length >= 5 && soDigitos(f.cnpj).includes(digitosF))) return false;
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
        <FiltroTexto rotulo="Busca" valor={busca} aoMudar={setBusca} placeholder={aba === "clientes" ? "nome, CPF/CNPJ, e-mail, tel., cidade, bairro, CEP" : "razão social, CNPJ, cidade"} largura="w-80" />
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
          <>
            <label className="flex items-center gap-1.5 pb-1.5 text-[12px] font-medium text-ink-500">
              <input type="checkbox" checked={soComSaldo} onChange={(e) => setSoComSaldo(e.target.checked)} className="size-3.5 accent-way-600" />
              Só com saldo em aberto
            </label>
            <Campo rotulo="Tipo de pessoa" className="w-32">
              <Select valor={tipoPessoa} aoMudar={setTipoPessoa} opcoes={[{ valor: "todos", rotulo: "Todos" }, { valor: "pf", rotulo: "Pessoa física" }, { valor: "pj", rotulo: "Pessoa jurídica" }]} />
            </Campo>
            <FiltroMulti
              rotulo="Cidade"
              opcoes={[...new Set(clientes.map((c) => c.cidade ?? "").filter(Boolean))].sort().map((x) => ({ valor: x, rotulo: x, contagem: clientes.filter((c) => c.cidade === x).length }))}
              selecionados={cidades}
              aoAlternar={(v) => setCidades(alternarItem(cidades, v))}
            />
            <FiltroMulti
              rotulo="Crédito"
              opcoes={[
                { valor: "em_aberto", rotulo: "com saldo em aberto", contagem: clientes.filter((c) => c.saldoEmAberto > 0).length },
                { valor: "acima_85", rotulo: "acima de 85% do limite", contagem: clientes.filter((c) => c.limiteCredito > 0 && (c.saldoEmAberto / c.limiteCredito) * 100 > 85).length },
                { valor: "sem_limite", rotulo: "sem limite", contagem: clientes.filter((c) => c.limiteCredito <= 0).length },
                { valor: "limite_disponivel", rotulo: "com limite disponível", contagem: clientes.filter((c) => c.limiteCredito > c.saldoEmAberto).length },
              ]}
              selecionados={creditos}
              aoAlternar={(v) => setCreditos(alternarItem(creditos, v))}
            />
            <Campo rotulo="Cadastro SEFAZ" className="w-36">
              <Select valor={sefaz} aoMudar={setSefaz} opcoes={[{ valor: "todos", rotulo: "Todos" }, { valor: "ok", rotulo: "Apto à NF-e" }, { valor: "pendencia", rotulo: "Com pendência" }]} />
            </Campo>
            <FiltroMulti
              rotulo="ICMS"
              opcoes={[
                { valor: "1", rotulo: "1 · Contribuinte", contagem: clientes.filter((c) => String(c.indIe) === "1").length },
                { valor: "2", rotulo: "2 · Isento", contagem: clientes.filter((c) => String(c.indIe) === "2").length },
                { valor: "9", rotulo: "9 · Não contribuinte", contagem: clientes.filter((c) => String(c.indIe) === "9").length },
              ]}
              selecionados={contribuinte}
              aoAlternar={(v) => setContribuinte(alternarItem(contribuinte, v))}
            />
            <Campo rotulo="Última compra" className="w-40">
              <Select
                valor={recencia}
                aoMudar={setRecencia}
                opcoes={[
                  { valor: "todos", rotulo: "Todos" },
                  { valor: "30d", rotulo: "Nos últimos 30 dias" },
                  { valor: "30_60", rotulo: "Sem comprar 30–60 dias" },
                  { valor: "60_90", rotulo: "Sem comprar 60–90 dias" },
                  { valor: "90mais", rotulo: "Sem comprar +90 dias" },
                  { valor: "nunca", rotulo: "Nunca comprou" },
                ]}
              />
            </Campo>
            <Campo rotulo="Total comprado de" className="w-28">
              <Input dinheiro valor={totalMin} aoMudar={setTotalMin} placeholder="0,00" />
            </Campo>
            <Campo rotulo="até" className="w-28">
              <Input dinheiro valor={totalMax} aoMudar={setTotalMax} placeholder="∞" />
            </Campo>
            <Campo rotulo="Limite de" className="w-28">
              <Input dinheiro valor={limiteMin} aoMudar={setLimiteMin} placeholder="0,00" />
            </Campo>
            <Campo rotulo="até" className="w-28">
              <Input dinheiro valor={limiteMax} aoMudar={setLimiteMax} placeholder="∞" />
            </Campo>
          </>
        )}
        <div className="ml-auto flex items-center gap-2">
          <FiltrosSalvos chave={aba === "clientes" ? "clientes" : "fornecedores"} atual={filtro} aoAplicar={(f) => {
              setBusca(f.busca);
              setUfs(f.ufs);
              setCondicoes(f.condicoes ?? []);
              setSoComSaldo(f.soComSaldo ?? false);
              setTipoPessoa(f.tipoPessoa ?? "todos");
              setCidades(f.cidades ?? []);
              setCreditos(f.creditos ?? []);
              setSefaz(f.sefaz ?? "todos");
              setContribuinte(f.contribuinte ?? []);
              setRecencia(f.recencia ?? "todos");
              setTotalMin(f.totalMin ?? "");
              setTotalMax(f.totalMax ?? "");
              setLimiteMin(f.limiteMin ?? "");
              setLimiteMax(f.limiteMax ?? "");
            }} />
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
