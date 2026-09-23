"use client";

import { useEffect, useState } from "react";
import { Select } from "@/app/_components/select";
import { cn } from "@/lib/utils";

export type Assignee = { conductorId: string; groupId: string };

type Mode = "conductor" | "group";

/**
 * Who an outing is for: a conductor or a designated group (never both). The Conductor / Grupo switch
 * only changes what is shown; the assignment changes when a person or a group is actually picked.
 */
export function AssigneePicker({
  value,
  conductors,
  groups,
  onChange,
  disabled = false,
  className,
}: {
  value: Assignee;
  conductors: { id: string; full_name: string }[];
  groups: { id: string; name: string }[];
  onChange: (next: Assignee) => void;
  disabled?: boolean;
  className?: string;
}) {
  const [mode, setMode] = useState<Mode>(value.groupId ? "group" : "conductor");

  useEffect(() => {
    // An assignment that arrives from outside (roster suggestion, refresh) decides the visible mode.
    // eslint-disable-next-line react-hooks/set-state-in-effect -- syncing a view switch with an external value
    if (value.groupId) setMode("group");
    else if (value.conductorId) setMode("conductor");
  }, [value.conductorId, value.groupId]);

  return (
    <div className={cn("space-y-1.5", className)}>
      <div className="inline-flex rounded-lg bg-black/25 p-0.5" role="radiogroup" aria-label="Asignar a">
        {(["conductor", "group"] as const).map((option) => (
          <button
            aria-checked={mode === option}
            className={cn("cursor-pointer rounded-md px-2.5 py-1 text-xs font-medium transition disabled:cursor-not-allowed", mode === option ? "bg-primary/20 text-white" : "text-slate-400 hover:text-white")}
            disabled={disabled}
            key={option}
            onClick={() => setMode(option)}
            role="radio"
            type="button"
          >
            {option === "conductor" ? "Conductor" : "Grupo"}
          </button>
        ))}
      </div>
      {mode === "conductor" ? (
        <Select
          className="border-transparent bg-black/20 px-2 py-1"
          onChange={(conductorId) => conductorId !== value.conductorId && onChange({ conductorId, groupId: "" })}
          options={[{ value: "", label: "Sin conductor" }, ...conductors.map((conductor) => ({ value: conductor.id, label: conductor.full_name }))]}
          size="compact"
          value={value.groupId ? "" : value.conductorId}
        />
      ) : (
        <Select
          className="border-transparent bg-black/20 px-2 py-1"
          onChange={(groupId) => groupId !== value.groupId && onChange({ conductorId: "", groupId })}
          options={[{ value: "", label: "Sin grupo" }, ...groups.map((group) => ({ value: group.id, label: group.name }))]}
          size="compact"
          value={value.groupId}
        />
      )}
    </div>
  );
}
