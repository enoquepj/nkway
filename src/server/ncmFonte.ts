import { ErroNcm, NCM_MAX_BYTES, URL_NCM, validarCatalogoNcm, type CatalogoNcm } from "@/lib/ncm";

/** Endpoint fixo. Só o redirecionamento público observado no próprio Classif é permitido. */
export function redirecionamentoNcmPermitido(destino: string): boolean {
  return destino === URL_NCM || destino === `${URL_NCM}?perfil=publico` || destino === `${URL_NCM}?perfil=PUBLICO`;
}

/** Sem credenciais, URLs do cliente, cookies, retries automáticos ou dependência do build. */
export async function baixarNcmOficial(fetcher: typeof fetch = fetch, tempoMs = 12000): Promise<CatalogoNcm> {
  const controller = new AbortController();
  let reader: ReadableStreamDefaultReader<Uint8Array> | undefined;
  let timer: ReturnType<typeof setTimeout> | undefined;
  const limite = new Promise<never>((_, rejeitar) => {
    timer = setTimeout(() => {
      controller.abort();
      void reader?.cancel().catch(() => undefined);
      rejeitar(new ErroNcm("tempo_esgotado"));
    }, tempoMs);
  });
  try {
    return await Promise.race([limite, (async () => {
      let url = URL_NCM;
      let resposta: Response | undefined;
      for (let salto = 0; salto <= 2; salto++) {
        resposta = await fetcher(url, { method: "GET", headers: { Accept: "application/json" }, cache: "no-store", redirect: "manual", signal: controller.signal });
        if (![301, 302, 303, 307, 308].includes(resposta.status)) break;
        const location = resposta.headers.get("location");
        const destino = location ? new URL(location, url).href : "";
        await resposta.body?.cancel();
        if (!redirecionamentoNcmPermitido(destino) || salto === 2) throw new ErroNcm("fonte_indisponivel");
        url = destino;
      }
      if (!resposta?.ok || !resposta.body) throw new ErroNcm("fonte_indisponivel");
      const tamanho = Number(resposta.headers.get("content-length") || 0);
      if (tamanho > NCM_MAX_BYTES) { await resposta.body.cancel(); throw new ErroNcm("tamanho_excedido"); }
      if ((resposta.headers.get("content-type") || "").toLowerCase().includes("text/html")) { await resposta.body.cancel(); throw new ErroNcm("resposta_invalida"); }
      reader = resposta.body.getReader();
      const partes: Uint8Array[] = [];
      let bytes = 0;
      while (true) {
        const parte = await reader.read();
        if (controller.signal.aborted) throw new ErroNcm("tempo_esgotado");
        if (parte.done) break;
        bytes += parte.value.byteLength;
        if (bytes > NCM_MAX_BYTES) { await reader.cancel(); throw new ErroNcm("tamanho_excedido"); }
        partes.push(parte.value);
      }
      const tudo = new Uint8Array(bytes);
      let posicao = 0;
      for (const parte of partes) { tudo.set(parte, posicao); posicao += parte.byteLength; }
      let bruto: unknown;
      try { bruto = JSON.parse(new TextDecoder("utf-8", { fatal: true }).decode(tudo)); }
      catch { throw new ErroNcm("resposta_invalida"); }
      return validarCatalogoNcm(bruto);
    })()]);
  } catch (erro) {
    if (erro instanceof ErroNcm) throw erro;
    throw new ErroNcm(controller.signal.aborted ? "tempo_esgotado" : "fonte_indisponivel");
  } finally {
    clearTimeout(timer);
    controller.abort();
    void reader?.cancel().catch(() => undefined);
  }
}
