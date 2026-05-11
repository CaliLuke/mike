"use client";

import { useQuery } from "@tanstack/react-query";

import { API_BASE } from "@/app/lib/lukeApi";

/**
 * /display returns either PDF bytes (when the active version has a PDF
 * rendition) or raw DOCX bytes otherwise. Reporting the type lets the
 * caller swap between DocView (PDF.js) and DocxView (docx-preview)
 * accordingly.
 */
export type DocResult =
  | { type: "pdf"; blob: Blob }
  | { type: "text"; text: string; markdown: boolean }
  | { type: "docx" }
  | null;

export function useFetchSingleDoc(
  documentId: string | null | undefined,
  versionId?: string | null,
) {
  const query = useQuery<Exclude<DocResult, null>>({
    queryKey: ["single-doc", documentId, versionId ?? "current"],
    enabled: !!documentId,
    queryFn: async ({ signal }) => {
      const qs = versionId ? `?version_id=${encodeURIComponent(versionId)}` : "";
      const response = await fetch(`${API_BASE}/single-documents/${documentId}/display${qs}`, {
        signal,
      });
      if (!response.ok) throw new Error(`HTTP ${response.status}`);

      const contentType = response.headers.get("content-type") ?? "";
      if (contentType.includes("application/pdf")) {
        // Keep a Blob (not an ArrayBuffer) — pdf.js transfers the
        // underlying buffer to its worker on use, which detaches it.
        // Reading `blob.arrayBuffer()` per render gives us a fresh,
        // owned copy each time.
        const blob = await response.blob();
        return { type: "pdf", blob };
      }
      if (contentType.startsWith("text/")) {
        const text = await response.text();
        return { type: "text", text, markdown: contentType.includes("markdown") };
      }
      // Drain the body so the connection is reusable.
      await response.arrayBuffer().catch(() => {});
      return { type: "docx" };
    },
  });

  return {
    result: (query.data ?? null) as DocResult,
    loading: query.isLoading,
    error: query.error ? "Failed to load document." : null,
  };
}
