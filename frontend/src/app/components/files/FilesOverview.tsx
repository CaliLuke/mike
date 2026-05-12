"use client";

import { useQuery, useQueryClient } from "@tanstack/react-query";
import { createColumnHelper } from "@tanstack/react-table";
import { FileText, Trash2, Upload } from "lucide-react";
import { useRouter } from "next/navigation";
import { useCallback, useEffect, useRef, useState } from "react";

import { DataTable } from "@/app/components/shared/DataTable";
import { HeaderSearchBtn } from "@/app/components/shared/HeaderSearchBtn";
import { RowMenu } from "@/app/components/shared/RowMenu";
import type { LukeDocument } from "@/app/components/shared/types";
import { DOCUMENT_UPLOAD_ACCEPT } from "@/app/lib/documentTypes";
import { deleteDocument, listDocuments, uploadStandaloneDocument } from "@/app/lib/lukeApi";
import { trackClick } from "@/app/lib/telemetry";

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

const DOCUMENTS_KEY = ["documents"] as const;

export function FilesOverview() {
  const queryClient = useQueryClient();
  const { data: docs = [], isLoading: loading } = useQuery<LukeDocument[]>({
    queryKey: DOCUMENTS_KEY,
    queryFn: listDocuments,
    refetchInterval: 5000,
  });
  const [search, setSearch] = useState("");
  const [errorMessage, setErrorMessage] = useState<string | null>(null);
  const [dragActive, setDragActive] = useState(false);
  const [uploading, setUploading] = useState<{ done: number; total: number } | null>(null);
  const router = useRouter();
  const fileInputRef = useRef<HTMLInputElement>(null);
  // Window-level dragenter/leave fire on every child element, so track the
  // depth ourselves to know when the cursor has truly left the page.
  const dragDepthRef = useRef(0);

  async function handleDelete(docId: string) {
    trackClick("file.delete", { "doc.id": docId });
    setErrorMessage(null);
    try {
      await deleteDocument(docId);
      queryClient.setQueryData<LukeDocument[]>(DOCUMENTS_KEY, (prev) =>
        (prev ?? []).filter((d) => d.id !== docId),
      );
    } catch {
      setErrorMessage("Failed to delete the file. Try again.");
    }
  }

  // uploadFiles fires N parallel multipart POSTs to /single-documents and
  // streams progress into local state so the user sees "Uploading 2/5…".
  // Any failures are surfaced in the error banner without blocking the rest.
  const uploadFiles = useCallback(
    async function uploadFiles(files: File[]) {
      if (files.length === 0) return;
      trackClick("file.upload", { count: files.length });
      setErrorMessage(null);
      setUploading({ done: 0, total: files.length });
      const results = await Promise.allSettled(
        files.map(async (file) => {
          const uploaded = await uploadStandaloneDocument(file);
          setUploading((prev) => (prev ? { ...prev, done: prev.done + 1 } : prev));
          return uploaded;
        }),
      );
      const successes: LukeDocument[] = [];
      const failures: string[] = [];
      for (const [i, result] of results.entries()) {
        if (result.status === "fulfilled") {
          successes.push(result.value);
        } else {
          failures.push(files[i].name);
        }
      }
      if (successes.length > 0) {
        // Merge new docs in front, dedup by id in case the polling refresh
        // already picked some of them up between request start and now.
        queryClient.setQueryData<LukeDocument[]>(DOCUMENTS_KEY, (prev) => {
          const byId = new Map<string, LukeDocument>();
          for (const d of [...successes, ...(prev ?? [])]) byId.set(d.id, d);
          return Array.from(byId.values());
        });
      }
      setUploading(null);
      if (failures.length > 0) {
        setErrorMessage(
          failures.length === files.length
            ? "Could not upload any of those files."
            : `Could not upload: ${failures.join(", ")}`,
        );
      }
    },
    [queryClient],
  );

  // Window-scoped drag listeners so the user can drop files anywhere on the
  // Files page — not just on a tiny dropzone. We only react to drags that
  // actually carry files (filters out drags from within the page).
  useEffect(() => {
    const carriesFiles = (e: DragEvent) =>
      Array.from(e.dataTransfer?.types ?? []).includes("Files");
    const onEnter = (e: DragEvent) => {
      if (!carriesFiles(e)) return;
      e.preventDefault();
      dragDepthRef.current += 1;
      setDragActive(true);
    };
    const onOver = (e: DragEvent) => {
      if (!carriesFiles(e)) return;
      e.preventDefault(); // required to allow drop
    };
    const onLeave = (e: DragEvent) => {
      if (!carriesFiles(e)) return;
      dragDepthRef.current = Math.max(0, dragDepthRef.current - 1);
      if (dragDepthRef.current === 0) setDragActive(false);
    };
    const onDrop = (e: DragEvent) => {
      if (!carriesFiles(e)) return;
      e.preventDefault();
      dragDepthRef.current = 0;
      setDragActive(false);
      const files = Array.from(e.dataTransfer?.files ?? []);
      if (files.length > 0) void uploadFiles(files);
    };
    window.addEventListener("dragenter", onEnter);
    window.addEventListener("dragover", onOver);
    window.addEventListener("dragleave", onLeave);
    window.addEventListener("drop", onDrop);
    return () => {
      window.removeEventListener("dragenter", onEnter);
      window.removeEventListener("dragover", onOver);
      window.removeEventListener("dragleave", onLeave);
      window.removeEventListener("drop", onDrop);
    };
  }, [uploadFiles]);

  function handleFileInputChange(e: React.ChangeEvent<HTMLInputElement>) {
    const files = Array.from(e.target.files ?? []);
    e.target.value = "";
    if (files.length > 0) void uploadFiles(files);
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
      size: 56,
      enableSorting: false,
      cell: (info) => (
        <div className="flex justify-end" data-row-action onClick={(e) => e.stopPropagation()}>
          <RowMenu
            ariaLabel={`Actions for ${info.row.original.filename}`}
            items={[
              {
                label: "Delete",
                icon: Trash2,
                destructive: true,
                onClick: () => handleDelete(info.row.original.id.replace(/^documents:/, "")),
              },
            ]}
          />
        </div>
      ),
    }),
  ];

  return (
    <div className="relative flex-1 overflow-y-auto bg-white">
      <div className="flex items-center justify-between px-8 py-4">
        <h1 className="font-serif text-2xl font-medium text-gray-900">Files</h1>
        <div className="flex items-center gap-2">
          <HeaderSearchBtn value={search} onChange={setSearch} placeholder="Search files..." />
          <input
            ref={fileInputRef}
            type="file"
            multiple
            accept={DOCUMENT_UPLOAD_ACCEPT}
            className="hidden"
            onChange={handleFileInputChange}
          />
          <button
            onClick={() => fileInputRef.current?.click()}
            className="flex items-center gap-1.5 rounded-lg border border-gray-200 px-3 py-1.5 text-xs text-gray-600 transition-colors hover:bg-gray-50"
            title="Upload files"
          >
            <Upload className="h-3.5 w-3.5" />
            Upload
          </button>
        </div>
      </div>

      {uploading && (
        <div className="mx-8 mb-2 rounded-lg border border-gray-200 bg-gray-50 px-3 py-2 text-sm text-gray-700">
          Uploading {uploading.done}/{uploading.total}…
        </div>
      )}
      {errorMessage && (
        <div className="mx-8 mb-2 rounded-lg border border-red-200 bg-red-50 px-3 py-2 text-sm text-red-700">
          {errorMessage}
        </div>
      )}

      {dragActive && (
        <div className="pointer-events-none fixed inset-0 z-50 flex items-center justify-center bg-black/10 backdrop-blur-[2px]">
          <div className="rounded-2xl border-2 border-dashed border-gray-900 bg-white px-10 py-8 text-center shadow-2xl">
            <Upload className="mx-auto mb-2 h-6 w-6 text-gray-900" />
            <p className="font-serif text-xl text-gray-900">Drop files to upload</p>
            <p className="mt-1 text-xs text-gray-500">PDF, DOCX, DOC, MD, TXT</p>
          </div>
        </div>
      )}

      <DataTable
        data={docs}
        columns={columns}
        onRowClick={(doc) => {
          trackClick("file.open", { "doc.id": doc.id });
          router.push(`/files/${doc.id.replace(/^documents:/, "")}`);
        }}
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
