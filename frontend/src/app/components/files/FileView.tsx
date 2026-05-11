"use client";

import { Download, Trash2 } from "lucide-react";
import { useRouter } from "next/navigation";
import { useEffect, useState } from "react";

import { DocView } from "@/app/components/shared/DocView";
import type { LukeDocument } from "@/app/components/shared/types";
import { deleteDocument, getDocumentUrl, listDocuments } from "@/app/lib/lukeApi";

interface Props {
  /** Document id without the `documents:` prefix (from the URL). */
  fileId: string;
}

export function FileView({ fileId }: Props) {
  const router = useRouter();
  const fullId = `documents:${fileId}`;
  const [doc, setDoc] = useState<LukeDocument | null>(null);
  const [loading, setLoading] = useState(true);
  const [notFound, setNotFound] = useState(false);

  useEffect(() => {
    let cancelled = false;
    listDocuments()
      .then((rows) => {
        if (cancelled) return;
        const match = rows.find((d) => d.id === fullId) ?? null;
        setDoc(match);
        setNotFound(!match);
      })
      .catch(() => {
        if (cancelled) return;
        setNotFound(true);
      })
      .finally(() => {
        if (cancelled) return;
        setLoading(false);
      });
    return () => {
      cancelled = true;
    };
  }, [fullId]);

  async function handleDownload() {
    if (!doc) return;
    const { url, filename } = await getDocumentUrl(doc.id, null);
    const a = document.createElement("a");
    a.href = url;
    a.download = filename;
    a.click();
  }

  async function handleDelete() {
    if (!doc) return;
    await deleteDocument(fileId);
    router.push("/files");
  }

  return (
    <div className="flex h-full overflow-hidden bg-white">
      <div className="flex flex-1 flex-col overflow-hidden">
        {/* Header */}
        <div className="flex shrink-0 items-start justify-between gap-4 bg-white px-8 py-4">
          <div className="flex min-w-0 items-center gap-1.5 font-serif text-2xl font-medium">
            <button
              onClick={() => router.push("/files")}
              className="text-gray-500 transition-colors hover:text-gray-700"
            >
              Files
            </button>
            <span className="text-gray-300">›</span>
            {loading ? (
              <div className="h-6 w-40 animate-pulse rounded bg-gray-100" />
            ) : (
              <span className="truncate text-gray-900">
                {doc?.filename ?? (notFound ? "Not found" : "")}
              </span>
            )}
          </div>
          {doc && (
            <div className="flex shrink-0 items-center gap-1">
              <button
                onClick={handleDownload}
                title="Download"
                className="flex h-7 w-7 items-center justify-center rounded text-gray-400 transition-colors hover:bg-gray-100 hover:text-gray-700"
              >
                <Download className="h-4 w-4" />
              </button>
              <button
                onClick={handleDelete}
                title="Delete"
                className="flex h-7 w-7 items-center justify-center rounded text-gray-400 transition-colors hover:bg-red-50 hover:text-red-500"
              >
                <Trash2 className="h-4 w-4" />
              </button>
            </div>
          )}
        </div>

        {/* Body */}
        <div className="flex flex-1 flex-col overflow-hidden px-8 pb-6">
          {notFound ? (
            <div className="flex flex-1 items-center justify-center text-sm text-gray-500">
              This file no longer exists.
            </div>
          ) : (
            <DocView doc={doc ? { document_id: doc.id, version_id: null } : null} />
          )}
        </div>
      </div>
    </div>
  );
}
