import { randomBytes } from "node:crypto";
import { eq, sql } from "drizzle-orm";
import { db } from "@/db";
import {
  clientes,
  empresas,
  mdfes,
  usuarios,
  contas,
  entradas,
  fornecedores,
  movimentos,
  produtos,
  vendaItens,
  vendas,
  type EntradaItem,
} from "@/db/schema";
import { hashSenha } from "@/lib/session";
import { gerarChave, round2, UF_NUMERO } from "@/lib/dominio";

/** PRNG determinístico para ambiente de demonstração estável */
function aleatorio(semente = 20260322) {
  let s = semente;
  return () => {
    s = (s * 1664525 + 1013904223) % 4294967296;
    return s / 4294967296;
  };
}

const CATALOGO = [
  // nome, categoria, custo, preço, unidade, estoque inicial, mínimo, estoque de venda (pesável)
  ["ARROZ TIPO 1 5KG", "Mercearia", 22.4, 32.9, "PC", 96, 24, false],
  ["FEIJAO CARIOCA TIPO 1 1KG", "Mercearia", 7.15, 11.9, "UN", 140, 30, false],
  ["OLEO DE SOJA 900ML", "Mercearia", 6.35, 9.9, "UN", 88, 24, false],
  ["ACUCAR REFINADO 5KG", "Mercearia", 14.9, 21.9, "PC", 60, 15, false],
  ["CAFE TOSTADO 500G", "Mercearia", 12.4, 18.9, "UN", 74, 20, false],
  ["LEITE UHT 1L", "Mercearia", 4.35, 6.79, "UN", 180, 40, false],
  ["MACARRAO PARAFUSO 500G", "Mercearia", 3.1, 5.49, "UN", 120, 25, false],
  ["FAROFA DE MANDIOCA 500G", "Mercearia", 4.2, 7.5, "UN", 40, 12, false],
  ["REFRIGERANTE COLA 2L", "Bebidas", 6.9, 11.5, "UN", 96, 24, false],
  ["AGUA MINERAL 500ML", "Bebidas", 1.1, 2.5, "UN", 320, 60, false],
  ["CERVEJA LATTAO 350ML", "Bebidas", 2.85, 4.99, "UN", 288, 72, false],
  ["SUCO CONCENTRADO 1L", "Bebidas", 5.4, 8.9, "UN", 44, 12, false],
  ["SABAO EM PO 500G", "Limpeza", 5.6, 9.9, "UN", 70, 18, false],
  ["DETERGENTE 500ML", "Limpeza", 2.3, 4.49, "UN", 110, 24, false],
  ["AMACIANTE 2L", "Limpeza", 7.8, 13.9, "UN", 32, 10, false],
  ["PAPEL HIGIENICO 12UN", "Higiene", 15.2, 24.9, "PC", 46, 12, false],
  ["SABONETE 90G", "Higiene", 1.45, 2.99, "UN", 160, 40, false],
  ["CREME DENTAL 90G", "Higiene", 3.4, 6.49, "UN", 58, 15, false],
  ["MORTADELA FATIADO", "Frios", 15.5, 25.9, "KG", 14, 5, true],
  ["QUEIJO MUSSARELA", "Frios", 28.4, 45.9, "KG", 11, 4, true],
  ["PRESUNTO COZIDO", "Frios", 19.9, 32.9, "KG", 8, 3, true],
  ["PACO FRANCA", "Padaria", 8.2, 14.9, "KG", 16, 5, true],
  ["BOLO DE CENOURA FATIADO", "Padaria", 9.5, 18.0, "KG", 6, 2, true],
] as const;

const FORMAS = ["dinheiro", "pix", "credito", "debito", "boleto", "prazo"] as const;

const iso = (d: Date) => d.toISOString().slice(0, 10);

export async function semearAmbiente() {
  const emailDemo = "demo@nkway.com.br";
  const [ja] = await db.select({ id: usuarios.id }).from(usuarios).where(eq(usuarios.email, emailDemo)).limit(1);
  if (ja?.id) return { criado: false };

  const rnd = aleatorio();
  const agora = new Date();

  const [empresa] = await db
    .insert(empresas)
    .values({
      nome: "COMERCIAL SÃO JORGE LTDA",
      nomeFantasia: "Mercado São Jorge",
      cnpj: "23.567.891/0001-02",
      uf: "RO",
      municipio: "Ji-Paraná",
      codMunicipio: "1100866",
      ie: "0000000000",
      regime: "simples",
      porte: "ME",
      telefone: "(69) 3424-1188",
      email: emailDemo,
      endereco: "Av. Transcontinental",
      numero: "2450",
      bairro: "Centro",
      cep: "76900004",
      plano: "me",
      trialUntil: new Date(agora.getTime() + 11 * 86_400_000),
      fiscal: {
        ambiente: 2,
        crt: 1,
        ufPadrao: "RO",
        serieNfce: "1",
        serieNfe: "1",
        serieMdfe: "1",
        cscId: "520000000123456",
        cscToken: "···demo",
        certificadoNome: "A1 demo (não usar em produção)",
        certificadoValidade: iso(new Date(agora.getTime() + 200 * 86_400_000)),
        certificadoSerial: "00:11:22:33:44:55:66:77",
      },
    })
    .returning({ id: empresas.id });
  const empresaId = String(empresa.id);

  await db.insert(usuarios).values({
    empresaId,
    nome: "Ana Ribeiro",
    email: emailDemo,
    senhaHash: hashSenha("nkway123"),
    papel: "owner",
  });

  const idsProduto: { id: string; nome: string; custo: number; preco: number; unidade: string; estoque: number; categoria: string }[] = [];
  for (let i = 0; i < CATALOGO.length; i++) {
    const [nome, categoria, custo, preco, unidade, estoque, minimo, pesavel] = CATALOGO[i];
    const base = `789${String(1000 + i).padStart(9, "0")}`;
    let soma = 0;
    for (let k = 0; k < 12; k++) soma += Number(base[k]) * (k % 2 === 0 ? 1 : 3);
    const gtin = `${base}${(10 - (soma % 10)) % 10}`;
    const [p] = await db
      .insert(produtos)
      .values({
        empresaId,
        nome,
        sku: `NK${String(i + 1).padStart(4, "0")}`,
        gtin,
        categoria,
        marca: categoria === "Bebidas" ? "Nacional" : "Linha Way",
        unidade,
        custo,
        preco,
        estoque,
        estoqueMin: minimo,
        pesavel,
        ncm: ["00000000", "10063021", "15071000", "17019900", "19021900"][i % 5],
        cfop: "5102",
        csosn: "102",
        icmsAliq: 0,
        pisAliq: 0,
        cofinsAliq: 0,
      })
      .returning({ id: produtos.id, nome: produtos.nome });
    idsProduto.push({ id: p.id, nome: p.nome, custo, preco, unidade, estoque, categoria });
  }

  const [c1] = await db
    .insert(clientes)
    .values({
      empresaId,
      nome: "CONSUMIDOR FINAL",
      documento: "",
      cidade: "Ji-Paraná",
      uf: "RO",
      condicaoPadrao: "a vista",
      telefone: "",
      email: "",
    })
    .returning({ id: clientes.id, nome: clientes.nome, condicaoPadrao: clientes.condicaoPadrao });
  const clientesCriados = [c1];
  for (const [nome, doc, cidade, limite, cond] of [
    ["MERCADINHO BOA VISTA LTDA", "12.345.678/0001-90", "Ji-Paraná", 1500, "30d"],
    ["RESTAURANTE SABOR CASEIRO", "98.765.432/0001-10", "Porto Velho", 2500, "14d"],
    ["PADARIA PAO QUENTE ME", "45.678.912/0001-33", "Machadinho", 800, "7d"],
    ["SILVANA LIMA DE SOUZA", "321.654.987-00", "Ji-Paraná", 400, "a vista"],
  ] as const) {
    const [c] = await db
      .insert(clientes)
      .values({
        empresaId,
        nome,
        documento: doc,
        cidade,
        uf: "RO",
        limiteCredito: limite,
        condicaoPadrao: cond,
        email: `${nome.split(" ")[0].toLowerCase()}@exemplo.com`,
        telefone: "(69) 9" + String(990000000 + Math.floor(rnd() * 999999)).slice(0, 4) + "-" + String(1000 + Math.floor(rnd() * 8999)).slice(0, 4),
        observacao: "Atacado de bairro — faturamento mensal quando prazo.",
      })
      .returning({ id: clientes.id, nome: clientes.nome, condicaoPadrao: clientes.condicaoPadrao });
    clientesCriados.push(c);
  }

  const fornecedorIds: { id: string; nome: string; cnpj: string }[] = [];
  for (const [nome, cnpj, cidade, prazo] of [
    ["DISTRIBUIDORA NORTE SUL LTDA", "11.222.333/0001-44", "Porto Velho", 28],
    ["ATACADAO AMAZONIA SA", "22.333.444/0001-55", "Cacoal", 21],
    ["COMERCIAL RIO MADEIRA EIRELI", "33.444.555/0001-66", "Ji-Paraná", 14],
  ] as const) {
    const [f] = await db
      .insert(fornecedores)
      .values({ empresaId, nome, cnpj, cidade, uf: "RO", telefone: "(69) 3" + String(2000000 + Math.floor(rnd() * 999999)).slice(0, 7), prazoPagDias: prazo })
      .returning({ id: fornecedores.id, nome: fornecedores.nome, cnpj: fornecedores.cnpj });
    fornecedorIds.push(f);
  }

  /* ------------------------------------------------- histórico de vendas */
  const saldo = new Map(idsProduto.map((p) => [p.id, p.estoque]));
  const custoAtual = new Map(idsProduto.map((p) => [p.id, p.custo]));
  let numeroVenda = 0;
  let numeroNota = 0;

  const inserirMovimento = async (
    produtoId: string,
    produtoNome: string,
    tipo: string,
    qtd: number,
    saldoApos: number,
    custoUnit: number,
    documento: string,
    data: Date,
    observacao?: string,
  ) => {
    await db.insert(movimentos).values({
      empresaId,
      produtoId,
      produtoNome,
      tipo,
      qtd,
      saldoApos,
      custoUnit,
      custoMedioApos: custoUnit,
      documento,
      observacao,
      data,
    });
  };

  for (let d = 29; d >= 0; d--) {
    const dia = new Date(agora);
    dia.setDate(dia.getDate() - d);
    dia.setHours(Math.floor(8 + rnd() * 2), Math.floor(rnd() * 59), 0, 0);
    const qtdVendas = d === 0 ? 4 : 3 + Math.floor(rnd() * 9);
    for (let v = 0; v < qtdVendas; v++) {
      numeroVenda += 1;
      numeroNota += 1;
      const dataVenda = new Date(dia.getTime() + v * 26 * 60_000);
      const qtdItens = 1 + Math.floor(rnd() * 4);
      const escolhidos: (typeof idsProduto)[number][] = [];
      for (let i = 0; i < qtdItens; i++) escolhidos.push(idsProduto[Math.floor(rnd() * idsProduto.length)]);
      const itens = escolhidos.map((p) => {
        const qtd = p.unidade === "KG" ? round2(0.3 + rnd() * 1.4) : 1 + Math.floor(rnd() * 3);
        return { produto: p, qtd, total: round2(qtd * p.preco) };
      });
      const subtotal = round2(itens.reduce((s, i) => s + i.total, 0));
      const desconto = rnd() > 0.82 ? round2(subtotal * 0.05) : 0;
      const total = round2(subtotal - desconto);
      const forma = FORMAS[Math.floor(rnd() * FORMAS.length)];
      const pagamentos =
        rnd() > 0.75
          ? [
              { forma: "dinheiro", valor: round2(total * 0.4) },
              { forma: "pix", valor: round2(total - round2(total * 0.4)) },
            ]
          : [{ forma, valor: total }];
      const cliente = rnd() > 0.75 ? clientesCriados[1 + Math.floor(rnd() * (clientesCriados.length - 1))] : clientesCriados[0];
      const chave = gerarChave({
        uf: UF_NUMERO.RO,
        aamm: `${String(dataVenda.getFullYear()).slice(2)}${String(dataVenda.getMonth() + 1).padStart(2, "0")}`,
        cnpj: "23567891000102",
        modelo: "65",
        serie: "001",
        numeroNota,
      });
      const [venda] = await db
        .insert(vendas)
        .values({
          empresaId,
          numero: numeroVenda,
          clienteId: cliente.id,
          clienteNome: cliente.nome,
          subtotal,
          desconto,
          vFrete: 0,
          total,
          formaPagamento: forma,
          pagamentos,
          tipo: "fiscal",
          status: "faturado",
          modelo: rnd() > 0.85 ? "NF-e" : "NFC-e",
          serie: "1",
          numeroNota,
          chave,
          protocolo: `111${String(dataVenda.getTime()).slice(-14)}`,
          autorizadaEm: dataVenda.getTime(),
          operador: rnd() > 0.5 ? "Ana Ribeiro" : "Caixa 2",
          data: dataVenda,
        })
        .returning({ id: vendas.id });
      await db.insert(vendaItens).values(
        itens.map((i) => ({
          vendaId: venda.id,
          produtoId: i.produto.id,
          nome: i.produto.nome,
          qtd: i.qtd,
          precoUnit: i.produto.preco,
          total: i.total,
          unidade: i.produto.unidade,
        })),
      );
      for (const i of itens) {
        const novo = round2((saldo.get(i.produto.id) ?? 0) - i.qtd);
        saldo.set(i.produto.id, Math.max(0, novo));
        await db.update(produtos).set({ estoque: Math.max(0, novo) }).where(sql`id = ${i.produto.id}`);
        await inserirMovimento(
          i.produto.id,
          i.produto.nome,
          "venda",
          -i.qtd,
          Math.max(0, novo),
          custoAtual.get(i.produto.id) ?? i.produto.custo,
          `Nº ${numeroNota} NFC-e`,
          dataVenda,
        );
      }
      const aPrazo = forma === "boleto" || forma === "prazo" ? total : 0;
      if (aPrazo > 0) {
        const dias = cliente.condicaoPadrao === "7d" ? 7 : cliente.condicaoPadrao === "14d" ? 14 : 30;
        await db.insert(contas).values({
          empresaId,
          tipo: "receber",
          descricao: `NF ${numeroNota} — ${cliente.nome}`,
          categoria: "Vendas",
          contraparteNome: cliente.nome,
          valor: aPrazo,
          vencimento: iso(new Date(dataVenda.getTime() + dias * 86_400_000)),
          forma,
          vendaId: venda.id,
          status: dataVenda.getTime() < agora.getTime() - 5 * 86_400_000 && rnd() > 0.4 ? "paga" : "aberta",
          pagoEm: rnd() > 0.5 ? iso(new Date(dataVenda.getTime() + dias * 86_400_000)) : null,
        });
      }
    }
  }

  /* ------------------------------------------------- DAVs em aberto */
  for (let i = 0; i < 3; i++) {
    numeroVenda += 1;
    const p1 = idsProduto[Math.floor(rnd() * idsProduto.length)];
    const p2 = idsProduto[Math.floor(rnd() * idsProduto.length)];
    const total = round2(p1.preco * (1 + i) + p2.preco * 2);
    const [dav] = await db
      .insert(vendas)
      .values({
        empresaId,
        numero: numeroVenda,
        clienteId: clientesCriados[1 + i]?.id ?? null,
        clienteNome: clientesCriados[1 + i]?.nome ?? "CONSUMIDOR",
        subtotal: total,
        desconto: 0,
        vFrete: 0,
        total,
        formaPagamento: "a vista",
        pagamentos: [],
        tipo: "dav",
        status: "aberto",
        validade: iso(new Date(agora.getTime() + (2 - i) * 86_400_000)),
        observacao: "Orçamento de atacado — aguardando retirada no balcão.",
        operador: "Ana Ribeiro",
        data: new Date(agora.getTime() - (i + 1) * 36 * 3600_000),
      })
      .returning({ id: vendas.id });
    await db.insert(vendaItens).values([
      { vendaId: dav.id, produtoId: p1.id, nome: p1.nome, qtd: 1 + i, precoUnit: p1.preco, total: round2(p1.preco * (1 + i)), unidade: p1.unidade },
      { vendaId: dav.id, produtoId: p2.id, nome: p2.nome, qtd: 2, precoUnit: p2.preco, total: round2(p2.preco * 2), unidade: p2.unidade },
    ]);
  }

  /* ------------------------------------------------- entradas de mercadoria */
  const chaveEntrada = (numero: number) =>
    gerarChave({
      uf: UF_NUMERO.RO,
      aamm: "2603",
      cnpj: "11222333000144",
      modelo: "55",
      serie: "001",
      numeroNota: numero,
    });

  for (let e = 0; e < 4; e++) {
    const forn = fornecedorIds[e % fornecedorIds.length];
    const itensDaNota: EntradaItem[] = [];
    for (let i = 0; i < 3; i++) {
      const p = idsProduto[(e * 3 + i) % idsProduto.length];
      const qtd = 12 + Math.floor(rnd() * 36);
      const custo = round2(p.custo * (0.94 + rnd() * 0.14));
      const saldoAntes = saldo.get(p.id) ?? 0;
      const custoAntes = custoAtual.get(p.id) ?? p.custo;
      const novoSaldo = round2(saldoAntes + qtd);
      const custoMedio = novoSaldo > 0 ? round2((saldoAntes * custoAntes + qtd * custo) / novoSaldo) : custo;
      saldo.set(p.id, novoSaldo);
      custoAtual.set(p.id, custoMedio);
      await db.update(produtos).set({ estoque: novoSaldo, custo: custoMedio }).where(sql`id = ${p.id}`);
      const dataMov = new Date(agora.getTime() - (e + 1) * 3 * 86_400_000);
      await inserirMovimento(p.id, p.nome, "entrada", qtd, novoSaldo, custoMedio, `NF ${1200 + e} · ${forn.nome.slice(0, 20)}`, dataMov, `Custo médio recalculado: ${custo.toFixed(2)} → ${custoMedio.toFixed(2)}`);
      itensDaNota.push({
        produtoId: p.id,
        nome: p.nome,
        nomeFornecedor: p.nome,
        sku: `NK${String(e * 3 + i + 1).padStart(4, "0")}`,
        ncm: "00000000",
        cfop: "5101",
        unidade: p.unidade,
        gtin: "SEM GTIN",
        qtd,
        qtdNota: qtd,
        custo,
        preco: round2(custoMedio * 1.45),
      });
    }
    const valorProdutos = round2(itensDaNota.reduce((s, i) => s + i.qtd * i.custo, 0));
    const entradaId = new Date(agora.getTime() - (e + 1) * 3 * 86_400_000);
    const [ent] = await db
      .insert(entradas)
      .values({
        empresaId,
        numeroNota: String(1200 + e),
        serie: "1",
        chave: chaveEntrada(1200 + e),
        fornecedor: forn.nome,
        cnpjFornecedor: forn.cnpj.replace(/\D/g, ""),
        fornecedorId: forn.id,
        emissao: iso(entradaId),
        valorProdutos,
        valorFrete: round2(valorProdutos * 0.035),
        total: round2(valorProdutos * 1.035),
        status: "lancada",
        origem: e % 2 === 0 ? "xml" : "sefaz",
        gerarFinanceiro: true,
        itens: itensDaNota,
        observacao: e % 2 === 0 ? "XML importado do arquivo da SEFAZ" : "Capturado por chave de acesso (DF-e, modo demonstração)",
        createdAt: entradaId,
        lancadaEm: entradaId,
      })
      .returning({ id: entradas.id });
    await db.insert(contas).values({
      empresaId,
      tipo: "pagar",
      descricao: `NF ${1200 + e} ${forn.nome.slice(0, 26)}`,
      categoria: "Fornecedores",
      contraparteNome: forn.nome,
      valor: round2(valorProdutos * 1.035),
      vencimento: iso(new Date(entradaId.getTime() + 28 * 86_400_000)),
      forma: "boleto",
      entradaId: ent.id,
      status: e >= 2 ? "paga" : "aberta",
      pagoEm: e >= 2 ? iso(new Date(entradaId.getTime() + 20 * 86_400_000)) : null,
    });
  }

  /* ------------------------------------------------- entradas pendentes (fluxo de tratamento) */
  const pendente = idsProduto.slice(18, 21);
  await db.insert(entradas).values({
    empresaId,
    numeroNota: "1297",
    serie: "1",
    chave: chaveEntrada(1297),
    fornecedor: "ATACADAO AMAZONIA SA",
    cnpjFornecedor: "22333444000155",
    emissao: iso(new Date(agora.getTime() - 86_400_000)),
    valorProdutos: 986.4,
    valorFrete: 38,
    total: 1024.4,
    status: "pendente",
    origem: "xml",
    gerarFinanceiro: true,
    itens: [
      { produtoId: null, nome: "FRIOS LANCHE SALSICHA 1KG", nomeFornecedor: "SALSICHA CLASSICA 1KG", sku: "", ncm: "16010010", cfop: "5101", unidade: "PC", gtin: "7891234500011", qtd: 24, qtdNota: 24, custo: 18.6, preco: 27.9 },
      { produtoId: pendente[0].id, nome: pendente[0].nome, sku: "NK0019", ncm: "16010010", cfop: "5101", unidade: "KG", qtd: 10, qtdNota: 12, custo: 15.5, preco: 25.9 },
      { produtoId: pendente[1].id, nome: pendente[1].nome, sku: "NK0020", ncm: "04069090", cfop: "5101", unidade: "KG", qtd: 8, qtdNota: 8, custo: 28.4, preco: 45.9 },
    ],
    observacao: "XML recebido com divergência de quantidade em 1 item — aguardando conferência no recebimento.",
  });

  /* ------------------------------------------------- contas avulsas */
  await db.insert(contas).values([
    {
      empresaId,
      tipo: "pagar",
      descricao: "Aluguel do salão - março",
      categoria: "Obrigações",
      contraparteNome: "Imobiliária Centro",
      valor: 3200,
      vencimento: iso(new Date(agora.getTime() + 4 * 86_400_000)),
      forma: "boleto",
      status: "aberta",
    },
    {
      empresaId,
      tipo: "pagar",
      descricao: "Energia Ceron - fatura 03",
      categoria: "Custos",
      contraparteNome: "Ceron",
      valor: 748.22,
      vencimento: iso(new Date(agora.getTime() - 3 * 86_400_000)),
      forma: "debito",
      status: "aberta",
    },
    {
      empresaId,
      tipo: "pagar",
      descricao: "Contador - honorários",
      categoria: "Impostos",
      contraparteNome: "Studio Contábil",
      valor: 690,
      vencimento: iso(new Date(agora.getTime() + 9 * 86_400_000)),
      forma: "pix",
      status: "aberta",
    },
    {
      empresaId,
      tipo: "receber",
      descricao: "Encomenda de frios - ceja junina",
      categoria: "Vendas",
      contraparteNome: "PADARIA PAO QUENTE ME",
      valor: 1240,
      vencimento: iso(new Date(agora.getTime() + 2 * 86_400_000)),
      forma: "boleto",
      status: "aberta",
    },
  ]);

  /* ------------------------------------------------- MDF-e em viagem */
  const [mdfeNf] = await db
    .select({ chave: vendas.chave, total: vendas.total })
    .from(vendas)
    .where(sql`empresa_id = ${empresaId} and modelo = 'NF-e' and status = 'faturado'`)
    .limit(2);
  if (mdfeNf?.chave) {
    await db.insert(mdfes).values({
      empresaId,
      numero: 1,
      serie: "1",
      chave: gerarChave({ uf: UF_NUMERO.RO, aamm: "2603", cnpj: "23567891000102", modelo: "58", serie: "001", numeroNota: 1 }),
      protocolo: `111${String(agora.getTime()).slice(-14)}`,
      ufInicio: "RO",
      ufFim: "RO",
      municipioCarregamento: "Ji-Paraná",
      municipioDescarregamento: "Porto Velho",
      placa: "RQD-4F18",
      rntrc: "12345678",
      condutor: "Marcos Vinícius Prado",
      cpfCondutor: "12345678901",
      documentos: [{ chave: mdfeNf.chave!, tipo: "NF-e", valor: round2(Number(mdfeNf.total)) }],
      pesoBruto: 842.5,
      valorCarga: round2(Number(mdfeNf.total)),
      status: "autorizado",
      emitidoEm: new Date(agora.getTime() - 8 * 3600_000),
    });
  }

  return { criado: true, empresaId };
}

/** usado no cadastro de novas contas: senha aleatória só no seed */
export const senhaDemo = "nkway123";
export const tokenAleatorio = () => randomBytes(8).toString("hex");
