"use client";

import { useEffect, useState } from "react";

import { getApplication, listApplications, listStandaloneDocuments } from "@/app/lib/lukeApi";

import type { LukeApplication, LukeDocument } from "./types";

const CACHE_TTL_MS = 30_000;

interface DirectoryCache {
  standaloneDocuments: LukeDocument[];
  applications: LukeApplication[];
  fetchedAt: number;
}

let cache: DirectoryCache | null = null;

export function invalidateDirectoryCache() {
  cache = null;
}

export function useDirectoryData(enabled: boolean) {
  const [loading, setLoading] = useState(true);
  const [standaloneDocuments, setStandaloneDocuments] = useState<LukeDocument[]>([]);
  const [applications, setApplications] = useState<LukeApplication[]>([]);

  useEffect(() => {
    if (!enabled) return;

    const now = Date.now();
    if (cache && now - cache.fetchedAt < CACHE_TTL_MS) {
      const cached = cache;
      queueMicrotask(() => {
        setStandaloneDocuments(cached.standaloneDocuments);
        setApplications(cached.applications);
        setLoading(false);
      });
      return;
    }

    queueMicrotask(() => setLoading(true));
    Promise.all([listApplications(), listStandaloneDocuments()])
      .then(([ps, ds]) => {
        const sorted = [...ds].sort((a, b) =>
          (b.created_at ?? "").localeCompare(a.created_at ?? ""),
        );
        return Promise.all(ps.map((p) => getApplication(p.id))).then((fullApplications) => {
          cache = {
            standaloneDocuments: sorted,
            applications: fullApplications,
            fetchedAt: Date.now(),
          };
          setStandaloneDocuments(sorted);
          setApplications(fullApplications);
        });
      })
      .catch(() => {
        setStandaloneDocuments([]);
        setApplications([]);
      })
      .finally(() => setLoading(false));
  }, [enabled]);

  return { loading, standaloneDocuments, applications };
}
