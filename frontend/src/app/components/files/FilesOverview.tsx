"use client";

import { createColumnHelper } from "@tanstack/react-table";
import { FileText, Trash2 } from "lucide-react";
import { useEffect, useState } from "react";

import { DataTable } from "@/app/components/shared/DataTable";
import { HeaderSearchBtn } from "@/app/components/shared/HeaderSearchBtn";
import type { LukeDocument } from "@/app/components/shared/types";
import { deleteDocument, listDocuments } from "@/app/lib/lukeApi";

function formatDate(iso: string | null | undefined) {
  if (!iso) return "—";
  return new Date(iso).toLocaleDateString(undefined, {
    day: "numeric",
    month: "short",
    year: "numeric",
  });
}

function formatBytes(bytes: number | null | undefined) {
  if (bytes === null || bytes === undefined || bytes < 0) return "—";
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}

function trimApplicationRef(value: string | null) {
  if (!value) return null;
  return value.startsWith("applications:") ? value.slice("applications:".length) : value;
}

const columnHelper = createColumnHelper<LukeDocument>();

export function FilesOverview() {
  const [docs, setDocs] = useState<LukeDocument[]>([]);
  const [loading, setLoading] = useState(true);
  const [search, setSearch] = useState("");
  const [errorMessage, setErrorMessage] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    const refresh = () => {
      listDocuments()
        .then((rows) => {
          if (cancelled) return;
          setDocs(rows);
        })
        .catch(() => {
          if (cancelled) return;
          setDocs([]);
        })
        .finally(() => {
          if (cancelled) return;
          setLoading(false);
        });
    };
    refresh();
    const interval = window.setInterval(refresh, 5000);
    return () => {
      cancelled = true;
      window.clearInterval(interval);
    };
  }, []);

  async function handleDelete(docId: string) {
    setErrorMessage(null);
    try {
      await deleteDocument(docId);
      setDocs((prev) => prev.filter((d) => d.id !== docId));
    } catch {
      setErrorMessage("Failed to delete the file. Try again.");
    }
  }

  const columns = [
    columnHelper.accessor("filename", {
      header: "Name",
      size: 320,
      meta: { stickyLeft: 0 },
      cell: (info) => (
        <div className="flex min-w-0 items-center gap-2">
          <FileText className="h-4 w-4 shrink-0 text-gray-400" />
          <span className="truncate font-medium text-gray-900">{info.getValue()}</span>
        </div>
      ),
    }),
    columnHelper.accessor("file_type", {
      header: "Type",
      size: 80,
      cell: (info) => <span className="text-gray-600">{info.getValue() ?? "—"}</span>,
    }),
    columnHelper.accessor("size_bytes", {
      header: "Size",
      size: 96,
      cell: (info) => (
        <span className="text-gray-600 tabular-nums">{formatBytes(info.getValue())}</span>
      ),
    }),
    columnHelper.accessor("application_id", {
      header: "Application",
      size: 140,
      cell: (info) => {
        const appRef = trimApplicationRef(info.getValue());
        if (!appRef) return <span className="text-gray-400">—</span>;
        return (
          <a
            href={`/applications/${appRef}?tab=documents`}
            className="text-gray-700 underline-offset-2 hover:underline"
          >
            open
          </a>
        );
      },
    }),
    columnHelper.accessor("status", {
      header: "Status",
      size: 96,
      cell: (info) => {
        const status = info.getValue();
        const tone =
          status === "ready"
            ? "bg-green-50 text-green-700"
            : status === "error"
              ? "bg-red-50 text-red-700"
              : "bg-gray-100 text-gray-600";
        return (
          <span
            className={`inline-flex items-center rounded-full px-2 py-0.5 text-xs font-medium ${tone}`}
          >
            {status}
          </span>
        );
      },
    }),
    columnHelper.accessor("updated_at", {
      header: "Updated",
      size: 120,
      cell: (info) => <span className="text-gray-500">{formatDate(info.getValue() ?? null)}</span>,
      sortingFn: "datetime",
    }),
    columnHelper.display({
      id: "actions",
      header: "",
      size: 48,
      enableSorting: false,
      cell: (info) => (
        <button
          onClick={() => handleDelete(info.row.original.id.replace(/^documents:/, ""))}
          className="inline-flex shrink-0 items-center justify-center p-1.5 text-gray-400 transition-colors hover:text-red-600"
          title="Delete file"
          aria-label={`Delete ${info.row.original.filename}`}
          data-row-action
        >
          <Trash2 className="h-4 w-4" />
        </button>
      ),
    }),
  ];

  return (
    <div className="flex-1 overflow-y-auto bg-white">
      <div className="flex items-center justify-between px-8 py-4">
        <h1 className="font-serif text-2xl font-medium text-gray-900">Files</h1>
        <HeaderSearchBtn value={search} onChange={setSearch} placeholder="Search files..." />
      </div>

      {errorMessage && (
        <div className="mx-8 mb-2 rounded-lg border border-red-200 bg-red-50 px-3 py-2 text-sm text-red-700">
          {errorMessage}
        </div>
      )}

      <DataTable
        data={docs}
        columns={columns}
        globalFilter={search}
        onGlobalFilterChange={setSearch}
        globalFilterFn={(row, _id, value) => {
          const q = value.toLowerCase();
          if (!q) return true;
          const doc = row.original;
          return (
            doc.filename.toLowerCase().includes(q) ||
            (doc.file_type ?? "").toLowerCase().includes(q) ||
            (doc.status ?? "").toLowerCase().includes(q)
          );
        }}
        initialSorting={[{ id: "updated_at", desc: true }]}
        isLoading={loading}
        emptyNode={
          <div className="px-8 py-6 text-sm text-gray-500">
            No files yet. Files created by the assistant or uploaded to an application will appear
            here.
          </div>
        }
        emptyFilteredNode={
          <div className="px-8 py-6 text-sm text-gray-500">No files match that search.</div>
        }
      />
    </div>
  );
}
