"use client";

import { ChevronDown, FolderOpen, Plus } from "lucide-react";
import { useRouter } from "next/navigation";
import { useCallback, useEffect, useRef, useState } from "react";

import { HeaderSearchBtn } from "@/app/components/shared/HeaderSearchBtn";
import { RowActions } from "@/app/components/shared/RowActions";
import type { LukeApplication } from "@/app/components/shared/types";
import { deleteApplication, listApplications, updateApplication } from "@/app/lib/lukeApi";
import { useAuth } from "@/contexts/AuthContext";

import { NewApplicationModal } from "./NewApplicationModal";

function formatDate(iso: string) {
  return new Date(iso).toLocaleDateString(undefined, {
    day: "numeric",
    month: "short",
    year: "numeric",
  });
}

const CHECK_W = "w-8 shrink-0";
const NAME_COL_W = "w-[300px] shrink-0";

export function ApplicationsOverview() {
  const [applications, setApplications] = useState<LukeApplication[]>([]);
  const [loading, setLoading] = useState(true);
  const [modalOpen, setModalOpen] = useState(false);
  const [renamingId, setRenamingId] = useState<string | null>(null);
  const [renameValue, setRenameValue] = useState("");
  const [cmEditingId, setCmEditingId] = useState<string | null>(null);
  const [cmValue, setCmValue] = useState("");
  const [selectedIds, setSelectedIds] = useState<string[]>([]);
  const [actionsOpen, setActionsOpen] = useState(false);
  const [search, setSearch] = useState("");
  const actionsRef = useRef<HTMLDivElement>(null);
  const router = useRouter();
  const { authLoading, user } = useAuth();

  const reloadApplications = useCallback(() => {
    if (authLoading) return;
    if (!user) {
      setApplications([]);
      setLoading(false);
      return;
    }
    setLoading(true);
    listApplications()
      .then(setApplications)
      .catch(() => setApplications([]))
      .finally(() => setLoading(false));
  }, [authLoading, user]);

  useEffect(() => {
    void Promise.resolve().then(reloadApplications);
  }, [reloadApplications]);

  useEffect(() => {
    const handleVisible = () => {
      if (document.visibilityState === "visible") reloadApplications();
    };
    document.addEventListener("visibilitychange", handleVisible);
    window.addEventListener("focus", reloadApplications);
    return () => {
      document.removeEventListener("visibilitychange", handleVisible);
      window.removeEventListener("focus", reloadApplications);
    };
  }, [reloadApplications]);

  useEffect(() => {
    function handleClick(e: MouseEvent) {
      if (actionsRef.current && !actionsRef.current.contains(e.target as Node))
        setActionsOpen(false);
    }
    if (actionsOpen) document.addEventListener("mousedown", handleClick);
    return () => document.removeEventListener("mousedown", handleClick);
  }, [actionsOpen]);

  const q = search.toLowerCase();
  const filtered = applications.filter(
    (p) =>
      !q ||
      p.name.toLowerCase().includes(q) ||
      (p.company_name ?? "").toLowerCase().includes(q) ||
      (p.cm_number ?? "").toLowerCase().includes(q),
  );

  const allSelected = filtered.length > 0 && filtered.every((p) => selectedIds.includes(p.id));
  const someSelected = !allSelected && filtered.some((p) => selectedIds.includes(p.id));

  function toggleAll() {
    if (allSelected) {
      setSelectedIds([]);
    } else {
      setSelectedIds(filtered.map((p) => p.id));
    }
  }

  function toggleOne(id: string) {
    setSelectedIds((prev) => (prev.includes(id) ? prev.filter((x) => x !== id) : [...prev, id]));
  }

  async function handleRenameSubmit(applicationId: string) {
    const trimmed = renameValue.trim();
    setRenamingId(null);
    if (!trimmed) return;
    setApplications((prev) =>
      prev.map((p) => (p.id === applicationId ? { ...p, name: trimmed } : p)),
    );
    await updateApplication(applicationId, { name: trimmed });
  }

  async function handleCmSubmit(applicationId: string) {
    const trimmed = cmValue.trim();
    setCmEditingId(null);
    setApplications((prev) =>
      prev.map((p) => (p.id === applicationId ? { ...p, cm_number: trimmed || null } : p)),
    );
    await updateApplication(applicationId, { cm_number: trimmed || undefined });
  }

  async function handleDeleteSelected() {
    const ids = [...selectedIds];
    setActionsOpen(false);
    setSelectedIds([]);
    await Promise.all(ids.map((id) => deleteApplication(id).catch(() => {})));
    setApplications((prev) => prev.filter((p) => !ids.includes(p.id)));
  }

  const toolbarActions = (
    <div className="flex items-center gap-2">
      {selectedIds.length > 0 && (
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
    </div>
  );

  return (
    <div className="flex-1 overflow-y-auto bg-white">
      {/* Page header */}
      <div className="flex items-center justify-between px-8 py-4">
        <h1 className="font-serif text-2xl font-medium text-gray-900">Applications</h1>
        <div className="flex items-center gap-2">
          <HeaderSearchBtn value={search} onChange={setSearch} placeholder="Search applications…" />
          <button
            onClick={() => setModalOpen(true)}
            className="flex items-center justify-center p-1.5 text-gray-500 transition-colors hover:text-gray-900"
          >
            <Plus className="h-4 w-4" />
          </button>
        </div>
      </div>

      <div className="flex h-9 items-center justify-end border-b border-gray-200 px-8">
        {toolbarActions}
      </div>

      {/* Table */}
      <div className="w-full overflow-x-auto">
        <div className="min-w-max">
          {/* Column headers */}
          <div className="flex h-8 items-center border-b border-gray-200 pr-8 text-xs font-medium text-gray-500 select-none">
            <div
              className={`sticky left-0 z-[60] ${CHECK_W} relative flex items-center justify-center self-stretch bg-white before:absolute before:inset-x-0 before:bottom-0 before:h-px before:bg-white`}
            >
              {!loading && (
                <input
                  type="checkbox"
                  checked={allSelected}
                  ref={(el) => {
                    if (el) el.indeterminate = someSelected;
                  }}
                  onChange={toggleAll}
                  className="h-2.5 w-2.5 cursor-pointer rounded border-gray-200 accent-black"
                />
              )}
            </div>
            <div className={`sticky left-8 z-[60] ${NAME_COL_W} bg-white pl-2 text-left`}>Name</div>
            <div className="w-44 shrink-0 text-left">Company</div>
            <div className="ml-auto w-32 shrink-0 text-left">CM</div>
            <div className="w-24 shrink-0 text-left">Files</div>
            <div className="w-24 shrink-0 text-left">Chats</div>
            <div className="w-36 shrink-0 text-left">Tabular Reviews</div>
            <div className="w-32 shrink-0 text-left">Created</div>
            <div className="w-8 shrink-0" />
          </div>

          {loading ? (
            <div>
              {[1, 2, 3].map((i) => (
                <div key={i} className="flex h-10 items-center border-b border-gray-50 pr-8">
                  <div className="w-8 shrink-0" />
                  <div className="min-w-0 flex-1 pr-4 pl-3">
                    <div className="h-3.5 w-48 animate-pulse rounded bg-gray-100" />
                  </div>
                  <div className="w-44 shrink-0">
                    <div className="h-3 w-24 animate-pulse rounded bg-gray-100" />
                  </div>
                  <div className="w-32 shrink-0">
                    <div className="h-3 w-20 animate-pulse rounded bg-gray-100" />
                  </div>
                  <div className="w-24 shrink-0">
                    <div className="h-3 w-8 animate-pulse rounded bg-gray-100" />
                  </div>
                  <div className="w-24 shrink-0">
                    <div className="h-3 w-8 animate-pulse rounded bg-gray-100" />
                  </div>
                  <div className="w-36 shrink-0">
                    <div className="h-3 w-8 animate-pulse rounded bg-gray-100" />
                  </div>
                  <div className="w-32 shrink-0">
                    <div className="h-3 w-20 animate-pulse rounded bg-gray-100" />
                  </div>
                  <div className="w-8 shrink-0" />
                </div>
              ))}
            </div>
          ) : filtered.length === 0 ? (
            <div className="mx-auto flex w-full max-w-xs flex-col items-start py-24">
              <FolderOpen className="mb-4 h-8 w-8 text-gray-300" />
              <p className="font-serif text-2xl font-medium text-gray-900">Applications</p>
              <p className="mt-1 max-w-xs text-xs text-gray-400">
                Upload documents into applications, then start chats and tabular reviews with them.
              </p>
              <button
                onClick={() => setModalOpen(true)}
                className="mt-4 inline-flex items-center gap-1 rounded-full bg-gray-900 px-3 py-1 text-xs font-medium text-white shadow-md transition-colors hover:bg-gray-700"
              >
                + Create New
              </button>
            </div>
          ) : (
            <div>
              {filtered.map((application) => {
                const rowBg = selectedIds.includes(application.id) ? "bg-gray-50" : "bg-white";
                return (
                  <div
                    key={application.id}
                    onClick={() => {
                      if (renamingId === application.id) return;
                      router.push(`/applications/${application.id}`);
                    }}
                    className="group flex h-10 cursor-pointer items-center border-b border-gray-50 pr-8 transition-colors hover:bg-gray-50"
                  >
                    <div
                      className={`sticky left-0 z-[60] ${CHECK_W} flex items-center justify-center p-2 ${rowBg} group-hover:bg-gray-50`}
                      onClick={(e) => e.stopPropagation()}
                    >
                      <input
                        type="checkbox"
                        checked={selectedIds.includes(application.id)}
                        onChange={() => toggleOne(application.id)}
                        className="h-2.5 w-2.5 cursor-pointer rounded border-gray-200 accent-black"
                      />
                    </div>

                    {/* Application Name */}
                    <div
                      className={`sticky left-8 z-[60] ${NAME_COL_W} p-2 ${rowBg} group-hover:bg-gray-50`}
                    >
                      {renamingId === application.id ? (
                        <input
                          autoFocus
                          value={renameValue}
                          onChange={(e) => setRenameValue(e.target.value)}
                          onKeyDown={(e) => {
                            if (e.key === "Enter") handleRenameSubmit(application.id);
                            if (e.key === "Escape") setRenamingId(null);
                          }}
                          onBlur={() => handleRenameSubmit(application.id)}
                          onClick={(e) => e.stopPropagation()}
                          className="w-full bg-transparent text-sm text-gray-800 outline-none"
                        />
                      ) : (
                        <span className="block truncate text-sm text-gray-800">
                          {application.name}
                        </span>
                      )}
                    </div>

                    <div className="w-44 shrink-0 truncate text-sm text-gray-500">
                      {application.company_name ?? <span className="text-gray-300">-</span>}
                    </div>

                    <div
                      className="ml-auto w-32 shrink-0 truncate text-sm text-gray-500"
                      onClick={(e) => e.stopPropagation()}
                    >
                      {cmEditingId === application.id ? (
                        <input
                          autoFocus
                          value={cmValue}
                          onChange={(e) => setCmValue(e.target.value)}
                          onKeyDown={(e) => {
                            if (e.key === "Enter") handleCmSubmit(application.id);
                            if (e.key === "Escape") setCmEditingId(null);
                          }}
                          onBlur={() => handleCmSubmit(application.id)}
                          placeholder="CM #"
                          className="w-full bg-transparent text-sm text-gray-800 outline-none"
                        />
                      ) : (
                        (application.cm_number ?? <span className="text-gray-300">—</span>)
                      )}
                    </div>
                    <div className="w-24 shrink-0 truncate text-sm text-gray-500">
                      {application.document_count ?? 0}
                    </div>
                    <div className="w-24 shrink-0 truncate text-sm text-gray-500">
                      {application.chat_count ?? 0}
                    </div>
                    <div className="w-36 shrink-0 truncate text-sm text-gray-500">
                      {application.review_count ?? 0}
                    </div>
                    <div className="w-32 shrink-0 truncate text-sm text-gray-500">
                      {formatDate(application.created_at)}
                    </div>

                    <div
                      className="flex w-8 shrink-0 justify-end"
                      onClick={(e) => e.stopPropagation()}
                    >
                      <RowActions
                        onRename={() => {
                          setRenameValue(application.name);
                          setRenamingId(application.id);
                        }}
                        onUpdateCmNumber={() => {
                          setCmValue(application.cm_number ?? "");
                          setCmEditingId(application.id);
                        }}
                        onDelete={async () => {
                          await deleteApplication(application.id);
                          setApplications((prev) => prev.filter((p) => p.id !== application.id));
                        }}
                      />
                    </div>
                  </div>
                );
              })}
            </div>
          )}
        </div>
      </div>

      <NewApplicationModal
        open={modalOpen}
        onClose={() => setModalOpen(false)}
        onCreated={(p) => {
          setApplications((prev) => [p, ...prev]);
          router.push(`/applications/${p.id}`);
        }}
      />
    </div>
  );
}
