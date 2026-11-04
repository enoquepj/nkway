import { redirect } from "next/navigation";
import { normalizarPerfil } from "@/lib/permissoes";
import { contexto } from "@/lib/session";
import type { Emitente } from "@/lib/danfe";
import { listarClientes, listarProdutos } from "@/server/dados";
import { obterEstadoGavetaSessao } from "@/server/caixaCore";
import { PdvView } from "@/views/Pdv";

export const dynamic = "force-dynamic";

export default async function PdvPage() {
  const c = await contexto();
  if (!c) redirect("/login");
  const papel = normalizarPerfil(c.usuario.papel);
  const [produtos, clientes, estadoGaveta] = await Promise.all([
    listarProdutos(c.empresaId, true),
    listarClientes(c.empresaId),
    // Blind balance: o PDV recebe SOMENTE o estado lógico da gaveta e o boolean
    // de bloqueio. Nenhum valor esperado ou saldo em dinheiro sai do servidor.
    obterEstadoGavetaSessao(c.empresaId, c.usuario.id),
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
      emitente={
        {
          nome: c.empresa.nome,
          fantasia: c.empresa.nomeFantasia || c.empresa.nome,
          cnpj: c.empresa.cnpj,
          ie: c.empresa.ie || "",
          regime: c.empresa.regime,
          endereco: [c.empresa.endereco, c.empresa.numero, c.empresa.bairro].filter(Boolean).join(", "),
          municipio: c.empresa.municipio || "",
          uf: c.empresa.uf,
          codMunicipio: c.empresa.codMunicipio || "",
        } satisfies Emitente
      }
      cscId={String(fiscal.cscId ?? "00000000")}
      usuario={{
        nome: c.usuario.nome,
        papel,
      }}
      sessaoCaixa={
        estadoGaveta
          ? {
              id: estadoGaveta.sessaoId,
              numero: estadoGaveta.numero,
              terminal: estadoGaveta.terminal,
              operadorNome: estadoGaveta.operadorNome,
              estadoGaveta: estadoGaveta.estadoGaveta,
              bloquearVendaDinheiro: estadoGaveta.bloquearVendaDinheiro,
            }
          : null
      }
    />
  );
}
