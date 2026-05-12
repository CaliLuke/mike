"use client";

import { Download, Eye, EyeOff, FolderMinus, History, Pencil, Trash2, Upload } from "lucide-react";
import { useEffect, useRef, useState } from "react";

interface Props {
  onDelete?: () => void;
  onHide?: () => void;
  onUnhide?: () => void;
  onDownload?: () => void;
  onRemoveFromFolder?: () => void;
  onShowAllVersions?: () => void;
  onUploadNewVersion?: () => void;
  deleting?: boolean;
  onRename?: () => void;
}

export function RowActions({
  onDelete,
  onHide,
  onUnhide,
  onDownload,
  onRemoveFromFolder,
  onShowAllVersions,
  onUploadNewVersion,
  deleting,
  onRename,
}: Props) {
  const [open, setOpen] = useState(false);
  const [coords, setCoords] = useState({ top: 0, right: 0 });
  const btnRef = useRef<HTMLButtonElement>(null);

  useEffect(() => {
    if (!open) return;
    function handleClick() {
      setOpen(false);
    }
    document.addEventListener("click", handleClick);
    return () => document.removeEventListener("click", handleClick);
  }, [open]);

  function handleToggle(e: React.MouseEvent) {
    e.stopPropagation();
    if (!open && btnRef.current) {
      const rect = btnRef.current.getBoundingClientRect();
      setCoords({
        top: rect.bottom + 4,
        right: window.innerWidth - rect.right,
      });
    }
    setOpen((o) => !o);
  }

  return (
    <>
      <button
        ref={btnRef}
        onClick={handleToggle}
        className="flex h-6 w-6 items-center justify-center rounded leading-none text-gray-700 transition-colors hover:bg-gray-100 hover:text-gray-900"
      >
        <span className="text-xs tracking-widest">···</span>
      </button>

      {open && (
        <div
          style={{ position: "fixed", top: coords.top, right: coords.right }}
          className="z-50 w-48 overflow-hidden rounded-xl border border-gray-100 bg-white shadow-lg"
          onClick={(e) => e.stopPropagation()}
        >
          {onRename && (
            <button
              onClick={() => {
                setOpen(false);
                onRename();
              }}
              className="flex w-full items-center gap-2 px-3 py-2 text-xs text-gray-600 transition-colors hover:bg-gray-50"
            >
              <Pencil className="h-3.5 w-3.5" />
              Rename
            </button>
          )}
          {onDownload && (
            <button
              onClick={() => {
                setOpen(false);
                onDownload();
              }}
              className="flex w-full items-center gap-2 px-3 py-2 text-xs text-gray-600 transition-colors hover:bg-gray-50"
            >
              <Download className="h-3.5 w-3.5" />
              Download
            </button>
          )}
          {onShowAllVersions && (
            <button
              onClick={() => {
                setOpen(false);
                onShowAllVersions();
              }}
              className="flex w-full items-center gap-2 px-3 py-2 text-left text-xs text-gray-600 transition-colors hover:bg-gray-50"
            >
              <History className="h-3.5 w-3.5 shrink-0" />
              Show all versions
            </button>
          )}
          {onUploadNewVersion && (
            <button
              onClick={() => {
                setOpen(false);
                onUploadNewVersion();
              }}
              className="flex w-full items-center gap-2 px-3 py-2 text-left text-xs text-gray-600 transition-colors hover:bg-gray-50"
            >
              <Upload className="h-3.5 w-3.5 shrink-0" />
              Upload new version
            </button>
          )}
          {onRemoveFromFolder && (
            <button
              onClick={() => {
                setOpen(false);
                onRemoveFromFolder();
              }}
              className="flex w-full items-center gap-2 px-3 py-2 text-left text-xs text-gray-600 transition-colors hover:bg-gray-50"
            >
              <FolderMinus className="h-3.5 w-3.5 shrink-0" />
              Remove from subfolder
            </button>
          )}
          {onUnhide && (
            <button
              onClick={() => {
                setOpen(false);
                onUnhide();
              }}
              className="flex w-full items-center gap-2 px-3 py-2 text-xs text-gray-600 transition-colors hover:bg-gray-50"
            >
              <Eye className="h-3.5 w-3.5" />
              Unhide
            </button>
          )}
          {onHide && (
            <button
              onClick={() => {
                setOpen(false);
                onHide();
              }}
              className="flex w-full items-center gap-2 px-3 py-2 text-xs text-gray-600 transition-colors hover:bg-gray-50"
            >
              <EyeOff className="h-3.5 w-3.5" />
              Hide
            </button>
          )}
          {onDelete && (
            <button
              onClick={() => {
                setOpen(false);
                onDelete();
              }}
              disabled={deleting}
              className="flex w-full items-center gap-2 px-3 py-2 text-xs text-red-500 transition-colors hover:bg-red-50 disabled:opacity-40"
            >
              <Trash2 className="h-3.5 w-3.5" />
              Delete
            </button>
          )}
        </div>
      )}
    </>
  );
}
