"use client";

import type {
  LukeDocumentKind,
  LukeLibraryKind,
  LukeMetadataStatus,
} from "@/app/components/shared/types";

// Short human labels for the document kind enum. Falls back to the raw value
// for any future enum the frontend hasn't been updated for yet.
const KIND_LABELS: Record<LukeDocumentKind, string> = {
  resume: "Resume",
  resume_baseline: "Baseline Resume",
  job_description: "Job Description",
  interview_transcript: "Transcript",
  recruiter_notes: "Recruiter Notes",
  prep_packet: "Prep Packet",
  cheatsheet: "Cheatsheet",
  interviewer_bio: "Interviewer Bio",
  schedule: "Schedule",
  story: "Story",
  about_me: "About Me",
  answer_bank: "Answer Bank",
  framework: "Framework",
  references: "References",
  cover_letter: "Cover Letter",
  writing_sample: "Writing Sample",
  coaching_state: "Coaching State",
  unclassified: "Unclassified",
};

function kindLabel(kind: LukeDocumentKind | null | undefined): string {
  if (!kind) return "Unclassified";
  return KIND_LABELS[kind] ?? kind;
}

const STATUS_LABELS: Record<LukeMetadataStatus, string> = {
  unprocessed: "Unprocessed",
  queued: "Queued",
  processing: "Processing",
  ready: "Classified",
  error: "Error",
  user_confirmed: "Confirmed",
};

const STATUS_TONES: Record<LukeMetadataStatus, string> = {
  unprocessed: "bg-zinc-100 text-zinc-600 border-zinc-200",
  queued: "bg-amber-50 text-amber-700 border-amber-200",
  processing: "bg-amber-50 text-amber-700 border-amber-200 animate-pulse",
  ready: "bg-emerald-50 text-emerald-700 border-emerald-200",
  error: "bg-rose-50 text-rose-700 border-rose-200",
  user_confirmed: "bg-sky-50 text-sky-700 border-sky-200",
};

interface MetadataBadgesProps {
  kind?: LukeDocumentKind | null;
  library?: boolean | null;
  libraryKind?: LukeLibraryKind | null;
  metadataStatus?: LukeMetadataStatus | null;
  compact?: boolean;
}

export function MetadataBadges({
  kind,
  library,
  libraryKind,
  metadataStatus,
  compact = false,
}: MetadataBadgesProps) {
  const status = (metadataStatus ?? "unprocessed") as LukeMetadataStatus;
  const statusLabel = STATUS_LABELS[status] ?? status;
  const statusTone = STATUS_TONES[status] ?? STATUS_TONES.unprocessed;
  const libraryLabel = library
    ? libraryKind === "reference"
      ? "Reference"
      : "Library"
    : library === false
      ? "Application"
      : null;

  return (
    <div className={`flex flex-wrap items-center gap-1.5 ${compact ? "text-[10px]" : "text-xs"}`}>
      {kind !== undefined && (
        <span className="rounded-full border border-zinc-200 bg-white px-2 py-0.5 font-medium text-zinc-700">
          {kindLabel(kind)}
        </span>
      )}
      {libraryLabel && (
        <span
          className={`rounded-full border px-2 py-0.5 font-medium ${
            library
              ? "border-violet-200 bg-violet-50 text-violet-700"
              : "border-zinc-200 bg-zinc-50 text-zinc-700"
          }`}
        >
          {libraryLabel}
        </span>
      )}
      <span
        className={`rounded-full border px-2 py-0.5 font-medium ${statusTone}`}
        title={`metadata_status=${status}`}
      >
        {statusLabel}
      </span>
    </div>
  );
}

export { KIND_LABELS, STATUS_LABELS };
