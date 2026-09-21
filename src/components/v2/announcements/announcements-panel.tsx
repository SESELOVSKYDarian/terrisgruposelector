"use client";

import { useEffect, useState } from "react";
import { Archive } from "lucide-react";
import { miniButtonClass, primarySmallButtonClass } from "@/app/_components/ui-classes";
import { ANNOUNCEMENT_DESCRIPTION_MAX, ANNOUNCEMENT_TITLE_MAX } from "@/modules/announcements/validation";
import { cn } from "@/lib/utils";
import { clearAnnouncementDraft, peekAnnouncementDraft } from "../announcement-draft";
import { useHighlight } from "../highlight";
import { Card, Empty, Notice, fieldClass } from "../ui";
import { useModuleApi } from "../use-module-api";

type State = { canPublish: boolean; items: { id: string; title: string; description: string; created_at: string; author: string | null }[] };

function Composer({ run, busy }: { run: (action: string, payload?: Record<string, unknown>) => Promise<boolean>; busy: boolean }) {
  // A rain → Zoom switch (or any flow) can leave a prefilled draft behind.
  const [draft] = useState(peekAnnouncementDraft);
  const [title, setTitle] = useState(draft?.title ?? "");
  const [description, setDescription] = useState(draft?.description ?? "");
  const [result, setResult] = useState("");

  // The draft is used once: clear it after it has prefilled the form.
  useEffect(() => clearAnnouncementDraft, []);

  return (
    <Card title="Nuevo anuncio" description="Lo reciben todos como notificación (y push si lo activaron) y queda visible acá.">
      <div className="space-y-2">
        <label className="block text-xs text-muted">Título
          <input className={cn(fieldClass, "mt-1 block w-full")} maxLength={ANNOUNCEMENT_TITLE_MAX} onChange={(event) => setTitle(event.target.value)} placeholder="Ej. Salida del miércoles por Zoom" value={title} />
        </label>
        <label className="block text-xs text-muted">Descripción
          <textarea className={cn(fieldClass, "mt-1 block min-h-28 w-full")} maxLength={ANNOUNCEMENT_DESCRIPTION_MAX} onChange={(event) => setDescription(event.target.value)} placeholder="Debido a las condiciones climáticas…" value={description} />
        </label>
        <div className="flex items-center gap-3">
          <button className={primarySmallButtonClass} disabled={busy || !title.trim() || !description.trim()} onClick={async () => { if (await run("publish", { title, description })) { setTitle(""); setDescription(""); setResult("Anuncio publicado."); } }} type="button">Publicar</button>
          {result ? <span className="text-sm text-muted">{result}</span> : null}
        </div>
      </div>
    </Card>
  );
}

/** Anuncios: visible to everyone; only Coordinador and Superintendente de Servicio can publish. */
export function AnnouncementsPanel() {
  const { data, error, loading, busy, run } = useModuleApi<State>("/api/v2/announcements");
  useHighlight(Boolean(data));
  if (loading) return <Notice>Cargando anuncios…</Notice>;
  if (!data) return <Notice tone="error">{error || "No se pudieron cargar los anuncios."}</Notice>;
  return (
    <div className="space-y-4">
      {error ? <Notice tone="error">{error}</Notice> : null}
      {data.canPublish ? <Composer busy={busy} run={run} /> : null}
      {data.items.length ? (
        data.items.map((item) => (
          <article className="glass-panel-soft rounded-[1.25rem] p-4 transition" data-entity-id={item.id} key={item.id}>
            <div className="flex flex-wrap items-start justify-between gap-2">
              <h3 className="text-base font-semibold text-foreground">{item.title}</h3>
              {data.canPublish ? <button className={miniButtonClass} disabled={busy} onClick={() => void run("archive", { id: item.id })} type="button"><Archive size={14} aria-hidden="true" />Archivar</button> : null}
            </div>
            <p className="mt-2 whitespace-pre-wrap text-sm leading-6 text-foreground/90">{item.description}</p>
            <p className="mt-2 text-xs text-muted">{item.author ? `${item.author} · ` : ""}{new Date(item.created_at).toLocaleString("es-AR", { timeZone: "America/Argentina/Buenos_Aires", dateStyle: "medium", timeStyle: "short" })}</p>
          </article>
        ))
      ) : (
        <Empty>No hay anuncios por el momento.</Empty>
      )}
    </div>
  );
}
