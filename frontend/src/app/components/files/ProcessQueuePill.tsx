"use client";

import { useQuery } from "@tanstack/react-query";

import { getMetadataQueue } from "@/app/lib/documentMetadata";

const QUEUE_KEY = ["metadata-queue"] as const;

// ProcessQueuePill polls /single-documents/metadata-queue every 5s while any
// document is queued or processing. Hides itself when both counts hit 0 so it
// doesn't clutter the header in the steady state.
export function ProcessQueuePill() {
  const { data } = useQuery({
    queryKey: QUEUE_KEY,
    queryFn: getMetadataQueue,
    refetchInterval: 5000,
  });
  if (!data) return null;
  const queued = data.counts.find((c) => c.metadata_status === "queued")?.count ?? 0;
  const processing = data.counts.find((c) => c.metadata_status === "processing")?.count ?? 0;
  if (queued === 0 && processing === 0) return null;
  return (
    <span
      className="inline-flex items-center gap-1.5 rounded-full border border-amber-200 bg-amber-50 px-3 py-1 text-xs font-medium text-amber-700"
      title={`queued=${queued}, processing=${processing}`}
    >
      <span className="h-1.5 w-1.5 animate-pulse rounded-full bg-amber-500" />
      Classifying {processing > 0 ? `${processing}/${queued + processing}` : `${queued} queued`}
    </span>
  );
}
