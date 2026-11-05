import { redirect } from "next/navigation";
import { eq } from "drizzle-orm";
import { db } from "@/db";
import { usuarios } from "@/db/schema";
import { contexto } from "@/lib/session";
import { planoById } from "@/lib/dominio";
import { crtSugeridoParaRegime } from "@/lib/tributacao";
import { normalizarPerfil } from "@/lib/permissoes";
import { ConfigView } from "@/views/Config";
import { listarContas, listarEntradas, listarProdutos, listarVendas, obterPainelAssinatura, painel } from "@/server/dados";

export const dynamic = "force-dynamic";

export default async function ConfigPage() {
  const c = await contexto();
  if (!c) redirect("/login");
  const [equipe, produtos, vendas, contas, entradas, resumo, assinatura] = await Promise.all([
    db.select({ id: usuarios.id, nome: usuarios.nome, email: usuarios.email, papel: usuarios.papel, ativo: usuarios.ativo }).from(usuarios).where(eq(usuarios.empresaId, c.empresaId)),
    listarProdutos(c.empresaId),
    listarVendas(c.empresaId),
    listarContas(c.empresaId),
    listarEntradas(c.empresaId),
    painel(c.empresaId),
    obterPainelAssinatura(c.empresaId),
  ]);
  const fiscal = (c.empresa.fiscal ?? {}) as Record<string, unknown>;
  return (
    <ConfigView
      empresa={{
        nome: c.empresa.nome,
        nomeFantasia: c.empresa.nomeFantasia || "",
        cnpj: c.empresa.cnpj,
        uf: c.empresa.uf,
        municipio: c.empresa.municipio || "",
        codMunicipio: c.empresa.codMunicipio || "",
        ie: c.empresa.ie || "",
        regime: c.empresa.regime,
        porte: c.empresa.porte,
        telefone: c.empresa.telefone || "",
        email: c.empresa.email || "",
        endereco: c.empresa.endereco || "",
        numero: c.empresa.numero || "",
        bairro: c.empresa.bairro || "",
        cep: c.empresa.cep || "",
      }}
      fiscal={{
        serieNfce: String(fiscal.serieNfce ?? "1"),
        serieNfe: String(fiscal.serieNfe ?? "1"),
        serieMdfe: String(fiscal.serieMdfe ?? "1"),
        ambiente: Number(fiscal.ambiente ?? 2) as 1 | 2,
        cscId: String(fiscal.cscId ?? ""),
        cscToken: String(fiscal.cscToken ?? ""),
        crt: Number(fiscal.crt ?? crtSugeridoParaRegime(c.empresa.regime) ?? 1),
        certificadoNome: String(fiscal.certificadoNome ?? ""),
        certificadoValidade: String(fiscal.certificadoValidade ?? ""),
        certificadoSerial: String(fiscal.certificadoSerial ?? ""),
      }}
      plano={{ id: c.empresa.plano, nome: planoById(c.empresa.plano).nome, preco: planoById(c.empresa.plano).preco, limiteProdutos: planoById(c.empresa.plano).limiteProdutos, limiteUsuarios: planoById(c.empresa.plano).limiteUsuarios }}
      equipe={equipe.map((u) => ({ ...u, papel: normalizarPerfil(u.papel), ativo: u.ativo !== false }))}
      usuarioAtual={c.usuario.id}
      usuarioPapel={normalizarPerfil(c.usuario.papel)}
      assinatura={assinatura}
      ambiente={{
        produtos: produtos.length,
        produtosAtivos: produtos.filter((p) => p.ativo).length,
        documentos: vendas.length,
        davs: vendas.filter((v) => v.tipo === "dav").length,
        contas: contas.length,
        entradas: entradas.length,
        entradasPendentes: entradas.filter((e) => e.status !== "lancada").length,
        faturamento14d: resumo.kpis.totalPeriodo,
      }}
    />
  );
}
