"use client";

import { KIND_LABELS, STATUS_LABELS } from "@/app/components/files/MetadataBadges";
import type { LukeDocumentKind, LukeMetadataStatus } from "@/app/components/shared/types";

export type LibraryScope = "all" | "library" | "application";

export interface FilesFilterState {
  scope: LibraryScope;
  kind: LukeDocumentKind | "all";
  metadataStatus: LukeMetadataStatus | "all";
}

export const DEFAULT_FILES_FILTER: FilesFilterState = {
  scope: "all",
  kind: "all",
  metadataStatus: "all",
};

interface FilesFilterBarProps {
  state: FilesFilterState;
  onChange: (next: FilesFilterState) => void;
}

export function FilesFilterBar({ state, onChange }: FilesFilterBarProps) {
  return (
    <div className="flex flex-wrap items-center gap-2 text-xs">
      <label className="flex items-center gap-1.5 text-zinc-600">
        <span>Scope</span>
        <select
          className="rounded-md border border-zinc-200 bg-white px-2 py-1 text-zinc-700"
          value={state.scope}
          onChange={(e) => onChange({ ...state, scope: e.target.value as LibraryScope })}
        >
          <option value="all">All</option>
          <option value="library">Library</option>
          <option value="application">Application-specific</option>
        </select>
      </label>
      <label className="flex items-center gap-1.5 text-zinc-600">
        <span>Kind</span>
        <select
          className="rounded-md border border-zinc-200 bg-white px-2 py-1 text-zinc-700"
          value={state.kind}
          onChange={(e) => onChange({ ...state, kind: e.target.value as LukeDocumentKind | "all" })}
        >
          <option value="all">All</option>
          {Object.entries(KIND_LABELS).map(([k, label]) => (
            <option key={k} value={k}>
              {label}
            </option>
          ))}
        </select>
      </label>
      <label className="flex items-center gap-1.5 text-zinc-600">
        <span>Status</span>
        <select
          className="rounded-md border border-zinc-200 bg-white px-2 py-1 text-zinc-700"
          value={state.metadataStatus}
          onChange={(e) =>
            onChange({
              ...state,
              metadataStatus: e.target.value as LukeMetadataStatus | "all",
            })
          }
        >
          <option value="all">All</option>
          {Object.entries(STATUS_LABELS).map(([k, label]) => (
            <option key={k} value={k}>
              {label}
            </option>
          ))}
        </select>
      </label>
      {(state.scope !== "all" || state.kind !== "all" || state.metadataStatus !== "all") && (
        <button
          type="button"
          onClick={() => onChange(DEFAULT_FILES_FILTER)}
          className="text-zinc-500 underline-offset-2 hover:text-zinc-800 hover:underline"
        >
          clear
        </button>
      )}
    </div>
  );
}
