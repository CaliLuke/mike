"use client";

import { createColumnHelper } from "@tanstack/react-table";
import { Check, ChevronDown, Loader2, Plus, Table2 } from "lucide-react";
import { useRouter } from "next/navigation";
import { useEffect, useRef, useState } from "react";

import { DataTable } from "@/app/components/shared/DataTable";
import { HeaderSearchBtn } from "@/app/components/shared/HeaderSearchBtn";
import { OwnerOnlyModal } from "@/app/components/shared/OwnerOnlyModal";
import { RowActions } from "@/app/components/shared/RowActions";
import { ToolbarTabs } from "@/app/components/shared/ToolbarTabs";
import type { ColumnConfig, LukeApplication, TabularReview } from "@/app/components/shared/types";
import { AddNewTRModal } from "@/app/components/tabular/AddNewTRModal";
import {
  createTabularReview,
  deleteTabularReview,
  listApplications,
  listTabularReviews,
  updateTabularReview,
} from "@/app/lib/lukeApi";
import { useAuth } from "@/contexts/AuthContext";

type Tab = "all" | "in-application" | "standalone";

const TABS: { id: Tab; label: string }[] = [
  { id: "all", label: "All Reviews" },
  { id: "in-application", label: "In Application" },
  { id: "standalone", label: "Standalone" },
];

function formatDate(iso: string) {
  return new Date(iso).toLocaleDateString(undefined, {
    day: "numeric",
    month: "short",
    year: "numeric",
  });
}

const columnHelper = createColumnHelper<TabularReview>();

export default function TabularReviewsPage() {
  const [reviews, setReviews] = useState<TabularReview[]>([]);
  const [applications, setApplications] = useState<LukeApplication[]>([]);
  const [loading, setLoading] = useState(true);
  const [creating, setCreating] = useState(false);
  const [newTROpen, setNewTROpen] = useState(false);
  const [activeTab, setActiveTab] = useState<Tab>("all");
  const [renamingId, setRenamingId] = useState<string | null>(null);
  const [renameValue, setRenameValue] = useState("");
  const [applicationFilter, setApplicationFilter] = useState<string | null>(null);
  const [filterOpen, setFilterOpen] = useState(false);
  const [search, setSearch] = useState("");
  const [rowSelection, setRowSelection] = useState<Record<string, boolean>>({});
  const [actionsOpen, setActionsOpen] = useState(false);
  const [ownerOnlyAction, setOwnerOnlyAction] = useState<string | null>(null);
  const filterRef = useRef<HTMLDivElement>(null);
  const actionsRef = useRef<HTMLDivElement>(null);
  const router = useRouter();
  const { user } = useAuth();

  useEffect(() => {
    Promise.all([listTabularReviews().catch(() => []), listApplications().catch(() => [])])
      .then(([r, p]) => {
        setReviews(r);
        setApplications(p);
      })
      .finally(() => setLoading(false));
  }, []);

  useEffect(() => {
    function handleClick(e: MouseEvent) {
      if (filterRef.current && !filterRef.current.contains(e.target as Node)) setFilterOpen(false);
    }
    document.addEventListener("mousedown", handleClick);
    return () => document.removeEventListener("mousedown", handleClick);
  }, []);

  useEffect(() => {
    function handleClick(e: MouseEvent) {
      if (actionsRef.current && !actionsRef.current.contains(e.target as Node)) {
        setActionsOpen(false);
      }
    }
    if (actionsOpen) document.addEventListener("mousedown", handleClick);
    return () => document.removeEventListener("mousedown", handleClick);
  }, [actionsOpen]);

  // Tab + application filtering happens here so DataTable receives the
  // already-filtered slice; the table itself handles the search filter via
  // its globalFilter prop.
  const filtered = reviews
    .filter((r) => {
      if (activeTab === "in-application") return !!r.application_id;
      if (activeTab === "standalone") return !r.application_id;
      return true;
    })
    .filter((r) => !applicationFilter || r.application_id === applicationFilter);

  const selectedIds = Object.keys(rowSelection).filter((id) => rowSelection[id]);
  // Only count selections for rows currently visible — switching tabs leaves
  // hidden selections in state but bulk actions should target what the user
  // can see.
  const visibleSelectedIds = selectedIds.filter((id) => filtered.some((r) => r.id === id));

  const selectedApplication = applications.find((p) => p.id === applicationFilter);

  const handleNewReview = async (
    title: string,
    applicationId?: string,
    documentIds?: string[],
    columnsConfig?: ColumnConfig[] | null,
    createdApplication?: LukeApplication,
  ) => {
    setCreating(true);
    try {
      const review = await createTabularReview({
        title,
        document_ids: documentIds ?? [],
        columns_config: columnsConfig ?? [],
        ...(applicationId && { application_id: applicationId }),
      });
      if (createdApplication) {
        setApplications((prev) => [createdApplication, ...prev]);
      }
      router.push(
        applicationId
          ? `/applications/${applicationId}/tabular-reviews/${review.id}`
          : `/tabular-reviews/${review.id}`,
      );
    } finally {
      setCreating(false);
    }
  };

  async function handleRenameSubmit(reviewId: string) {
    const trimmed = renameValue.trim();
    if (!trimmed) {
      setRenamingId(null);
      return;
    }
    const review = reviews.find((r) => r.id === reviewId);
    if (review && user?.id && review.user_id !== user.id) {
      setRenamingId(null);
      setOwnerOnlyAction("rename this tabular review");
      return;
    }
    setReviews((prev) => prev.map((r) => (r.id === reviewId ? { ...r, title: trimmed } : r)));
    setRenamingId(null);
    await updateTabularReview(reviewId, { title: trimmed });
  }

  async function handleDeleteSelected() {
    const ids = [...visibleSelectedIds];
    setActionsOpen(false);
    const owned = ids.filter((id) => {
      const r = reviews.find((rr) => rr.id === id);
      return !r || !user?.id || r.user_id === user.id;
    });
    const blocked = ids.length - owned.length;
    setRowSelection({});
    await Promise.all(owned.map((id) => deleteTabularReview(id).catch(() => {})));
    setReviews((prev) => prev.filter((r) => !owned.includes(r.id)));
    if (blocked > 0) {
      setOwnerOnlyAction(
        `delete ${blocked} of the selected reviews — only the review creator can delete a review`,
      );
    }
  }

  // ---------------------------------------------------------------------------
  // Columns
  // ---------------------------------------------------------------------------

  const columns = [
    columnHelper.accessor("title", {
      header: "Name",
      size: 320,
      meta: { stickyLeft: 32 },
      cell: (info) => {
        const review = info.row.original;
        const isRenaming = renamingId === review.id;
        if (isRenaming) {
          return (
            <input
              autoFocus
              value={renameValue}
              onChange={(e) => setRenameValue(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === "Enter") void handleRenameSubmit(review.id);
                if (e.key === "Escape") setRenamingId(null);
              }}
              onBlur={() => void handleRenameSubmit(review.id)}
              onClick={(e) => e.stopPropagation()}
              data-row-action
              className="w-full bg-transparent text-sm text-gray-800 outline-none"
            />
          );
        }
        return (
          <span className="block truncate text-sm text-gray-800">
            {review.title ?? "Untitled Review"}
          </span>
        );
      },
    }),
    columnHelper.accessor((row) => row.columns_config?.length ?? 0, {
      id: "columns_count",
      header: "Columns",
      size: 96,
      cell: (info) => <span className="text-gray-500 tabular-nums">{info.getValue()}</span>,
    }),
    columnHelper.accessor((row) => row.document_count ?? 0, {
      id: "document_count",
      header: "Documents",
      size: 96,
      cell: (info) => <span className="text-gray-500 tabular-nums">{info.getValue()}</span>,
    }),
    columnHelper.accessor("application_id", {
      header: "Application",
      size: 180,
      cell: (info) => {
        const app = applications.find((p) => p.id === info.getValue());
        return app ? (
          <span className="truncate text-gray-500">{app.name}</span>
        ) : (
          <span className="text-gray-300">—</span>
        );
      },
    }),
    columnHelper.accessor("created_at", {
      header: "Created",
      size: 120,
      cell: (info) => {
        const v = info.getValue();
        return v ? (
          <span className="text-gray-500">{formatDate(v)}</span>
        ) : (
          <span className="text-gray-300">—</span>
        );
      },
      sortingFn: "datetime",
    }),
    columnHelper.display({
      id: "actions",
      header: "",
      size: 56,
      enableSorting: false,
      cell: (info) => (
        <div className="flex justify-end" data-row-action onClick={(e) => e.stopPropagation()}>
          <RowActions
            onRename={() => {
              const review = info.row.original;
              if (user?.id && review.user_id !== user.id) {
                setOwnerOnlyAction("rename this tabular review");
                return;
              }
              setRenameValue(review.title ?? "Untitled Review");
              setRenamingId(review.id);
            }}
            onDelete={async () => {
              const review = info.row.original;
              if (user?.id && review.user_id !== user.id) {
                setOwnerOnlyAction("delete this tabular review");
                return;
              }
              await deleteTabularReview(review.id);
              setReviews((prev) => prev.filter((r) => r.id !== review.id));
            }}
          />
        </div>
      ),
    }),
  ];

  // ---------------------------------------------------------------------------
  // Toolbar bits (application filter dropdown + bulk-action menu)
  // ---------------------------------------------------------------------------

  const applicationFilterButton = (
    <div className="relative" ref={filterRef}>
      <button
        onClick={() => setFilterOpen((o) => !o)}
        className={`flex items-center gap-1 text-xs font-medium transition-colors ${
          applicationFilter
            ? "text-gray-700 hover:text-gray-900"
            : "text-gray-500 hover:text-gray-700"
        }`}
      >
        {selectedApplication ? selectedApplication.name : "Filter by application"}
        <ChevronDown className="h-3 w-3" />
      </button>
      {filterOpen && (
        <div className="absolute top-full right-0 z-20 mt-1.5 w-52 overflow-hidden rounded-xl border border-gray-100 bg-white shadow-lg">
          <button
            onClick={() => {
              setApplicationFilter(null);
              setFilterOpen(false);
            }}
            className="flex w-full items-center justify-between px-3 py-2 text-xs text-gray-600 transition-colors hover:bg-gray-50"
          >
            All Applications
            {!applicationFilter && <Check className="h-3.5 w-3.5 text-gray-400" />}
          </button>
          {applications.length > 0 && <div className="border-t border-gray-100" />}
          {applications.map((p) => (
            <button
              key={p.id}
              onClick={() => {
                setApplicationFilter(p.id);
                setFilterOpen(false);
              }}
              className="flex w-full items-center justify-between px-3 py-2 text-xs text-gray-600 transition-colors hover:bg-gray-50"
            >
              <span className="truncate pr-2">{p.name}</span>
              {applicationFilter === p.id && (
                <Check className="h-3.5 w-3.5 shrink-0 text-gray-400" />
              )}
            </button>
          ))}
        </div>
      )}
    </div>
  );

  const toolbarActions = (
    <div className="flex items-center gap-2">
      {visibleSelectedIds.length > 0 && (
        <div ref={actionsRef} className="relative">
          <button
            onClick={() => setActionsOpen((v) => !v)}
            className="flex items-center gap-1 text-xs font-medium text-gray-700 transition-colors hover:text-gray-900"
          >
            Actions
            <ChevronDown className="h-3.5 w-3.5" />
          </button>
          {actionsOpen && (
            <div className="absolute top-full right-0 z-50 mt-1 w-36 overflow-hidden rounded-lg border border-gray-100 bg-white shadow-lg">
              <button
                onClick={handleDeleteSelected}
                className="w-full px-3 py-1.5 text-left text-xs text-red-600 transition-colors hover:bg-red-50"
              >
                Delete
              </button>
            </div>
          )}
        </div>
      )}
      {applicationFilterButton}
    </div>
  );

  // The empty state has two flavours: a rich "Tabular Reviews" landing card
  // when the user has nothing to show at the top level, and a quieter
  // "No reviews found" message when filters/tabs/search hide all rows.
  const showRichEmpty = activeTab === "all" && !applicationFilter && !search;
  const richEmpty = (
    <div className="mx-auto flex w-full max-w-xs flex-col items-start py-24">
      <Table2 className="mb-4 h-8 w-8 text-gray-300" />
      <p className="font-serif text-2xl font-medium text-gray-900">Tabular Reviews</p>
      <p className="mt-1 max-w-xs text-left text-xs text-gray-400">
        Extract data from documents into tables using AI.
      </p>
      <button
        onClick={() => setNewTROpen(true)}
        disabled={creating}
        className="mt-4 inline-flex items-center gap-1 rounded-full bg-gray-900 px-3 py-1 text-xs font-medium text-white shadow-md transition-colors hover:bg-gray-700 disabled:opacity-40"
      >
        + Create New
      </button>
    </div>
  );
  const quietEmpty = (
    <div className="px-8 py-16 text-center text-sm text-gray-400">No reviews found</div>
  );

  return (
    <div className="flex-1 overflow-y-auto bg-white">
      {/* Page header */}
      <div className="flex items-center justify-between px-8 py-4">
        <h1 className="font-serif text-2xl font-medium text-gray-900">Tabular Reviews</h1>
        <div className="flex items-center gap-2">
          <HeaderSearchBtn value={search} onChange={setSearch} placeholder="Search reviews…" />
          <button
            onClick={() => setNewTROpen(true)}
            disabled={creating}
            className="flex items-center justify-center p-1.5 text-gray-500 transition-colors hover:text-gray-900 disabled:opacity-40"
          >
            {creating ? <Loader2 className="h-4 w-4 animate-spin" /> : <Plus className="h-4 w-4" />}
          </button>
        </div>
      </div>

      <ToolbarTabs
        tabs={TABS}
        active={activeTab}
        onChange={setActiveTab}
        actions={toolbarActions}
      />

      <DataTable
        data={filtered}
        columns={columns}
        globalFilter={search}
        onGlobalFilterChange={setSearch}
        globalFilterFn={(row, _id, value) => {
          const q = value.toLowerCase();
          if (!q) return true;
          const review = row.original;
          const haystack = [
            review.title ?? "",
            applications.find((p) => p.id === review.application_id)?.name ?? "",
          ]
            .join(" ")
            .toLowerCase();
          return haystack.includes(q);
        }}
        getRowId={(row) => row.id}
        initialSorting={[{ id: "created_at", desc: true }]}
        enableRowSelection
        rowSelection={rowSelection}
        onRowSelectionChange={setRowSelection}
        onRowClick={(review) => {
          if (renamingId === review.id) return;
          router.push(
            review.application_id
              ? `/applications/${review.application_id}/tabular-reviews/${review.id}`
              : `/tabular-reviews/${review.id}`,
          );
        }}
        isLoading={loading}
        loadingNode={
          <div className="space-y-2 px-8 py-5">
            {[1, 2, 3].map((i) => (
              <div key={i} className="h-8 w-80 animate-pulse rounded bg-gray-100" />
            ))}
          </div>
        }
        emptyNode={showRichEmpty ? richEmpty : quietEmpty}
        emptyFilteredNode={quietEmpty}
      />

      <AddNewTRModal
        open={newTROpen}
        onClose={() => setNewTROpen(false)}
        onAdd={handleNewReview}
        applications={applications}
      />

      <OwnerOnlyModal
        open={!!ownerOnlyAction}
        action={ownerOnlyAction ?? undefined}
        onClose={() => setOwnerOnlyAction(null)}
      />
    </div>
  );
}
