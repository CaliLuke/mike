"use client";

import { LayoutGridIcon, Loader2Icon,PlusIcon, Upload } from "lucide-react";
import { useRef, useState } from "react";

import { DOCUMENT_UPLOAD_ACCEPT } from "@/app/lib/documentTypes";
import { uploadStandaloneDocument } from "@/app/lib/lukeApi";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";

import type { LukeDocument } from "../shared/types";

interface Props {
  onSelectDoc: (doc: LukeDocument) => void;
  onBrowseAll: () => void;
  selectedDocIds?: string[];
}

export function AddDocButton({ onSelectDoc, onBrowseAll, selectedDocIds = [] }: Props) {
  const [isOpen, setIsOpen] = useState(false);
  const [uploading, setUploading] = useState(false);
  const fileInputRef = useRef<HTMLInputElement>(null);

  const handleUpload = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const files = Array.from(e.target.files || []);
    if (!files.length) return;
    setUploading(true);
    try {
      const uploaded = await Promise.all(files.map((f) => uploadStandaloneDocument(f)));
      uploaded.forEach((doc) => onSelectDoc(doc));
    } catch (err) {
      console.error("Upload failed:", err);
    } finally {
      setUploading(false);
      if (fileInputRef.current) fileInputRef.current.value = "";
    }
  };

  return (
    <>
      <input
        ref={fileInputRef}
        type="file"
        accept={DOCUMENT_UPLOAD_ACCEPT}
        multiple
        className="hidden"
        onChange={handleUpload}
      />
      <DropdownMenu onOpenChange={setIsOpen}>
        <DropdownMenuTrigger asChild>
          <button
            className={`flex h-8 cursor-pointer items-center gap-1 rounded-lg px-2 text-sm transition-colors ${
              selectedDocIds.length > 0
                ? "text-black hover:bg-gray-100"
                : "text-gray-400 hover:bg-gray-100 hover:text-gray-700"
            } ${isOpen ? "bg-gray-100" : ""}`}
            title="Add documents"
            aria-label="Add documents"
          >
            {selectedDocIds.length > 0 ? (
              <span className="font-medium tabular-nums">{selectedDocIds.length}</span>
            ) : (
              <PlusIcon
                className={`h-4 w-4 shrink-0 transition-transform duration-300 ${isOpen ? "rotate-[135deg]" : ""}`}
              />
            )}
            <span className="hidden sm:inline">
              {selectedDocIds.length === 1 ? "Document" : "Documents"}
            </span>
          </button>
        </DropdownMenuTrigger>
        <DropdownMenuContent className="z-50 w-44" side="bottom" align="start">
          <DropdownMenuItem
            className="cursor-pointer"
            disabled={uploading}
            onSelect={(e) => {
              e.preventDefault();
              fileInputRef.current?.click();
            }}
          >
            {uploading ? (
              <Loader2Icon className="mr-2 h-4 w-4 animate-spin text-gray-400" />
            ) : (
              <Upload className="mr-2 h-4 w-4 text-gray-500" />
            )}
            <span className="text-sm">{uploading ? "Uploading…" : "Upload files"}</span>
          </DropdownMenuItem>
          <DropdownMenuItem className="cursor-pointer" onClick={onBrowseAll}>
            <LayoutGridIcon className="mr-2 h-4 w-4 text-gray-500" />
            <span className="text-sm">Browse all</span>
          </DropdownMenuItem>
        </DropdownMenuContent>
      </DropdownMenu>
    </>
  );
}
