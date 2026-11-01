import { NextResponse, type NextRequest } from "next/server";
import { executarExportacaoXmlVendas } from "@/server/exportacaoXmlCore";
import { exigirPermissao } from "@/server/tenant";

export const dynamic = "force-dynamic";

export async function POST(req: NextRequest) {
  try {
    const { empresaId, usuario } = await exigirPermissao("documentos.exportar_xml");
    const body = (await req.json().catch(() => ({}))) as { ids?: unknown };
    const ids = Array.isArray(body.ids) ? body.ids.map((x) => String(x ?? "")) : [];

    const r = await executarExportacaoXmlVendas({
      empresaId,
      usuario,
      ids,
    });

    if (!r.ok) {
      return NextResponse.json({ ok: false, erro: r.erro, semXml: r.semXml }, { status: 422 });
    }

    return new NextResponse(new Uint8Array(r.buffer), {
      status: 200,
      headers: {
        "Content-Type": r.mimeType,
        "Content-Disposition": `attachment; filename="${r.nomeArquivo}"`,
        "X-Exportados-Count": String(r.exportados.length),
        "X-Sem-Xml-Count": String(r.semXml.length),
      },
    });
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e);
    const status = msg.includes("Acesso negado") ? 403 : msg.includes("Sessão") ? 401 : 400;
    return NextResponse.json({ ok: false, erro: msg }, { status });
  }
}
