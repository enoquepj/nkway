import { redirect } from "next/navigation";
import { normalizarPerfil } from "@/lib/permissoes";
import { contexto } from "@/lib/session";
import { listarClientes, listarProdutos, obterSessaoCaixaOperador } from "@/server/dados";
import { PdvView } from "@/views/Pdv";

export const dynamic = "force-dynamic";

export default async function PdvPage() {
  const c = await contexto();
  if (!c) redirect("/login");
  const papel = normalizarPerfil(c.usuario.papel);
  const [produtos, clientes, sessaoCaixa] = await Promise.all([
    listarProdutos(c.empresaId, true),
    listarClientes(c.empresaId),
    obterSessaoCaixaOperador(c.empresaId, c.usuario.id, papel),
  ]);
  const fiscal = (c.empresa.fiscal ?? {}) as Record<string, unknown>;
  return (
    <PdvView
      produtos={produtos}
      clientes={clientes.map((cl) => ({
        id: cl.id,
        nome: cl.nome,
        documento: cl.documento,
        condicaoPadrao: cl.condicaoPadrao,
        limiteCredito: cl.limiteCredito,
        saldoEmAberto: cl.saldoEmAberto,
      }))}
      empresa={{
        nome: c.empresa.nome,
        fantasia: c.empresa.nomeFantasia || c.empresa.nome,
        cnpj: c.empresa.cnpj,
        documento: c.empresa.cnpj,
        endereco: c.empresa.endereco || "",
        municipio: c.empresa.municipio || "",
        ambiente: String(fiscal.ambiente ?? "2"),
      }}
      usuario={{
        nome: c.usuario.nome,
        papel,
      }}
      sessaoCaixa={
        sessaoCaixa
          ? {
              id: sessaoCaixa.id,
              numero: sessaoCaixa.numero,
              terminal: sessaoCaixa.terminal,
              saldoDinheiro: sessaoCaixa.apuracao.esperadosMap.dinheiro ?? 0,
              totalEsperado: sessaoCaixa.apuracao.totalEsperado,
            }
          : null
      }
    />
  );
}
