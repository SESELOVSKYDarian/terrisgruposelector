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

type Item = { id: string; territory_id: string; territory_number: number; address: string; status: string; structure_version: number; unit_count: number };
type Proposal = { id: string; territory_id: string; territory_number: number; address: string; author: string | null };
type State = { canManage: boolean; buildings: Item[]; territories: { id: string; number: number; name: string | null }[]; proposals: Proposal[] };

/**
 * Buildings of a territory (or of all of them for managers). Everyone who can consult the
 * territory searches and opens buildings; they can also report a new one, which managers approve.
 */
export function BuildingsBrowser({ territoryId, detailExtras }: { territoryId?: string; detailExtras?: (unit: BuildingData["units"][number], building: BuildingData) => React.ReactNode }) {
  const [query, setQuery] = useState("");
  const [filter, setFilter] = useState(territoryId ?? "");
  const [openId, setOpenId] = useState<string | null>(null);
  const [newTerritory, setNewTerritory] = useState(territoryId ?? "");
  const [newAddress, setNewAddress] = useState("");
  const [notice, setNotice] = useState("");
  const path = `/api/v2/buildings?${new URLSearchParams({ ...(filter ? { territory: filter } : {}), ...(query.trim() ? { q: query.trim() } : {}) }).toString()}`;
  const { data, error, loading, busy, run, reload } = useModuleApi<State>(path);
  useHighlight(Boolean(data));

  if (openId) return <BuildingDetail buildingId={openId} onBack={() => { setOpenId(null); void reload(); }} renderUnit={detailExtras} />;
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

      {data.proposals.length ? (
        <Card title="Propuestas pendientes" description="Solo lo aprobado pasa a ser un edificio oficial.">
          {data.proposals.map((proposal) => (
            <div className="flex flex-wrap items-center gap-2 rounded-xl bg-foreground/[0.03] px-3 py-2" data-entity-id={proposal.id} key={proposal.id}>
              <div className="min-w-48 flex-1"><p className="text-sm font-medium text-foreground">{proposal.address}</p><p className="text-xs text-muted">Territorio {proposal.territory_number}{proposal.author ? ` · propuesto por ${proposal.author}` : ""}</p></div>
              <button className={miniButtonClass} disabled={busy} onClick={() => void run("decideProposal", { id: proposal.id, approve: true })} type="button"><Check size={14} aria-hidden="true" />Aprobar</button>
              <button className={miniButtonClass} disabled={busy} onClick={() => void run("decideProposal", { id: proposal.id, approve: false })} type="button"><X size={14} aria-hidden="true" />Rechazar</button>
            </div>
          ))}
        </Card>
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
