"use client";

import Link from "next/link";
import { useMemo, useState } from "react";
import { useRouter } from "next/navigation";
import { CamposTributarios } from "@/components/CamposTributarios";
import { Tabela, type Coluna } from "@/components/Tabela";
import { Abas, Badge, Button, Campo, Card, CardTitulo, Icon, Input, Kpi, Modal, PageHeader, Select, useToast } from "@/components/ui";
import { aplicarPerfilTributario, avisosTributarios, crtSugeridoParaRegime, PARAMETROS_TRIBUTARIOS_VAZIOS, REGIMES_FISCAIS, rotuloRegimeFiscal, TIPOS_CODIGO_FISCAL, type ParametrosTributarios, type RegimeFiscalPerfil, type TipoCodigoFiscal } from "@/lib/tributacao";
import { alterarStatusParametroFiscal, salvarCodigoFiscal, salvarPerfilFiscal, salvarTributacaoProduto } from "@/server/acoes/tributacao";
import type { CodigoFiscalDto, PainelTributacaoDto, PerfilFiscalDto, ProdutoFiscalDto } from "@/server/tributacaoCore";

type CodigoEdicao = { id: string; tipo: TipoCodigoFiscal; codigo: string; nome: string };
type PerfilEdicao = { id: string; nome: string; regime: RegimeFiscalPerfil; dados: ParametrosTributarios };

export function TributacaoProdutosView({ dados, produtoInicial }: { dados: PainelTributacaoDto; produtoInicial: string }) {
  const router = useRouter(); const toast = useToast();
  const inicial = dados.produtos.find((p) => p.id === produtoInicial) ?? null;
  const [aba, setAba] = useState("produtos");
  const [busca, setBusca] = useState("");
  const [produto, setProduto] = useState<ProdutoFiscalDto | null>(inicial);
  const [camposProduto, setCamposProduto] = useState<ParametrosTributarios>(inicial ? { ...inicial.dados } : { ...PARAMETROS_TRIBUTARIOS_VAZIOS });
  const [perfilProduto, setPerfilProduto] = useState(inicial?.perfilId ?? "");
  const [perfilSelecionado, setPerfilSelecionado] = useState(inicial?.perfilId ?? "");
  const [perfil, setPerfil] = useState<PerfilEdicao | null>(null);
  const [codigo, setCodigo] = useState<CodigoEdicao | null>(null);
  const [erro, setErro] = useState("");
  const [ocupado, setOcupado] = useState(false);
  const avisosProduto = produto ? avisosTributarios(camposProduto, dados.crt) : [];
  const precisaRevisao = dados.produtos.filter((p) => p.avisos.length > 0).length;
  const perfisAtivos = dados.perfis.filter((p) => p.ativo);
  const termo = busca.trim().toLocaleLowerCase("pt-BR");
  const produtosFiltrados = useMemo(() => dados.produtos.filter((p) => !termo || `${p.nome} ${p.sku} ${p.categoria} ${p.dados.ncm} ${p.dados.cfop} ${p.dados.csosn} ${p.dados.cstIcms}`.toLocaleLowerCase("pt-BR").includes(termo)), [dados.produtos, termo]);
  const perfisFiltrados = dados.perfis.filter((p) => !termo || `${p.nome} ${rotuloRegimeFiscal(p.regime)}`.toLocaleLowerCase("pt-BR").includes(termo));
  const codigosFiltrados = dados.codigos.filter((c) => !termo || `${c.codigo} ${c.nome} ${c.tipo}`.toLocaleLowerCase("pt-BR").includes(termo));

  function abrirProduto(p: ProdutoFiscalDto) { setProduto(p); setCamposProduto({ ...p.dados }); setPerfilProduto(p.perfilId ?? ""); setPerfilSelecionado(p.perfilId ?? ""); setErro(""); }
  function abrirPerfil(p?: PerfilFiscalDto) { setPerfil(p ? { id: p.id, nome: p.nome, regime: p.regime, dados: { ...p.dados } } : { id: "", nome: "", regime: "todos", dados: { ...PARAMETROS_TRIBUTARIOS_VAZIOS } }); setErro(""); }
  function abrirCodigo(c?: CodigoFiscalDto) { setCodigo(c ? { id: c.id, tipo: c.tipo, codigo: c.codigo, nome: c.nome } : { id: "", tipo: "cfop", codigo: "", nome: "" }); setErro(""); }
  async function alternar(id: string, ativo: boolean) {
    if (ocupado) return; setOcupado(true);
    try { const r = await alterarStatusParametroFiscal({ id, ativo }); toast(r.ok ? r.aviso : r.erro, r.ok ? "ok" : "erro"); if (r.ok) router.refresh(); }
    catch { toast("Não foi possível atualizar o registro.", "erro"); } finally { setOcupado(false); }
  }
  async function gravarProduto() {
    if (!produto || ocupado) return;
    if (perfilSelecionado && perfilSelecionado !== perfilProduto) { setErro("Clique em Aplicar perfil antes de salvar ou escolha o perfil já vinculado."); return; }
    setOcupado(true); setErro("");
    try { const r = await salvarTributacaoProduto({ produtoId: produto.id, perfilId: perfilProduto, dados: camposProduto }); if (!r.ok) { setErro(r.erro); return; } toast(r.aviso); setProduto(null); router.refresh(); }
    catch { setErro("Não foi possível salvar a tributação do produto."); } finally { setOcupado(false); }
  }
  async function gravarPerfil() {
    if (!perfil || ocupado) return; setOcupado(true); setErro("");
    try { const r = await salvarPerfilFiscal(perfil); if (!r.ok) { setErro(r.erro); return; } toast(r.aviso); setPerfil(null); router.refresh(); }
    catch { setErro("Não foi possível salvar o perfil fiscal."); } finally { setOcupado(false); }
  }
  async function gravarCodigo() {
    if (!codigo || ocupado) return; setOcupado(true); setErro("");
    try { const r = await salvarCodigoFiscal(codigo); if (!r.ok) { setErro(r.erro); return; } toast(r.aviso); setCodigo(null); router.refresh(); }
    catch { setErro("Não foi possível salvar o código fiscal."); } finally { setOcupado(false); }
  }
  const colunasProdutos: Coluna<ProdutoFiscalDto>[] = [
    { id: "nome", rotulo: "Produto", valor: (p) => p.nome, render: (p) => <div><p className="font-bold text-ink-800">{p.nome}</p><p className="font-mono text-[10px] text-ink-400">{p.sku || "sem SKU"} · {p.categoria}</p></div> },
    { id: "ncm", rotulo: "NCM / CEST", valor: (p) => p.dados.ncm, render: (p) => <span className="font-mono text-[12px]">{p.dados.ncm || "—"}<br /><span className="text-ink-400">{p.dados.cest || "sem CEST"}</span></span> },
    { id: "cfop", rotulo: "CFOP", valor: (p) => p.dados.cfop, render: (p) => <span className="font-mono">{p.dados.cfop || "—"}</span> },
    { id: "icms", rotulo: "ICMS", valor: (p) => p.dados.tipoIcms === "cst" ? p.dados.cstIcms : p.dados.tipoIcms === "csosn" ? p.dados.csosn : "", render: (p) => p.dados.tipoIcms ? <span className="font-mono">{p.dados.tipoIcms === "cst" ? `CST ${p.dados.cstIcms}` : `CSOSN ${p.dados.csosn}`}</span> : <span className="text-ink-400">Não revisado</span> },
    { id: "status", rotulo: "Revisão", valor: (p) => p.avisos.length, render: (p) => <Badge tom={p.avisos.length ? "alerta" : "ok"}>{p.avisos.length ? `${p.avisos.length} ponto(s)` : "Dados básicos informados"}</Badge> },
    { id: "acao", rotulo: "", ocultoNoCsv: true, render: (p) => <Button tamanho="sm" variante="secundario" onClick={() => abrirProduto(p)}>Configurar</Button> },
  ];
  const colunasPerfis: Coluna<PerfilFiscalDto>[] = [
    { id: "nome", rotulo: "Perfil fiscal", valor: (p) => p.nome, render: (p) => <span className="font-semibold text-ink-800">{p.nome}</span> },
    { id: "regime", rotulo: "Regime", valor: (p) => rotuloRegimeFiscal(p.regime) },
    { id: "codigos", rotulo: "Referências", valor: (p) => `${p.dados.ncm} ${p.dados.cfop}`, render: (p) => <span className="font-mono text-[11px]">NCM {p.dados.ncm || "—"} · CFOP {p.dados.cfop || "—"}</span> },
    { id: "ativo", rotulo: "Situação", valor: (p) => p.ativo ? "Ativo" : "Inativo", render: (p) => <Badge tom={p.ativo ? "ok" : "neutro"}>{p.ativo ? "Ativo" : "Inativo"}</Badge> },
    { id: "acoes", rotulo: "", ocultoNoCsv: true, render: (p) => <div className="flex justify-end gap-1"><Button tamanho="sm" variante="secundario" onClick={() => abrirPerfil(p)}>Editar</Button><Button tamanho="sm" variante="fantasma" disabled={ocupado} onClick={() => void alternar(p.id, !p.ativo)}>{p.ativo ? "Desativar" : "Ativar"}</Button></div> },
  ];
  const colunasCodigos: Coluna<CodigoFiscalDto>[] = [
    { id: "tipo", rotulo: "Tipo", valor: (c) => TIPOS_CODIGO_FISCAL.find((t) => t.id === c.tipo)?.rotulo ?? c.tipo },
    { id: "codigo", rotulo: "Código", valor: (c) => c.codigo, render: (c) => <span className="font-mono font-bold text-ink-800">{c.codigo}</span> },
    { id: "nome", rotulo: "Descrição da empresa", valor: (c) => c.nome },
    { id: "ativo", rotulo: "Situação", valor: (c) => c.ativo ? "Ativo" : "Inativo", render: (c) => <Badge tom={c.ativo ? "ok" : "neutro"}>{c.ativo ? "Ativo" : "Inativo"}</Badge> },
    { id: "acao", rotulo: "", ocultoNoCsv: true, render: (c) => <div className="flex justify-end gap-1"><Button tamanho="sm" variante="secundario" onClick={() => abrirCodigo(c)}>Editar</Button><Button tamanho="sm" variante="fantasma" disabled={ocupado} onClick={() => void alternar(c.id, !c.ativo)}>{c.ativo ? "Desativar" : "Ativar"}</Button></div> },
  ];

  return <div className="space-y-4">
    <PageHeader titulo="Parametrização fiscal de produtos" subtitulo={`${dados.empresa} · cadastros e perfis tributários por empresa`} etiquetas={<><Badge tom="info">{rotuloRegimeFiscal(dados.regime)}</Badge><Badge tom="neutro">CRT {dados.crt}{dados.crtConfigurado ? " configurado" : " sugerido"}</Badge></>} acao={<Link href="/config"><Button tamanho="sm" variante="secundario" icone="voltar">Voltar às configurações</Button></Link>} />
    <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-4"><Kpi rotulo="Produtos" valor={String(dados.produtos.length)} detalhe="Todos os cadastros da empresa" icone="etiqueta" /><Kpi rotulo="Precisam de revisão" valor={String(precisaRevisao)} detalhe="Dados ausentes ou inconsistentes" icone="alerta" tom={precisaRevisao ? "alerta" : "ok"} /><Kpi rotulo="Perfis ativos" valor={String(perfisAtivos.length)} detalhe="Modelos de preenchimento" icone="documento" tom="info" /><Kpi rotulo="Códigos próprios" valor={String(dados.codigos.filter((c) => c.ativo).length)} detalhe="Referências cadastradas pela empresa" icone="grafico" /></div>
    <div className="rounded-xl border border-amber-200 bg-amber-50/70 px-4 py-3 text-[12px] leading-relaxed text-amber-900"><strong>Revise com sua contabilidade.</strong> Os códigos e alíquotas devem ser confirmados pela empresa. Valores já existentes podem ser padrões legados ou de teste, não uma validação fiscal. O sistema verifica formato e compatibilidade básica, mas não comprova vigência nem calcula automaticamente ICMS-ST, FCP ou incidência tributária. Os dados seguem no contrato canônico; o mapeamento do provedor exige homologação. Perfis são cópias explícitas e não atualizam produtos sozinhos. <a className="font-semibold underline" href="https://www.nfe.fazenda.gov.br/portal/listaConteudo.aspx?tipoConteudo=%2FNJarYc9nus%3D" target="_blank" rel="noopener noreferrer">Consultar tabelas oficiais NF-e</a>.</div>
    {dados.crtSugerido && dados.crtConfigurado && dados.crt !== dados.crtSugerido && <div role="alert" className="rounded-xl border border-rose-200 bg-rose-50 px-4 py-3 text-xs text-rose-700">O CRT configurado ({dados.crt}) difere do normalmente associado ao regime informado ({dados.crtSugerido}). Revise a empresa e o CRT em Configurações antes de aplicar regras.</div>}
    {!dados.crtConfigurado && <div className="rounded-xl border border-sky-200 bg-sky-50 px-4 py-3 text-xs text-sky-800">{dados.crtSugerido ? `CRT ${dados.crtSugerido} sugerido pelo regime cadastrado.` : "Regime não identificado para sugerir o CRT."} Confirme o regime e o CRT em Configurações fiscais; eles não foram alterados automaticamente.</div>}
    <Abas atual={aba} aoTrocar={(v) => { setAba(v); setBusca(""); }} abas={[{ id: "produtos", rotulo: "Produtos", contagem: dados.produtos.length }, { id: "perfis", rotulo: "Perfis fiscais", contagem: dados.perfis.length }, { id: "codigos", rotulo: "Códigos da empresa", contagem: dados.codigos.length }]} />
    <div className="flex flex-wrap items-center gap-2"><div className="relative w-full max-w-sm"><span className="pointer-events-none absolute left-2.5 top-1/2 -translate-y-1/2 text-ink-400"><Icon name="busca" className="size-4" /></span><Input valor={busca} aoMudar={setBusca} placeholder={aba === "produtos" ? "Buscar produto, SKU, NCM ou CFOP" : "Buscar nome ou código"} className="pl-8" /></div><div className="ml-auto">{aba === "perfis" && <Button icone="mais" onClick={() => abrirPerfil()}>Novo perfil</Button>}{aba === "codigos" && <Button icone="mais" onClick={() => abrirCodigo()}>Cadastrar código</Button>}</div></div>
    <Card padding={false}>{aba === "produtos" ? <Tabela colunas={colunasProdutos} linhas={produtosFiltrados} chave={(p) => p.id} vazio="Nenhum produto encontrado." /> : aba === "perfis" ? <Tabela colunas={colunasPerfis} linhas={perfisFiltrados} chave={(p) => p.id} vazio="Nenhum perfil cadastrado. Crie um modelo sem alterar produtos existentes." /> : <Tabela colunas={colunasCodigos} linhas={codigosFiltrados} chave={(c) => c.id} vazio="Nenhum código próprio cadastrado. As tabelas oficiais continuam sendo a fonte de consulta." />}</Card>

    <Modal aberto={Boolean(produto)} aoFechar={() => { if (!ocupado) { setProduto(null); setErro(""); } }} titulo={produto ? `Tributação · ${produto.nome}` : "Tributação do produto"} descricao="Os campos existentes são preservados até você salvar. A conferência fiscal é responsabilidade da empresa." largura="max-w-5xl" rodape={<><Button variante="secundario" disabled={ocupado} onClick={() => setProduto(null)}>Cancelar</Button><Button icone="salvar" disabled={ocupado} onClick={() => void gravarProduto()}>{ocupado ? "Salvando…" : "Salvar tributação"}</Button></>}>
      {produto && <div className="space-y-4">{erro && <p role="alert" className="rounded-lg bg-rose-50 px-3 py-2 text-xs text-rose-700">{erro}</p>}
        {avisosProduto.length > 0 && <div className="rounded-xl border border-amber-200 bg-amber-50/70 p-3 text-[11.5px] text-amber-900"><p className="font-bold">Pontos para revisão</p><ul className="mt-1 space-y-1">{avisosProduto.map((aviso) => <li key={aviso}>• {aviso}</li>)}</ul></div>}
        <div className="rounded-xl border border-way-100 bg-way-50/60 p-3">
          <p className="text-[12px] font-bold text-ink-800">Aplicar um perfil opcional</p>
          <p className="mt-1 text-[11px] text-ink-500">A aplicação copia os campos preenchidos. Campos vazios do perfil preservam os valores do produto; revise antes de salvar.</p>
          <p className="mt-1 text-[11px] text-ink-500">Perfil vinculado: <b>{dados.perfis.find((p) => p.id === perfilProduto)?.nome ?? "nenhum"}</b>. Desvincular não apaga os valores.</p>
          <div className="mt-2 flex flex-wrap items-end gap-2"><div className="min-w-56 flex-1"><Select valor={perfilSelecionado} aoMudar={(v) => { setPerfilSelecionado(v); if (!v) setPerfilProduto(""); }} opcoes={[{ valor: "", rotulo: "Sem perfil vinculado" }, ...dados.perfis.filter((p) => (p.ativo && (p.regime === "todos" || p.regime === dados.regime)) || p.id === perfilProduto).map((p) => ({ valor: p.id, rotulo: `${p.nome}${p.ativo ? "" : " (inativo)"}${p.regime !== "todos" && p.regime !== dados.regime ? " · regime diferente" : ""}` }))]} /></div>
            <Button tamanho="sm" variante="secundario" disabled={!perfilSelecionado || !dados.perfis.some((p) => p.id === perfilSelecionado && p.ativo && (p.regime === "todos" || p.regime === dados.regime))} onClick={() => { const p = dados.perfis.find((x) => x.id === perfilSelecionado); if (p) { setCamposProduto(aplicarPerfilTributario(camposProduto, p.dados)); setPerfilProduto(p.id); setErro(""); } }}>Aplicar perfil</Button>
          </div>
          {perfilSelecionado && perfilSelecionado !== perfilProduto && <p className="mt-2 text-[11px] font-semibold text-amber-700">Clique em Aplicar perfil para copiar e vincular a seleção.</p>}
        </div>
        <CamposTributarios dados={camposProduto} aoMudar={setCamposProduto} codigos={dados.codigos} prefixo="produto-fiscal" crt={dados.crt} />
      </div>}
    </Modal>
    <Modal aberto={Boolean(perfil)} aoFechar={() => { if (!ocupado) { setPerfil(null); setErro(""); } }} titulo={perfil?.id ? "Editar perfil fiscal" : "Novo perfil fiscal"} descricao="Modelo reutilizável por produto; campos vazios não apagam valores ao aplicar." largura="max-w-5xl" rodape={<><Button variante="secundario" disabled={ocupado} onClick={() => setPerfil(null)}>Cancelar</Button><Button icone="salvar" disabled={ocupado} onClick={() => void gravarPerfil()}>{ocupado ? "Salvando…" : "Salvar perfil"}</Button></>}>
      {perfil && <div className="space-y-4">{erro && <p role="alert" className="rounded-lg bg-rose-50 px-3 py-2 text-xs text-rose-700">{erro}</p>}<div className="grid gap-3 sm:grid-cols-2"><Campo rotulo="Nome do perfil" obrigatorio><Input valor={perfil.nome} aoMudar={(v) => setPerfil({ ...perfil, nome: v })} placeholder="Ex.: Mercadorias para revenda" maxLength={120} /></Campo><Campo rotulo="Regime aplicável"><Select valor={perfil.regime} aoMudar={(v) => setPerfil({ ...perfil, regime: v as RegimeFiscalPerfil })} opcoes={REGIMES_FISCAIS.map((r) => ({ valor: r.id, rotulo: r.rotulo }))} /></Campo></div><CamposTributarios dados={perfil.dados} aoMudar={(d) => setPerfil({ ...perfil, dados: d })} codigos={dados.codigos} prefixo="perfil-fiscal" crt={crtSugeridoParaRegime(perfil.regime) ?? dados.crt} /></div>}
    </Modal>
    <Modal aberto={Boolean(codigo)} aoFechar={() => { if (!ocupado) { setCodigo(null); setErro(""); } }} titulo={codigo?.id ? "Editar código fiscal" : "Cadastrar código fiscal"} descricao="Cadastro de referência da empresa; não altera a tabela oficial nem produtos existentes." largura="max-w-xl" rodape={<><Button variante="secundario" disabled={ocupado} onClick={() => setCodigo(null)}>Cancelar</Button><Button icone="salvar" disabled={ocupado} onClick={() => void gravarCodigo()}>{ocupado ? "Salvando…" : "Salvar código"}</Button></>}>
      {codigo && <div className="space-y-3">{erro && <p role="alert" className="rounded-lg bg-rose-50 px-3 py-2 text-xs text-rose-700">{erro}</p>}<div className="grid gap-3 sm:grid-cols-2"><Campo rotulo="Tipo" obrigatorio><Select valor={codigo.tipo} aoMudar={(v) => setCodigo({ ...codigo, tipo: v as TipoCodigoFiscal, codigo: "" })} opcoes={TIPOS_CODIGO_FISCAL.map((t) => ({ valor: t.id, rotulo: t.rotulo }))} /></Campo><Campo rotulo="Código" obrigatorio dica={TIPOS_CODIGO_FISCAL.find((t) => t.id === codigo.tipo)?.dica}><Input valor={codigo.codigo} aoMudar={(v) => setCodigo({ ...codigo, codigo: v })} inputMode="numeric" className="font-mono" maxLength={12} /></Campo></div><Campo rotulo="Descrição da empresa" obrigatorio><Input valor={codigo.nome} aoMudar={(v) => setCodigo({ ...codigo, nome: v })} maxLength={180} placeholder="Descrição para facilitar a seleção" /></Campo></div>}
    </Modal>
  </div>;
}
