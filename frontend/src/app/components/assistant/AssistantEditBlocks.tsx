"use client";

import { ChevronDown, Loader2 } from "lucide-react";
import type { ReactNode } from "react";
import { useState } from "react";

import { API_BASE } from "@/app/lib/lukeApi";

import type { LukeEditAnnotation } from "../shared/types";
import { applyOptimisticResolution } from "./EditCard";

type PendingEdit = {
  annotation: LukeEditAnnotation;
  filename: string;
};

type ResolveStartHandler = (args: {
  editId: string;
  documentId: string;
  verb: "accept" | "reject";
}) => void;

type ResolvedHandler = (args: {
  editId: string;
  documentId: string;
  status: "accepted" | "rejected";
  versionId: string | null;
  downloadUrl: string | null;
}) => void;

type ResolveErrorHandler = (args: {
  editId: string;
  documentId: string;
  versionId: string | null;
  message: string;
}) => void;

function BulkEditActions({
  pending,
  onViewClick,
  onResolveStart,
  onResolved,
  onError,
}: {
  pending: PendingEdit[];
  onViewClick?: (ann: LukeEditAnnotation, filename: string) => void;
  onResolveStart?: ResolveStartHandler;
  onResolved?: ResolvedHandler;
  onError?: ResolveErrorHandler;
}) {
  const [busy, setBusy] = useState<"accept" | "reject" | null>(null);
  const [progress, setProgress] = useState<{
    done: number;
    total: number;
  } | null>(null);

  if (pending.length === 0) return null;

  const handleAll = async (verb: "accept" | "reject") => {
    if (busy) return;
    setBusy(verb);
    setProgress({ done: 0, total: pending.length });
    try {
      let done = 0;
      for (const { annotation } of pending) {
        onResolveStart?.({
          editId: annotation.edit_id,
          documentId: annotation.document_id,
          verb,
        });
        let revert: (() => void) | null = null;
        try {
          revert = applyOptimisticResolution(annotation, verb);
        } catch (e) {
          console.error("[BulkEditActions] optimistic update threw", e);
        }
        try {
          const resp = await fetch(
            `${API_BASE}/single-documents/${annotation.document_id}/edits/${annotation.edit_id}/${verb}`,
            {
              method: "POST",
            },
          );
          if (!resp.ok) throw new Error(`HTTP ${resp.status}`);
          const data = (await resp.json()) as {
            ok: boolean;
            status?: "accepted" | "rejected";
            version_id: string | null;
            download_url: string | null;
          };
          const nextStatus = data.status ?? (verb === "accept" ? "accepted" : "rejected");
          onResolved?.({
            editId: annotation.edit_id,
            documentId: annotation.document_id,
            status: nextStatus,
            versionId: data.version_id,
            downloadUrl: data.download_url,
          });
        } catch (e) {
          console.error("[BulkEditActions] resolve failed", e);
          try {
            revert?.();
          } catch (revertErr) {
            console.error("[BulkEditActions] revert threw", revertErr);
          }
          onError?.({
            editId: annotation.edit_id,
            documentId: annotation.document_id,
            versionId: annotation.version_id ?? null,
            message:
              verb === "accept"
                ? "Couldn't save one or more accepts."
                : "Couldn't save one or more rejects.",
          });
        }
        done++;
        setProgress({ done, total: pending.length });
      }
    } finally {
      setBusy(null);
      setProgress(null);
    }
  };

  const first = pending[0];

  return (
    <div className="flex items-center gap-2">
      <button
        onClick={() => handleAll("accept")}
        disabled={!!busy}
        className="inline-flex items-center gap-1 rounded border border-gray-900 bg-gray-900 px-2 py-1 text-xs text-white hover:bg-gray-800 disabled:opacity-50"
      >
        {busy === "accept" && <Loader2 className="h-3 w-3 animate-spin" />}
        Accept all
      </button>
      <button
        onClick={() => handleAll("reject")}
        disabled={!!busy}
        className="inline-flex items-center gap-1 rounded border border-gray-200 bg-white px-2 py-1 text-xs text-gray-700 hover:bg-gray-100 disabled:opacity-50"
      >
        {busy === "reject" && <Loader2 className="h-3 w-3 animate-spin" />}
        Reject all
      </button>
      {progress && (
        <span className="font-serif text-xs text-gray-500">
          {progress.done}/{progress.total}
        </span>
      )}
      {onViewClick && first && (
        <button
          onClick={() => onViewClick(first.annotation, first.filename)}
          disabled={!!busy}
          className="ml-auto rounded border border-gray-200 bg-white px-2 py-1 text-xs text-gray-700 hover:bg-gray-100 disabled:opacity-50"
        >
          View
        </button>
      )}
    </div>
  );
}

export function EditCardsSection({
  pending,
  filenameByDocId,
  cards,
  resolvedCount,
  onViewClick,
  onResolveStart,
  onResolved,
  onError,
}: {
  pending: PendingEdit[];
  filenameByDocId: Map<string, string>;
  cards: ReactNode[];
  resolvedCount: number;
  onViewClick?: (ann: LukeEditAnnotation, filename: string) => void;
  onResolveStart?: ResolveStartHandler;
  onResolved?: ResolvedHandler;
  onError?: ResolveErrorHandler;
}) {
  const [isOpen, setIsOpen] = useState(true);
  if (cards.length === 0) return null;

  const docCount = filenameByDocId.size;
  const summary =
    pending.length > 0
      ? docCount > 1
        ? `${pending.length} tracked changes across ${docCount} documents`
        : `${pending.length} tracked ${pending.length === 1 ? "change" : "changes"}`
      : docCount > 1
        ? `${resolvedCount} resolved tracked changes across ${docCount} documents`
        : `${resolvedCount} resolved tracked ${resolvedCount === 1 ? "change" : "changes"}`;

  return (
    <div className="overflow-hidden rounded-lg border border-gray-200 bg-white">
      <div className="flex items-center gap-2 px-3 pt-3">
        <p className="min-w-0 flex-1 truncate font-serif text-sm text-gray-700">{summary}</p>
        <button
          onClick={() => setIsOpen((v) => !v)}
          aria-label={isOpen ? "Collapse edits" : "Expand edits"}
          className="shrink-0 rounded p-1 text-gray-500 transition-colors hover:bg-gray-100 hover:text-gray-800"
        >
          <ChevronDown
            className={`h-4 w-4 transition-transform duration-200 ${isOpen ? "" : "-rotate-90"}`}
          />
        </button>
      </div>
      {pending.length > 0 && (
        <div className="px-3 pt-3">
          <BulkEditActions
            pending={pending}
            onViewClick={onViewClick}
            onResolveStart={onResolveStart}
            onResolved={onResolved}
            onError={onError}
          />
        </div>
      )}
      {isOpen && <div className="flex flex-col gap-2 px-3 pt-3 pb-3">{cards}</div>}
      {!isOpen && <div className="pb-3" />}
    </div>
  );
}
