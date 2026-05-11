"use client";

import {
  type ColumnDef,
  flexRender,
  getCoreRowModel,
  getFilteredRowModel,
  getSortedRowModel,
  type Row,
  type RowSelectionState,
  type SortingState,
  type Table,
  useReactTable,
} from "@tanstack/react-table";
import { ArrowDown, ArrowUp, ArrowUpDown } from "lucide-react";
import { type ReactNode, useEffect, useState } from "react";

// Per-column extra metadata DataTable consumes. Declared via TanStack's
// module-augmentation pattern so `meta: { stickyLeft: 32 }` is type-safe.
// The TData / TValue type params are required by the upstream interface
// signature (declaration merging compares names + arity); they're not used
// in our augmentation, so explicitly silence the lint rule below.
/* eslint-disable unused-imports/no-unused-vars */
declare module "@tanstack/react-table" {
  interface ColumnMeta<TData, TValue> {
    /** Pixel offset from the left edge where this column should stick. */
    stickyLeft?: number;
  }
}
/* eslint-enable unused-imports/no-unused-vars */

// DataTable is the canonical list view used by Files, Companies, and any
// other Overview page that lists records. Built on TanStack Table so the
// sort / filter / column-size primitives are consistent across pages.
//
// Styling is deliberately matched to the existing Tailwind look used by
// CompaniesOverview / ApplicationsOverview (border-b row separators, soft
// hover, px-8 gutters) — moving to this component shouldn't visually shift
// pages that already used the hand-rolled equivalents.

// TanStack ColumnDef is invariant in its `TValue` parameter, so an array of
// columns produced by `columnHelper.accessor("...", ...)` (each carrying a
// concrete value type) does NOT widen to `ColumnDef<TData, unknown>[]`.
// Using `any` here is the standard documented workaround and keeps callers
// from having to manually erase value types at every callsite.
// eslint-disable-next-line @typescript-eslint/no-explicit-any
type AnyColumnDef<TData> = ColumnDef<TData, any>;

export interface DataTableProps<TData> {
  data: TData[];
  columns: AnyColumnDef<TData>[];
  /** Optional controlled global filter. If omitted, the component manages it internally. */
  globalFilter?: string;
  onGlobalFilterChange?: (value: string) => void;
  /** Custom predicate for global filter; defaults to JSON.stringify().includes(). */
  globalFilterFn?: (row: Row<TData>, columnId: string, filterValue: string) => boolean;
  /** Initial sort state (component manages it from there). */
  initialSorting?: SortingState;
  /** Stable key for each row. Defaults to row index. */
  getRowId?: (row: TData, index: number) => string;
  /** Optional click handler — fires for the whole row except inside buttons/links. */
  onRowClick?: (row: TData) => void;
  /** Enable a sticky-left checkbox column for multi-row selection. */
  enableRowSelection?: boolean;
  rowSelection?: RowSelectionState;
  onRowSelectionChange?: (next: RowSelectionState) => void;
  /** Replaces the body when data is loading. */
  isLoading?: boolean;
  loadingNode?: ReactNode;
  /** Rendered when data is non-empty but filter matches nothing. */
  emptyFilteredNode?: ReactNode;
  /** Rendered when data itself is empty. */
  emptyNode?: ReactNode;
  /** Side-effect hook for cases where callers want raw access (e.g. test introspection). */
  onTableReady?: (table: Table<TData>) => void;
}

// Width of the sticky-left checkbox column when row selection is enabled.
const SELECT_COL_WIDTH = 32;

export function DataTable<TData>({
  data,
  columns,
  globalFilter,
  onGlobalFilterChange,
  globalFilterFn,
  initialSorting,
  getRowId,
  onRowClick,
  enableRowSelection,
  rowSelection,
  onRowSelectionChange,
  isLoading,
  loadingNode,
  emptyFilteredNode,
  emptyNode,
  onTableReady,
}: DataTableProps<TData>) {
  const [sorting, setSorting] = useState<SortingState>(initialSorting ?? []);
  const [internalFilter, setInternalFilter] = useState("");
  const filter = globalFilter ?? internalFilter;
  const setFilter = onGlobalFilterChange ?? setInternalFilter;
  const [internalSelection, setInternalSelection] = useState<RowSelectionState>({});
  const selection = rowSelection ?? internalSelection;
  const setSelection = onRowSelectionChange ?? setInternalSelection;

  // Prepend a select column when enabled; the column itself is sticky-left
  // at offset 0 so the header checkbox and per-row checkboxes stay visible
  // during horizontal scrolling.
  const effectiveColumns: AnyColumnDef<TData>[] = enableRowSelection
    ? [
        {
          id: "_select",
          size: SELECT_COL_WIDTH,
          enableSorting: false,
          meta: { stickyLeft: 0 },
          header: ({ table: tbl }) => (
            <input
              type="checkbox"
              checked={tbl.getIsAllRowsSelected()}
              ref={(el) => {
                if (el) el.indeterminate = tbl.getIsSomeRowsSelected();
              }}
              onChange={tbl.getToggleAllRowsSelectedHandler()}
              className="h-2.5 w-2.5 cursor-pointer rounded border-gray-200 accent-black"
              aria-label="Select all rows"
            />
          ),
          cell: ({ row }) => (
            <input
              type="checkbox"
              checked={row.getIsSelected()}
              onChange={row.getToggleSelectedHandler()}
              onClick={(e) => e.stopPropagation()}
              className="h-2.5 w-2.5 cursor-pointer rounded border-gray-200 accent-black"
              aria-label={`Select row`}
              data-row-action
            />
          ),
        },
        ...columns,
      ]
    : columns;

  // eslint-disable-next-line react-hooks/incompatible-library
  const table = useReactTable({
    data,
    columns: effectiveColumns,
    state: { sorting, globalFilter: filter, rowSelection: selection },
    onSortingChange: setSorting,
    onGlobalFilterChange: setFilter,
    onRowSelectionChange: (updater) => {
      const next = typeof updater === "function" ? updater(selection) : updater;
      setSelection(next);
    },
    enableRowSelection,
    getCoreRowModel: getCoreRowModel(),
    getFilteredRowModel: getFilteredRowModel(),
    getSortedRowModel: getSortedRowModel(),
    getRowId,
    globalFilterFn: globalFilterFn
      ? (row, columnId, value) => globalFilterFn(row, columnId, String(value ?? ""))
      : (row, _columnId, value) => {
          const q = String(value ?? "").toLowerCase();
          if (!q) return true;
          return JSON.stringify(row.original).toLowerCase().includes(q);
        },
  });

  useEffect(() => {
    onTableReady?.(table);
  }, [table, onTableReady]);

  const rows = table.getRowModel().rows;

  if (isLoading) {
    return <>{loadingNode ?? <div className="px-8 py-6 text-sm text-gray-500">Loading…</div>}</>;
  }
  if (data.length === 0) {
    return (
      <>{emptyNode ?? <div className="px-8 py-6 text-sm text-gray-500">No records yet.</div>}</>
    );
  }
  if (rows.length === 0) {
    return (
      <>
        {emptyFilteredNode ?? (
          <div className="px-8 py-6 text-sm text-gray-500">No records match that filter.</div>
        )}
      </>
    );
  }

  // Wrap the table in its own horizontal scroller so a wide table doesn't
  // force the whole page (and its sticky header) to scroll sideways. The
  // sticky thead stays pinned to the top of the page scroll container.
  return (
    <div className="w-full overflow-x-auto">
      <table className="w-full text-sm">
        <colgroup>
          {table.getVisibleLeafColumns().map((col) => (
            <col
              key={col.id}
              style={col.columnDef.size ? { width: `${col.columnDef.size}px` } : undefined}
            />
          ))}
        </colgroup>
        <thead className="sticky top-0 z-20 border-b border-gray-200 bg-white text-left text-xs font-medium tracking-wider text-gray-500 uppercase">
          {table.getHeaderGroups().map((headerGroup) => (
            <tr key={headerGroup.id}>
              {headerGroup.headers.map((header, idx) => {
                const sortDir = header.column.getIsSorted();
                const canSort = header.column.getCanSort();
                const isLast = idx === headerGroup.headers.length - 1;
                const stickyLeft = header.column.columnDef.meta?.stickyLeft;
                const stickyStyle =
                  stickyLeft !== undefined
                    ? { position: "sticky" as const, left: `${stickyLeft}px`, zIndex: 30 }
                    : undefined;
                return (
                  <th
                    key={header.id}
                    style={stickyStyle}
                    className={`${idx === 0 ? "pl-8" : "px-2"} ${
                      isLast ? "pr-8" : ""
                    } py-2 ${canSort ? "cursor-pointer select-none" : ""} ${
                      stickyLeft !== undefined ? "bg-white" : ""
                    }`}
                    onClick={canSort ? header.column.getToggleSortingHandler() : undefined}
                  >
                    <span className="inline-flex items-center gap-1">
                      {flexRender(header.column.columnDef.header, header.getContext())}
                      {canSort &&
                        (sortDir === "asc" ? (
                          <ArrowUp className="h-3 w-3 text-gray-400" />
                        ) : sortDir === "desc" ? (
                          <ArrowDown className="h-3 w-3 text-gray-400" />
                        ) : (
                          <ArrowUpDown className="h-3 w-3 text-gray-300" />
                        ))}
                    </span>
                  </th>
                );
              })}
            </tr>
          ))}
        </thead>
        <tbody>
          {rows.map((row) => {
            const rowSelected = row.getIsSelected();
            // Sticky-left cells need an opaque background or scrolled
            // content shows through. Match the row tint so it stays
            // consistent on hover/select.
            const stickyBgClass = rowSelected
              ? "bg-gray-50 group-hover:bg-gray-50"
              : "bg-white group-hover:bg-gray-50";
            return (
              <tr
                key={row.id}
                className={`group border-b border-gray-100 hover:bg-gray-50 ${
                  rowSelected ? "bg-gray-50" : ""
                } ${onRowClick ? "cursor-pointer" : ""}`}
                onClick={
                  onRowClick
                    ? (e) => {
                        const target = e.target as HTMLElement;
                        if (
                          target.closest("a, button, input, select, textarea, [data-row-action]")
                        ) {
                          return;
                        }
                        onRowClick(row.original);
                      }
                    : undefined
                }
              >
                {row.getVisibleCells().map((cell, idx) => {
                  const isLast = idx === row.getVisibleCells().length - 1;
                  const stickyLeft = cell.column.columnDef.meta?.stickyLeft;
                  const stickyStyle =
                    stickyLeft !== undefined
                      ? { position: "sticky" as const, left: `${stickyLeft}px`, zIndex: 10 }
                      : undefined;
                  return (
                    <td
                      key={cell.id}
                      style={stickyStyle}
                      className={`${idx === 0 ? "pl-8" : "px-2"} ${
                        isLast ? "pr-8" : ""
                      } py-2 align-middle ${stickyLeft !== undefined ? stickyBgClass : ""}`}
                    >
                      {flexRender(cell.column.columnDef.cell, cell.getContext())}
                    </td>
                  );
                })}
              </tr>
            );
          })}
        </tbody>
      </table>
    </div>
  );
}
