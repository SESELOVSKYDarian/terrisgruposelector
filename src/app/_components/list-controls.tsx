"use client";

import { useMemo, useState } from "react";
import { ChevronLeft, ChevronRight, Search } from "lucide-react";
import { cn } from "@/lib/utils";

const PAGE_SIZE = 10;

export function useListControls<T>({
  items,
  searchText,
  dateValue,
}: {
  items: T[];
  searchText: (item: T) => string;
  dateValue?: (item: T) => string | null;
}) {
  const [query, setQueryState] = useState("");
  const [dateFrom, setDateFromState] = useState("");
  const [dateTo, setDateToState] = useState("");
  const [page, setPage] = useState(1);

  const filtered = useMemo(() => {
    const term = query.trim().toLowerCase();
    return items.filter((item) => {
      if (term && !searchText(item).toLowerCase().includes(term)) return false;
      if (dateValue && (dateFrom || dateTo)) {
        const value = dateValue(item);
        if (!value) return false;
        if (dateFrom && value < dateFrom) return false;
        if (dateTo && value > dateTo) return false;
      }
      return true;
    });
  }, [items, query, dateFrom, dateTo, searchText, dateValue]);

  const totalPages = Math.max(1, Math.ceil(filtered.length / PAGE_SIZE));
  const clampedPage = Math.min(page, totalPages);
  const paged = filtered.slice((clampedPage - 1) * PAGE_SIZE, clampedPage * PAGE_SIZE);

  function setQuery(value: string) {
    setQueryState(value);
    setPage(1);
  }
  function setDateFrom(value: string) {
    setDateFromState(value);
    setPage(1);
  }
  function setDateTo(value: string) {
    setDateToState(value);
    setPage(1);
  }
  function setQuickRange(days: number | null) {
    if (days === null) {
      setDateFromState("");
      setDateToState("");
    } else {
      const to = new Date();
      const from = new Date();
      from.setDate(from.getDate() - days);
      setDateFromState(from.toISOString().slice(0, 10));
      setDateToState(to.toISOString().slice(0, 10));
    }
    setPage(1);
  }

  return {
    query,
    setQuery,
    dateFrom,
    setDateFrom,
    dateTo,
    setDateTo,
    setQuickRange,
    page: clampedPage,
    setPage,
    pageSize: PAGE_SIZE,
    filtered,
    paged,
    totalPages,
    total: filtered.length,
  };
}

export function ListToolbar({
  query,
  onQueryChange,
  placeholder = "Buscar...",
  dateFrom,
  dateTo,
  onDateFromChange,
  onDateToChange,
  onQuickRange,
  showDateFilter,
}: {
  query: string;
  onQueryChange: (value: string) => void;
  placeholder?: string;
  dateFrom?: string;
  dateTo?: string;
  onDateFromChange?: (value: string) => void;
  onDateToChange?: (value: string) => void;
  onQuickRange?: (days: number | null) => void;
  showDateFilter?: boolean;
}) {
  return (
    <div className="mb-3 flex flex-wrap items-center gap-2">
      <div className="relative min-w-[200px] flex-1">
        <Search aria-hidden="true" className="pointer-events-none absolute left-3 top-1/2 -translate-y-1/2 text-slate-500" size={15} />
        <input
          className="h-10 w-full rounded-lg border border-white/10 bg-black/20 pl-9 pr-3 text-sm text-white outline-none transition placeholder:text-slate-600 focus:border-primary/50 focus:ring-4 focus:ring-primary/10"
          onChange={(event) => onQueryChange(event.target.value)}
          placeholder={placeholder}
          value={query}
        />
      </div>
      {showDateFilter ? (
        <div className="flex flex-wrap items-center gap-1.5">
          <input
            className="h-10 rounded-lg border border-white/10 bg-black/20 px-2.5 text-sm text-white outline-none transition focus:border-primary/50"
            onChange={(event) => onDateFromChange?.(event.target.value)}
            type="date"
            value={dateFrom ?? ""}
          />
          <span className="text-xs text-slate-500">a</span>
          <input
            className="h-10 rounded-lg border border-white/10 bg-black/20 px-2.5 text-sm text-white outline-none transition focus:border-primary/50"
            onChange={(event) => onDateToChange?.(event.target.value)}
            type="date"
            value={dateTo ?? ""}
          />
          <button className="rounded-lg border border-white/10 bg-white/[0.04] px-2.5 py-2 text-xs font-medium text-slate-300 transition hover:bg-white/[0.08] hover:text-white" onClick={() => onQuickRange?.(7)} type="button">
            Ultima semana
          </button>
          <button className="rounded-lg border border-white/10 bg-white/[0.04] px-2.5 py-2 text-xs font-medium text-slate-300 transition hover:bg-white/[0.08] hover:text-white" onClick={() => onQuickRange?.(30)} type="button">
            Ultimo mes
          </button>
          {dateFrom || dateTo ? (
            <button className="rounded-lg px-2 py-2 text-xs font-medium text-slate-500 transition hover:text-white" onClick={() => onQuickRange?.(null)} type="button">
              Limpiar
            </button>
          ) : null}
        </div>
      ) : null}
    </div>
  );
}

export function PaginationBar({
  page,
  totalPages,
  total,
  pageSize,
  onPageChange,
}: {
  page: number;
  totalPages: number;
  total: number;
  pageSize: number;
  onPageChange: (page: number) => void;
}) {
  if (total === 0) return null;
  const start = (page - 1) * pageSize + 1;
  const end = Math.min(page * pageSize, total);
  return (
    <div className="mt-3 flex items-center justify-between gap-3 text-sm text-slate-400">
      <p>Mostrando {start}-{end} de {total}</p>
      <div className="flex items-center gap-1">
        <button
          className={cn("inline-flex h-8 w-8 items-center justify-center rounded-lg border border-white/10 text-slate-300 transition hover:bg-white/[0.06] hover:text-white disabled:cursor-not-allowed disabled:opacity-30")}
          disabled={page <= 1}
          onClick={() => onPageChange(page - 1)}
          type="button"
        >
          <ChevronLeft size={15} aria-hidden="true" />
        </button>
        <span className="px-2 text-xs">Pagina {page} de {totalPages}</span>
        <button
          className={cn("inline-flex h-8 w-8 items-center justify-center rounded-lg border border-white/10 text-slate-300 transition hover:bg-white/[0.06] hover:text-white disabled:cursor-not-allowed disabled:opacity-30")}
          disabled={page >= totalPages}
          onClick={() => onPageChange(page + 1)}
          type="button"
        >
          <ChevronRight size={15} aria-hidden="true" />
        </button>
      </div>
    </div>
  );
}
