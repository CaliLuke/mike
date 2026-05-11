"use client";

import { useQuery, useQueryClient } from "@tanstack/react-query";
import { useCallback } from "react";

import { API_BASE } from "@/app/lib/lukeApi";

export interface FetchDocxResult {
  bytes: ArrayBuffer | null;
  loading: boolean;
  error: string | null;
}

const DOCX_BYTES_KEY = "docx-bytes";

function queryKey(
  documentId: string | null | undefined,
  versionId?: string | null,
  refetchKey?: number,
) {
  return [DOCX_BYTES_KEY, documentId, versionId ?? "", refetchKey ?? 0] as const;
}

/**
 * Fetch the raw .docx bytes for a document, optionally targeting a specific
 * tracked-changes version. Cached by React Query so tab switches don't
 * refetch and concurrent mounts share the in-flight request.
 */
export function useFetchDocxBytes(
  documentId: string | null | undefined,
  versionId?: string | null,
  refetchKey?: number,
): FetchDocxResult {
  const query = useQuery<ArrayBuffer>({
    queryKey: queryKey(documentId, versionId, refetchKey),
    enabled: !!documentId,
    queryFn: async ({ signal }) => {
      const qs = versionId ? `?version_id=${encodeURIComponent(versionId)}` : "";
      const r = await fetch(`${API_BASE}/single-documents/${documentId}/docx${qs}`, { signal });
      if (!r.ok) throw new Error(`HTTP ${r.status}`);
      return r.arrayBuffer();
    },
  });

  return {
    bytes: query.data ?? null,
    loading: query.isLoading,
    error: query.error ? (query.error as Error).message : null,
  };
}

/**
 * Evict cached docx bytes for a document (e.g. after accept/reject
 * writes new bytes at the same storage path, or a new version is
 * uploaded). Pass a versionId to scope eviction; omit to clear every
 * cached version for that document.
 */
export function useInvalidateDocxBytes() {
  const qc = useQueryClient();
  return useCallback(
    (documentId: string, versionId?: string | null) => {
      qc.invalidateQueries({
        predicate: (q) => {
          const k = q.queryKey;
          if (!Array.isArray(k) || k[0] !== DOCX_BYTES_KEY) return false;
          if (k[1] !== documentId) return false;
          if (versionId === undefined) return true;
          return k[2] === (versionId ?? "");
        },
      });
    },
    [qc],
  );
}
