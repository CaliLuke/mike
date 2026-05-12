"use client";

import { useQuery, useQueryClient } from "@tanstack/react-query";
import { createColumnHelper, type RowSelectionState } from "@tanstack/react-table";
import { ChevronDown, ExternalLink, FolderOpen, Pencil, Plus, Trash2 } from "lucide-react";
import { useRouter } from "next/navigation";
import { useEffect, useRef, useState } from "react";

import { DataTable } from "@/app/components/shared/DataTable";
import { HeaderSearchBtn } from "@/app/components/shared/HeaderSearchBtn";
import { RowMenu } from "@/app/components/shared/RowMenu";
import type { LukeApplication } from "@/app/components/shared/types";
import { useChatHistoryContext } from "@/app/contexts/ChatHistoryContext";
import { deleteApplication, listApplications } from "@/app/lib/lukeApi";
import { trackClick } from "@/app/lib/telemetry";
import { useAuth } from "@/contexts/AuthContext";

import { EditApplicationModal } from "./EditApplicationModal";
import { NewApplicationModal } from "./NewApplicationModal";

function formatDate(iso: string) {
  return new Date(iso).toLocaleDateString(undefined, {
    day: "numeric",
    month: "short",
    year: "numeric",
  });
}

const columnHelper = createColumnHelper<LukeApplication>();

// The select column is 32px (DataTable injects it at offset 0). The name
// column sits sticky right after it.
const NAME_STICKY_OFFSET = 32;

const APPLICATIONS_KEY = ["applications"] as const;

function buildApplicationGreeting(application: LukeApplication): string {
  const name = application.name?.trim() || "your new application";
  const ingested = application.job_description_ingested === true;
  const opener = ingested
    ? `I've started **${name}** and pulled the job description into the Explorer for you.`
    : `I've started **${name}**.`;
  return `${opener} Want to work on it together? Drop your resume in the Explorer on the left, or tell me what you'd like to do first.`;
}

export function ApplicationsOverview() {
  const queryClient = useQueryClient();
  const { authLoading, user } = useAuth();
  const { saveChat } = useChatHistoryContext();
  const { data: applications = [], isLoading } = useQuery<LukeApplication[]>({
    queryKey: APPLICATIONS_KEY,
    queryFn: listApplications,
    enabled: !authLoading && !!user,
    refetchOnWindowFocus: true,
  });
  const loading = (authLoading || isLoading) && !!user;
  const mutateApplications = (fn: (prev: LukeApplication[]) => LukeApplication[]) =>
    queryClient.setQueryData<LukeApplication[]>(APPLICATIONS_KEY, (prev) => fn(prev ?? []));

  const [createModalOpen, setCreateModalOpen] = useState(false);
  const [editingApplication, setEditingApplication] = useState<LukeApplication | null>(null);
  const [search, setSearch] = useState("");
  const [rowSelection, setRowSelection] = useState<RowSelectionState>({});
  const [actionsOpen, setActionsOpen] = useState(false);
  const actionsRef = useRef<HTMLDivElement>(null);
  const router = useRouter();

  useEffect(() => {
    function handleClick(e: MouseEvent) {
      if (actionsRef.current && !actionsRef.current.contains(e.target as Node)) {
        setActionsOpen(false);
      }
    }
    if (actionsOpen) document.addEventListener("mousedown", handleClick);
    return () => document.removeEventListener("mousedown", handleClick);
  }, [actionsOpen]);

  const selectedIds = Object.keys(rowSelection).filter((id) => rowSelection[id]);

  async function handleDeleteSelected() {
    const ids = [...selectedIds];
    setActionsOpen(false);
    setRowSelection({});
    trackClick("application.delete.bulk", { count: ids.length });
    await Promise.all(ids.map((id) => deleteApplication(id).catch(() => {})));
    mutateApplications((prev) => prev.filter((p) => !ids.includes(p.id)));
  }

  async function handleDeleteOne(id: string) {
    trackClick("application.delete", { "application.id": id });
    await deleteApplication(id);
    mutateApplications((prev) => prev.filter((p) => p.id !== id));
    setRowSelection((prev) => {
      const next = { ...prev };
      delete next[id];
      return next;
    });
  }

  const columns = [
    columnHelper.accessor("name", {
      header: "Name",
      meta: { stickyLeft: NAME_STICKY_OFFSET },
      cell: (info) => {
        const url = info.row.original.job_description_url;
        return (
          <div className="flex items-center gap-1.5">
            <span className="truncate">{info.getValue()}</span>
            {url && (
              <a
                href={url}
                target="_blank"
                rel="noreferrer"
                onClick={(e) => e.stopPropagation()}
                className="shrink-0 text-gray-300 transition-colors hover:text-gray-600"
                title="Open job description"
                aria-label="Open job description"
                data-row-action
              >
                <ExternalLink className="h-3.5 w-3.5" />
              </a>
            )}
          </div>
        );
      },
    }),
    columnHelper.accessor("status", {
      header: "Status",
      size: 112,
      cell: (info) => {
        const status = info.getValue() ?? "in_progress";
        const label = status === "closed" ? "Closed" : "In progress";
        const cls =
          status === "closed" ? "bg-gray-100 text-gray-500" : "bg-emerald-50 text-emerald-700";
        return (
          <span
            className={`inline-flex items-center rounded-full px-2 py-0.5 text-xs font-medium ${cls}`}
          >
            {label}
          </span>
        );
      },
    }),
    columnHelper.accessor("company_name", {
      header: "Company",
      size: 176,
      cell: (info) =>
        info.getValue() ? (
          <span className="truncate text-gray-500">{info.getValue()}</span>
        ) : (
          <span className="text-gray-300">-</span>
        ),
    }),
    columnHelper.accessor("created_at", {
      header: "Created",
      size: 128,
      cell: (info) => <span className="text-gray-500">{formatDate(info.getValue())}</span>,
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
            ariaLabel={`Actions for ${info.row.original.name}`}
            items={[
              {
                label: "Edit",
                icon: Pencil,
                onClick: () => setEditingApplication(info.row.original),
              },
              {
                label: "Delete",
                icon: Trash2,
                destructive: true,
                onClick: () => void handleDeleteOne(info.row.original.id),
              },
            ]}
          />
        </div>
      ),
    }),
  ];

  const skeletonRows = (
    <div>
      {[1, 2, 3].map((i) => (
        <div key={i} className="flex h-10 items-center border-b border-gray-50 px-8">
          <div className="mr-3 h-2.5 w-2.5 animate-pulse rounded bg-gray-100" />
          <div className="mr-4 h-3.5 w-48 animate-pulse rounded bg-gray-100" />
          <div className="mr-4 h-3 w-16 animate-pulse rounded-full bg-gray-100" />
          <div className="mr-4 h-3 w-24 animate-pulse rounded bg-gray-100" />
          <div className="mr-4 h-3 w-20 animate-pulse rounded bg-gray-100" />
          <div className="h-3 w-20 animate-pulse rounded bg-gray-100" />
        </div>
      ))}
    </div>
  );

  const emptyState = (
    <div className="mx-auto flex w-full max-w-xs flex-col items-start py-24">
      <FolderOpen className="mb-4 h-8 w-8 text-gray-300" />
      <p className="font-serif text-2xl font-medium text-gray-900">Applications</p>
      <p className="mt-1 max-w-xs text-xs text-gray-400">
        Upload documents into applications, then start chats and tabular reviews with them.
      </p>
      <button
        onClick={() => setCreateModalOpen(true)}
        className="mt-4 inline-flex items-center gap-1 rounded-full bg-gray-900 px-3 py-1 text-xs font-medium text-white shadow-md transition-colors hover:bg-gray-700"
      >
        + Create New
      </button>
    </div>
  );

  return (
    <div className="flex-1 overflow-y-auto bg-white">
      <div className="flex items-center justify-between px-8 py-4">
        <h1 className="font-serif text-2xl font-medium text-gray-900">Applications</h1>
        <div className="flex items-center gap-2">
          <HeaderSearchBtn value={search} onChange={setSearch} placeholder="Search applications…" />
          <button
            onClick={() => setCreateModalOpen(true)}
            className="flex items-center justify-center p-1.5 text-gray-500 transition-colors hover:text-gray-900"
            title="Add application"
          >
            <Plus className="h-4 w-4" />
          </button>
        </div>
      </div>

      <div className="flex h-9 items-center justify-end border-b border-gray-200 px-8">
        {selectedIds.length > 0 && (
          <div ref={actionsRef} className="relative">
            <button
              onClick={() => setActionsOpen((v) => !v)}
              className="flex items-center gap-1 text-xs font-medium text-gray-700 transition-colors hover:text-gray-900"
            >
              Actions ({selectedIds.length})
              <ChevronDown className="h-3.5 w-3.5" />
            </button>
            {actionsOpen && (
              <div className="absolute top-full right-0 z-50 mt-1 w-36 overflow-hidden rounded-lg border border-gray-100 bg-white shadow-lg">
                <button
                  onClick={() => void handleDeleteSelected()}
                  className="w-full px-3 py-1.5 text-left text-xs text-red-600 transition-colors hover:bg-red-50"
                >
                  Delete
                </button>
              </div>
            )}
          </div>
        )}
      </div>

      <DataTable
        data={applications}
        columns={columns}
        globalFilter={search}
        onGlobalFilterChange={setSearch}
        globalFilterFn={(row, _id, value) => {
          const q = value.toLowerCase();
          if (!q) return true;
          const p = row.original;
          return (
            p.name.toLowerCase().includes(q) || (p.company_name ?? "").toLowerCase().includes(q)
          );
        }}
        initialSorting={[{ id: "created_at", desc: true }]}
        getRowId={(row) => row.id}
        enableRowSelection
        rowSelection={rowSelection}
        onRowSelectionChange={setRowSelection}
        onRowClick={(application) => {
          trackClick("application.open", { "application.id": application.id });
          router.push(`/applications/${application.id}`);
        }}
        isLoading={loading}
        loadingNode={skeletonRows}
        emptyNode={emptyState}
        emptyFilteredNode={
          <div className="px-8 py-6 text-sm text-gray-500">No applications match that search.</div>
        }
      />

      <NewApplicationModal
        open={createModalOpen}
        onClose={() => setCreateModalOpen(false)}
        onCreated={async (p) => {
          mutateApplications((prev) => [p, ...prev]);
          const greeting = buildApplicationGreeting(p);
          const chatId = await saveChat(p.id, { initialAssistantMessage: greeting });
          if (chatId) {
            router.push(`/applications/${p.id}/assistant-next/chat/${chatId}`);
          } else {
            router.push(`/applications/${p.id}`);
          }
        }}
      />
      <EditApplicationModal
        open={editingApplication !== null}
        application={editingApplication}
        onClose={() => setEditingApplication(null)}
        onUpdated={(updated) => {
          mutateApplications((prev) => prev.map((p) => (p.id === updated.id ? updated : p)));
        }}
      />
    </div>
  );
}
