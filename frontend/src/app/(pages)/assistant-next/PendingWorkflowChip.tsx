"use client";

import { Library, X } from "lucide-react";

import { usePendingWorkflow } from "./pendingWorkflow";

/**
 * Shown above the composer input when a workflow has been picked via
 * `/workflow-name`. Clears on dismiss or after the next send (taken
 * inside onNew).
 */
export function PendingWorkflowChip() {
  const { pending, set } = usePendingWorkflow();
  if (!pending) return null;

  return (
    <div className="bg-primary/5 flex items-center gap-2 self-start rounded-full border px-3 py-1 text-xs">
      <Library className="h-3 w-3" />
      <span className="font-medium">Workflow:</span>
      <span className="max-w-[200px] truncate">{pending.title}</span>
      <button
        type="button"
        onClick={() => set(null)}
        className="hover:bg-muted rounded-full p-0.5"
        aria-label="Remove workflow"
      >
        <X className="h-3 w-3" />
      </button>
    </div>
  );
}
