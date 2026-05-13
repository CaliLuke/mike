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
      // Octet-stream / unknown: sniff the body before deciding. DOCX/ZIP
      // files start with the PK magic (0x50 0x4B); anything else routed
      // to docx-preview crashes inside JSZip ("Can't find end of central
      // directory"). Falling back to text keeps a misclassified markdown
      // or plain-text doc viewable instead of erroring out.
      const buffer = await response.arrayBuffer();
      const head = new Uint8Array(buffer.slice(0, 2));
      if (head[0] === 0x50 && head[1] === 0x4b) {
        return { type: "docx" };
      }
      const text = new TextDecoder("utf-8", { fatal: false }).decode(buffer);
      return { type: "text", text, markdown: false };
    },
  });

  return {
    result: (query.data ?? null) as DocResult,
    loading: query.isLoading,
    error: query.error ? "Failed to load document." : null,
  };
}
