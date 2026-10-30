"use client";

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
  PageHeader,
  Select,
  cn,
  useToast,
} from "@/components/ui";
import { PLANOS_CFG, UFS, dataBR, moeda } from "@/lib/dominio";
import { alterarPlano, criarOperador, removerOperador, salvarEmpresa, salvarFiscal } from "@/server/acoes/config";
import { trocarSenha } from "@/server/acoes/auth";

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
  plano,
  equipe,
  usuarioAtual,
  ambiente,
}: {
  empresa: EmpresaCfg;
  fiscal: FiscalCfg;
  plano: { id: string; nome: string; preco: number; limiteProdutos: number; limiteUsuarios: number };
  equipe: { id: string; nome: string; email: string; papel: string }[];
  usuarioAtual: string;
  ambiente: { produtos: number; produtosAtivos: number; documentos: number; davs: number; contas: number; entradas: number; entradasPendentes: number; faturamento14d: number };
}) {
  const toast = useToast();
  const [aba, setAba] = useState("empresa");
  const [e, setE] = useState(empresa);
  const [f, setF] = useState(fiscal);
  const [novoOp, setNovoOp] = useState({ nome: "", email: "", senha: "" });
  const [senha, setSenha] = useState("");
  const [ocupado, setOcupado] = useState(false);
  const [erro, setErro] = useState("");

  const checks = [
    { r: "Banco PostgreSQL conectado", ok: true, d: "Drizzle · schema nk_* aplicado" },
    { r: "Empresa e usuário logado", ok: true, d: `${e.nome} · ${equipe.length} acesso(s)` },
    { r: "Catálogo carregado", ok: ambiente.produtosAtivos > 0, d: `${ambiente.produtosAtivos} produto(s) ativos de ${ambiente.produtosAtivos + (ambiente.produtos - ambiente.produtosAtivos)} cadastrados` },
    { r: "Entradas aguardando tratamento", ok: ambiente.entradasPendentes === 0, d: ambiente.entradasPendentes ? `${ambiente.entradasPendentes} entrada(s) na fila de conferência` : "nenhuma pendência de recebimento" },
    { r: "Documentos emitidos", ok: ambiente.documentos > 0, d: `${ambiente.documentos} documento(s) · ${ambiente.davs} DAV(s)` },
    { r: "Financeiro com títulos", ok: ambiente.contas > 0, d: `${ambiente.contas} lançamento(s) entre pagar e receber` },
  ];

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
              disabled={ocupado}
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
                disabled={ocupado}
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
                  Upload do .pfx
                </p>
                <p className="mt-1 text-[11.5px] leading-snug text-ink-400">
                  O arquivo e a senha não são armazenados aqui: no roteiro do repositório eles vão para o bucket privado
                  <b> certificados-a1</b> e o worker mTLS usa <b>DFE_SECRET</b>. Siga supabase/DFE_ROTEIRO_CONFIG.md (fases 3 a 8).
                </p>
                <p className="mt-2">
                  <Badge tom={f.certificadoValidade && new Date(f.certificadoValidade) < new Date() ? "erro" : "ok"}>
                    {f.certificadoValidade ? `validade registrada: ${dataBR(f.certificadoValidade)}` : "nenhum certificado registrado"}
                  </Badge>
                </p>
              </div>
            </div>
          </Card>
        </div>
      )}

      {aba === "plano" && (
        <div className="space-y-4">
          <Card>
            <CardTitulo
              titulo={`Plano atual: ${plano.nome}`}
              descricao={`limites em uso — ${ambiente.produtosAtivos}/${plano.limiteProdutos} produtos ativos · ${equipe.length}/${plano.limiteUsuarios} acesso(s)`}
              icone="raio"
              acao={<Badge tom={plano.preco > 0 ? "ok" : "neutro"}>{plano.preco > 0 ? `${moeda(plano.preco)}/mês` : "gratuito"}</Badge>}
            />
            <div className="grid gap-3 md:grid-cols-3">
              {PLANOS_CFG.map((p) => {
                const atual = p.id === plano.id;
                return (
                  <div key={p.id} className={cn("rounded-xl border p-3.5 transition", atual ? "border-way-300 bg-way-50/60 ring-1 ring-way-100" : "border-ink-100 bg-white")}>
                    <p className="text-[13.5px] font-bold text-ink-900">{p.nome}</p>
                    <p className="tabular mt-0.5 text-[22px] font-black leading-none text-ink-900">
                      {p.preco === 0 ? "R$ 0" : moeda(p.preco)}
                      <span className="text-[11px] font-semibold text-ink-400">/mês</span>
                    </p>
                    <ul className="mt-2.5 space-y-1 text-[11.5px] text-ink-500">
                      {p.recursos.map((r) => (
                        <li key={r} className="flex items-start gap-1.5">
                          <Icon name="check" className="mt-0.5 size-3 shrink-0 text-way-600" strokeWidth={2.6} />
                          {r}
                        </li>
                      ))}
                    </ul>
                    <p className="mt-2 text-[10.5px] text-ink-400">
                      até {p.limiteProdutos.toLocaleString("pt-BR")} produtos · {p.limiteUsuarios} terminal(is)
                    </p>
                    <Button
                      className="mt-3 w-full"
                      variante={atual ? "secundario" : "primario"}
                      disabled={atual || ocupado}
                      onClick={async () => {
                        setOcupado(true);
                        const r = await alterarPlano(p.id);
                        setOcupado(false);
                        toast(r.ok ? (r.aviso ?? "Plano atualizado.") : r.erro, r.ok ? "ok" : "erro");
                      }}
                    >
                      {atual ? "Plano ativo" : p.preco === 0 ? "Voltar ao gratuito" : "Assinar"}
                    </Button>
                  </div>
                );
              })}
            </div>
            <p className="mt-3 text-[11.5px] leading-snug text-ink-400">
              A cobrança recorrente é simulada neste ambiente. Para produção, integre o gateway de assinatura (recorrência por CNPJ) e
              mantenha o bloqueio por limites de produtos/terminais — a estrutura de planos já está no banco (nk_empresa.plano).
            </p>
          </Card>
        </div>
      )}

      {aba === "equipe" && (
        <div className="grid gap-4 lg:grid-cols-2">
          <Card padding={false}>
            <div className="p-4 pb-2">
              <CardTitulo titulo="Acessos da empresa" descricao="Cada operador entra com e-mail e senha próprios — o caixa fica registrado na nota" icone="pessoas" />
            </div>
            <ul className="divide-y divide-ink-50">
              {equipe.map((u) => (
                <li key={u.id} className="flex items-center gap-3 px-4 py-2.5">
                  <span className="grid size-8 place-items-center rounded-lg bg-ink-100 text-[12px] font-bold text-ink-600">{u.nome.slice(0, 2).toUpperCase()}</span>
                  <div className="min-w-0 flex-1">
                    <p className="truncate text-[12.5px] font-semibold text-ink-900">{u.nome}</p>
                    <p className="truncate text-[11px] text-ink-400">{u.email}</p>
                  </div>
                  <Badge tom={u.papel === "owner" ? "ok" : "neutro"}>{u.papel === "owner" ? "proprietário" : "operador"}</Badge>
                  {u.id !== usuarioAtual && (
                    <button
                      type="button"
                      onClick={async () => {
                        const r = await removerOperador(u.id);
                        toast(r.ok ? "Acesso removido." : r.erro, r.ok ? "ok" : "erro");
                      }}
                      className="rounded-md p-1 text-ink-300 hover:bg-rose-50 hover:text-rose-600"
                    >
                      <Icon name="lixo" className="size-4" />
                    </button>
                  )}
                </li>
              ))}
            </ul>
          </Card>
          <Card>
            <CardTitulo titulo="Novo operador" descricao="Liberar um terminal de caixa" icone="mais" />
            {erro && <p className="mb-2 rounded-lg bg-rose-50 px-2.5 py-2 text-[12px] font-medium text-rose-700">{erro}</p>}
            <div className="space-y-3">
              <Campo rotulo="Nome">
                <Input valor={novoOp.nome} aoMudar={(v) => setNovoOp({ ...novoOp, nome: v })} placeholder="Caixa 2" />
              </Campo>
              <Campo rotulo="E-mail" obrigatorio>
                <Input valor={novoOp.email} aoMudar={(v) => setNovoOp({ ...novoOp, email: v })} placeholder="caixa2@loja.com.br" />
              </Campo>
              <Campo rotulo="Senha inicial" obrigatorio>
                <Input type="password" valor={novoOp.senha} aoMudar={(v) => setNovoOp({ ...novoOp, senha: v })} />
              </Campo>
              <Button
                className="w-full"
                disabled={ocupado}
                onClick={async () => {
                  setErro("");
                  setOcupado(true);
                  const r = await criarOperador(novoOp);
                  setOcupado(false);
                  if (!r.ok) return setErro(r.erro);
                  toast(r.aviso ?? "Operador criado.");
                  setNovoOp({ nome: "", email: "", senha: "" });
                }}
              >
                Criar acesso
              </Button>
            </div>
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
        <div className="grid gap-4 lg:grid-cols-[1.1fr_1fr]">
          <Card>
            <CardTitulo titulo="Diagnóstico do ambiente" descricao="Verificações rápidas de integridade (o console do dev do protótipo virou esta aba)" icone="raio" />
            <ul className="space-y-1.5">
              {checks.map((c) => (
                <li key={c.r} className={cn("flex items-start gap-2.5 rounded-lg px-2.5 py-2", c.ok ? "bg-way-50/60" : "bg-amber-50/70")}>
                  <span className={cn("mt-0.5 grid size-5 shrink-0 place-items-center rounded-full", c.ok ? "bg-way-600 text-white" : "bg-signal-500 text-white")}>
                    <Icon name={c.ok ? "check" : "alerta"} className="size-3" strokeWidth={2.6} />
                  </span>
                  <div className="min-w-0">
                    <p className="text-[12.5px] font-semibold text-ink-800">{c.r}</p>
                    <p className="text-[11px] text-ink-400">{c.d}</p>
                  </div>
                </li>
              ))}
            </ul>
          </Card>
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
        </div>
      )}
    </>
  );
}
