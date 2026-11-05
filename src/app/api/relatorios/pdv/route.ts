import Papa from "papaparse";
import { temPermissao } from "@/lib/permissoes";
import { fusoRelatorioPdv, lerFiltrosRelatorioPdv } from "@/lib/relatoriosPdv";
import { contexto } from "@/lib/session";
import { obterRelatorioPdv } from "@/server/relatoriosPdv";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";
const SEM_CACHE = { "Cache-Control": "no-store, private" };
const LIMITE_EXPORTACAO = 10_000;

/** A autorização é revalidada em cada consulta e exportação; empresaId nunca vem da URL. */
export async function GET(request: Request) {
  const c = await contexto();
  if (!c) return Response.json({ ok: false, erro: "Sessão expirada. Entre novamente." }, { status: 401, headers: SEM_CACHE });
  if (!temPermissao(c.usuario.papel, "caixa.auditoria")) return Response.json({ ok: false, erro: "Acesso restrito a gerentes e administradores." }, { status: 403, headers: SEM_CACHE });
  try {
    const params = new URL(request.url).searchParams;
    const fuso = fusoRelatorioPdv(c.empresa.uf);
    const filtros = lerFiltrosRelatorioPdv(params, fuso);
    const csv = params.get("exportar") === "csv";
    if (csv) { filtros.pagina = 1; filtros.tamanhoPagina = LIMITE_EXPORTACAO + 1; }
    const dados = await obterRelatorioPdv(c.empresaId, c.empresa.nomeFantasia || c.empresa.nome, filtros, fuso);
    if (!csv) return Response.json(dados, { headers: SEM_CACHE });
    if (dados.total > LIMITE_EXPORTACAO) return Response.json({ ok: false, erro: "A exportação excede 10.000 linhas. Reduza o período ou refine os filtros." }, { status: 400, headers: SEM_CACHE });
    const campos = dados.colunas.map((coluna) => coluna.rotulo);
    const linhas = dados.linhas.map((linha) => dados.colunas.map((coluna) => linha[coluna.chave] ?? ""));
    const conteudo = Papa.unparse({ fields: campos, data: linhas }, { delimiter: ";", newline: "\r\n", escapeFormulae: /^(?:[\t\r\n]|[ ]*[=+\-@])/ });
    const nome = `relatorio-pdv-${filtros.aba}${filtros.aba === "caixa" ? `-${filtros.detalhe}` : ""}-${filtros.inicio}-${filtros.fim}.csv`;
    return new Response(`\uFEFF${conteudo}`, { headers: { ...SEM_CACHE, "Content-Type": "text/csv; charset=utf-8", "Content-Disposition": `attachment; filename="${nome}"`, "X-Content-Type-Options": "nosniff" } });
  } catch (e) {
    if (e instanceof RangeError) return Response.json({ ok: false, erro: e.message }, { status: 400, headers: SEM_CACHE });
    console.error("[relatorios-pdv] Falha ao consultar relatório", e instanceof Error ? e.message : "erro desconhecido");
    return Response.json({ ok: false, erro: "Não foi possível consultar o relatório. Tente novamente." }, { status: 500, headers: SEM_CACHE });
  }
}
