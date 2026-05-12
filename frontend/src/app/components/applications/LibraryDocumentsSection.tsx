"use client";

import { useRouter } from "next/navigation";

import { MetadataBadges } from "@/app/components/files/MetadataBadges";
import type { LukeLibraryDocumentBrief } from "@/app/components/shared/types";

function trimDocRef(id: string): string {
  return id.startsWith("documents:") ? id.slice("documents:".length) : id;
}

// LibraryDocumentsSection renders the application.library_documents array
// (populated by the backend sub-select in applicationListQuery) as a
// compact section above the application-specific documents table. Each
// chip links back to the document detail view in /files/{id}.
export function LibraryDocumentsSection({
  documents,
}: {
  documents: LukeLibraryDocumentBrief[] | undefined | null;
}) {
  const router = useRouter();
  if (!documents || documents.length === 0) return null;
  return (
    <section className="mb-4 rounded-lg border border-violet-100 bg-violet-50/40 p-4">
      <header className="mb-2 flex items-center justify-between">
        <h2 className="text-xs font-semibold tracking-wide text-violet-700 uppercase">
          Library documents linked to this application
        </h2>
        <span className="text-xs text-violet-600">{documents.length}</span>
      </header>
      <ul className="space-y-1.5">
        {documents.map((doc) => {
          const slug = trimDocRef(doc.id);
          return (
            <li
              key={doc.id}
              className="flex items-start justify-between gap-3 rounded-md border border-violet-100 bg-white px-3 py-2 hover:border-violet-300"
            >
              <button
                type="button"
                onClick={() => router.push(`/files/${slug}`)}
                className="flex min-w-0 flex-1 flex-col items-start gap-1 text-left"
              >
                <span className="truncate text-sm font-medium text-zinc-900">{doc.filename}</span>
                {doc.summary ? (
                  <span className="line-clamp-2 text-xs text-zinc-600">{doc.summary}</span>
                ) : null}
                <MetadataBadges
                  kind={doc.kind}
                  library={doc.library}
                  libraryKind={doc.library_kind}
                  metadataStatus={doc.metadata_status}
                  compact
                />
              </button>
            </li>
          );
        })}
      </ul>
    </section>
  );
}
