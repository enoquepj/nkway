"use client";

import Link from "next/link";
import { useState } from "react";
import {
  Abas,
  Badge,
  Button,
  Campo,
  Card,
  CardTitulo,
  Icon,
  Input,
  Modal,
  PageHeader,
  Select,
  cn,
  useToast,
} from "@/components/ui";
import { UFS, dataBR, moeda } from "@/lib/dominio";
import { gerarSqlConsolidadoSupabaseNk } from "@/lib/migracaoLegado";
import { PERFIS_USUARIO, ROTULO_PERFIL, normalizarPerfil, temPermissao, type PerfilUsuario } from "@/lib/permissoes";
import { criarOperador, removerOperador, salvarEmpresa, salvarFiscal } from "@/server/acoes/config";
import { trocarSenha } from "@/server/acoes/auth";
import type { AssinaturaPainelDto } from "@/server/dados";
import { PainelAssinatura } from "@/views/Assinatura";
import { PainelDiagnostico } from "@/views/Diagnostico";

type EmpresaCfg = {
  nome: string;
  nomeFantasia: string;
  cnpj: string;
  uf: string;
  municipio: string;
  codMunicipio: string;
  ie: string;
  regime: string;
  porte: string;
  telefone: string;
  email: string;
  endereco: string;
  numero: string;
  bairro: string;
  cep: string;
};
type FiscalCfg = {
  serieNfce: string;
  serieNfe: string;
  serieMdfe: string;
  ambiente: 1 | 2;
  cscId: string;
  cscToken: string;
  crt: number;
  certificadoNome: string;
  certificadoValidade: string;
  certificadoSerial: string;
};

export function ConfigView({
  empresa,
  fiscal,
  equipe,
  usuarioAtual,
  usuarioPapel = "administrador",
  assinatura,
  ambiente,
}: {
  empresa: EmpresaCfg;
  fiscal: FiscalCfg;
  plano?: { id: string; nome: string; preco: number; limiteProdutos: number; limiteUsuarios: number };
  equipe: { id: string; nome: string; email: string; papel: string; ativo?: boolean }[];
  usuarioAtual: string;
  usuarioPapel?: PerfilUsuario;
  assinatura: AssinaturaPainelDto;
  ambiente: { produtos: number; produtosAtivos: number; documentos: number; davs: number; contas: number; entradas: number; entradasPendentes: number; faturamento14d: number };
}) {
  const toast = useToast();
  const podeConfig = temPermissao(usuarioPapel, "config.gerenciar");
  const podeUsuarios = temPermissao(usuarioPapel, "usuarios.gerenciar");
  const [aba, setAba] = useState(podeConfig ? "empresa" : "equipe");
  const [e, setE] = useState(empresa);
  const [f, setF] = useState(fiscal);
  const [novoOp, setNovoOp] = useState({ nome: "", email: "", senha: "", papel: "operador" });
  const [senha, setSenha] = useState("");
  const [ocupado, setOcupado] = useState(false);
  const [erro, setErro] = useState("");
  const [modalSqlSupabase, setModalSqlSupabase] = useState(false);
  const sqlConsolidado = gerarSqlConsolidadoSupabaseNk();

  function baixarArquivoSqlConsolidado() {
    const blob = new Blob([sqlConsolidado], { type: "application/sql;charset=utf-8" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = "ATUALIZAR_SUPABASE_AGORA.sql";
    a.click();
    URL.revokeObjectURL(url);
    toast("Arquivo ATUALIZAR_SUPABASE_AGORA.sql baixado.", "ok");
  }

  async function copiarSqlConsolidado() {
    try {
      await navigator.clipboard.writeText(sqlConsolidado);
      toast("SQL completo copiado! Cole no SQL Editor do Supabase e clique em Run.", "ok");
    } catch {
      setModalSqlSupabase(true);
    }
  }

  return (
    <>
      <PageHeader
        titulo="Configurações"
        subtitulo="Dados da empresa, parâmetros fiscais para emissão, assinatura e equipe"
        acao={<Badge tom={f.ambiente === 1 ? "erro" : "info"}>{f.ambiente === 1 ? "Produção — notas reais" : "Homologação — notas simuladas"}</Badge>}
      />

      <Abas
        abas={[
          { id: "empresa", rotulo: "Empresa" },
          { id: "fiscal", rotulo: "Fiscal e certificado" },
          { id: "plano", rotulo: "Assinatura" },
          { id: "equipe", rotulo: "Equipe", contagem: equipe.length },
          { id: "ambiente", rotulo: "Ambiente" },
        ]}
        atual={aba}
        aoTrocar={setAba}
      />

      {aba === "empresa" && (
        <Card>
          <CardTitulo titulo="Cadastro da empresa" descricao="Alimenta o cabeçalho das notas, o rodapé do cupom e o cadastro do DF-e" icone="painel" />
          <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
            <Campo rotulo="Razão social" obrigatorio className="lg:col-span-2">
              <Input valor={e.nome} aoMudar={(v) => setE({ ...e, nome: v })} />
            </Campo>
            <Campo rotulo="Nome fantasia">
              <Input valor={e.nomeFantasia} aoMudar={(v) => setE({ ...e, nomeFantasia: v })} />
            </Campo>
            <Campo rotulo="CNPJ">
              <Input valor={e.cnpj} aoMudar={(v) => setE({ ...e, cnpj: v })} className="font-mono" />
            </Campo>
            <Campo rotulo="Inscrição estadual">
              <Input valor={e.ie} aoMudar={(v) => setE({ ...e, ie: v })} />
            </Campo>
            <Campo rotulo="Regime tributário">
              <Select
                valor={e.regime}
                aoMudar={(v) => setE({ ...e, regime: v })}
                opcoes={[
                  { valor: "mei", rotulo: "MEI / SNEI" },
                  { valor: "simples", rotulo: "Simples Nacional" },
                  { valor: "simples_excedente", rotulo: "Simples com excesso" },
                  { valor: "presumido", rotulo: "Lucro Presumido" },
                  { valor: "real", rotulo: "Lucro Real" },
                ]}
              />
            </Campo>
            <Campo rotulo="Porte">
              <Select valor={e.porte} aoMudar={(v) => setE({ ...e, porte: v })} opcoes={["MEI", "ME", "EPP", "EA"].map((p) => ({ valor: p, rotulo: p }))} />
            </Campo>
            <Campo rotulo="UF">
              <Select valor={e.uf} aoMudar={(v) => setE({ ...e, uf: v })} opcoes={Object.keys(UFS).map((u) => ({ valor: u, rotulo: `${u} · ${UFS[u]}` }))} />
            </Campo>
            <Campo rotulo="Município">
              <Input valor={e.municipio} aoMudar={(v) => setE({ ...e, municipio: v })} />
            </Campo>
            <Campo rotulo="Código IBGE do município" dica="7 dígitos — obrigatório na NF-e">
              <Input valor={e.codMunicipio} aoMudar={(v) => setE({ ...e, codMunicipio: v })} className="font-mono" />
            </Campo>
            <Campo rotulo="Telefone">
              <Input valor={e.telefone} aoMudar={(v) => setE({ ...e, telefone: v })} />
            </Campo>
            <Campo rotulo="E-mail">
              <Input valor={e.email} aoMudar={(v) => setE({ ...e, email: v })} />
            </Campo>
            <Campo rotulo="Logradouro">
              <Input valor={e.endereco} aoMudar={(v) => setE({ ...e, endereco: v })} />
            </Campo>
            <Campo rotulo="Número">
              <Input valor={e.numero} aoMudar={(v) => setE({ ...e, numero: v })} />
            </Campo>
            <Campo rotulo="Bairro">
              <Input valor={e.bairro} aoMudar={(v) => setE({ ...e, bairro: v })} />
            </Campo>
            <Campo rotulo="CEP">
              <Input valor={e.cep} aoMudar={(v) => setE({ ...e, cep: v })} className="font-mono" />
            </Campo>
          </div>
          <div className="mt-4 flex justify-end">
            <Button
              disabled={ocupado || !podeConfig}
              onClick={async () => {
                setOcupado(true);
                const r = await salvarEmpresa(e);
                setOcupado(false);
                toast(r.ok ? (r.aviso ?? "Dados da empresa salvos.") : r.erro, r.ok ? "ok" : "erro");
              }}
            >
              Salvar dados da empresa
            </Button>
          </div>
        </Card>
      )}

      {aba === "fiscal" && (
        <div className="grid gap-4 lg:grid-cols-2">
          {podeConfig && <Card className="lg:col-span-2"><div className="flex flex-wrap items-center justify-between gap-3"><div><p className="text-[13px] font-bold text-ink-800">Tributação de produtos</p><p className="mt-1 text-[11.5px] text-ink-400">Cadastre CFOP, NCM, CST, CSOSN e perfis fiscais por empresa, com revisão contábil.</p></div><Link href="/config/fiscal/produtos"><Button tamanho="sm" variante="secundario" icone="etiqueta">Abrir parametrização fiscal</Button></Link></div></Card>}
          <Card>
            <CardTitulo titulo="Emissão" descricao="Séries por modelo e ambiente da SEFAZ" icone="documento" />
            <div className="grid gap-3 sm:grid-cols-2">
              <Campo rotulo="Série NFC-e">
                <Input valor={f.serieNfce} aoMudar={(v) => setF({ ...f, serieNfce: v })} className="font-mono" />
              </Campo>
              <Campo rotulo="Série NF-e">
                <Input valor={f.serieNfe} aoMudar={(v) => setF({ ...f, serieNfe: v })} className="font-mono" />
              </Campo>
              <Campo rotulo="Série MDF-e">
                <Input valor={f.serieMdfe} aoMudar={(v) => setF({ ...f, serieMdfe: v })} className="font-mono" />
              </Campo>
              <Campo rotulo="CRT">
                <Select
                  valor={String(f.crt)}
                  aoMudar={(v) => setF({ ...f, crt: Number(v) })}
                  opcoes={[
                    { valor: "1", rotulo: "1 - Simples Nacional" },
                    { valor: "2", rotulo: "2 - SN com excesso" },
                    { valor: "3", rotulo: "3 - Regime normal" },
                    { valor: "4", rotulo: "4 - MEI" },
                  ]}
                />
              </Campo>
              <Campo rotulo="Ambiente" className="sm:col-span-2">
                <div className="flex rounded-lg bg-ink-50 p-0.5">
                  {[
                    { v: 2, r: "2 - Homologação (teste)" },
                    { v: 1, r: "1 - Produção" },
                  ].map((x) => (
                    <button
                      key={x.v}
                      type="button"
                      onClick={() => setF({ ...f, ambiente: x.v as 1 | 2 })}
                      className={cn("flex-1 rounded px-2 py-1.5 text-[12px] font-semibold transition", f.ambiente === x.v ? "bg-white text-ink-900 shadow-sm" : "text-ink-400")}
                    >
                      {x.r}
                    </button>
                  ))}
                </div>
              </Campo>
              <Campo rotulo="CSC id (token NFC-e)">
                <Input valor={f.cscId} aoMudar={(v) => setF({ ...f, cscId: v })} className="font-mono" placeholder="1-6 dígitos" />
              </Campo>
              <Campo rotulo="CSC token" dica="Gravamos só o começo e o fim; o valor completo fica no cofre do servidor">
                <Input valor={f.cscToken} aoMudar={(v) => setF({ ...f, cscToken: v })} className="font-mono" placeholder="token informado pela SEFAZ" />
              </Campo>
            </div>
            <div className="mt-3 flex justify-end">
              <Button
                disabled={ocupado || !podeConfig}
                onClick={async () => {
                  setOcupado(true);
                  const r = await salvarFiscal(f);
                  setOcupado(false);
                  toast(r.ok ? (r.aviso ?? "Configuração fiscal salva.") : r.erro, r.ok ? "ok" : "erro");
                }}
              >
                Salvar configuração fiscal
              </Button>
            </div>
          </Card>

          <Card>
            <CardTitulo titulo="Certificado digital A1" descricao="Necessário para emitir em produção e para capturar NF-e no DF-e" icone="cadeado" />
            <div className="space-y-3">
              <Campo rotulo="Titular / apelido do certificado">
                <Input valor={f.certificadoNome} aoMudar={(v) => setF({ ...f, certificadoNome: v })} placeholder="COMERCIAL SAO JORGE LTDA (A1)" />
              </Campo>
              <div className="grid gap-3 sm:grid-cols-2">
                <Campo rotulo="Validade">
                  <Input type="date" valor={f.certificadoValidade} aoMudar={(v) => setF({ ...f, certificadoValidade: v })} />
                </Campo>
                <Campo rotulo="Número de série">
                  <Input valor={f.certificadoSerial} aoMudar={(v) => setF({ ...f, certificadoSerial: v })} className="font-mono" />
                </Campo>
              </div>
              <div className="rounded-lg border border-dashed border-ink-200 bg-ink-50/50 p-3">
                <p className="flex items-center gap-1.5 text-[12.5px] font-semibold text-ink-700">
                  <Icon name="cadeado" className="size-3.5 text-way-600" />
                  Upload seguro do .pfx e captura DF-e
                </p>
                <p className="mt-1 text-[11.5px] leading-snug text-ink-400">
                  Envie o arquivo <b>.pfx/.p12</b> e gerencie o worker mTLS, o bucket privado <b>certificados-a1</b> (ou cofre
                  AES-256-GCM) e as NF-e recebidas no painel dedicado de DF-e.
                </p>
                <div className="mt-2.5 flex flex-wrap items-center justify-between gap-2">
                  <Badge tom={f.certificadoValidade && new Date(f.certificadoValidade) < new Date() ? "erro" : "ok"}>
                    {f.certificadoValidade ? `validade registrada: ${dataBR(f.certificadoValidade)}` : "nenhum certificado registrado"}
                  </Badge>
                  <Link href="/dfe">
                    <Button tamanho="sm" variante="secundario" icone="cadeado">
                      Abrir DF-e e Certificado A1 →
                    </Button>
                  </Link>
                </div>
              </div>
            </div>
          </Card>
        </div>
      )}

      {aba === "plano" && (
        <PainelAssinatura dados={assinatura} usuarioPapel={usuarioPapel} mostrarCabecalho={false} />
      )}

      {aba === "equipe" && (
        <div className="grid gap-4 lg:grid-cols-2">
          <Card padding={false}>
            <div className="p-4 pb-2">
              <CardTitulo
                titulo="Acessos da empresa"
                descricao="Perfis Administrador, Operador e Vendedor com trilha de auditoria"
                icone="pessoas"
                acao={
                  <Link href="/usuarios">
                    <Button tamanho="sm" variante="secundario">
                      Usuários e auditoria →
                    </Button>
                  </Link>
                }
              />
            </div>
            <ul className="divide-y divide-ink-50">
              {equipe.map((u) => {
                const perfil = normalizarPerfil(u.papel);
                const info = ROTULO_PERFIL[perfil];
                const ativo = u.ativo !== false;
                return (
                <li key={u.id} className="flex items-center gap-3 px-4 py-2.5">
                  <span className="grid size-8 place-items-center rounded-lg bg-ink-100 text-[12px] font-bold text-ink-600">{u.nome.slice(0, 2).toUpperCase()}</span>
                  <div className="min-w-0 flex-1">
                    <p className="truncate text-[12.5px] font-semibold text-ink-900">{u.nome}</p>
                    <p className="truncate text-[11px] text-ink-400">{u.email}</p>
                  </div>
                  <Badge tom={info.tom}>{info.nome}</Badge>
                  {!ativo && <Badge tom="erro">Inativo</Badge>}
                  {podeUsuarios && u.id !== usuarioAtual && ativo && (
                    <button
                      type="button"
                      title="Desativar usuário"
                      onClick={async () => {
                        const r = await removerOperador(u.id);
                        toast(r.ok ? (r.aviso ?? "Usuário desativado.") : r.erro, r.ok ? "ok" : "erro");
                      }}
                      className="rounded-md p-1 text-ink-300 hover:bg-rose-50 hover:text-rose-600"
                    >
                      <Icon name="x" className="size-4" />
                    </button>
                  )}
                </li>
                );
              })}
            </ul>
          </Card>
          <Card>
            <CardTitulo titulo="Novo usuário" descricao="Liberar acesso por perfil (Administrador, Operador ou Vendedor)" icone="mais" />
            {erro && <p className="mb-2 rounded-lg bg-rose-50 px-2.5 py-2 text-[12px] font-medium text-rose-700">{erro}</p>}
            {podeUsuarios ? (
            <div className="space-y-3">
              <Campo rotulo="Nome">
                <Input valor={novoOp.nome} aoMudar={(v) => setNovoOp({ ...novoOp, nome: v })} placeholder="Caixa 2" />
              </Campo>
              <Campo rotulo="E-mail" obrigatorio>
                <Input valor={novoOp.email} aoMudar={(v) => setNovoOp({ ...novoOp, email: v })} placeholder="caixa2@loja.com.br" />
              </Campo>
              <div className="grid gap-3 sm:grid-cols-2">
                <Campo rotulo="Perfil" obrigatorio>
                  <Select
                    valor={novoOp.papel}
                    aoMudar={(v) => setNovoOp({ ...novoOp, papel: v })}
                    opcoes={PERFIS_USUARIO.map((p) => ({ valor: p, rotulo: ROTULO_PERFIL[p].nome }))}
                  />
                </Campo>
                <Campo rotulo="Senha inicial" obrigatorio>
                  <Input type="password" valor={novoOp.senha} aoMudar={(v) => setNovoOp({ ...novoOp, senha: v })} />
                </Campo>
              </div>
              <Button
                className="w-full"
                disabled={ocupado}
                onClick={async () => {
                  setErro("");
                  setOcupado(true);
                  const r = await criarOperador(novoOp);
                  setOcupado(false);
                  if (!r.ok) return setErro(r.erro);
                  toast(r.aviso ?? "Usuário criado.");
                  setNovoOp({ nome: "", email: "", senha: "", papel: "operador" });
                }}
              >
                Criar acesso
              </Button>
            </div>
            ) : (
              <p className="rounded-lg bg-ink-50 p-3 text-[12px] text-ink-500">
                Apenas Administradores podem cadastrar novos usuários ou alterar perfis. Você pode alterar sua própria senha abaixo.
              </p>
            )}
            <div className="mt-4 border-t border-ink-100 pt-3">
              <Campo rotulo="Sua senha de acesso">
                <div className="flex gap-2">
                  <Input type="password" valor={senha} aoMudar={setSenha} placeholder="nova senha" />
                  <Button
                    variante="secundario"
                    disabled={ocupado}
                    onClick={async () => {
                      const r = await trocarSenha(senha);
                      toast(r.ok ? "Senha atualizada." : r.erro, r.ok ? "ok" : "erro");
                      if (r.ok) setSenha("");
                    }}
                  >
                    Trocar
                  </Button>
                </div>
              </Campo>
            </div>
          </Card>
        </div>
      )}

      {aba === "ambiente" && (
        <div className="space-y-4">
          {podeConfig && (
            <Card>
              <CardTitulo
                titulo="Script SQL único para atualizar o Supabase (novas tabelas e colunas nk_*)"
                descricao="Reúne em 1 só arquivo idempotente: Auditoria, Caixa, XML de Vendas, Assinatura CNPJ e Emissor SEFAZ 4.00"
                icone="baixar"
                acao={
                  <div className="flex flex-wrap items-center gap-2">
                    <Button tamanho="sm" variante="secundario" onClick={() => setModalSqlSupabase(true)}>
                      Ver SQL
                    </Button>
                    <Button tamanho="sm" variante="suave" onClick={() => void copiarSqlConsolidado()}>
                      Copiar SQL
                    </Button>
                    <Button tamanho="sm" icone="baixar" onClick={baixarArquivoSqlConsolidado}>
                      Baixar .sql único
                    </Button>
                  </div>
                }
              />
              <p className="text-[12px] text-ink-500">
                Também salvo no projeto em <code className="font-mono font-semibold text-ink-700">supabase/ATUALIZAR_SUPABASE_AGORA.sql</code> e{" "}
                <code className="font-mono font-semibold text-ink-700">supabase/migrations/20261104_consolidado_todas_fases.sql</code>. Usa{" "}
                <code className="font-mono">IF NOT EXISTS</code> (pode rodar com segurança mesmo se usuários e caixa já tiverem sido criados).
              </p>
            </Card>
          )}
          {podeConfig && (
            <Card>
              <CardTitulo
                titulo="Migração planejada do legado → nk_*"
                descricao="Importador somente-leitura das tabelas antigas sem prefixo (Supabase) ou de arquivo .json de backup do protótipo"
                icone="entrada"
                acao={
                  <Link href="/migracao">
                    <Button tamanho="sm" icone="entrada">
                      Abrir assistente de migração →
                    </Button>
                  </Link>
                }
              />
              <p className="text-[12px] text-ink-500">
                Simula antes de gravar (Dry-Run), deduplica cadastros por GTIN/SKU/CPF/CNPJ, preserva 100% das tabelas legadas intactas e registra toda execução na trilha de auditoria.
              </p>
            </Card>
          )}
          <PainelDiagnostico />
          <Card>
            <CardTitulo titulo="Estado dos dados" descricao="Contagens por módulo no tenant atual" icone="carteira" />
            <dl className="grid grid-cols-2 gap-2">
              {[
                { r: "Produtos", v: String(ambiente.produtos) },
                { r: "Ativos p/ venda", v: String(ambiente.produtosAtivos) },
                { r: "Documentos", v: String(ambiente.documentos) },
                { r: "DAVs", v: String(ambiente.davs) },
                { r: "Títulos financeiros", v: String(ambiente.contas) },
                { r: "Entradas", v: String(ambiente.entradas) },
              ].map((x) => (
                <div key={x.r} className="rounded-lg bg-ink-50 px-2.5 py-2">
                  <dt className="micro text-ink-400">{x.r}</dt>
                  <dd className="tabular mt-0.5 text-[16px] font-bold text-ink-900">{x.v}</dd>
                </div>
              ))}
            </dl>
            <p className="mt-3 rounded-lg bg-ink-900 px-3 py-2.5 font-mono text-[11px] leading-relaxed text-ink-100">
              faturamento 14d: <b className="text-way-300">{moeda(ambiente.faturamento14d)}</b>
              {"\n"}tabela base: nk_empresa · nk_produto · nk_venda · nk_entrada · nk_conta
              {"\n"}modo: PostgreSQL (multi-tenant por empresa_id) — o localStorage do protótipo virou fila offline no PDV
            </p>
          </Card>

          <Modal
            aberto={modalSqlSupabase}
            aoFechar={() => setModalSqlSupabase(false)}
            titulo="SQL consolidado para o Supabase (todas as fases)"
            descricao="Cole no Supabase → SQL Editor → New query e clique em Run"
            largura="max-w-3xl"
            rodape={
              <div className="flex justify-end gap-2">
                <Button variante="secundario" onClick={() => void copiarSqlConsolidado()}>
                  Copiar tudo
                </Button>
                <Button icone="baixar" onClick={baixarArquivoSqlConsolidado}>
                  Baixar ATUALIZAR_SUPABASE_AGORA.sql
                </Button>
              </div>
            }
          >
            <pre className="max-h-96 overflow-auto rounded-xl bg-ink-900 p-3.5 font-mono text-[11px] leading-relaxed text-ink-100">
              {sqlConsolidado}
            </pre>
          </Modal>
        </div>
      )}
    </>
  );
}
