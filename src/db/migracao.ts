import { sql } from "drizzle-orm";
import { db } from "@/db";

let aplicado = false;

/**
 * Garante de forma idempotente e aditiva as colunas/tabelas novas das Fases 1, 2 e 3
 * sem apagar nenhum dado cadastrado e sem tocar nas tabelas legadas.
 */
export async function garantirMigracoesNk() {
  if (aplicado) return;
  await db.execute(sql`
    alter table nk_usuario
      add column if not exists ativo boolean not null default true,
      add column if not exists atualizado_em timestamptz default now()
  `);
  await db.execute(sql`create index if not exists nk_usuario_empresa_idx on nk_usuario (empresa_id)`);
  await db.execute(sql`
    create table if not exists nk_auditoria (
      id uuid primary key default gen_random_uuid(),
      empresa_id uuid not null references nk_empresa (id) on delete cascade,
      usuario_id uuid,
      usuario_nome text not null default '',
      usuario_papel text not null default '',
      acao text not null,
      entidade text not null,
      registro_id text not null default '',
      resumo text not null default '',
      alteracoes jsonb default '{}'::jsonb,
      created_at timestamptz default now()
    )
  `);
  await db.execute(sql`create index if not exists nk_auditoria_empresa_data_idx on nk_auditoria (empresa_id, created_at)`);
  await db.execute(sql`create index if not exists nk_auditoria_empresa_acao_idx on nk_auditoria (empresa_id, acao)`);

  // Fase 2, Fase 3 e Emissor Fiscal — Vínculos de caixa, XML real e rastreamento SEFAZ em nk_venda
  await db.execute(sql`
    alter table nk_venda
      add column if not exists operador_id uuid,
      add column if not exists caixa_sessao_id uuid,
      add column if not exists xml_fiscal text,
      add column if not exists status_sefaz text default 'simulado',
      add column if not exists cstat_sefaz text default '100',
      add column if not exists motivo_sefaz text default '',
      add column if not exists emissor_provedor text default 'local',
      add column if not exists situacao_fiscal text,
      add column if not exists protocolo_origem text,
      add column if not exists status_comercial text
  `);
  await db.execute(sql`create index if not exists nk_venda_status_sefaz_idx on nk_venda (empresa_id, status_sefaz)`);
  await db.execute(sql`create index if not exists nk_venda_situacao_fiscal_idx on nk_venda (empresa_id, situacao_fiscal)`);
  await db.execute(sql`create index if not exists nk_venda_caixa_sessao_idx on nk_venda (caixa_sessao_id)`);
  await db.execute(sql`
    create table if not exists nk_caixa_sessao (
      id uuid primary key default gen_random_uuid(),
      empresa_id uuid not null references nk_empresa (id) on delete cascade,
      numero integer not null,
      terminal text not null default 'CAIXA 1',
      operador_id uuid not null references nk_usuario (id),
      operador_nome text not null,
      status text not null default 'aberto',
      saldo_inicial numeric(12, 2) not null default 0,
      valores_esperados jsonb default '{}'::jsonb,
      valores_informados jsonb default '{}'::jsonb,
      diferencas jsonb default '{}'::jsonb,
      total_esperado numeric(12, 2) not null default 0,
      total_informado numeric(12, 2) not null default 0,
      diferenca_total numeric(12, 2) not null default 0,
      observacao_abertura text default '',
      justificativa_fechamento text default '',
      aberto_em timestamptz default now(),
      fechado_em timestamptz,
      fechado_por_id uuid,
      fechado_por_nome text default '',
      reaberto_em timestamptz,
      reaberto_por_nome text default '',
      justificativa_reabertura text default ''
    )
  `);
  await db.execute(sql`create index if not exists nk_caixa_sessao_empresa_idx on nk_caixa_sessao (empresa_id, aberto_em)`);
  await db.execute(sql`create index if not exists nk_caixa_sessao_operador_idx on nk_caixa_sessao (empresa_id, operador_id, status)`);
  await db.execute(sql`
    create unique index if not exists nk_caixa_sessao_operador_aberto_uidx
      on nk_caixa_sessao (empresa_id, operador_id)
      where status = 'aberto'
  `);
  await db.execute(sql`
    create table if not exists nk_caixa_movimento (
      id uuid primary key default gen_random_uuid(),
      empresa_id uuid not null references nk_empresa (id) on delete cascade,
      sessao_id uuid not null references nk_caixa_sessao (id) on delete cascade,
      tipo text not null,
      forma text not null default 'dinheiro',
      valor numeric(12, 2) not null default 0,
      motivo text not null default '',
      venda_id uuid,
      usuario_id uuid,
      usuario_nome text not null default '',
      created_at timestamptz default now()
    )
  `);
  await db.execute(sql`create index if not exists nk_caixa_mov_sessao_idx on nk_caixa_movimento (sessao_id)`);
  await db.execute(sql`create index if not exists nk_caixa_mov_empresa_idx on nk_caixa_movimento (empresa_id)`);

  // Assinatura comercial recorrente por CNPJ com gateway
  await db.execute(sql`
    create table if not exists nk_assinatura (
      id uuid primary key default gen_random_uuid(),
      empresa_id uuid not null references nk_empresa (id) on delete cascade,
      cnpj text not null,
      razao_social text not null default '',
      email_cobranca text not null default '',
      plano_id text not null,
      ciclo text not null default 'mensal',
      forma_pagamento text not null default 'pix',
      valor_ciclo numeric(12, 2) not null default 0,
      status text not null default 'aguardando_pagamento',
      gateway text not null default 'sandbox',
      gateway_customer_id text default '',
      gateway_subscription_id text default '',
      cartao_bandeira text default '',
      cartao_ultimos4 text default '',
      proximo_vencimento date not null,
      cancelar_ao_fim_do_ciclo boolean not null default false,
      cancelada_em timestamptz,
      motivo_cancelamento text default '',
      created_at timestamptz default now(),
      atualizado_em timestamptz default now()
    )
  `);
  await db.execute(sql`create index if not exists nk_assinatura_empresa_idx on nk_assinatura (empresa_id)`);
  await db.execute(sql`create index if not exists nk_assinatura_cnpj_idx on nk_assinatura (cnpj)`);
  await db.execute(sql`create index if not exists nk_assinatura_gateway_sub_idx on nk_assinatura (gateway_subscription_id)`);
  await db.execute(sql`
    create table if not exists nk_assinatura_fatura (
      id uuid primary key default gen_random_uuid(),
      empresa_id uuid not null references nk_empresa (id) on delete cascade,
      assinatura_id uuid not null references nk_assinatura (id) on delete cascade,
      numero integer not null,
      cnpj text not null,
      plano_id text not null,
      ciclo text not null default 'mensal',
      competencia text not null default '',
      valor numeric(12, 2) not null default 0,
      forma_pagamento text not null default 'pix',
      status text not null default 'pendente',
      vencimento date not null,
      pago_em timestamptz,
      gateway text not null default 'sandbox',
      gateway_payment_id text default '',
      checkout_url text default '',
      pix_payload text default '',
      linha_digitavel text default '',
      nsu_autorizacao text default '',
      created_at timestamptz default now()
    )
  `);
  await db.execute(sql`create index if not exists nk_ass_fatura_empresa_idx on nk_assinatura_fatura (empresa_id, created_at)`);
  await db.execute(sql`create index if not exists nk_ass_fatura_ass_idx on nk_assinatura_fatura (assinatura_id)`);
  await db.execute(sql`create index if not exists nk_ass_fatura_gw_pay_idx on nk_assinatura_fatura (gateway_payment_id)`);

  // Etapa 1 (2026) — quebra de caixa e homologação: ADITIVO, sem RLS, sem tocar no legado.
  await db.execute(sql`
    alter table nk_caixa_sessao
      add column if not exists status_aprovacao text,
      add column if not exists homologado_por_usuario_id uuid,
      add column if not exists fundo_troco numeric(12, 2)
  `);
  await db.execute(sql`
    create table if not exists nk_caixa_quebra_log (
      id uuid primary key default gen_random_uuid(),
      empresa_id uuid not null references nk_empresa (id) on delete cascade,
      sessao_id uuid not null references nk_caixa_sessao (id) on delete cascade,
      usuario_id uuid references nk_usuario (id),
      valor_diferenca numeric(12, 2) not null default 0,
      tipo text not null default 'FALTA',
      justificativa text not null default '',
      homologado_por_usuario_id uuid,
      homologado_em timestamptz,
      created_at timestamptz default now()
    )
  `);
  await db.execute(sql`create index if not exists nk_caixa_quebra_sessao_idx on nk_caixa_quebra_log (sessao_id)`);
  await db.execute(sql`create index if not exists nk_caixa_quebra_empresa_idx on nk_caixa_quebra_log (empresa_id, created_at)`);

  // Parametrização fiscal de produtos: somente tabelas novas, sem reescrever cadastros legados.
  await db.execute(sql`
    create table if not exists nk_fiscal_parametro (
      id uuid primary key default gen_random_uuid(),
      empresa_id uuid not null references nk_empresa(id) on delete cascade,
      tipo text not null,
      codigo text not null default '',
      nome text not null,
      regime text not null default 'todos',
      dados jsonb not null default '{}'::jsonb,
      ativo boolean not null default true,
      criado_em timestamptz not null default now(),
      atualizado_em timestamptz not null default now()
    )
  `);
  await db.execute(sql`create index if not exists nk_fiscal_parametro_empresa_tipo_idx on nk_fiscal_parametro(empresa_id, tipo)`);
  await db.execute(sql`create unique index if not exists nk_fiscal_codigo_empresa_tipo_uidx on nk_fiscal_parametro(empresa_id, tipo, codigo) where tipo <> 'perfil'`);
  await db.execute(sql`create unique index if not exists nk_fiscal_perfil_empresa_nome_uidx on nk_fiscal_parametro(empresa_id, lower(nome)) where tipo = 'perfil'`);
  await db.execute(sql`
    create table if not exists nk_produto_tributacao (
      id uuid primary key default gen_random_uuid(),
      empresa_id uuid not null references nk_empresa(id) on delete cascade,
      produto_id uuid not null references nk_produto(id) on delete cascade,
      perfil_id uuid references nk_fiscal_parametro(id) on delete set null,
      dados jsonb not null default '{}'::jsonb,
      atualizado_em timestamptz not null default now()
    )
  `);
  await db.execute(sql`create unique index if not exists nk_produto_tributacao_produto_uidx on nk_produto_tributacao(produto_id)`);
  await db.execute(sql`create index if not exists nk_produto_tributacao_empresa_idx on nk_produto_tributacao(empresa_id)`);
  aplicado = true;
}
