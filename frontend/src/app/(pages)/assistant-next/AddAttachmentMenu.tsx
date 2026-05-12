"use client";

import { useComposerRuntime } from "@assistant-ui/react";
import { LayoutGridIcon, Loader2Icon, PlusIcon, Upload } from "lucide-react";
import { useRef, useState } from "react";

import { AddDocumentsModal } from "@/app/components/shared/AddDocumentsModal";
import type { LukeDocument } from "@/app/components/shared/types";
import { DOCUMENT_UPLOAD_ACCEPT } from "@/app/lib/documentTypes";
import { TooltipIconButton } from "@/components/assistant-ui/tooltip-icon-button";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";

import { LUKE_DOCUMENT_PART, type LukeDocumentPartData } from "./attachmentAdapter";
import { aniEvent, aniWrap } from "./observability";

/**
 * Drop-in replacement for ComposerAddAttachment. Two-option dropdown:
 * - Upload files → file picker, each file flows through our
 *   attachment adapter (uploads via /single-documents and surfaces as
 *   a pending → complete attachment).
 * - Browse all → opens the existing AddDocumentsModal library picker;
 *   selected (already-uploaded) docs are inserted directly as
 *   CompleteAttachments via `composer.addAttachment(CreateAttachment)`,
 *   so we skip the upload round-trip.
 */
export function AddAttachmentMenu() {
  const composer = useComposerRuntime();
  const fileInputRef = useRef<HTMLInputElement>(null);
  const [open, setOpen] = useState(false);
  const [uploading, setUploading] = useState(false);
  const [browseOpen, setBrowseOpen] = useState(false);

  const handleFiles = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const files = Array.from(e.target.files ?? []);
    if (files.length === 0) return;
    setUploading(true);
    try {
      await aniWrap("attachment.menu.upload_files", { "files.count": files.length }, async () => {
        for (const file of files) {
          await composer.addAttachment(file);
        }
      });
    } finally {
      setUploading(false);
      if (fileInputRef.current) fileInputRef.current.value = "";
    }
  };

  const handleBrowseSelect = async (docs: LukeDocument[]) => {
    await aniWrap("attachment.menu.browse_select", { "documents.count": docs.length }, async () => {
      for (const doc of docs) {
        const data: LukeDocumentPartData = {
          document_id: doc.id,
          filename: doc.filename ?? doc.id,
        };
        await composer.addAttachment({
          id: doc.id,
          type: "document",
          name: data.filename,
          content: [{ type: "data", name: LUKE_DOCUMENT_PART, data }],
        });
      }
    });
    setBrowseOpen(false);
  };

  const handleOpenChange = (next: boolean) => {
    setOpen(next);
    if (next) aniEvent("attachment.menu.open");
  };

  return (
    <>
      <input
        ref={fileInputRef}
        type="file"
        accept={DOCUMENT_UPLOAD_ACCEPT}
        multiple
        className="hidden"
        onChange={handleFiles}
      />
      <DropdownMenu open={open} onOpenChange={handleOpenChange}>
        <DropdownMenuTrigger asChild>
          <TooltipIconButton
            tooltip="Add Attachment"
            side="bottom"
            variant="ghost"
            size="icon"
            className="hover:bg-muted-foreground/15 dark:border-muted-foreground/15 dark:hover:bg-muted-foreground/30 size-8 rounded-full p-1 text-xs font-semibold"
            aria-label="Add Attachment"
          >
            <PlusIcon className="size-5 stroke-[1.5px]" />
          </TooltipIconButton>
        </DropdownMenuTrigger>
        <DropdownMenuContent className="z-50 w-44" side="top" align="start">
          <DropdownMenuItem
            className="cursor-pointer"
            disabled={uploading}
            onSelect={(e) => {
              e.preventDefault();
              fileInputRef.current?.click();
            }}
          >
            {uploading ? (
              <Loader2Icon className="text-muted-foreground mr-2 h-4 w-4 animate-spin" />
            ) : (
              <Upload className="text-muted-foreground mr-2 h-4 w-4" />
            )}
            <span className="text-sm">{uploading ? "Uploading…" : "Upload files"}</span>
          </DropdownMenuItem>
          <DropdownMenuItem
            className="cursor-pointer"
            onSelect={(e) => {
              e.preventDefault();
              setOpen(false);
              setBrowseOpen(true);
            }}
          >
            <LayoutGridIcon className="text-muted-foreground mr-2 h-4 w-4" />
            <span className="text-sm">Browse all</span>
          </DropdownMenuItem>
        </DropdownMenuContent>
      </DropdownMenu>
      <AddDocumentsModal
        open={browseOpen}
        onClose={() => {
          aniEvent("attachment.menu.browse_cancel");
          setBrowseOpen(false);
        }}
        onSelect={handleBrowseSelect}
        breadcrumb={["Add documents"]}
      />
    </>
  );
}
