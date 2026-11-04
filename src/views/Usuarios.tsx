"use client";

import { useMemo, useState } from "react";
import {
  Abas,
  Badge,
  BarraFiltros,
  Button,
  Campo,
  Card,
  CardTitulo,
  Chip,
  FiltroMulti,
  FiltroPeriodo,
  FiltroTexto,
  Icon,
  Input,
  Kpi,
  Modal,
  PageHeader,
  Select,
  Vazio,
  useToast,
} from "@/components/ui";
import { Tabela, type Coluna } from "@/components/Tabela";
import { dataBR, dataHoraBR } from "@/lib/dominio";
import { alternarItem, casaTexto, emPeriodo, type Periodo } from "@/lib/filtros";
import {
  CATALOGO_PERMISSOES,
  PERFIS_USUARIO,
  ROTULO_PERFIL,
  rotuloPerfil,
  temPermissao,
  type PerfilUsuario,
} from "@/lib/permissoes";
import {
  alternarStatusUsuario,
  atribuirPerfilUsuario,
  criarUsuario,
  editarUsuario,
} from "@/server/acoes/usuarios";
import type { AuditoriaDto, UsuarioDto } from "@/server/dados";

export function UsuariosView({
  usuarios,
  auditorias,
  usuarioAtual,
  plano,
}: {
  usuarios: UsuarioDto[];
  auditorias: AuditoriaDto[];
  usuarioAtual: { id: string; nome: string; papel: PerfilUsuario };
  plano: { nome: string; limiteUsuarios: number };
}) {
  const toast = useToast();
  const podeGerenciar = temPermissao(usuarioAtual.papel, "usuarios.gerenciar");
  const podeVerAuditoria = temPermissao(usuarioAtual.papel, "auditoria.ver");

  const [aba, setAba] = useState<"usuarios" | "auditoria" | "perfis">(
    podeGerenciar ? "usuarios" : "perfis",
  );
  const [ocupado, setOcupado] = useState(false);

  /* ------------------------------------------------ filtros de usuários */
  const [buscaUsuario, setBuscaUsuario] = useState("");
  const [perfisFiltro, setPerfisFiltro] = useState<string[]>([]);
  const [statusFiltro, setStatusFiltro] = useState<string[]>([]);

  const usuariosFiltrados = useMemo(
    () =>
      usuarios.filter((u) => {
        if (!casaTexto(`${u.nome} ${u.email} ${ROTULO_PERFIL[u.papel].nome}`, buscaUsuario)) return false;
        if (perfisFiltro.length && !perfisFiltro.includes(u.papel)) return false;
        if (statusFiltro.length) {
          const st = u.ativo ? "ativo" : "inativo";
          if (!statusFiltro.includes(st)) return false;
        }
        return true;
      }),
    [usuarios, buscaUsuario, perfisFiltro, statusFiltro],
  );

  /* ----------------------------------------------- modal novo / edição */
  const [modalAberto, setModalAberto] = useState(false);
  const [alvoEdicao, setAlvoEdicao] = useState<UsuarioDto | null>(null);
  const [formNome, setFormNome] = useState("");
  const [formEmail, setFormEmail] = useState("");
  const [formPapel, setFormPapel] = useState<PerfilUsuario>("operador");
  const [formSenha, setFormSenha] = useState("");
  const [formAtivo, setFormAtivo] = useState(true);

  function abrirNovo() {
    setAlvoEdicao(null);
    setFormNome("");
    setFormEmail("");
    setFormPapel("operador");
    setFormSenha("");
    setFormAtivo(true);
    setModalAberto(true);
  }

  function abrirEdicao(u: UsuarioDto) {
    setAlvoEdicao(u);
    setFormNome(u.nome);
    setFormEmail(u.email);
    setFormPapel(u.papel);
    setFormSenha("");
    setFormAtivo(u.ativo);
    setModalAberto(true);
  }

  async function salvarFormulario() {
    setOcupado(true);
    const r = alvoEdicao
      ? await editarUsuario({
          id: alvoEdicao.id,
          nome: formNome,
          email: formEmail,
          papel: formPapel,
          novaSenha: formSenha || undefined,
          ativo: formAtivo,
        })
      : await criarUsuario({
          nome: formNome,
          email: formEmail,
          papel: formPapel,
          senha: formSenha,
          ativo: formAtivo,
        });
    setOcupado(false);
    toast(r.ok ? (r.aviso ?? "Salvo com sucesso.") : r.erro, r.ok ? "ok" : "erro");
    if (r.ok) {
      setModalAberto(false);
      setFormSenha("");
    }
  }

  /* ----------------------------------------------- filtros de auditoria */
  const [buscaAud, setBuscaAud] = useState("");
  const [periodoAud, setPeriodoAud] = useState<Periodo>({ inicio: "", fim: "" });
  const [entidadesAud, setEntidadesAud] = useState<string[]>([]);
  const [autoresAud, setAutoresAud] = useState<string[]>([]);
  const [detalheAud, setDetalheAud] = useState<AuditoriaDto | null>(null);

  const auditoriasFiltradas = useMemo(
    () =>
      auditorias.filter((a) => {
        if (!casaTexto(`${a.usuarioNome} ${a.acao} ${a.entidade} ${a.registroId} ${a.resumo}`, buscaAud)) return false;
        if ((periodoAud.inicio || periodoAud.fim) && !emPeriodo(a.criadoEm, periodoAud)) return false;
        if (entidadesAud.length && !entidadesAud.includes(a.entidade)) return false;
        if (autoresAud.length && !autoresAud.includes(a.usuarioNome)) return false;
        return true;
      }),
    [auditorias, buscaAud, periodoAud, entidadesAud, autoresAud],
  );

  const ativosCount = usuarios.filter((u) => u.ativo).length;
  const inativosCount = usuarios.length - ativosCount;
  const adminsCount = usuarios.filter((u) => u.ativo && u.papel === "administrador").length;
  const gerentesCount = usuarios.filter((u) => u.ativo && u.papel === "gerente").length;
  const operadoresCount = usuarios.filter((u) => u.ativo && u.papel === "operador").length;
  const vendedoresCount = usuarios.filter((u) => u.ativo && u.papel === "vendedor").length;

  const colunasUsuarios: Coluna<UsuarioDto>[] = [
    {
      id: "nome",
      rotulo: "Usuário",
      valor: (u) => u.nome,
      render: (u) => (
        <div className="flex items-center gap-2.5">
          <span className="grid size-8 shrink-0 place-items-center rounded-lg bg-ink-100 text-[11.5px] font-bold text-ink-700">
            {u.nome.slice(0, 2).toUpperCase()}
          </span>
          <div className="min-w-0">
            <p className="truncate text-[12.5px] font-semibold text-ink-900">
              {u.nome}
              {u.id === usuarioAtual.id && (
                <span className="ml-1.5 text-[10.5px] font-normal text-way-600">(você)</span>
              )}
            </p>
            <p className="truncate font-mono text-[11px] text-ink-400">{u.email}</p>
          </div>
        </div>
      ),
    },
    {
      id: "papel",
      rotulo: "Perfil de acesso",
      valor: (u) => ROTULO_PERFIL[u.papel].nome,
      largura: "190px",
      render: (u) =>
        podeGerenciar ? (
          <Select
            valor={u.papel}
            aoMudar={async (novo) => {
              if (novo === u.papel) return;
              setOcupado(true);
              const r = await atribuirPerfilUsuario({ id: u.id, papel: novo });
              setOcupado(false);
              toast(r.ok ? (r.aviso ?? "Perfil atualizado.") : r.erro, r.ok ? "ok" : "erro");
            }}
            opcoes={PERFIS_USUARIO.map((p) => ({ valor: p, rotulo: ROTULO_PERFIL[p].nome }))}
          />
        ) : (
          <Badge tom={ROTULO_PERFIL[u.papel].tom}>{ROTULO_PERFIL[u.papel].nome}</Badge>
        ),
    },
    {
      id: "status",
      rotulo: "Situação",
      alinhar: "centro",
      largura: "110px",
      valor: (u) => (u.ativo ? "Ativo" : "Inativo"),
      render: (u) => <Badge tom={u.ativo ? "ok" : "erro"}>{u.ativo ? "Ativo" : "Inativo"}</Badge>,
    },
    {
      id: "criado",
      rotulo: "Cadastro",
      largura: "120px",
      valor: (u) => u.criadoEm,
      render: (u) => <span className="text-[12px] text-ink-500">{dataBR(u.criadoEm)}</span>,
    },
    {
      id: "acoes",
      rotulo: "",
      alinhar: "direita",
      ocultoNoCsv: true,
      render: (u) =>
        podeGerenciar ? (
          <div className="flex items-center justify-end gap-1.5">
            <Button tamanho="sm" variante="secundario" onClick={() => abrirEdicao(u)}>
              Editar
            </Button>
            {u.id !== usuarioAtual.id && (
              <Button
                tamanho="sm"
                variante={u.ativo ? "fantasma" : "suave"}
                disabled={ocupado}
                onClick={async () => {
                  setOcupado(true);
                  const r = await alternarStatusUsuario({ id: u.id, ativo: !u.ativo });
                  setOcupado(false);
                  toast(r.ok ? (r.aviso ?? "Status atualizado.") : r.erro, r.ok ? "ok" : "erro");
                }}
              >
                {u.ativo ? "Desativar" : "Ativar"}
              </Button>
            )}
          </div>
        ) : null,
    },
  ];

  const colunasAuditoria: Coluna<AuditoriaDto>[] = [
    {
      id: "data",
      rotulo: "Data / hora",
      largura: "148px",
      valor: (a) => a.criadoEm,
      render: (a) => <span className="tabular text-[12px] text-ink-600">{dataHoraBR(a.criadoEm)}</span>,
    },
    {
      id: "usuario",
      rotulo: "Usuário",
      largura: "170px",
      valor: (a) => a.usuarioNome,
      render: (a) => (
        <div className="min-w-0">
          <p className="truncate text-[12.5px] font-semibold text-ink-800">{a.usuarioNome || "Sistema"}</p>
          <p className="text-[10.5px] text-ink-400">{rotuloPerfil(a.usuarioPapel)}</p>
        </div>
      ),
    },
    {
      id: "acao",
      rotulo: "Ação / Módulo",
      largura: "180px",
      valor: (a) => a.acao,
      render: (a) => (
        <div>
          <Badge tom="info" mono>
            {a.acao}
          </Badge>
          <span className="mt-0.5 block text-[10.5px] text-ink-400">entidade: {a.entidade}</span>
        </div>
      ),
    },
    {
      id: "resumo",
      rotulo: "Alteração registrada",
      valor: (a) => a.resumo,
      render: (a) => (
        <div className="min-w-0">
          <p className="truncate text-[12.5px] text-ink-800">{a.resumo}</p>
          {a.registroId && (
            <p className="truncate font-mono text-[10px] text-ink-400">registro: {a.registroId}</p>
          )}
        </div>
      ),
    },
    {
      id: "detalhe",
      rotulo: "",
      alinhar: "direita",
      largura: "90px",
      ocultoNoCsv: true,
      render: (a) => (
        <Button tamanho="sm" variante="secundario" onClick={() => setDetalheAud(a)}>
          Detalhes
        </Button>
      ),
    },
  ];

  const entidadesUnicas = [...new Set(auditorias.map((a) => a.entidade))].filter(Boolean).sort();
  const autoresUnicos = [...new Set(auditorias.map((a) => a.usuarioNome))].filter(Boolean).sort();

  const gruposPermissoes = useMemo(() => {
    const mapa = new Map<string, typeof CATALOGO_PERMISSOES>();
    for (const item of CATALOGO_PERMISSOES) {
      const lista = mapa.get(item.grupo) ?? [];
      lista.push(item);
      mapa.set(item.grupo, lista);
    }
    return [...mapa.entries()];
  }, []);

  return (
    <div className="space-y-4">
      <PageHeader
        titulo="Usuários, perfis e auditoria"
        subtitulo="Controle de acessos da empresa, atribuição de perfis por ação e trilha completa de auditoria"
        etiquetas={
          <>
            <Badge tom={ROTULO_PERFIL[usuarioAtual.papel].tom}>
              Seu perfil: {ROTULO_PERFIL[usuarioAtual.papel].nome}
            </Badge>
            <Badge tom="neutro">
              Plano {plano.nome}: {ativosCount}/{plano.limiteUsuarios} ativo(s)
            </Badge>
          </>
        }
        acao={
          podeGerenciar ? (
            <Button icone="mais" onClick={abrirNovo}>
              Novo usuário
            </Button>
          ) : undefined
        }
      />

      <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
        <Kpi
          rotulo="Usuários ativos"
          valor={`${ativosCount} / ${plano.limiteUsuarios}`}
          detalhe={inativosCount > 0 ? `${inativosCount} inativo(s)` : "todos os cadastros ativos"}
          tom="ok"
          icone="pessoas"
          barra={plano.limiteUsuarios > 0 ? (ativosCount / plano.limiteUsuarios) * 100 : 0}
        />
        <Kpi
          rotulo="Administradores"
          valor={String(adminsCount)}
          detalhe="gestão total e reabertura de caixa"
          tom="ok"
          icone="cadeado"
        />
        <Kpi
          rotulo="Equipe operacional"
          valor={`${gerentesCount} ger · ${operadoresCount} op · ${vendedoresCount} vend`}
          detalhe="gerência, frente de caixa e pré-venda"
          tom="info"
          icone="caixa"
        />
        <Kpi
          rotulo="Eventos auditados"
          valor={podeVerAuditoria ? String(auditorias.length) : "Restrito"}
          detalhe={podeVerAuditoria ? "histórico multi-tenant da empresa" : "visível para Administradores"}
          tom="roxo"
          icone="documento"
        />
      </div>

      <Abas
        atual={aba}
        aoTrocar={(v) => setAba(v as "usuarios" | "auditoria" | "perfis")}
        abas={[
          ...(podeGerenciar
            ? [{ id: "usuarios", rotulo: "Usuários cadastrados", contagem: usuarios.length }]
            : []),
          ...(podeVerAuditoria
            ? [{ id: "auditoria", rotulo: "Trilha de auditoria", contagem: auditorias.length }]
            : []),
          { id: "perfis", rotulo: "Matriz de permissões" },
        ]}
      />

      {aba === "usuarios" && (
        podeGerenciar ? (
          <div className="space-y-3">
            <BarraFiltros>
              <FiltroTexto
                rotulo="Buscar nome ou e-mail"
                valor={buscaUsuario}
                aoMudar={setBuscaUsuario}
                placeholder="Ex.: Ana, caixa2@..."
                largura="w-64"
              />
              <FiltroMulti
                rotulo="Perfil"
                selecionados={perfisFiltro}
                aoAlternar={(v) => setPerfisFiltro(alternarItem(perfisFiltro, v))}
                opcoes={PERFIS_USUARIO.map((p) => ({
                  valor: p,
                  rotulo: ROTULO_PERFIL[p].nome,
                  contagem: usuarios.filter((u) => u.papel === p).length,
                }))}
              />
              <FiltroMulti
                rotulo="Situação"
                selecionados={statusFiltro}
                aoAlternar={(v) => setStatusFiltro(alternarItem(statusFiltro, v))}
                opcoes={[
                  { valor: "ativo", rotulo: "Ativos", contagem: ativosCount },
                  { valor: "inativo", rotulo: "Inativos", contagem: inativosCount },
                ]}
              />
              {(buscaUsuario || perfisFiltro.length > 0 || statusFiltro.length > 0) && (
                <Button
                  tamanho="sm"
                  variante="fantasma"
                  onClick={() => {
                    setBuscaUsuario("");
                    setPerfisFiltro([]);
                    setStatusFiltro([]);
                  }}
                >
                  Limpar filtros
                </Button>
              )}
            </BarraFiltros>

            <Tabela
              colunas={colunasUsuarios}
              linhas={usuariosFiltrados}
              chave={(u) => u.id}
              nomeExportar="nkway-usuarios"
              vazio="Nenhum usuário encontrado com os filtros selecionados."
            />
          </div>
        ) : (
          <Vazio>Apenas usuários com perfil Administrador podem gerenciar os acessos da empresa.</Vazio>
        )
      )}

      {aba === "auditoria" && (
        podeVerAuditoria ? (
          <div className="space-y-3">
            <BarraFiltros>
              <FiltroTexto
                rotulo="Buscar ação, usuário ou registro"
                valor={buscaAud}
                aoMudar={setBuscaAud}
                placeholder="Ex.: usuario.criar, caixa.fechar, xml..."
                largura="w-64"
              />
              <FiltroPeriodo rotulo="Período" valor={periodoAud} aoMudar={setPeriodoAud} />
              <FiltroMulti
                rotulo="Entidade"
                selecionados={entidadesAud}
                aoAlternar={(v) => setEntidadesAud(alternarItem(entidadesAud, v))}
                opcoes={entidadesUnicas.map((e) => ({
                  valor: e,
                  rotulo: e,
                  contagem: auditorias.filter((a) => a.entidade === e).length,
                }))}
              />
              <FiltroMulti
                rotulo="Usuário"
                selecionados={autoresAud}
                aoAlternar={(v) => setAutoresAud(alternarItem(autoresAud, v))}
                opcoes={autoresUnicos.map((u) => ({
                  valor: u,
                  rotulo: u,
                  contagem: auditorias.filter((a) => a.usuarioNome === u).length,
                }))}
              />
              {(buscaAud || periodoAud.inicio || periodoAud.fim || entidadesAud.length > 0 || autoresAud.length > 0) && (
                <Button
                  tamanho="sm"
                  variante="fantasma"
                  onClick={() => {
                    setBuscaAud("");
                    setPeriodoAud({ inicio: "", fim: "" });
                    setEntidadesAud([]);
                    setAutoresAud([]);
                  }}
                >
                  Limpar
                </Button>
              )}
            </BarraFiltros>

            {(buscaAud || entidadesAud.length > 0 || autoresAud.length > 0) && (
              <div className="flex flex-wrap gap-1.5">
                {buscaAud && <Chip onClick={() => setBuscaAud("")}>busca: {buscaAud}</Chip>}
                {entidadesAud.map((e) => (
                  <Chip key={e} onClick={() => setEntidadesAud(entidadesAud.filter((x) => x !== e))}>
                    entidade: {e}
                  </Chip>
                ))}
                {autoresAud.map((u) => (
                  <Chip key={u} onClick={() => setAutoresAud(autoresAud.filter((x) => x !== u))}>
                    autor: {u}
                  </Chip>
                ))}
              </div>
            )}

            <Tabela
              colunas={colunasAuditoria}
              linhas={auditoriasFiltradas}
              chave={(a) => a.id}
              nomeExportar="nkway-auditoria"
              tamanhoPagina={20}
              vazio="Nenhum evento de auditoria encontrado para os filtros aplicados."
            />
          </div>
        ) : (
          <Vazio>A trilha completa de auditoria é restrita ao perfil Administrador.</Vazio>
        )
      )}

      {aba === "perfis" && (
        <div className="space-y-4">
          <div className="grid gap-3 md:grid-cols-3">
            {PERFIS_USUARIO.map((p) => {
              const info = ROTULO_PERFIL[p];
              return (
                <Card key={p}>
                  <div className="flex items-center justify-between">
                    <h3 className="text-[14px] font-bold text-ink-900">{info.nome}</h3>
                    <Badge tom={info.tom}>{p}</Badge>
                  </div>
                  <p className="mt-1.5 text-[12px] leading-relaxed text-ink-500">{info.descricao}</p>
                </Card>
              );
            })}
          </div>

          <Card padding={false}>
            <div className="p-4 pb-2">
              <CardTitulo
                titulo="Permissões por ação validadas no backend e na interface"
                descricao="Toda Server Action verifica o perfil do usuário autenticado e o vínculo com a empresa"
                icone="cadeado"
              />
            </div>
            <div className="overflow-x-auto">
              <table className="w-full text-left text-[12.5px]">
                <thead className="border-y border-ink-100 bg-ink-50/70 text-[11px] uppercase text-ink-400">
                  <tr>
                    <th className="px-4 py-2.5">Módulo / Ação</th>
                    <th className="px-4 py-2.5 text-center">Administrador</th>
                    <th className="px-4 py-2.5 text-center">Operador</th>
                    <th className="px-4 py-2.5 text-center">Vendedor</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-ink-50">
                  {gruposPermissoes.flatMap(([grupo, itens]) => [
                    <tr key={`g-${grupo}`} className="bg-ink-50/40">
                      <td colSpan={4} className="px-4 py-1.5 text-[11px] font-bold uppercase tracking-wider text-ink-500">
                        {grupo}
                      </td>
                    </tr>,
                    ...itens.map((item) => (
                      <tr key={item.acao} className="hover:bg-ink-50/40">
                        <td className="px-4 py-2">
                          <span className="font-medium text-ink-800">{item.rotulo}</span>
                          <span className="ml-2 font-mono text-[10.5px] text-ink-400">{item.acao}</span>
                        </td>
                        {PERFIS_USUARIO.map((perfil) => {
                          const ok = temPermissao(perfil, item.acao);
                          return (
                            <td key={perfil} className="px-4 py-2 text-center">
                              {ok ? (
                                <span className="inline-grid size-5 place-items-center rounded-full bg-way-50 text-way-700">
                                  <Icon name="check" className="size-3.5" strokeWidth={2.8} />
                                </span>
                              ) : (
                                <span className="text-ink-300">—</span>
                              )}
                            </td>
                          );
                        })}
                      </tr>
                    )),
                  ])}
                </tbody>
              </table>
            </div>
          </Card>
        </div>
      )}

      {/* Modal: Criar / Editar Usuário */}
      <Modal
        aberto={modalAberto}
        aoFechar={() => setModalAberto(false)}
        titulo={alvoEdicao ? `Editar usuário · ${alvoEdicao.nome}` : "Cadastrar novo usuário"}
        descricao="A senha é protegida por hash criptográfico — nunca é armazenada nem exibida em texto puro"
        largura="max-w-lg"
        rodape={
          <div className="flex justify-end gap-2">
            <Button variante="secundario" onClick={() => setModalAberto(false)}>
              Cancelar
            </Button>
            <Button icone="check" disabled={ocupado} onClick={salvarFormulario}>
              {ocupado ? "Salvando…" : alvoEdicao ? "Salvar alterações" : "Criar usuário"}
            </Button>
          </div>
        }
      >
        <div className="space-y-3">
          <Campo rotulo="Nome completo" obrigatorio>
            <Input valor={formNome} aoMudar={setFormNome} placeholder="Ex.: Marcos Oliveira" />
          </Campo>
          <Campo rotulo="E-mail de login" obrigatorio>
            <Input valor={formEmail} aoMudar={setFormEmail} placeholder="marcos@loja.com.br" />
          </Campo>
          <div className="grid gap-3 sm:grid-cols-2">
            <Campo rotulo="Perfil de acesso" obrigatorio>
              <Select
                valor={formPapel}
                aoMudar={(v) => setFormPapel(v as PerfilUsuario)}
                opcoes={PERFIS_USUARIO.map((p) => ({ valor: p, rotulo: ROTULO_PERFIL[p].nome }))}
              />
            </Campo>
            <Campo rotulo="Status da conta">
              <Select
                valor={formAtivo ? "ativo" : "inativo"}
                aoMudar={(v) => setFormAtivo(v === "ativo")}
                opcoes={[
                  { valor: "ativo", rotulo: "Ativo (acesso liberado)" },
                  { valor: "inativo", rotulo: "Inativo (acesso bloqueado)" },
                ]}
              />
            </Campo>
          </div>
          <Campo
            rotulo={alvoEdicao ? "Redefinir senha (deixe em branco para manter a atual)" : "Senha inicial (mín. 6 caracteres)"}
            obrigatorio={!alvoEdicao}
          >
            <Input
              type="password"
              valor={formSenha}
              aoMudar={setFormSenha}
              placeholder={alvoEdicao ? "Nova senha opcional" : "Mínimo 6 caracteres"}
            />
          </Campo>
          <p className="rounded-lg bg-ink-50 px-3 py-2 text-[11.5px] text-ink-500">
            <b>{ROTULO_PERFIL[formPapel].nome}:</b> {ROTULO_PERFIL[formPapel].descricao}
          </p>
        </div>
      </Modal>

      {/* Modal: Detalhe do Evento de Auditoria */}
      <Modal
        aberto={Boolean(detalheAud)}
        aoFechar={() => setDetalheAud(null)}
        titulo={detalheAud ? `Auditoria · ${detalheAud.acao}` : "Auditoria"}
        descricao={detalheAud ? `${dataHoraBR(detalheAud.criadoEm)} · ${detalheAud.usuarioNome}` : ""}
        largura="max-w-2xl"
        rodape={
          <Button variante="secundario" onClick={() => setDetalheAud(null)}>
            Fechar
          </Button>
        }
      >
        {detalheAud && (
          <div className="space-y-3 text-[12.5px]">
            <div className="grid gap-2 rounded-xl bg-ink-50 p-3 sm:grid-cols-2">
              <div>
                <span className="micro block text-ink-400">Usuário / Perfil</span>
                <b className="text-ink-900">
                  {detalheAud.usuarioNome} ({rotuloPerfil(detalheAud.usuarioPapel)})
                </b>
              </div>
              <div>
                <span className="micro block text-ink-400">Data e Hora</span>
                <b className="tabular text-ink-900">{dataHoraBR(detalheAud.criadoEm)}</b>
              </div>
              <div>
                <span className="micro block text-ink-400">Entidade / Registro</span>
                <b className="font-mono text-[11.5px] text-ink-800">
                  {detalheAud.entidade} {detalheAud.registroId ? `· ${detalheAud.registroId}` : ""}
                </b>
              </div>
              <div>
                <span className="micro block text-ink-400">Código da Ação</span>
                <b className="font-mono text-[11.5px] text-way-700">{detalheAud.acao}</b>
              </div>
            </div>
            <div>
              <span className="micro mb-1 block text-ink-400">Resumo</span>
              <p className="rounded-lg border border-ink-100 px-3 py-2 text-ink-800">{detalheAud.resumo}</p>
            </div>
            <div>
              <span className="micro mb-1 block text-ink-400">Alterações relevantes (JSON sanitizado)</span>
              <pre className="max-h-72 overflow-auto rounded-xl bg-ink-900 p-3.5 font-mono text-[11px] leading-relaxed text-ink-100">
                {JSON.stringify(detalheAud.alteracoes ?? {}, null, 2)}
              </pre>
            </div>
          </div>
        )}
      </Modal>
    </div>
  );
}
