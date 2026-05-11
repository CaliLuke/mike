"use client";

import { useQuery, useQueryClient } from "@tanstack/react-query";
import { useCallback } from "react";

import { getApplication, listApplications, listStandaloneDocuments } from "@/app/lib/lukeApi";

import type { LukeApplication, LukeDocument } from "./types";

interface DirectoryData {
  standaloneDocuments: LukeDocument[];
  applications: LukeApplication[];
}

const DIRECTORY_KEY = ["directory"] as const;

export function useDirectoryData(enabled: boolean) {
  const { data, isLoading } = useQuery<DirectoryData>({
    queryKey: DIRECTORY_KEY,
    enabled,
    staleTime: 30_000,
    queryFn: async () => {
      const [ps, ds] = await Promise.all([listApplications(), listStandaloneDocuments()]);
      const sorted = [...ds].sort((a, b) => (b.created_at ?? "").localeCompare(a.created_at ?? ""));
      const fullApplications = await Promise.all(ps.map((p) => getApplication(p.id)));
      return { standaloneDocuments: sorted, applications: fullApplications };
    },
  });

  return {
    loading: isLoading,
    standaloneDocuments: data?.standaloneDocuments ?? [],
    applications: data?.applications ?? [],
  };
}

export function useInvalidateDirectory() {
  const qc = useQueryClient();
  return useCallback(() => {
    qc.invalidateQueries({ queryKey: DIRECTORY_KEY });
  }, [qc]);
}
