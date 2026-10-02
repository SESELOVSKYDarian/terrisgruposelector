"use client";

import { useState } from "react";
import { Building2, Check, ChevronRight, X } from "lucide-react";
import { Select } from "@/app/_components/select";
import { miniButtonClass, primarySmallButtonClass } from "@/app/_components/ui-classes";
import { cn } from "@/lib/utils";
import { useHighlight } from "../highlight";
import { Card, Empty, Notice, Pill, fieldClass } from "../ui";
import { useModuleApi } from "../use-module-api";
import { BuildingDetail, type BuildingData } from "./building-detail";
import { CensusInbox, type CensusRow } from "./census-inbox";
import { lockUnitLabels, type LockDuration } from "@/modules/buildings/activity";

type Item = { id: string; territory_id: string; territory_number: number; address: string; status: string; structure_version: number; unit_count: number; needs_census: boolean };
type Proposal = { id: string; territory_id: string | null; territory_number: number; address: string; author: string | null; unit_count: number | null; has_photo: boolean };
type State = { canManage: boolean; lock: LockDuration | null; buildings: Item[]; census: CensusRow[]; territories: { id: string; number: number; name: string | null }[]; proposals: Proposal[] };
type BulkResult = { created: number; duplicates: number; invalid: number; unknown_territories: number[] };

/** Many buildings at once: one per line, "Territorio[TAB]Dirección[TAB]Timbres separados por coma]". */
function BulkImportCard({ onChanged }: { onChanged: () => Promise<void> }) {
  const [text, setText] = useState("");
  const [result, setResult] = useState<BulkResult | null>(null);
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);

  async function send() {
    setBusy(true);
    setResult(null);
    setError("");
    try {
      const response = await fetch("/api/v2/buildings", { method: "POST", credentials: "same-origin", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ action: "bulkCreate", payload: { text } }) });
      const body = await response.json().catch(() => ({}));
      if (!response.ok) throw new Error(body?.error ?? "No se pudo importar.");
      setResult(body as BulkResult);
      setText("");
      await onChanged();
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "Error inesperado.");
    } finally {
      setBusy(false);
    }
  }

  return (
    <Card description="Pegá varios edificios de una, uno por línea: Territorio, Dirección y (opcional) los timbres separados por coma. Ej: 12\tPaso 456\tA,B,C,D" title="Carga masiva de edificios">
      <div className="space-y-2">
        {error ? <Notice tone="error">{error}</Notice> : null}
        {result ? (
          <Notice tone={result.invalid || result.unknown_territories.length ? "warning" : "success"}>
            {result.created} creado{result.created === 1 ? "" : "s"}, {result.duplicates} ya exist{result.duplicates === 1 ? "ía" : "ían"}, {result.invalid} línea{result.invalid === 1 ? "" : "s"} inválida{result.invalid === 1 ? "" : "s"}
            {result.unknown_territories.length ? `; territorios inexistentes: ${result.unknown_territories.join(", ")}` : ""}.
          </Notice>
        ) : null}
        <textarea className="min-h-32 w-full rounded-lg border border-border bg-background px-2.5 py-2 font-mono text-xs text-foreground outline-none focus:border-primary/60" onChange={(event) => setText(event.target.value)} placeholder={"12\tPaso 456\tA,B,C,D\n12\tPaso 460"} value={text} />
        <button className={primarySmallButtonClass} disabled={busy || !text.trim()} onClick={() => void send()} type="button">Importar</button>
      </div>
    </Card>
  );
}

/** Temporary lock after a doorbell was worked without a revisit: configurable, never a hardcoded 30 days. */
function LockSetting({ lock, run, busy }: { lock: LockDuration; run: (action: string, payload?: Record<string, unknown>) => Promise<boolean>; busy: boolean }) {
  const [amount, setAmount] = useState(String(lock.amount));
  const [unit, setUnit] = useState<LockDuration["unit"]>(lock.unit);
  return (
    <Card title="Tiempo de bloqueo" description="Cuánto queda bloqueado un departamento después de trabajarlo sin interés o sin que atiendan.">
      <div className="flex flex-wrap items-end gap-3">
        <label className="text-sm text-muted">Cantidad<input className={cn(fieldClass, "mt-1 block w-24")} inputMode="numeric" onChange={(event) => setAmount(event.target.value.replace(/\D/g, ""))} value={amount} /></label>
        <div className="w-40"><Select onChange={(value) => setUnit(value as LockDuration["unit"])} options={(Object.keys(lockUnitLabels) as LockDuration["unit"][]).map((key) => ({ value: key, label: lockUnitLabels[key] }))} size="compact" value={unit} /></div>
        <button className={primarySmallButtonClass} disabled={busy || !amount} onClick={() => void run("setLockDuration", { amount: Number(amount), unit })} type="button">Guardar</button>
      </div>
    </Card>
  );
}

/**
 * Requests for a new building (from the app or the public site). Managers see how many doorbells
 * were declared and the photo; "Crear edificio" makes it with that address and opens the editor so
 * the doorbells are typed in from the photo.
 */
function ProposalsCard({ proposals, territories, busy, run, onCreated }: { proposals: Proposal[]; territories: State["territories"]; busy: boolean; run: (action: string, payload?: Record<string, unknown>) => Promise<boolean>; onCreated: (buildingId: string, photo: string | null, proposal: Proposal) => void }) {
  const [territoryFor, setTerritoryFor] = useState<Record<string, string>>({});
  const [photos, setPhotos] = useState<Record<string, string | null>>({});
  const [error, setError] = useState("");
  const [working, setWorking] = useState(false);

  async function fetchPhoto(id: string) {
    const response = await fetch(`/api/v2/buildings?proposalPhoto=${id}`, { credentials: "same-origin" });
    const body = await response.json().catch(() => ({}));
    const photo = response.ok ? ((body.photo as string | null) ?? null) : null;
    setPhotos((current) => ({ ...current, [id]: photo }));
    return photo;
  }

  async function create(proposal: Proposal) {
    setError("");
    const territory_id = proposal.territory_id ?? territoryFor[proposal.id] ?? null;
    if (!territory_id) {
      setError("Elegí el territorio al que pertenece el edificio.");
      return;
    }
    setWorking(true);
    try {
      const response = await fetch("/api/v2/buildings", { method: "POST", credentials: "same-origin", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ action: "decideProposal", payload: { id: proposal.id, approve: true, territory_id } }) });
      const body = await response.json().catch(() => ({}));
      if (!response.ok) throw new Error(body?.error ?? "No se pudo crear el edificio.");
      const photo = proposal.has_photo ? (photos[proposal.id] ?? (await fetchPhoto(proposal.id))) : null;
      onCreated(body.building_id as string, photo, proposal);
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "Error inesperado.");
    } finally {
      setWorking(false);
    }
  }

  return (
    <Card title="Solicitudes de edificio nuevo" description="Para ser un edificio necesita 6 timbres o más. Al crearlo se abre el editor para que cargues los timbres que se ven en la foto.">
      {error ? <Notice tone="error">{error}</Notice> : null}
      {proposals.map((proposal) => (
        <div className="space-y-2 rounded-xl bg-foreground/[0.03] px-3 py-2" data-entity-id={proposal.id} key={proposal.id}>
          <div className="flex flex-wrap items-center gap-2">
            <div className="min-w-48 flex-1">
              <p className="text-sm font-medium text-foreground">{proposal.address}</p>
              <p className="text-xs text-muted">{proposal.territory_id ? `Territorio ${proposal.territory_number}` : "Sin territorio"}{proposal.unit_count ? ` · ${proposal.unit_count} timbres declarados` : ""}{proposal.author ? ` · ${proposal.author}` : ""}</p>
            </div>
            {!proposal.territory_id ? <div className="w-44"><Select onChange={(value) => setTerritoryFor((current) => ({ ...current, [proposal.id]: value }))} options={territories.map((entry) => ({ value: entry.id, label: `Territorio ${entry.number}` }))} placeholder="Territorio" size="compact" value={territoryFor[proposal.id] ?? ""} /></div> : null}
            <button className={miniButtonClass} disabled={busy || working} onClick={() => void create(proposal)} type="button"><Check size={14} aria-hidden="true" />Crear edificio</button>
            <button className={miniButtonClass} disabled={busy || working} onClick={() => void run("decideProposal", { id: proposal.id, approve: false })} type="button"><X size={14} aria-hidden="true" />No agregar</button>
          </div>
          {proposal.has_photo ? (photos[proposal.id] ? <img alt="Foto de los timbres" className="max-h-72 rounded-lg" src={photos[proposal.id]!} /> : <button className={miniButtonClass} onClick={() => void fetchPhoto(proposal.id)} type="button">Ver foto de los timbres</button>) : null}
        </div>
      ))}
    </Card>
  );
}

/**
 * Buildings of a territory (or of all of them for managers). Everyone who can consult the
 * territory searches and opens buildings; they can also report a new one, which managers approve.
 */
export function BuildingsBrowser({ territoryId, detailExtras }: { territoryId?: string; detailExtras?: (unit: BuildingData["units"][number], building: BuildingData) => React.ReactNode }) {
  const [query, setQuery] = useState("");
  const [filter, setFilter] = useState(territoryId ?? "");
  const [openId, setOpenId] = useState<string | null>(null);
  const [evidence, setEvidence] = useState<CensusRow | null>(null);
  const [evidencePhoto, setEvidencePhoto] = useState<string | null>(null);
  const [newTerritory, setNewTerritory] = useState(territoryId ?? "");
  const [newAddress, setNewAddress] = useState("");
  const [notice, setNotice] = useState("");
  const path = `/api/v2/buildings?${new URLSearchParams({ ...(filter ? { territory: filter } : {}), ...(query.trim() ? { q: query.trim() } : {}) }).toString()}`;
  const { data, error, loading, busy, run, reload } = useModuleApi<State>(path);
  useHighlight(Boolean(data));

  if (openId) {
    return (
      <div className="space-y-3">
        {evidencePhoto ? <Card title="Foto de los timbres" description="Cargá en el editor los timbres que se ven acá."><img alt="Foto de los timbres" className="max-h-96 rounded-lg" src={evidencePhoto} /></Card> : null}
        <BuildingDetail buildingId={openId} evidence={evidence} onBack={() => { setOpenId(null); setEvidence(null); setEvidencePhoto(null); void reload(); }} renderUnit={detailExtras} startEditing={Boolean(evidence)} />
      </div>
    );
  }
  if (loading && !data) return <Notice>Cargando edificios…</Notice>;
  if (!data) return <Notice tone="error">{error || "No se pudieron cargar los edificios."}</Notice>;

  async function submit() {
    const action = data?.canManage ? "create" : "propose";
    if (await run(action, { territory_id: newTerritory, address: newAddress })) {
      setNewAddress("");
      setNotice(action === "create" ? "Edificio creado." : "Propuesta enviada: Servicio y Territorios la van a revisar.");
    }
  }

  return (
    <div className="space-y-4">
      {error ? <Notice tone="error">{error}</Notice> : null}
      {notice ? <Notice tone="success">{notice}</Notice> : null}

      <div className="flex flex-wrap items-center gap-2">
        <input aria-label="Buscar edificio" className={cn(fieldClass, "min-w-56 flex-1")} onChange={(event) => setQuery(event.target.value)} placeholder="Buscar por dirección (ej. Paso 123)" type="search" value={query} />
        {!territoryId ? <div className="w-52"><Select onChange={setFilter} options={[{ value: "", label: "Todos los territorios" }, ...data.territories.map((entry) => ({ value: entry.id, label: `Territorio ${entry.number}` }))]} size="compact" value={filter} /></div> : null}
      </div>

      {data.canManage && data.lock ? <LockSetting busy={busy} lock={data.lock} run={run} /> : null}
      {data.canManage ? <BulkImportCard onChanged={reload} /> : null}

      <CensusInbox busy={busy} items={data.census} onOpenEditor={(row) => { setEvidence(row); setOpenId(row.building_id); }} run={run} />

      {data.proposals.length ? (
        <ProposalsCard
          busy={busy}
          onCreated={(buildingId, photo, proposal) => {
            setEvidencePhoto(photo);
            setEvidence({ id: proposal.id, building_id: buildingId, address: proposal.address, territory_number: proposal.territory_number, reason: "FALTAN_TIMBRES", description: `Edificio nuevo${proposal.unit_count ? `: ${proposal.unit_count} timbres declarados` : ""}. Cargá los timbres de la foto.`, diff: null, base_version: 1, current_version: 1, has_photo: Boolean(photo), reporter: proposal.author, created_at: new Date().toISOString() });
            setOpenId(buildingId);
          }}
          proposals={data.proposals}
          run={run}
          territories={data.territories}
        />
      ) : null}

      <Card title={data.canManage ? "Nuevo edificio" : "Informar un edificio nuevo"} description={data.canManage ? "Se crea directamente; después cargás sus timbres." : "Queda pendiente hasta que Servicio o Territorios lo aprueben."}>
        <div className="flex flex-wrap items-end gap-3">
          {!territoryId ? <div className="w-48"><Select onChange={setNewTerritory} options={data.territories.map((entry) => ({ value: entry.id, label: `Territorio ${entry.number}` }))} placeholder="Territorio" size="compact" value={newTerritory} /></div> : null}
          <label className="min-w-56 flex-1 text-sm text-muted">Dirección<input className={cn(fieldClass, "mt-1 block w-full")} onChange={(event) => setNewAddress(event.target.value)} placeholder="Ej. Paso 456" value={newAddress} /></label>
          <button className={primarySmallButtonClass} disabled={busy || !newTerritory || newAddress.trim().length < 3} onClick={() => void submit()} type="button">{data.canManage ? "Crear" : "Informar"}</button>
        </div>
      </Card>

      {data.buildings.length ? (
        <div className="space-y-2">
          {data.buildings.map((building) => (
            <button className="flex w-full items-center gap-3 rounded-xl bg-foreground/[0.03] px-3 py-3 text-left transition hover:bg-foreground/[0.06]" key={building.id} onClick={() => setOpenId(building.id)} type="button">
              <Building2 className="text-muted" size={18} aria-hidden="true" />
              <span className="min-w-0 flex-1"><span className="block truncate text-sm font-medium text-foreground">{building.address}</span><span className="block text-xs text-muted">Territorio {building.territory_number} · {building.unit_count} timbre{building.unit_count === 1 ? "" : "s"}</span></span>
              {building.needs_census ? <Pill tone="amber">Falta censar</Pill> : null}
              {building.status !== "ACTIVE" ? <Pill tone="slate">Inactivo</Pill> : null}
              <ChevronRight className="text-muted" size={16} aria-hidden="true" />
            </button>
          ))}
        </div>
      ) : (
        <Empty>{query ? "No hay edificios que coincidan con la búsqueda." : "Todavía no hay edificios cargados."}</Empty>
      )}
    </div>
  );
}
