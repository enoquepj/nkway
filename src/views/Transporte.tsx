"use client";

import { useMemo, useState } from "react";
import {
  Badge,
  Button,
  Campo,
  Card,
  CardTitulo,
  Icon,
  Input,
  Kpi,
  Modal,
  PageHeader,
  Select,
  cn,
  useToast,
} from "@/components/ui";
import { Tabela, type Coluna } from "@/components/Tabela";
import { UFS, dataBR, dataHoraBR, formatChave, moeda, round2 } from "@/lib/dominio";
import { cancelarMdfe, emitirMdfe, encerrarMdfe } from "@/server/acoes/transporte";
import type { listarMdfes } from "@/server/dados";

type Mdfe = Awaited<ReturnType<typeof listarMdfes>>[number];
type Nota = { chave: string; modelo: string; numeroNota: number; clienteNome: string; total: number; data: string };

export function TransporteView({
  mdfes,
  notas,
  empresa,
}: {
  mdfes: Mdfe[];
  notas: Nota[];
  empresa: { fantasia: string; razao: string; cnpj: string; ie: string; municipio: string; uf: string; endereco: string };
}) {
  const toast = useToast();
  const [form, setForm] = useState({
    ufFim: empresa.uf,
    municipioCarregamento: empresa.municipio,
    municipioDescarregamento: "",
    placa: "",
    ufVeiculo: empresa.uf,
    rntrc: "",
    condutor: "",
    cpfCondutor: "",
    pesoBruto: "",
  });
  const [selecionadas, setSelecionadas] = useState<string[]>([]);
  const [erro, setErro] = useState("");
  const [ocupado, setOcupado] = useState(false);
  const [vendo, setVendo] = useState<Mdfe | null>(null);
  const [cancelando, setCancelando] = useState<Mdfe | null>(null);
  const [motivo, setMotivo] = useState("");
  const [km, setKm] = useState("");

  const carga = round2(selecionadas.reduce((s, ch) => s + (notas.find((n) => n.chave === ch)?.total ?? 0), 0));
  const viagens = mdfes.filter((m) => m.status === "autorizado").length;

  const colunas: Coluna<Mdfe>[] = [
    {
      id: "numero",
      rotulo: "MDF-e",
      valor: (m) => m.numero,
      render: (m) => (
        <div>
          <p className="tabular text-[12.5px] font-bold text-ink-900">
            nº {m.numero} <span className="font-normal text-ink-400">série {m.serie}</span>
          </p>
          <p className="text-[10.5px] text-ink-400">{dataHoraBR(m.emitidoEm)}</p>
        </div>
      ),
    },
    {
      id: "rota",
      rotulo: "Rota",
      valor: (m) => `${m.ufInicio}-${m.ufFim}`,
      render: (m) => (
        <div className="text-[12px] text-ink-600">
          <p className="font-semibold text-ink-800">
            {m.municipioCarregamento || m.ufInicio} → {m.municipioDescarregamento || m.ufFim}
          </p>
          <p className="text-[10.5px] text-ink-400">
            {m.ufInicio}/{m.ufFim} · {m.documentos.length} documento(s)
          </p>
        </div>
      ),
    },
    {
      id: "veiculo",
      rotulo: "Veículo / condutor",
      valor: (m) => m.placa,
      render: (m) => (
        <div className="text-[12px]">
          <p className="font-mono font-semibold text-ink-800">{m.placa}</p>
          <p className="text-[10.5px] text-ink-400">
            {m.condutor} · RNTRC {m.rntrc || "—"}
          </p>
        </div>
      ),
    },
    { id: "peso", rotulo: "Peso bruto", alinhar: "direita", valor: (m) => m.pesoBruto, render: (m) => <span className="tabular text-[12px] text-ink-600">{m.pesoBruto.toFixed(2)} t</span> },
    { id: "carga", rotulo: "Valor da carga", alinhar: "direita", valor: (m) => m.valorCarga, render: (m) => <span className="tabular text-[13px] font-bold text-ink-900">{moeda(m.valorCarga)}</span> },
    {
      id: "status",
      rotulo: "Status",
      alinhar: "centro",
      valor: (m) => m.status,
      render: (m) => (
        <Badge tom={m.status === "autorizado" ? "info" : m.status === "encerrado" ? "ok" : "erro"}>
          {m.status === "autorizado" ? "em viagem" : m.status === "encerrado" ? `encerrado ${m.encerradoEm ? dataBR(m.encerradoEm) : ""}` : "cancelado"}
        </Badge>
      ),
    },
    {
      id: "acoes",
      rotulo: "",
      alinhar: "direita",
      ocultoNoCsv: true,
      render: (m) => (
        <div className="flex justify-end gap-1">
          <Button tamanho="sm" variante="fantasma" onClick={() => setVendo(m)}>
            DAMDFE
          </Button>
          {m.status === "autorizado" && (
            <Button
              tamanho="sm"
              variante="suave"
              onClick={async () => {
                const r = await encerrarMdfe(m.id, Number(km.replace(",", ".")) || undefined);
                toast(r.ok ? (r.aviso ?? "Manifesto encerrado.") : r.erro, r.ok ? "ok" : "erro");
              }}
            >
              Encerrar
            </Button>
          )}
          {m.status === "autorizado" && (
            <button type="button" onClick={() => setCancelando(m)} className="rounded-md p-1 text-ink-300 hover:bg-rose-50 hover:text-rose-600" title="Cancelar manifesto">
              <Icon name="x" className="size-4" />
            </button>
          )}
        </div>
      ),
    },
  ];

  return (
    <>
      <PageHeader
        titulo="MDF-e · transporte"
        subtitulo="Manifesto de documento fiscal eletrônico: vincula as notas da viagem, gera DAMDFE e registra o encerramento"
        acao={<Badge tom={viagens ? "info" : "ok"}>{viagens ? `${viagens} viagem(ns) em andamento` : "nenhuma viagem em andamento"}</Badge>}
      />

      <div className="mb-4 grid grid-cols-2 gap-3 lg:grid-cols-4">
        <Kpi rotulo="Manifestos emitidos" valor={String(mdfes.length)} icone="caminhoes" detalhe="autorizados + encerrados + cancelados" />
        <Kpi rotulo="Em viagem" valor={String(viagens)} tom={viagens ? "info" : "ok"} icone="raio" detalhe="aguardando encerramento" />
        <Kpi rotulo="Notas disponíveis" valor={String(notas.length)} icone="documento" detalhe="NF-e/NFC-e ainda sem manifesto" />
        <Kpi rotulo="Carga selecionada" valor={moeda(carga)} icone="caixaEstoque" tom="ok" detalhe={`${selecionadas.length} documento(s) marcados`} />
      </div>

      <div className="grid gap-4 xl:grid-cols-[1fr_1.45fr]">
        <Card>
          <CardTitulo titulo="Emitir manifesto" descricao="Selecione as notas da viagem e informe o veículo" icone="caminhoes" />
          {erro && <p className="mb-2 rounded-lg bg-rose-50 px-2.5 py-2 text-[12px] font-medium text-rose-700">{erro}</p>}
          <div className="grid gap-3 sm:grid-cols-2">
            <Campo rotulo="Placa" obrigatorio>
              <Input valor={form.placa} aoMudar={(v) => setForm({ ...form, placa: v })} placeholder="RQD-4F18" className="font-mono uppercase" />
            </Campo>
            <Campo rotulo="RNTRC">
              <Input valor={form.rntrc} aoMudar={(v) => setForm({ ...form, rntrc: v })} placeholder="12345678" />
            </Campo>
            <Campo rotulo="Condutor" obrigatorio className="sm:col-span-2">
              <Input valor={form.condutor} aoMudar={(v) => setForm({ ...form, condutor: v })} placeholder="nome completo do motorista" />
            </Campo>
            <Campo rotulo="CPF do condutor">
              <Input valor={form.cpfCondutor} aoMudar={(v) => setForm({ ...form, cpfCondutor: v })} placeholder="000.000.000-00" />
            </Campo>
            <Campo rotulo="Peso bruto (t)">
              <Input dinheiro valor={form.pesoBruto} aoMudar={(v) => setForm({ ...form, pesoBruto: v })} placeholder="0,000" />
            </Campo>
            <Campo rotulo="Carregamento">
              <Input valor={form.municipioCarregamento} aoMudar={(v) => setForm({ ...form, municipioCarregamento: v })} />
            </Campo>
            <Campo rotulo="Descarregamento">
              <Input valor={form.municipioDescarregamento} aoMudar={(v) => setForm({ ...form, municipioDescarregamento: v })} placeholder="Porto Velho" />
            </Campo>
            <Campo rotulo="UF destino">
              <Select valor={form.ufFim} aoMudar={(v) => setForm({ ...form, ufFim: v })} opcoes={Object.keys(UFS).map((u) => ({ valor: u, rotulo: u }))} />
            </Campo>
            <Campo rotulo="UF do veículo">
              <Select valor={form.ufVeiculo} aoMudar={(v) => setForm({ ...form, ufVeiculo: v })} opcoes={Object.keys(UFS).map((u) => ({ valor: u, rotulo: u }))} />
            </Campo>
          </div>

          <p className="micro mt-4 mb-1.5 text-ink-400">Documentos fiscais na viagem</p>
          <div className="max-h-64 overflow-auto rounded-xl border border-ink-100">
            {notas.length === 0 ? (
              <p className="px-3 py-6 text-center text-[12px] text-ink-400">Nenhuma nota pendente de manifesto.</p>
            ) : (
              <ul className="divide-y divide-ink-50">
                {notas.slice(0, 40).map((n) => {
                  const on = selecionadas.includes(n.chave);
                  return (
                    <li key={n.chave}>
                      <button
                        type="button"
                        onClick={() => setSelecionadas((a) => (a.includes(n.chave) ? a.filter((x) => x !== n.chave) : [...a, n.chave]))}
                        className={cn("flex w-full items-center gap-2.5 px-2.5 py-2 text-left transition", on ? "bg-way-50" : "hover:bg-ink-50")}
                      >
                        <span className={cn("grid size-4 shrink-0 place-items-center rounded-[4px] ring-1 ring-inset", on ? "bg-way-600 text-white ring-way-600" : "ring-ink-300")}>
                          {on && <Icon name="check" className="size-3" strokeWidth={3} />}
                        </span>
                        <span className="min-w-0 flex-1">
                          <span className="block truncate text-[12px] font-semibold text-ink-800">
                            {n.modelo} {n.numeroNota} · {n.clienteNome}
                          </span>
                          <span className="block truncate font-mono text-[10px] text-ink-400">{formatChave(n.chave).slice(0, 30)}…</span>
                        </span>
                        <span className="tabular shrink-0 text-[12px] font-bold text-ink-900">{moeda(n.total)}</span>
                      </button>
                    </li>
                  );
                })}
              </ul>
            )}
          </div>
          <Button
            className="mt-3 w-full"
            disabled={ocupado || selecionadas.length === 0}
            icone="caminhoes"
            onClick={async () => {
              setErro("");
              setOcupado(true);
              const r = await emitirMdfe({
                ufFim: form.ufFim,
                municipioCarregamento: form.municipioCarregamento,
                municipioDescarregamento: form.municipioDescarregamento,
                placa: form.placa,
                ufVeiculo: form.ufVeiculo,
                rntrc: form.rntrc,
                condutor: form.condutor,
                cpfCondutor: form.cpfCondutor,
                pesoBruto: Number(form.pesoBruto.replace(",", ".")) || 0,
                chaves: selecionadas,
              });
              setOcupado(false);
              if (!r.ok) return setErro(r.erro);
              setErro("");
              toast(r.aviso ?? "MDF-e autorizado.");
              setSelecionadas([]);
            }}
          >
            {ocupado ? "Transmitindo…" : `Emitir MDF-e · ${notas.length ? moeda(carga) : "selecione notas"}`}
          </Button>
        </Card>

        <div>
          <Tabela colunas={colunas} linhas={mdfes} chave={(m) => m.id} nomeExportar="nkway-mdfe" tamanhoPagina={10} vazio="Nenhum manifesto emitido. Monte a viagem no painel ao lado." />
        </div>
      </div>

      <Modal
        aberto={!!vendo}
        aoFechar={() => setVendo(null)}
        titulo="DAMDFE — documento auxiliar"
        descricao="Versão resumida para o vidro do caminhão"
        largura="max-w-xl"
        rodape={
          <Button variante="secundario" icone="imprimir" onClick={() => window.print()}>
            Imprimir
          </Button>
        }
      >
        {vendo && (
          <div className="space-y-3 rounded-lg border border-ink-200 p-4">
            <div className="flex items-start justify-between">
              <div>
                <p className="text-[13px] font-bold text-ink-900">{empresa.fantasia.toUpperCase()}</p>
                <p className="text-[11px] text-ink-500">
                  {empresa.endereco} · {empresa.municipio}/{empresa.uf} · CNPJ {empresa.cnpj}
                </p>
              </div>
              <Badge tom="info">MDF-e nº {vendo.numero}</Badge>
            </div>
            <p className="break-all rounded-md bg-ink-900 px-2.5 py-2 text-center font-mono text-[11px] font-bold tracking-tight text-white">
              {formatChave(vendo.chave)}
            </p>
            <div className="grid grid-cols-2 gap-2 text-[12px] sm:grid-cols-3">
              {[
                { r: "Placa", v: vendo.placa },
                { r: "RNTRC", v: vendo.rntrc || "—" },
                { r: "Condutor", v: vendo.condutor || "—" },
                { r: "Rota", v: `${vendo.municipioCarregamento || vendo.ufInicio} → ${vendo.municipioDescarregamento || vendo.ufFim}` },
                { r: "Peso", v: `${vendo.pesoBruto.toFixed(2)} t` },
                { r: "Emissão", v: dataHoraBR(vendo.emitidoEm) },
              ].map((x) => (
                <div key={x.r} className="rounded-md bg-ink-50 px-2 py-1.5">
                  <p className="micro text-ink-400">{x.r}</p>
                  <p className="mt-0.5 font-semibold text-ink-800">{x.v}</p>
                </div>
              ))}
            </div>
            <ul className="divide-y divide-ink-50 rounded-md border border-ink-100">
              {vendo.documentos.map((d, i) => (
                <li key={i} className="flex items-center gap-2 px-2.5 py-1.5 text-[11.5px]">
                  <Badge tom="neutro">{d.tipo}</Badge>
                  <span className="min-w-0 flex-1 truncate font-mono text-ink-500">{formatChave(d.chave)}</span>
                  <span className="tabular font-bold text-ink-900">{moeda(d.valor)}</span>
                </li>
              ))}
            </ul>
            <p className="text-[11px] text-ink-400">
              Carga total declarada {moeda(vendo.valorCarga)} · protocolo {vendo.protocolo || "—"} · {vendo.status === "encerrado" ? `encerrado em ${dataHoraBR(vendo.encerradoEm)}` : "manifesto ativo"}
            </p>
          </div>
        )}
      </Modal>

      <Modal
        aberto={!!cancelando}
        aoFechar={() => setCancelando(null)}
        titulo="Cancelar MDF-e"
        largura="max-w-md"
        rodape={
          <>
            <Button variante="secundario" onClick={() => setCancelando(null)}>
              Voltar
            </Button>
            <Button
              variante="perigo"
              disabled={ocupado}
              onClick={async () => {
                if (!cancelando) return;
                setOcupado(true);
                const r = await cancelarMdfe(cancelando.id, motivo);
                setOcupado(false);
                if (!r.ok) return toast(r.erro, "erro");
                toast(r.aviso ?? "MDF-e cancelada.");
                setCancelando(null);
              }}
            >
              Confirmar
            </Button>
          </>
        }
      >
        <Campo rotulo="Justificativa do evento" obrigatorio>
          <Input valor={motivo} aoMudar={setMotivo} placeholder="ex.: viagem cancelada por falha no veículo" />
        </Campo>
      </Modal>
    </>
  );
}
