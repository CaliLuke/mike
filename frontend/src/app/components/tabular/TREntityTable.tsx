"use client";

import { createColumnHelper } from "@tanstack/react-table";
import { FileText, Loader2 } from "lucide-react";
import { useMemo } from "react";

import { DataTable } from "../shared/DataTable";
import type { ColumnConfig, LukeDocument, TabularReviewRow, TabularRowCell } from "../shared/types";

interface Props {
  columns: ColumnConfig[];
  rows: TabularReviewRow[];
  rowCells: TabularRowCell[];
  documents: LukeDocument[];
}

const ANCHOR_COL_PX = 280;
const SOURCE_COL_PX = 200;
const DATA_COL_PX = 220;

const columnHelper = createColumnHelper<TabularReviewRow>();

// TREntityTable renders an entity-mode tabular review: one row per extracted
// anchor (e.g. one accomplishment, one company-tenure) with a leading column
// showing the source document. Built on the shared DataTable primitive so
// sticky-left, sort, and selection plumbing match the rest of the app.
export function TREntityTable({ columns, rows, rowCells, documents }: Props) {
  const sortedColumns = useMemo(() => [...columns].sort((a, b) => a.index - b.index), [columns]);
  const sortedRows = useMemo(() => [...rows].sort((a, b) => a.row_index - b.row_index), [rows]);
  const docById = useMemo(() => new Map(documents.map((d) => [d.id, d])), [documents]);

  const cellsByKey = useMemo(() => {
    const out = new Map<string, TabularRowCell>();
    for (const c of rowCells) out.set(`${c.row_id}|${c.column_index}`, c);
    return out;
  }, [rowCells]);

  const tableColumns = useMemo(() => {
    const userCols = sortedColumns.map((col) =>
      columnHelper.display({
        id: `tr-col-${col.index}`,
        size: DATA_COL_PX,
        enableSorting: false,
        header: () => (
          <span className="text-xs font-medium text-gray-700 normal-case" title={col.prompt}>
            {col.name}
          </span>
        ),
        cell: (info) => {
          const cell = cellsByKey.get(`${info.row.original.id}|${col.index}`);
          if (!cell || cell.status === "pending" || cell.status === "generating") {
            return (
              <span className="inline-flex items-center gap-1 text-neutral-400">
                <Loader2 className="h-3 w-3 animate-spin" />
                <span>Generating…</span>
              </span>
            );
          }
          if (cell.status === "error") {
            return <span className="text-red-600">Error</span>;
          }
          return (
            <span className="text-sm whitespace-pre-wrap text-gray-800">
              {cell.content?.summary ?? ""}
            </span>
          );
        },
      }),
    );

    return [
      columnHelper.accessor(
        (row) => row.anchor?.label ?? row.anchor?.summary ?? `Row ${row.row_index + 1}`,
        {
          id: "anchor",
          header: () => <span className="normal-case">Anchor</span>,
          size: ANCHOR_COL_PX,
          meta: { stickyLeft: 0 },
          cell: (info) => {
            const row = info.row.original;
            const label = info.getValue();
            const summary = row.anchor?.summary;
            return (
              <div>
                <div className="text-sm font-medium text-gray-900">{label}</div>
                {summary && summary !== label && (
                  <div className="mt-0.5 line-clamp-2 text-xs text-gray-500">{summary}</div>
                )}
              </div>
            );
          },
        },
      ),
      columnHelper.accessor("document_id", {
        id: "source",
        header: () => <span className="normal-case">Source</span>,
        size: SOURCE_COL_PX,
        cell: (info) => {
          const doc = docById.get(info.getValue());
          return (
            <span
              className="inline-flex max-w-full items-center gap-1 rounded bg-gray-100 px-2 py-0.5 text-xs"
              title={doc?.filename ?? info.getValue()}
            >
              <FileText className="h-3 w-3 shrink-0" />
              <span className="truncate">{doc?.filename ?? info.getValue()}</span>
            </span>
          );
        },
      }),
      ...userCols,
    ];
  }, [sortedColumns, cellsByKey, docById]);

  return (
    <DataTable
      data={sortedRows}
      columns={tableColumns}
      widthMode="fixed"
      getRowId={(row) => row.id}
      emptyNode={
        <div className="px-8 py-12 text-center text-sm text-gray-400">
          {sortedColumns.length === 0
            ? "Add columns and documents, then click Generate to extract rows."
            : "No rows yet. Click Generate to extract anchors from the selected documents."}
        </div>
      }
    />
  );
}
