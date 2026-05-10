"use client";

import { MessageSquare, Table2, X } from "lucide-react";
import { useEffect, useRef, useState } from "react";

import { createWorkflow, updateWorkflow } from "@/app/lib/lukeApi";

import type { LukeWorkflow } from "../shared/types";
import { PRACTICE_OPTIONS } from "./practices";

interface Props {
  open: boolean;
  onClose: () => void;
  onCreated: (workflow: LukeWorkflow) => void;
  editWorkflow?: LukeWorkflow;
  onUpdated?: (workflow: LukeWorkflow) => void;
}

export function NewWorkflowModal({ open, onClose, onCreated, editWorkflow, onUpdated }: Props) {
  if (!open) return null;
  return (
    <NewWorkflowModalContent
      key={editWorkflow?.id ?? "new"}
      onClose={onClose}
      onCreated={onCreated}
      editWorkflow={editWorkflow}
      onUpdated={onUpdated}
    />
  );
}

function initialPractice(editWorkflow?: LukeWorkflow): {
  practice: string;
  customPractice: string;
} {
  const saved = editWorkflow?.practice ?? "";
  const isKnown = (PRACTICE_OPTIONS as readonly string[]).includes(saved);
  if (!isKnown && saved) return { practice: "Others", customPractice: saved };
  return { practice: saved, customPractice: "" };
}

function NewWorkflowModalContent({
  onClose,
  onCreated,
  editWorkflow,
  onUpdated,
}: Omit<Props, "open">) {
  const [title, setTitle] = useState(editWorkflow?.title ?? "");
  const [type, setType] = useState<"assistant" | "tabular">(editWorkflow?.type ?? "assistant");
  const initial = initialPractice(editWorkflow);
  const [practice, setPractice] = useState<string>(initial.practice);
  const [customPractice, setCustomPractice] = useState(initial.customPractice);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");
  const customInputRef = useRef<HTMLInputElement>(null);

  const isEditing = !!editWorkflow;
  const isOthers = practice === "Others";
  const effectivePractice = isOthers ? customPractice.trim() || null : practice || null;

  useEffect(() => {
    if (isOthers) {
      customInputRef.current?.focus();
    }
  }, [isOthers]);

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    if (!title.trim()) return;
    setLoading(true);
    setError("");
    try {
      if (isEditing && editWorkflow) {
        const updated = await updateWorkflow(editWorkflow.id, {
          title: title.trim(),
          practice: effectivePractice,
        });
        onUpdated?.(updated);
      } else {
        const workflow = await createWorkflow({
          title: title.trim(),
          type,
          practice: effectivePractice,
        });
        onCreated(workflow);
      }
      resetForm();
      onClose();
    } catch (err: unknown) {
      setError((err as Error).message || `Failed to ${isEditing ? "update" : "create"} workflow`);
    } finally {
      setLoading(false);
    }
  }

  function resetForm() {
    setTitle("");
    setType("assistant");
    setPractice("");
    setCustomPractice("");
    setError("");
  }

  function handleClose() {
    resetForm();
    onClose();
  }

  return (
    <div className="fixed inset-0 z-101 flex items-center justify-center bg-black/20 backdrop-blur-xs">
      <div
        className="flex w-full max-w-2xl flex-col overflow-hidden rounded-2xl bg-white shadow-2xl"
        style={{ height: 600 }}
      >
        {/* Header */}
        <div className="flex shrink-0 items-center justify-between px-6 pt-5 pb-2">
          <div className="flex items-center gap-1.5 text-xs text-gray-400">
            <span>Workflows</span>
            <span>›</span>
            <span>{isEditing ? "Edit workflow" : "New workflow"}</span>
          </div>
          <button
            onClick={handleClose}
            className="rounded-lg p-1.5 text-gray-400 transition-colors hover:bg-gray-100 hover:text-gray-600"
          >
            <X className="h-4 w-4" />
          </button>
        </div>

        <form onSubmit={handleSubmit} className="flex min-h-0 flex-1 flex-col">
          {/* Body */}
          <div className="flex-1 overflow-y-auto px-6 pt-3 pb-5">
            {/* Title */}
            <input
              type="text"
              value={title}
              onChange={(e) => setTitle(e.target.value)}
              placeholder="Workflow name"
              className="w-full bg-transparent font-serif text-2xl text-gray-800 placeholder-gray-300 focus:outline-none"
              autoFocus
            />

            {/* Type pills — only shown when creating */}
            {!isEditing && (
              <div className="mt-5">
                <p className="mb-2 text-sm font-medium text-gray-500">Type</p>
                <div className="flex items-center gap-2">
                  <button
                    type="button"
                    onClick={() => setType("assistant")}
                    className={`flex items-center gap-1.5 rounded-full border px-3 py-1 text-xs transition-colors ${
                      type === "assistant"
                        ? "border-gray-900 bg-gray-900 text-white"
                        : "border-gray-200 text-gray-600 hover:bg-gray-50"
                    }`}
                  >
                    <MessageSquare className="h-3 w-3" />
                    Assistant
                  </button>
                  <button
                    type="button"
                    onClick={() => setType("tabular")}
                    className={`flex items-center gap-1.5 rounded-full border px-3 py-1 text-xs transition-colors ${
                      type === "tabular"
                        ? "border-gray-900 bg-gray-900 text-white"
                        : "border-gray-200 text-gray-600 hover:bg-gray-50"
                    }`}
                  >
                    <Table2 className="h-3 w-3" />
                    Tabular
                  </button>
                </div>
              </div>
            )}

            {/* Practice */}
            <div className="mt-5">
              <p className="mb-2 text-sm font-medium text-gray-500">Practice Area</p>
              <div className="flex flex-wrap gap-2">
                {PRACTICE_OPTIONS.map((p) => (
                  <button
                    key={p}
                    type="button"
                    onClick={() => setPractice(practice === p ? "" : p)}
                    className={`rounded-full border px-3 py-1 text-xs transition-colors ${
                      practice === p
                        ? "border-gray-900 bg-gray-900 text-white"
                        : "border-gray-200 text-gray-600 hover:bg-gray-50"
                    }`}
                  >
                    {p}
                  </button>
                ))}
              </div>
              {isOthers && (
                <input
                  ref={customInputRef}
                  type="text"
                  value={customPractice}
                  onChange={(e) => setCustomPractice(e.target.value)}
                  placeholder="Enter practice area…"
                  className="mt-3 w-full rounded-md border border-gray-200 px-3 py-1.5 text-sm text-gray-700 placeholder-gray-400 focus:border-gray-400 focus:outline-none"
                />
              )}
            </div>

            {error && <p className="mt-4 text-sm text-red-500">{error}</p>}
          </div>

          {/* Footer */}
          <div className="flex shrink-0 items-center justify-end gap-2 border-t border-gray-100 px-6 py-4">
            <button
              type="button"
              onClick={handleClose}
              className="rounded-lg px-4 py-2 text-sm text-gray-500 transition-colors hover:bg-gray-100"
            >
              Cancel
            </button>
            <button
              type="submit"
              disabled={!title.trim() || loading}
              className="rounded-lg bg-gray-900 px-5 py-2 text-sm font-medium text-white transition-colors hover:bg-gray-700 disabled:opacity-40"
            >
              {loading
                ? isEditing
                  ? "Saving…"
                  : "Creating…"
                : isEditing
                  ? "Save changes"
                  : "Create workflow"}
            </button>
          </div>
        </form>
      </div>
    </div>
  );
}
