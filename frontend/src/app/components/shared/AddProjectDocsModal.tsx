"use client";

import { Check, Loader2, Search, Upload, X } from "lucide-react";
import { useEffect, useRef, useState } from "react";
import { createPortal } from "react-dom";

import { DOCUMENT_UPLOAD_ACCEPT } from "@/app/lib/documentTypes";
import { getProject, uploadProjectDocument } from "@/app/lib/lukeApi";

import { DocFileIcon } from "./FileDirectory";
import type { LukeDocument } from "./types";
import { VersionChip } from "./VersionChip";

interface Props {
  open: boolean;
  onClose: () => void;
  onSelect: (documents: LukeDocument[]) => void;
  breadcrumb: string[];
  projectId: string;
  /** Docs already in the target list — rendered checked + disabled. */
  excludeDocIds?: Set<string>;
  allowMultiple?: boolean;
}

function formatDate(iso: string | null) {
  if (!iso) return null;
  return new Date(iso).toLocaleDateString(undefined, {
    day: "numeric",
    month: "short",
    year: "numeric",
  });
}

export function AddProjectDocsModal({
  open,
  onClose,
  onSelect,
  breadcrumb,
  projectId,
  excludeDocIds,
  allowMultiple = true,
}: Props) {
  const [docs, setDocs] = useState<LukeDocument[]>([]);
  const [loading, setLoading] = useState(false);
  const [search, setSearch] = useState("");
  const [selectedIds, setSelectedIds] = useState<Set<string>>(new Set());
  const [uploading, setUploading] = useState(false);
  const fileInputRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    if (!open) return;
    setSearch("");
    setSelectedIds(new Set());
    let cancelled = false;
    setLoading(true);
    getProject(projectId)
      .then((p) => {
        if (!cancelled) setDocs(p.documents ?? []);
      })
      .catch(() => {
        if (!cancelled) setDocs([]);
      })
      .finally(() => {
        if (!cancelled) setLoading(false);
      });
    return () => {
      cancelled = true;
    };
  }, [open, projectId]);

  if (!open) return null;

  const q = search.toLowerCase().trim();
  const filtered = q ? docs.filter((d) => d.filename.toLowerCase().includes(q)) : docs;

  const isExcluded = (id: string) => !!excludeDocIds?.has(id);

  function toggle(id: string) {
    if (isExcluded(id)) return;
    if (!allowMultiple) {
      setSelectedIds(new Set([id]));
      return;
    }
    setSelectedIds((prev) => {
      const next = new Set(prev);
      next.has(id) ? next.delete(id) : next.add(id);
      return next;
    });
  }

  function handleConfirm() {
    const selected = docs.filter((d) => selectedIds.has(d.id));
    onSelect(selected);
    onClose();
  }

  async function handleUpload(e: React.ChangeEvent<HTMLInputElement>) {
    const files = Array.from(e.target.files || []);
    if (!files.length) return;
    setUploading(true);
    try {
      const uploaded = await Promise.all(files.map((f) => uploadProjectDocument(projectId, f)));
      setDocs((prev) => [...uploaded, ...prev]);
      setSelectedIds((prev) => {
        const next = new Set(prev);
        uploaded.forEach((d) => next.add(d.id));
        return next;
      });
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
            onClick={onClose}
            className="rounded-lg p-1.5 text-gray-400 hover:bg-gray-100 hover:text-gray-600"
          >
            <X className="h-4 w-4" />
          </button>
        </div>

        {/* Search */}
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

        {/* File list */}
        <div className="flex-1 overflow-y-auto px-4 pb-2">
          {loading ? (
            <div className="overflow-hidden rounded-sm border border-gray-100">
              {[60, 45, 75, 55, 40].map((w, i) => (
                <div key={i} className="flex items-center gap-2 px-2 py-2">
                  <div className="h-3.5 w-3.5 shrink-0 rounded border border-gray-200" />
                  <div className="h-3.5 w-3.5 shrink-0 animate-pulse rounded bg-gray-200" />
                  <div
                    className="h-3 animate-pulse rounded bg-gray-200"
                    style={{ width: `${w}%` }}
                  />
                </div>
              ))}
            </div>
          ) : filtered.length === 0 ? (
            <p className="py-8 text-center text-sm text-gray-400">
              {q ? "No matches found" : "No documents in this project"}
            </p>
          ) : (
            <div className="overflow-hidden rounded-sm border border-gray-100">
              {filtered.map((doc) => {
                const excluded = isExcluded(doc.id);
                const checked = excluded || selectedIds.has(doc.id);
                return (
                  <button
                    type="button"
                    key={doc.id}
                    disabled={excluded}
                    onClick={() => toggle(doc.id)}
                    className={`flex w-full items-center gap-2 px-2 py-2 text-left text-xs transition-colors ${
                      excluded
                        ? "cursor-not-allowed opacity-50"
                        : checked
                          ? "bg-gray-100"
                          : "hover:bg-gray-50"
                    }`}
                  >
                    <span
                      className={`flex h-3.5 w-3.5 shrink-0 items-center justify-center rounded border ${
                        checked ? "border-gray-900 bg-gray-900" : "border-gray-300"
                      }`}
                    >
                      {checked && <Check className="h-2.5 w-2.5 text-white" />}
                    </span>
                    <DocFileIcon fileType={doc.file_type} />
                    <span
                      className={`flex-1 truncate ${checked ? "text-gray-900" : "text-gray-700"}`}
                    >
                      {doc.filename}
                    </span>
                    {excluded && (
                      <span className="shrink-0 text-[10px] text-gray-400">Already added</span>
                    )}
                    <VersionChip n={doc.latest_version_number} />
                    {doc.created_at && (
                      <span className="shrink-0 text-gray-300">{formatDate(doc.created_at)}</span>
                    )}
                  </button>
                );
              })}
            </div>
          )}
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
              onClick={onClose}
              className="rounded-lg px-3 py-1.5 text-sm text-gray-500 hover:bg-gray-100"
            >
              Cancel
            </button>
            <button
              onClick={handleConfirm}
              disabled={selectedIds.size === 0 || uploading}
              className="rounded-lg bg-gray-900 px-4 py-1.5 text-sm font-medium text-white hover:bg-gray-700 disabled:opacity-40"
            >
              Confirm
            </button>
          </div>
        </div>
      </div>
    </div>,
    document.body,
  );
}
