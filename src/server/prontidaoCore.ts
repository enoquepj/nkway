import { sql, type SQL } from "drizzle-orm";
import { db } from "@/db";
import {
  itemProntidao,
  resumoProntidao,
  type BlocoProntidao,
  type ContagensProntidao,
  type ItemProntidao,
  type ProntidaoDto,
} from "@/lib/prontidao";
import { diagnosticoGatewayServidor } from "./assinaturaGateway";
import { obterPainelDfe } from "./dados";
import { diagnosticoEmissorServidor } from "./emissorFiscalCore";
import { inspecionarFontesLegadas } from "./migracaoLegadoCore";

/**
 * NKWAY — Central de prontidão.
 * Leitura somente. Não altera infraestrutura, não cria tabela, não grava nada,
 * não faz chamada externa e nunca devolve valores de variáveis de ambiente.
 */

async function tentar<T>(promessa: Promise<T>): Promise<T | null> {
  try {
    return await promessa;
  } catch {
    return null;
  }
}

async function contar(consulta: SQL): Promise<number> {
  try {
    const r = await db.execute<{ n: number }>(consulta);
    return Number(r.rows[0]?.n ?? 0) || 0;
  } catch {
    return 0;
  }
}

const fixo = (id: string, titulo: string, descricao: string): ItemProntidao =>
  itemProntidao(id, titulo, descricao, true);

export async function obterProntidao(empresaId: string, empresaNome: string): Promise<ProntidaoDto> {
  const health = (await tentar(db.execute(sql`select 1`))) !== null;
  const dfePainel = await tentar(obterPainelDfe(empresaId));
  const legado = await tentar(inspecionarFontesLegadas(empresaId));
  const gateway = diagnosticoGatewayServidor();
  const emissor = diagnosticoEmissorServidor();

  const segredoForte = (process.env.AUTH_SECRET || "").trim().length >= 32;
  const xmlUrlConfigurada = Boolean((process.env.EMISSOR_FISCAL_XML_URL || "").trim());

  const [documentos, entradas, assinaturas, faturas, tabelasNk, usuariosAtivos] = await Promise.all([
    contar(sql`select count(*)::int as n from nk_venda where empresa_id = ${empresaId}`),
    contar(sql`select count(*)::int as n from nk_entrada where empresa_id = ${empresaId}`),
    contar(sql`select count(*)::int as n from nk_assinatura where empresa_id = ${empresaId}`),
    contar(sql`select count(*)::int as n from nk_assinatura_fatura where empresa_id = ${empresaId}`),
    contar(
      sql`select count(*)::int as n from information_schema.tables where table_schema = 'public' and left(table_name, 3) = 'nk_'`,
    ),
    contar(sql`select count(*)::int as n from nk_usuario where empresa_id = ${empresaId} and ativo = true`),
  ]);

  const contagens: ContagensProntidao = {
    documentos,
    entradas,
    assinaturas,
    faturas,
    tabelasNk,
    tabelasLegadas: legado?.tabelasPresentes ?? 0,
    tabelasLegadasAcessiveis: legado?.tabelasAcessiveis ?? 0,
  };

  const blocos: BlocoProntidao[] = [
    {
      id: "base",
      titulo: "Base pronta",
      descricao: "Next.js, Postgres e isolamento por empresa",
      icone: "painel",
      rota: "/",
      itens: [
        itemProntidao("base-banco", "Banco conectado", "Consulta de verificação respondeu no servidor.", health),
        itemProntidao(
          "base-tabelas",
          "Tabelas nk_* presentes",
          `Esquema Next detectado neste banco (${tabelasNk} tabela(s)).`,
          tabelasNk >= 19,
        ),
        itemProntidao(
          "base-tenant",
          "Tenant por empresa_id",
          "Login próprio em nk_usuario com cookie assinado; leituras filtradas pela empresa.",
          usuariosAtivos > 0,
        ),
        itemProntidao(
          "base-auth",
          "Segredo de sessão forte",
          "Necessário antes de operação comercial; sem ele o sistema usa o segredo local de desenvolvimento.",
          segredoForte,
          { variavel: "AUTH_SECRET", observacao: "Configure no painel da Vercel. Nunca exiba o valor." },
        ),
      ],
    },
    {
      id: "dfe",
      titulo: "DF-e real e Certificado A1",
      descricao: "Captura SEFAZ, manifestação e cofre do certificado",
      icone: "cadeado",
      rota: "/dfe",
      itens: [
        fixo(
          "dfe-modulo",
          "Módulo DF-e implementado",
          "distNSU, consChNFe, manifestação do destinatário e importação para Entrada.",
        ),
        itemProntidao(
          "dfe-certificado",
          "Certificado A1 cadastrado",
          dfePainel?.temCertificado
            ? `A1 registrado (${dfePainel.armazenamentoCert === "bucket" ? "bucket privado" : "cofre criptografado"}).`
            : "Envie o arquivo .pfx/.p12 e a senha na tela DF-e.",
          Boolean(dfePainel?.temCertificado),
          { variavel: "DFE_SECRET" },
        ),
        itemProntidao(
          "dfe-cofre",
          "Cofre AES-256-GCM ativo",
          "A senha do A1 fica cifrada; o .pfx pode usar o cofre quando o bucket não está configurado.",
          Boolean(dfePainel?.temCertificado),
        ),
        itemProntidao(
          "dfe-bucket",
          "Bucket privado certificados-a1",
          "Opcional: sem bucket, o certificado usa o cofre integrado.",
          Boolean(dfePainel?.bucketConfigurado),
          { variavel: "DFE_STORAGE_URL + DFE_STORAGE_SERVICE_KEY", opcionalQuandoFaltar: true },
        ),
        itemProntidao(
          "dfe-worker",
          "Worker mTLS para SEFAZ live",
          "Necessário apenas para captura real em produção fiscal.",
          Boolean(dfePainel?.workerConfigurado),
          { variavel: "DFE_MTLS_WORKER_URL + DFE_MTLS_WORKER_SECRET", opcionalQuandoFaltar: true },
        ),
        itemProntidao(
          "dfe-cron",
          "Segredo do cron /api/dfe/dist",
          "Protege a rota de captura automática a cada 10 minutos.",
          Boolean(dfePainel?.cronSecretConfigurado),
          { variavel: "DFE_CRON_SECRET", opcionalQuandoFaltar: true },
        ),
        itemProntidao(
          "dfe-modo",
          "Modo SEFAZ",
          dfePainel?.modoEfetivo === "live"
            ? "Captura live habilitada com certificado e worker."
            : "Operando em demo/homologação, sem transmissão real.",
          dfePainel?.modoEfetivo === "live",
          { variavel: "DFE_SEFAZ_MODE", opcionalQuandoFaltar: true },
        ),
      ],
    },
    {
      id: "assinatura",
      titulo: "Assinatura com gateway",
      descricao: "Recorrência por CNPJ, faturas e webhook",
      icone: "carteira",
      rota: "/assinatura",
      itens: [
        fixo(
          "assinatura-modulo",
          "Gateway implementado",
          "Asaas v3 ou Stripe, PIX, boleto e cartão recorrente, com Sandbox Homologação.",
        ),
        itemProntidao(
          "assinatura-live",
          "Cobrança live",
          gateway.modoLive
            ? `Provedor ${gateway.provedor} ativo${gateway.provedor === "asaas" ? ` (${gateway.asaasAmbiente})` : ""}.`
            : "Sem chave externa: Sandbox Homologação seguro está ativo.",
          gateway.modoLive,
          { variavel: "ASAAS_API_KEY ou STRIPE_SECRET_KEY", opcionalQuandoFaltar: true },
        ),
        itemProntidao(
          "assinatura-webhook",
          "Webhook autenticado",
          "Liquidação de faturas em /api/assinatura/webhook.",
          gateway.webhookProtegido,
          { variavel: "ASAAS_WEBHOOK_TOKEN ou STRIPE_WEBHOOK_SECRET", opcionalQuandoFaltar: true },
        ),
        itemProntidao(
          "assinatura-dados",
          "Assinaturas registradas",
          `${assinaturas} assinatura(s) e ${faturas} fatura(s) da empresa.`,
          assinaturas > 0,
          { opcionalQuandoFaltar: true },
        ),
      ],
    },
    {
      id: "emissor",
      titulo: "Emissor fiscal de saída",
      descricao: "NF-e/NFC-e 4.00 com pré-validação e contingência",
      icone: "raio",
      rota: "/emissor",
      itens: [
        fixo(
          "emissor-modulo",
          "Pré-validador e contingência",
          "Validação local, fila offline e gravação de XML fiscal na venda.",
        ),
        itemProntidao(
          "emissor-live",
          "Transmissão para provedor",
          emissor.modoLive
            ? `Provedor ${emissor.provedor} configurado.`
            : "Sem provedor externo: emissão local honesta (sem chave/protocolo fictício).",
          emissor.modoLive,
          { variavel: "EMISSOR_FISCAL_URL + EMISSOR_FISCAL_TOKEN", opcionalQuandoFaltar: true },
        ),
        itemProntidao(
          "emissor-webhook",
          "Webhook protegido",
          "Retorno de autorização em /api/fiscal/webhook.",
          emissor.webhookProtegido,
          { variavel: "EMISSOR_WEBHOOK_SECRET", opcionalQuandoFaltar: true },
        ),
        itemProntidao(
          "emissor-xml",
          "URL de consulta de XML",
          "Opcional para buscar o XML autorizado no provedor.",
          xmlUrlConfigurada,
          { variavel: "EMISSOR_FISCAL_XML_URL", opcionalQuandoFaltar: true },
        ),
      ],
    },
    {
      id: "migracao",
      titulo: "Migração planejada do legado",
      descricao: "Somente leitura nas tabelas antigas + Dry-Run",
      icone: "entrada",
      rota: "/migracao",
      itens: [
        fixo(
          "migracao-modulo",
          "Assistente de migração",
          "Simulação por módulo, importação idempotente e auditoria, sem apagar o legado.",
        ),
        itemProntidao(
          "migracao-legado",
          "Tabelas legadas preservadas",
          `${contagens.tabelasLegadas} tabela(s) antiga(s) encontrada(s) neste banco.`,
          contagens.tabelasLegadas > 0,
          { opcionalQuandoFaltar: true, observacao: "Em bancos locais novos pode não haver legado; em produção elas permanecem." },
        ),
        itemProntidao(
          "migracao-leitura",
          "Leitura do legado liberada",
          contagens.tabelasLegadas === 0
            ? "Sem legado para ler neste banco."
            : `${contagens.tabelasLegadasAcessiveis} de ${contagens.tabelasLegadas} tabela(s) acessível(is) para SELECT.`,
          contagens.tabelasLegadas === 0 || contagens.tabelasLegadasAcessiveis === contagens.tabelasLegadas,
          { opcionalQuandoFaltar: true },
        ),
        itemProntidao(
          "migracao-ultima",
          "Importação já executada",
          legado?.ultimaMigracaoEm
            ? "Existe histórico de migração auditado para esta empresa."
            : "Nenhuma importação registrada; faça primeiro a simulação Dry-Run.",
          Boolean(legado?.ultimaMigracaoEm),
          { opcionalQuandoFaltar: true },
        ),
      ],
    },
  ];

  return {
    geradoEm: new Date().toISOString(),
    empresaNome,
    bancoConectado: health,
    resumo: resumoProntidao(blocos),
    contagens,
    blocos,
    legado: {
      empresaEncontrada: Boolean(legado?.empresaLegadaEncontrada),
      faltaPermissaoLeitura: Boolean(legado?.faltaPermissaoLeitura),
      ultimaMigracaoEm: legado?.ultimaMigracaoEm ?? null,
    },
  };
}
