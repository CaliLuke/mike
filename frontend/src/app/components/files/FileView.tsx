"use client";

import { useQuery, useQueryClient } from "@tanstack/react-query";
import { Download, Trash2 } from "lucide-react";
import { useRouter } from "next/navigation";

import { MetadataBadges } from "@/app/components/files/MetadataBadges";
import { MetadataPanel } from "@/app/components/files/MetadataPanel";
import { DocView } from "@/app/components/shared/DocView";
import type { LukeDocument } from "@/app/components/shared/types";
import { deleteDocument, getDocumentUrl, listDocuments } from "@/app/lib/lukeApi";

interface Props {
  /** Document id without the `documents:` prefix (from the URL). */
  fileId: string;
}

const DOCUMENTS_KEY = ["documents"] as const;

export function FileView({ fileId }: Props) {
  const router = useRouter();
  const queryClient = useQueryClient();
  const fullId = `documents:${fileId}`;
  // useQuery (not useState+useEffect) so the page reflects backend changes
  // when the classifier finishes — invalidate ["documents"] anywhere and this
  // view refetches. Poll every 3s while the classifier might be running so
  // the user sees "Classifying… → Classified" without a manual refresh.
  const {
    data: docs = [],
    isLoading: loading,
    isError,
  } = useQuery<LukeDocument[]>({
    queryKey: DOCUMENTS_KEY,
    queryFn: listDocuments,
    refetchInterval: (query) => {
      const all = query.state.data;
      const me = all?.find((d) => d.id === fullId);
      const inFlight = me?.metadata_status === "queued" || me?.metadata_status === "processing";
      return inFlight ? 3000 : false;
    },
  });
  const doc = docs.find((d) => d.id === fullId) ?? null;
  const notFound = !loading && !isError && !doc;

  function applyDocUpdate(updated: LukeDocument) {
    queryClient.setQueryData<LukeDocument[]>(DOCUMENTS_KEY, (prev) => {
      if (!prev) return [updated];
      return prev.map((d) => (d.id === updated.id ? updated : d));
    });
  }

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
          <div className="flex min-w-0 flex-col gap-1.5">
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
              <MetadataBadges
                kind={doc.kind}
                library={doc.library}
                libraryKind={doc.library_kind}
                metadataStatus={doc.metadata_status}
              />
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
        <div className="flex flex-1 flex-col gap-4 overflow-auto px-8 pb-6">
          {notFound ? (
            <div className="flex flex-1 items-center justify-center text-sm text-gray-500">
              This file no longer exists.
            </div>
          ) : (
            <>
              <DocView doc={doc ? { document_id: doc.id, version_id: null } : null} />
              {doc && (
                <MetadataPanel
                  key={`${doc.id}::${doc.metadata_processed_at ?? ""}::${doc.metadata_status ?? ""}`}
                  doc={doc}
                  onUpdated={applyDocUpdate}
                />
              )}
            </>
          )}
        </div>
      </div>
    </div>
  );
}
