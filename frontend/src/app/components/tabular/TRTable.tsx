"use client";

import { createColumnHelper } from "@tanstack/react-table";
import { Plus, Table2 } from "lucide-react"; // Plus used in empty state's Add Documents button
import { forwardRef, useImperativeHandle, useMemo, useRef } from "react";

import { DataTable } from "../shared/DataTable";
import type { ColumnConfig, LukeDocument, TabularCell } from "../shared/types";
import { TabularCell as TabularCellComponent } from "./TabularCell";
import { TREditColumnMenu } from "./TREditColumnMenu";

// Width hints. DataTable lays out via <colgroup>, so these flow through
// directly to the th/td widths.
const CHECK_COL_PX = 32;
const DOC_COL_PX = 300;
const DATA_COL_PX = 300;

export interface TRTableHandle {
  /**
   * Scroll the table so the cell at (colIdx, rowIdx) is visible.
   * `colIdx` is the position within the sorted column list (0-based);
   * `rowIdx` is the document position within the rendered table.
   */
  scrollToCell: (colIdx: number, rowIdx: number) => void;
}

interface Props {
  loading: boolean;
  columns: ColumnConfig[];
  documents: LukeDocument[];
  cells: TabularCell[];
  savingColumn: boolean;
  savingColumnsConfig: boolean;
  selectedDocIds: string[];
  highlightedCell?: { colIdx: number; rowIdx: number } | null;
  onSelectionChange: (ids: string[]) => void;
  onExpand: (cell: TabularCell) => void;
  onCitationClick: (cell: TabularCell, page: number, quote: string) => void;
  onUpdateColumn: (col: ColumnConfig) => void;
  onDeleteColumn: (colIndex: number) => void;
  onAddColumn: () => void;
  onAddDocuments: () => void;
}

const columnHelper = createColumnHelper<LukeDocument>();

export const TRTable = forwardRef<TRTableHandle, Props>(function TRTable(
  {
    loading,
    columns,
    documents,
    cells,
    savingColumn,
    savingColumnsConfig,
    selectedDocIds,
    highlightedCell,
    onSelectionChange,
    onExpand,
    onCitationClick,
    onUpdateColumn,
    onDeleteColumn,
    onAddColumn,
    onAddDocuments,
  },
  ref,
) {
  const containerRef = useRef<HTMLDivElement>(null);
  const sortedColumns = useMemo(() => [...columns].sort((a, b) => a.index - b.index), [columns]);

  // Expose imperative scrolling. The actual scroll happens on whichever
  // descendant of `containerRef` is the horizontally-scrollable element
  // (DataTable wraps its table in `overflow-x-auto`). We locate cells by the
  // data-row/col attrs we set on the rendered td below.
  useImperativeHandle(
    ref,
    () => ({
      scrollToCell(colIdx, rowIdx) {
        const root = containerRef.current;
        if (!root) return;
        const cell = root.querySelector<HTMLElement>(
          `[data-tr-row="${rowIdx}"][data-tr-col="${colIdx}"]`,
        );
        if (!cell) return;
        // Vertical scroll happens on the page; horizontal scroll on the
        // table's own overflow container. Compute both.
        const verticalContainer = root.closest<HTMLElement>(".overflow-y-auto") ?? root;
        const horizontalContainer = cell.closest<HTMLElement>(".overflow-x-auto") ?? root;
        const rect = cell.getBoundingClientRect();
        const hostRect = verticalContainer.getBoundingClientRect();
        verticalContainer.scrollTo({
          top: verticalContainer.scrollTop + (rect.top - hostRect.top) - 40,
          behavior: "smooth",
        });
        const hRect = horizontalContainer.getBoundingClientRect();
        horizontalContainer.scrollTo({
          left:
            horizontalContainer.scrollLeft +
            (rect.left - hRect.left) -
            horizontalContainer.clientWidth / 2 +
            cell.clientWidth / 2,
          behavior: "smooth",
        });
      },
    }),
    [],
  );

  // ---------------------------------------------------------------------------
  // Selection state plumbing — convert between the parent's string[] and the
  // RowSelectionState shape DataTable expects.
  // ---------------------------------------------------------------------------
  const rowSelection = useMemo(() => {
    const out: Record<string, boolean> = {};
    for (const id of selectedDocIds) out[id] = true;
    return out;
  }, [selectedDocIds]);

  // ---------------------------------------------------------------------------
  // Columns
  // ---------------------------------------------------------------------------
  const tableColumns = useMemo(() => {
    const cellsByKey = new Map<string, TabularCell>();
    for (const c of cells) {
      cellsByKey.set(`${c.document_id}|${c.column_index}`, c);
    }

    const userCols = sortedColumns.map((col, colPos) =>
      columnHelper.display({
        id: `tr-col-${col.index}`,
        size: DATA_COL_PX,
        enableSorting: false,
        header: () => (
          <div className="flex w-full items-center justify-between gap-3 text-left text-xs font-medium text-gray-500 normal-case">
            <span className="truncate" title={col.name}>
              {col.name}
            </span>
            <TREditColumnMenu
              column={col}
              disabled={savingColumn || savingColumnsConfig}
              onSave={onUpdateColumn}
              onDelete={onDeleteColumn}
            />
          </div>
        ),
        cell: (info) => {
          const doc = info.row.original;
          const cell = cellsByKey.get(`${doc.id}|${col.index}`);
          const rowIdx = info.row.index;
          const isHighlighted =
            highlightedCell?.colIdx === colPos && highlightedCell?.rowIdx === rowIdx;
          return (
            <div
              data-tr-row={rowIdx}
              data-tr-col={colPos}
              className={`-mx-2 -my-2 transition-colors ${isHighlighted ? "bg-blue-200" : ""}`}
            >
              {cell && (
                <TabularCellComponent
                  cell={cell}
                  column={col}
                  onExpand={() => onExpand(cell)}
                  onCitationClick={(page, quote) => onCitationClick(cell, page, quote)}
                />
              )}
            </div>
          );
        },
      }),
    );

    return [
      columnHelper.accessor("filename", {
        header: () => <span className="normal-case">Document</span>,
        id: "doc",
        size: DOC_COL_PX,
        enableSorting: false,
        meta: { stickyLeft: CHECK_COL_PX },
        cell: (info) => (
          <span className="line-clamp-1" title={info.getValue()}>
            {info.getValue()}
          </span>
        ),
      }),
      ...userCols,
    ];
  }, [
    sortedColumns,
    cells,
    highlightedCell,
    savingColumn,
    savingColumnsConfig,
    onUpdateColumn,
    onDeleteColumn,
    onExpand,
    onCitationClick,
  ]);

  // ---------------------------------------------------------------------------
  // Empty state — landing card with Add Columns + Add Documents buttons.
  // ---------------------------------------------------------------------------
  if (!loading && columns.length === 0 && documents.length === 0) {
    return (
      <div className="mx-auto flex w-full max-w-xs flex-1 flex-col items-start justify-center py-16">
        <Table2 className="mb-4 h-8 w-8 text-gray-300" />
        <p className="font-serif text-2xl font-medium text-gray-900">Tabular Review</p>
        <p className="mt-1 text-left text-xs text-gray-400">
          Add columns and documents to get started.
        </p>
        <div className="mt-4 flex items-center gap-2">
          <button
            onClick={onAddColumn}
            className="inline-flex items-center gap-1 rounded-full bg-gray-900 px-3 py-1 text-xs font-medium text-white shadow-md transition-colors hover:bg-gray-700"
          >
            + Add Columns
          </button>
          <button
            onClick={onAddDocuments}
            className="inline-flex items-center gap-1.5 rounded-full border border-gray-200 bg-white px-3 py-1 text-xs font-medium text-gray-600 shadow-sm transition-colors hover:bg-gray-50"
          >
            <Plus className="h-3.5 w-3.5" />
            Add Documents
          </button>
        </div>
      </div>
    );
  }

  return (
    <div ref={containerRef} className="flex h-full min-h-0 min-w-0 flex-1 flex-col">
      <DataTable
        data={documents}
        columns={tableColumns}
        widthMode="fixed"
        density="compact"
        getRowId={(row) => row.id}
        enableRowSelection
        rowSelection={rowSelection}
        onRowSelectionChange={(next) => {
          onSelectionChange(Object.keys(next).filter((id) => next[id]));
        }}
        isLoading={loading}
        loadingNode={
          <div className="space-y-2 px-8 py-5">
            {[1, 2, 3, 4, 5].map((i) => (
              <div key={i} className="h-8 w-full max-w-3xl animate-pulse rounded bg-gray-100" />
            ))}
          </div>
        }
        emptyNode={
          <div className="px-8 py-12 text-center text-sm text-gray-400">
            No documents in this review yet.
          </div>
        }
      />
    </div>
  );
});
