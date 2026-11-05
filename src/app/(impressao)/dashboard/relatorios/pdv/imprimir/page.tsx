import { redirect } from "next/navigation";
import { AcoesImpressaoRelatorio } from "@/components/AcoesImpressaoRelatorio";
import { temPermissao } from "@/lib/permissoes";
import { ABAS_RELATORIOS_PDV, formatarValorRelatorioPdv, fusoRelatorioPdv, lerFiltrosRelatorioPdv, type LinhaRelatorioPdv } from "@/lib/relatoriosPdv";
import { contexto } from "@/lib/session";
import { obterRelatorioPdv } from "@/server/relatoriosPdv";
import "./impressao.css";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";
const LIMITE_IMPRESSAO = 10_000;
type Parametros = Record<string, string | string[] | undefined>;

function dataPeriodo(data: string) { const [ano, mes, dia] = data.split("-"); return `${dia}/${mes}/${ano}`; }
function documentoEmpresa(valor: string | null | undefined) {
  const numeros = String(valor ?? "").replace(/\D/g, "");
  return numeros.length === 14 ? numeros.replace(/^(\d{2})(\d{3})(\d{3})(\d{4})(\d{2})$/, "$1.$2.$3/$4-$5") : String(valor || "Não informado");
}
function comparacao(linha: LinhaRelatorioPdv, prefixo: "dinheiro" | "pix" | "cartoes", fuso: string) {
  const esperado = linha[`${prefixo}Esperado`], declarado = linha[`${prefixo}Declarado`], dif = linha[`${prefixo}Diferenca`];
  const texto = formatarValorRelatorioPdv(dif, "diferenca", fuso);
  return <div className="relatorio-pdv-comparacao"><div>E: {formatarValorRelatorioPdv(esperado, "moeda", fuso)}</div><div>D: {formatarValorRelatorioPdv(declarado, "moeda", fuso)}</div><div className={typeof dif === "number" && dif < 0 ? "diferenca-falta" : typeof dif === "number" && dif > 0 ? "diferenca-sobra" : ""}>Dif.: {texto}{typeof dif === "number" && dif !== 0 ? dif < 0 ? " (FALTA)" : " (SOBRA)" : ""}</div></div>;
}

/** Impressão é outra entrada sensível: sessão e permissão são verificadas novamente. */
export default async function ImprimirRelatorioPdv({ searchParams }: { searchParams: Promise<Parametros> }) {
  const c = await contexto();
  if (!c) redirect("/login");
  if (!temPermissao(c.usuario.papel, "caixa.auditoria")) redirect("/");
  const parametros = new URLSearchParams();
  const busca = await searchParams;
  for (const [chave, valor] of Object.entries(busca ?? {})) {
    if (typeof valor === "string") parametros.set(chave, valor);
    else if (Array.isArray(valor) && valor[0]) parametros.set(chave, valor[0]);
  }
  const fuso = fusoRelatorioPdv(c.empresa.uf);
  let dados: Awaited<ReturnType<typeof obterRelatorioPdv>>;
  try {
    const filtros = lerFiltrosRelatorioPdv(parametros, fuso);
    filtros.pagina = 1;
    filtros.tamanhoPagina = LIMITE_IMPRESSAO + 1;
    dados = await obterRelatorioPdv(c.empresaId, c.empresa.nomeFantasia || c.empresa.nome, filtros, fuso);
    if (dados.total > LIMITE_IMPRESSAO) throw new RangeError("O relatório excede 10.000 linhas. Reduza o período ou refine os filtros antes de imprimir.");
  } catch (e) {
    const mensagem = e instanceof RangeError ? e.message : "Não foi possível preparar o relatório. Tente novamente.";
    if (!(e instanceof RangeError)) console.error("[impressao-relatorio-pdv] falha:", e instanceof Error ? e.name : "erro inesperado");
    return <main className="relatorio-pdv-preview"><AcoesImpressaoRelatorio /><article className="print-area relatorio-pdv-documento"><h1>Não foi possível preparar a impressão</h1><p>{mensagem}</p></article></main>;
  }
  const aba = ABAS_RELATORIOS_PDV.find((a) => a.id === dados.aba);
  const titulo = dados.aba === "caixa" ? dados.detalhe === "sangrias" ? "Auditoria de caixa · Sangrias" : "Auditoria de caixa · Turnos" : aba?.rotulo ?? "Relatório";
  const filtros = dados.filtros;
  const filtroItens = [
    { rotulo: "Período", valor: `${dataPeriodo(filtros.inicio)} a ${dataPeriodo(filtros.fim)}` },
    { rotulo: "Loja / empresa", valor: dados.empresa },
    { rotulo: "Caixa", valor: filtros.terminal || "Todos" },
    { rotulo: "Operador / ID", valor: filtros.operador || "Todos" },
    ...(dados.aba === "produtos" ? [{ rotulo: "Categoria", valor: filtros.categoria || "Todas" }, { rotulo: "Ranking", valor: `Top ${filtros.top}` }] : []),
    ...(dados.aba === "caixa" ? [{ rotulo: "Status do turno", valor: filtros.statusTurno === "todos" ? "Todos" : filtros.statusTurno === "aberto" ? "Aberto" : "Fechado" }] : []),
  ];
  const emitido = formatarValorRelatorioPdv(new Date().toISOString(), "datahora", fuso);
  const auditoria = dados.aba === "caixa" && dados.detalhe === "turnos";
  return (
    <main className="relatorio-pdv-preview">
      <AcoesImpressaoRelatorio />
      <article className="print-area relatorio-pdv-documento" data-relatorio-aba={dados.aba} data-total-registros={dados.total}>
        <header className="relatorio-pdv-cabecalho">
          <div className="relatorio-pdv-marca"><div className="relatorio-pdv-marca-icon">N</div><div><strong>NKWAY</strong><span>GESTÃO · VENDAS · CAIXA</span><span>{dados.empresa} · CNPJ {documentoEmpresa(c.empresa.cnpj)}</span></div></div>
          <div className="relatorio-pdv-emissao"><strong>RELATÓRIO GERENCIAL</strong><span>Emitido em {emitido}</span><span>Emitido por {c.usuario.nome}</span></div>
        </header>
        <section className="relatorio-pdv-titulo"><p>Relatórios / PDV e caixa</p><h1>{titulo}</h1><h2>{aba?.descricao} · dados da empresa atual</h2></section>
        <section className="relatorio-pdv-filtros" aria-label="Filtros aplicados">{filtroItens.map((item) => <div key={item.rotulo}><b>{item.rotulo}</b><span>{item.valor}</span></div>)}</section>
        <section className="relatorio-pdv-resumo" aria-label="Indicadores do relatório">{dados.indicadores.map((item) => <div key={item.rotulo} className="relatorio-pdv-resumo-item"><span>{item.rotulo}</span><strong>{formatarValorRelatorioPdv(item.valor, item.formato, fuso)}</strong><small>{item.detalhe}</small></div>)}</section>
        <section>
          <div className="relatorio-pdv-secao"><h2>{auditoria ? "Histórico de turnos · esperado × declarado" : dados.aba === "caixa" ? "Histórico de sangrias" : dados.aba === "produtos" ? "Ranking de produtos" : dados.aba === "visao" ? "Distribuição por modalidade" : dados.aba === "operadores" ? "Desempenho por operador" : "Cupons cancelados"}</h2><span>{dados.total} registro(s) · tabela completa filtrada</span></div>
          {dados.linhas.length === 0 ? <div className="relatorio-pdv-vazio">Nenhum registro para os filtros selecionados.</div> : (
            <div className="relatorio-pdv-tabela-wrap"><table className="relatorio-pdv-tabela">
              {auditoria ? <>
                <thead><tr><th>Sessão / caixa</th><th>Operador</th><th>Abertura</th><th>Fechamento</th><th>Status</th><th>Dinheiro<br />E / D / Dif.</th><th>PIX<br />E / D / Dif.</th><th>Cartões<br />E / D / Dif.</th><th>Aprovação</th><th>Lacre</th></tr></thead>
                <tbody>{dados.linhas.map((linha, i) => <tr key={`${linha.sessaoId}-${i}`} data-relatorio-linha="true"><td><strong>{linha.turno}</strong><br />{linha.terminal}<br /><span className="id">{linha.sessaoId}</span></td><td>{linha.operador}</td><td>{formatarValorRelatorioPdv(linha.abertoEm, "datahora", fuso)}</td><td>{formatarValorRelatorioPdv(linha.fechadoEm, "datahora", fuso)}</td><td>{linha.status}</td><td>{comparacao(linha, "dinheiro", fuso)}</td><td>{comparacao(linha, "pix", fuso)}</td><td>{comparacao(linha, "cartoes", fuso)}</td><td>{linha.aprovacao}</td><td>{linha.lacre}</td></tr>)}</tbody>
              </> : <>
                <thead><tr>{dados.colunas.map((coluna) => <th key={coluna.chave} className={["moeda", "percentual", "numero", "quantidade", "diferenca"].includes(coluna.formato ?? "") ? "numero" : ""}>{coluna.rotulo}</th>)}</tr></thead>
                <tbody>{dados.linhas.map((linha, i) => <tr key={i} data-relatorio-linha="true">{dados.colunas.map((coluna) => <td key={coluna.chave} className={["moeda", "percentual", "numero", "quantidade", "diferenca"].includes(coluna.formato ?? "") ? "numero" : coluna.formato === "identificador" ? "id" : ""}>{formatarValorRelatorioPdv(linha[coluna.chave], coluna.formato, fuso)}</td>)}</tr>)}</tbody>
              </>}
            </table></div>
          )}
        </section>
        {dados.avisos.length > 0 && <section className="relatorio-pdv-observacoes"><h2>Observações e critérios</h2><ul>{dados.avisos.map((aviso) => <li key={aviso}>{aviso}</li>)}</ul></section>}
        <footer className="relatorio-pdv-rodape"><span>NKWAY · {dados.empresa}</span><span>Emitido em {emitido} · {fuso.replace("America/", "").replaceAll("_", " ")}</span></footer>
      </article>
    </main>
  );
}
