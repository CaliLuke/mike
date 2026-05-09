"use client";

import { Download, Trash2, X } from "lucide-react";
import { useEffect, useState } from "react";
import { createPortal } from "react-dom";

import { getDocumentUrl } from "@/app/lib/lukeApi";

import { DocView } from "./DocView";
import type { LukeDocument } from "./types";

interface Props {
  doc: LukeDocument | null;
  /** Optional specific version to display. Only honoured for DOCX. */
  versionId?: string | null;
  /** Optional label suffix for the header (e.g. "V3"). */
  versionLabel?: string | null;
  onClose: () => void;
  onDelete?: (doc: LukeDocument) => void;
}

export function DocViewModal({ doc, versionId, versionLabel, onClose, onDelete }: Props) {
  const [mounted, setMounted] = useState(false);
  useEffect(() => {
    queueMicrotask(() => setMounted(true));
  }, []);

  if (!doc || !mounted) return null;

  async function handleDownload() {
    if (!doc) return;
    const { url, filename } = await getDocumentUrl(doc.id, versionId ?? null);
    const a = document.createElement("a");
    a.href = url;
    a.download = filename;
    a.click();
  }

  return createPortal(
    <div
      className="fixed inset-0 z-100 flex items-center justify-center bg-black/40"
      onClick={onClose}
    >
      <div
        className="relative flex h-[90vh] w-[800px] max-w-[90vw] flex-col rounded-xl bg-white shadow-2xl"
        onClick={(e) => e.stopPropagation()}
      >
        {/* Header */}
        <div className="flex shrink-0 items-center justify-between px-5 py-3">
          <span className="truncate pr-4 font-serif text-base font-medium text-gray-800">
            {doc.filename}
            {versionLabel && (
              <span className="ml-2 text-xs font-normal text-gray-500">{versionLabel}</span>
            )}
          </span>
          <div className="flex shrink-0 items-center gap-1">
            <button
              onClick={handleDownload}
              className="flex h-6 w-6 items-center justify-center rounded text-gray-400 transition-colors hover:bg-gray-100 hover:text-gray-700"
            >
              <Download className="h-4 w-4" />
            </button>
            {onDelete && (
              <button
                onClick={() => {
                  onDelete(doc);
                  onClose();
                }}
                className="flex h-6 w-6 items-center justify-center rounded text-gray-400 transition-colors hover:bg-red-50 hover:text-red-500"
              >
                <Trash2 className="h-4 w-4" />
              </button>
            )}
            <button
              onClick={onClose}
              className="flex h-6 w-6 items-center justify-center rounded text-gray-400 transition-colors hover:bg-gray-100 hover:text-gray-700"
            >
              <X className="h-4 w-4" />
            </button>
          </div>
        </div>

        {/* DocView serves PDF when available and falls back to
                    docx-preview internally if the active version has no
                    PDF rendition. Passing no versionId tells the backend
                    to resolve the latest tracked-changes version. */}
        <div className="flex flex-1 flex-col overflow-hidden px-3 pb-3">
          <DocView
            key={versionId ?? "current"}
            doc={{
              document_id: doc.id,
              version_id: versionId ?? null,
            }}
          />
        </div>
      </div>
    </div>,
    document.body,
  );
}
