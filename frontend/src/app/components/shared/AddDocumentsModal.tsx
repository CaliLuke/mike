"use client";

import { Loader2, Search, Upload, X } from "lucide-react";
import { useRef, useState } from "react";
import { createPortal } from "react-dom";

import { DOCUMENT_UPLOAD_ACCEPT } from "@/app/lib/documentTypes";
import {
  addDocumentToApplication,
  deleteDocument,
  uploadApplicationDocument,
  uploadStandaloneDocument,
} from "@/app/lib/lukeApi";
import { useAuth } from "@/contexts/AuthContext";

import { FileDirectory } from "./FileDirectory";
import { OwnerOnlyModal } from "./OwnerOnlyModal";
import type { LukeDocument } from "./types";
import { useDirectoryData, useInvalidateDirectory } from "./useDirectoryData";

interface Props {
  open: boolean;
  onClose: () => void;
  onSelect: (documents: LukeDocument[], applicationId?: string) => void;
  breadcrumb: string[];
  allowMultiple?: boolean;
  applicationId?: string;
}

export function AddDocumentsModal({
  open,
  onClose,
  onSelect,
  breadcrumb,
  allowMultiple = true,
  applicationId,
}: Props) {
  const { loading, standaloneDocuments, applications } = useDirectoryData(open);
  const invalidateDirectory = useInvalidateDirectory();
  const { user } = useAuth();
  const [selectedIds, setSelectedIds] = useState<Set<string>>(new Set());
  const [uploading, setUploading] = useState(false);
  const [search, setSearch] = useState("");
  const [extraUploadedDocs, setExtraUploadedDocs] = useState<LukeDocument[]>([]);
  // IDs deleted in this session — hidden locally since `useDirectoryData`'s
  // cached state won't re-fetch until the modal reopens.
  const [deletedIds, setDeletedIds] = useState<Set<string>>(new Set());
  const [ownerOnlyAction, setOwnerOnlyAction] = useState<string | null>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);

  function resetLocalState() {
    setSearch("");
    setSelectedIds(new Set());
    setExtraUploadedDocs([]);
    setDeletedIds(new Set());
  }

  if (!open) return null;

  function handleClose() {
    resetLocalState();
    onClose();
  }

  const q = search.toLowerCase().trim();

  const allStandalone = [
    ...extraUploadedDocs.filter((u) => !standaloneDocuments.some((d) => d.id === u.id)),
    ...standaloneDocuments,
  ].filter((d) => !deletedIds.has(d.id));

  const filteredStandalone = q
    ? allStandalone.filter((d) => d.filename.toLowerCase().includes(q))
    : allStandalone;

  const filteredApplications = applications
    .filter((p) => p.id !== applicationId)
    .map((p) => ({
      ...p,
      documents: (p.documents || []).filter(
        (d) => !deletedIds.has(d.id) && (!q || d.filename.toLowerCase().includes(q)),
      ),
    }))
    .filter((p) => !q || p.name.toLowerCase().includes(q) || p.documents.length > 0);

  const allDocs = [...allStandalone, ...applications.flatMap((p) => p.documents || [])];

  async function handleConfirm() {
    const selected = allDocs.filter((d) => selectedIds.has(d.id));

    if (applicationId) {
      const toAssign = selected.filter((d) => d.application_id !== applicationId);
      const alreadyHere = selected.filter((d) => d.application_id === applicationId);
      if (toAssign.length > 0) {
        setUploading(true);
        try {
          const assigned = await Promise.all(
            toAssign.map((d) => addDocumentToApplication(applicationId, d.id)),
          );
          onSelect([...alreadyHere, ...assigned], applicationId);
        } catch (err) {
          console.error("Failed to assign documents:", err);
        } finally {
          setUploading(false);
        }
      } else {
        onSelect(alreadyHere, applicationId);
      }
      handleClose();
      return;
    }

    const applicationIds = new Set(
      selected
        .map((d) => d.application_id)
        .filter((id): id is string => typeof id === "string" && id.length > 0),
    );
    const [singleApplicationId] = applicationIds;
    onSelect(selected, singleApplicationId);
    handleClose();
  }

  async function handleDelete(ids: string[]) {
    // Server only allows the doc creator to delete. Filter to owned
    // and warn for the rest.
    const docsById = new Map<string, LukeDocument>();
    for (const d of [
      ...standaloneDocuments,
      ...extraUploadedDocs,
      ...applications.flatMap((p) => p.documents ?? []),
    ]) {
      docsById.set(d.id, d);
    }
    const owned = ids.filter((id) => {
      const d = docsById.get(id);
      return !d || !d.user_id || !user?.id || d.user_id === user.id;
    });
    const blocked = ids.length - owned.length;
    if (owned.length === 0 && blocked > 0) {
      setOwnerOnlyAction(
        "delete these documents — only the document creator can delete a document",
      );
      return;
    }
    const idSet = new Set(owned);
    try {
      await Promise.all(owned.map((id) => deleteDocument(id)));
    } catch (err) {
      console.error("Delete failed:", err);
      return;
    }
    invalidateDirectory();
    setExtraUploadedDocs((prev) => prev.filter((d) => !idSet.has(d.id)));
    setDeletedIds((prev) => {
      const next = new Set(prev);
      owned.forEach((id) => next.add(id));
      return next;
    });
    if (blocked > 0) {
      setOwnerOnlyAction(
        `delete ${blocked} of the selected documents — only the document creator can delete a document`,
      );
    }
  }

  async function handleUpload(e: React.ChangeEvent<HTMLInputElement>) {
    const files = Array.from(e.target.files || []);
    if (!files.length) return;
    setUploading(true);
    try {
      const uploaded = await Promise.all(
        files.map((f) =>
          applicationId ? uploadApplicationDocument(applicationId, f) : uploadStandaloneDocument(f),
        ),
      );
      invalidateDirectory();
      setExtraUploadedDocs((prev) => [...uploaded, ...prev]);
      uploaded.forEach((d) => setSelectedIds((prev) => new Set([...prev, d.id])));
    } catch (err) {
      console.error("Upload failed:", err);
    } finally {
      setUploading(false);
      if (fileInputRef.current) fileInputRef.current.value = "";
    }
  }

  return createPortal(
    <div className="fixed inset-0 z-[200] flex items-center justify-center bg-black/10 backdrop-blur-xs">
      <div className="flex h-[600px] w-full max-w-2xl flex-col rounded-2xl bg-white shadow-2xl">
        {/* Header */}
        <div className="flex items-center justify-between px-5 py-4">
          <div className="flex items-center gap-1.5 text-xs text-gray-400">
            {breadcrumb.map((segment, i) => (
              <span key={i} className="flex items-center gap-1.5">
                {i > 0 && <span>›</span>}
                {segment}
              </span>
            ))}
          </div>
          <button
            onClick={handleClose}
            className="rounded-lg p-1.5 text-gray-400 hover:bg-gray-100 hover:text-gray-600"
          >
            <X className="h-4 w-4" />
          </button>
        </div>

        {/* Search bar */}
        <div className="px-4 pt-1 pb-2">
          <div className="flex items-center gap-2 rounded-lg border border-gray-200 bg-gray-50 px-3 py-2">
            <Search className="h-3.5 w-3.5 shrink-0 text-gray-400" />
            <input
              type="text"
              placeholder="Search…"
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              className="flex-1 bg-transparent text-sm text-gray-700 outline-none placeholder:text-gray-400"
              autoFocus
            />
            {search && (
              <button onClick={() => setSearch("")} className="text-gray-400 hover:text-gray-600">
                <X className="h-3.5 w-3.5" />
              </button>
            )}
          </div>
        </div>

        {/* File browser */}
        <div className="flex-1 overflow-y-auto px-4 pb-2">
          <FileDirectory
            standaloneDocs={filteredStandalone}
            directoryApplications={filteredApplications}
            loading={loading}
            selectedIds={selectedIds}
            onChange={setSelectedIds}
            allowMultiple={allowMultiple}
            forceExpanded={!!q}
            emptyMessage={q ? "No matches found" : "No documents yet"}
            onDelete={handleDelete}
          />
        </div>

        {/* Footer */}
        <div className="flex items-center justify-between gap-3 border-t border-gray-100 px-4 py-3">
          <div>
            <input
              ref={fileInputRef}
              type="file"
              accept={DOCUMENT_UPLOAD_ACCEPT}
              multiple
              className="hidden"
              onChange={handleUpload}
            />
            <button
              onClick={() => fileInputRef.current?.click()}
              disabled={uploading}
              className="flex items-center gap-1.5 rounded-lg border border-gray-200 px-3 py-1.5 text-sm text-gray-600 hover:bg-gray-50 disabled:opacity-50"
            >
              {uploading ? (
                <Loader2 className="h-3.5 w-3.5 animate-spin" />
              ) : (
                <Upload className="h-3.5 w-3.5" />
              )}
              {uploading ? "Uploading…" : "Upload"}
            </button>
          </div>
          <div className="flex items-center gap-2">
            {selectedIds.size > 0 && (
              <span className="text-xs text-gray-400">{selectedIds.size} selected</span>
            )}
            <button
              onClick={handleClose}
              className="rounded-lg px-3 py-1.5 text-sm text-gray-500 hover:bg-gray-100"
            >
              Cancel
            </button>
            <button
              onClick={handleConfirm}
              disabled={selectedIds.size === 0 || uploading}
              className="rounded-lg bg-gray-900 px-4 py-1.5 text-sm font-medium text-white hover:bg-gray-700 disabled:opacity-40"
            >
              {uploading ? "Saving…" : "Confirm"}
            </button>
          </div>
        </div>
      </div>
      <OwnerOnlyModal
        open={!!ownerOnlyAction}
        action={ownerOnlyAction ?? undefined}
        onClose={() => setOwnerOnlyAction(null)}
      />
    </div>,
    document.body,
  );
}
