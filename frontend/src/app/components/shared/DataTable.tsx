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

/**
 * "fit": table fills its parent (min-w-full). A column without an explicit
 *   `size` absorbs leftover horizontal space. Use for list pages.
 * "fixed": each column is rendered at its exact `size` and the table is the
 *   sum of those sizes. Short tables leave white space to the right; wide
 *   tables overflow into the wrapper's horizontal scroll. Use for tables
 *   where each column represents a user-defined entity (e.g. tabular
 *   reviews) and column widths should not vary with viewport size.
 */
export type DataTableWidthMode = "fit" | "fixed";

/**
 * Cell density. Owns the base typography (`text-sm` vs `text-xs`) and the
 * default text color. Cell renderers should not restate these — only override
 * when they need a muted tint, a font weight, etc.
 */
export type DataTableDensity = "comfortable" | "compact";

const CELL_TYPOGRAPHY: Record<DataTableDensity, string> = {
  comfortable: "text-sm text-gray-800",
  compact: "text-xs text-gray-800",
};

export interface DataTableProps<TData> {
  data: TData[];
  columns: AnyColumnDef<TData>[];
  /** How the table chooses its own width relative to its parent. Defaults to "fit". */
  widthMode?: DataTableWidthMode;
  /** Base cell typography. Defaults to "comfortable". */
  density?: DataTableDensity;
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

/**
 * Layout classes shared by every header and body cell. The padding /
 * separator rule lives here once so that changes to either don't drift
 * between th and td (and so the select column gets the same right border
 * as everything else). Header- or body-only concerns layer on top.
 */
function cellLayoutClasses(args: {
  isSelect: boolean;
  isFirstData: boolean;
  isLast: boolean;
  enableRowSelection: boolean;
}): string {
  const padding = args.isSelect
    ? "px-1"
    : args.isFirstData
      ? args.enableRowSelection
        ? "pl-3"
        : "pl-8"
      : "px-2";
  const trailing = args.isLast ? "pr-8" : "";
  // With border-separate, each cell owns all four of its borders. We always
  // draw bottom (row separator) and conditionally right (column separator).
  const borders = args.isLast ? "border-b border-gray-200" : "border-r border-b border-gray-200";
  const textAlign = args.isSelect ? "text-center" : "";
  return [padding, trailing, "py-2", borders, textAlign].filter(Boolean).join(" ");
}

export function DataTable<TData>({
  data,
  columns,
  widthMode = "fit",
  density = "comfortable",
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

  // Width strategy is determined by the `widthMode` prop:
  //
  // - "fit" (default): the table fills the parent with `min-w-full`. One
  //   or more columns without an explicit `size` absorb leftover width.
  //   Use this on list pages where a primary column (e.g. Name) should
  //   stretch and you don't expect horizontal scroll.
  // - "fixed": each column is exactly its declared `size`. The table is
  //   `width = sum-of-sizes` (no min-width: 100%), so short tables show
  //   a clean right-hand white margin and wide tables overflow into
  //   horizontal scroll. Use this for tables where every column is a
  //   user-defined entity and widths shouldn't change with viewport.
  const totalColWidth = table.getVisibleLeafColumns().reduce((sum, col) => {
    return sum + (typeof col.columnDef.size === "number" ? col.columnDef.size : 0);
  }, 0);
  const tableStyle =
    widthMode === "fixed"
      ? { tableLayout: "fixed" as const, width: `${totalColWidth}px` }
      : { tableLayout: "fixed" as const };
  // border-separate (with border-spacing-0) is required so per-cell borders
  // render reliably on sticky-positioned cells; Chrome drops border-r on
  // `position: sticky` th/td under the default border-collapse: collapse.
  const tableClass = `border-separate border-spacing-0 ${widthMode === "fixed" ? "text-sm" : "min-w-full text-sm"}`;

  // All return paths render inside the same `h-full flex-col` shell so
  // pages can rely on the table area filling the available vertical space.
  // Without that, a 2-row table would shrink to ~80px tall and any header
  // popovers (e.g. column-edit menus) would hang into the surrounding
  // white space and get clipped by the parent's overflow rules.
  //
  // min-w-0 is load-bearing too: every flex item defaults to
  // `min-width: auto`, which lets a wide table push its parent wider than
  // the available area and defeats overflow-x scrolling. Forcing the shell
  // to be allowed to shrink keeps the inner scroll container effective.
  const shellClass = "flex h-full min-h-0 w-full min-w-0 flex-col";

  if (isLoading) {
    return (
      <div className={shellClass}>
        {loadingNode ?? <div className="px-8 py-6 text-sm text-gray-500">Loading…</div>}
      </div>
    );
  }
  if (data.length === 0) {
    return (
      <div className={shellClass}>
        {emptyNode ?? <div className="px-8 py-6 text-sm text-gray-500">No records yet.</div>}
      </div>
    );
  }
  if (rows.length === 0) {
    return (
      <div className={shellClass}>
        {emptyFilteredNode ?? (
          <div className="px-8 py-6 text-sm text-gray-500">No records match that filter.</div>
        )}
      </div>
    );
  }

  // Wrap the table in its own horizontal scroller so a wide table doesn't
  // force the whole page (and its sticky header) to scroll sideways. The
  // sticky thead stays pinned to the top of the page scroll container.
  // Outer shell fills vertical space; the trailing spacer below the table
  // extends the visible "table area" to the bottom of the parent so header
  // popovers have room to render and short tables don't shrink-wrap.
  return (
    <div className={shellClass}>
      {/*
        flex-1 on the scroll wrapper is load-bearing for header popovers
        (e.g. the column-edit menu). overflow-x: auto coerces overflow-y
        to non-visible per the CSS spec; if the wrapper is content-height,
        a popover opening downward from the header gets clipped where the
        last row ends. Letting the wrapper fill remaining vertical space
        gives popovers somewhere to render and also makes short tables
        present a continuous white surface.
      */}
      <div className="block w-full flex-1 overflow-x-auto bg-white">
        {/*
          table-layout: fixed is load-bearing here. Without it, the browser
          recomputes column widths from cell content on every render, so
          content-driven changes (a header dropdown opening, a hover state
          flickering, a cell finishing generation) make adjacent columns
          jiggle horizontally. With fixed layout, the <colgroup> sizes are
          authoritative and the table is visually stable.
        */}
        <table className={tableClass} style={tableStyle}>
          <colgroup>
            {table.getVisibleLeafColumns().map((col) => (
              <col
                key={col.id}
                style={col.columnDef.size ? { width: `${col.columnDef.size}px` } : undefined}
              />
            ))}
          </colgroup>
          <thead className="sticky top-0 z-20 bg-white text-left text-xs font-medium tracking-wider text-gray-500 uppercase">
            {table.getHeaderGroups().map((headerGroup) => (
              <tr key={headerGroup.id}>
                {headerGroup.headers.map((header, idx) => {
                  const sortDir = header.column.getIsSorted();
                  const canSort = header.column.getCanSort();
                  const isLast = idx === headerGroup.headers.length - 1;
                  const isSelect = header.column.id === "_select";
                  const firstDataIdx = enableRowSelection ? 1 : 0;
                  const stickyLeft = header.column.columnDef.meta?.stickyLeft;
                  const stickyStyle =
                    stickyLeft !== undefined
                      ? { position: "sticky" as const, left: `${stickyLeft}px`, zIndex: 30 }
                      : undefined;
                  const layout = cellLayoutClasses({
                    isSelect,
                    isFirstData: idx === firstDataIdx,
                    isLast,
                    enableRowSelection: !!enableRowSelection,
                  });
                  return (
                    <th
                      key={header.id}
                      style={stickyStyle}
                      className={`${layout} ${canSort ? "cursor-pointer select-none" : ""} ${
                        stickyLeft !== undefined ? "bg-white" : ""
                      }`}
                      onClick={canSort ? header.column.getToggleSortingHandler() : undefined}
                    >
                      <div className="flex w-full items-center gap-1">
                        <span className="min-w-0 flex-1">
                          {flexRender(header.column.columnDef.header, header.getContext())}
                        </span>
                        {canSort &&
                          (sortDir === "asc" ? (
                            <ArrowUp className="h-3 w-3 shrink-0 text-gray-400" />
                          ) : sortDir === "desc" ? (
                            <ArrowDown className="h-3 w-3 shrink-0 text-gray-400" />
                          ) : (
                            <ArrowUpDown className="h-3 w-3 shrink-0 text-gray-300" />
                          ))}
                      </div>
                    </th>
                  );
                })}
              </tr>
            ))}
          </thead>
          <tbody>
            {rows.map((row, rowIndex) => {
              const rowSelected = row.getIsSelected();
              // Zebra stripe odd rows with a barely-there tint so it reads as
              // rhythm, not banding. Selection and hover override it.
              const zebra = rowIndex % 2 === 1;
              const baseBgClass = rowSelected ? "bg-gray-50" : zebra ? "bg-gray-50/40" : "bg-white";
              // Sticky-left cells need an opaque background or scrolled
              // content shows through. Match the row tint so it stays
              // consistent on hover/select.
              const stickyBgClass = `${baseBgClass} group-hover:bg-gray-50`;
              return (
                <tr
                  key={row.id}
                  className={`group hover:bg-gray-50 ${baseBgClass} ${onRowClick ? "cursor-pointer" : ""}`}
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
                    const isSelect = cell.column.id === "_select";
                    const firstDataIdx = enableRowSelection ? 1 : 0;
                    const stickyLeft = cell.column.columnDef.meta?.stickyLeft;
                    const stickyStyle =
                      stickyLeft !== undefined
                        ? { position: "sticky" as const, left: `${stickyLeft}px`, zIndex: 10 }
                        : undefined;
                    const layout = cellLayoutClasses({
                      isSelect,
                      isFirstData: idx === firstDataIdx,
                      isLast,
                      enableRowSelection: !!enableRowSelection,
                    });
                    return (
                      <td
                        key={cell.id}
                        style={stickyStyle}
                        className={`${layout} align-middle ${isSelect ? "" : CELL_TYPOGRAPHY[density]} ${stickyLeft !== undefined ? stickyBgClass : ""}`}
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
    </div>
  );
}
