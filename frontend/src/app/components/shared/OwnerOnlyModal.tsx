"use client";

import { Lock, X } from "lucide-react";
import { createPortal } from "react-dom";

interface Props {
  open: boolean;
  onClose: () => void;
  /** Short headline above the body, e.g. "Owner-only action". */
  title?: string;
  /** Sentence describing what the user tried to do. */
  action?: string;
  /** Email of the application/resource owner, shown so the user knows who to ask. */
  ownerEmail?: string | null;
  /** Override the default message entirely. */
  message?: string;
}

/**
 * Lightweight "you don't have permission" modal shown when a non-owner
 * attempts an owner-only action (manage people, rename, delete, …) on a
 * shared application. Replaces the silent 404 the backend would otherwise
 * return so the user understands why the action didn't go through.
 */
export function OwnerOnlyModal({
  open,
  onClose,
  title = "Owner-only action",
  action,
  ownerEmail,
  message,
}: Props) {
  if (!open) return null;

  const body =
    message ??
    (action
      ? `Only the application owner can ${action}.`
      : "Only the application owner can perform this action.");

  return createPortal(
    <div
      className="fixed inset-0 z-[200] flex items-center justify-center bg-black/10 backdrop-blur-xs"
      onClick={onClose}
    >
      <div
        className="flex w-full max-w-md flex-col rounded-2xl bg-white shadow-2xl"
        onClick={(e) => e.stopPropagation()}
      >
        {/* Header */}
        <div className="flex items-start justify-between gap-3 px-5 pt-5 pb-2">
          <div className="flex items-center gap-2">
            <Lock className="h-4 w-4 text-amber-600" />
            <h2 className="text-base font-medium text-gray-900">{title}</h2>
          </div>
          <button
            onClick={onClose}
            className="rounded-lg p-1.5 text-gray-400 hover:bg-gray-100 hover:text-gray-600"
          >
            <X className="h-4 w-4" />
          </button>
        </div>

        {/* Body */}
        <div className="px-5 pt-1 pb-2">
          <p className="text-sm leading-relaxed text-gray-600">{body}</p>
          {ownerEmail && (
            <p className="mt-2 text-xs text-gray-400">
              Ask <span className="text-gray-600">{ownerEmail}</span> if you need access.
            </p>
          )}
        </div>

        {/* Footer */}
        <div className="flex justify-end gap-2 px-5 pt-3 pb-5">
          <button
            onClick={onClose}
            className="rounded-lg bg-gray-900 px-4 py-1.5 text-sm font-medium text-white hover:bg-gray-700"
          >
            OK
          </button>
        </div>
      </div>
    </div>,
    document.body,
  );
}
