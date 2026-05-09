"use client";

import { ChevronLeft, Search, X } from "lucide-react";
import { useEffect, useState } from "react";
import { createPortal } from "react-dom";
import ReactMarkdown from "react-markdown";
import remarkGfm from "remark-gfm";

import { listWorkflows } from "@/app/lib/lukeApi";

import type { LukeWorkflow } from "../shared/types";
import { BUILT_IN_WORKFLOWS } from "../workflows/builtinWorkflows";

interface Props {
  open: boolean;
  onClose: () => void;
  onSelect: (workflow: LukeWorkflow) => void;
  projectName?: string;
  projectCmNumber?: string | null;
  initialWorkflowId?: string;
}

export function AssistantWorkflowModal({
  open,
  onClose,
  onSelect,
  projectName,
  projectCmNumber,
  initialWorkflowId,
}: Props) {
  const [workflows, setWorkflows] = useState<LukeWorkflow[]>([]);
  const [loading, setLoading] = useState(false);
  const [selected, setSelected] = useState<LukeWorkflow | null>(null);
  const [search, setSearch] = useState("");
  const [rightVisible, setRightVisible] = useState(false);

  useEffect(() => {
    if (!selected) {
      queueMicrotask(() => setRightVisible(false));
      return;
    }
    const frame = requestAnimationFrame(() => setRightVisible(true));
    return () => cancelAnimationFrame(frame);
  }, [selected]);

  useEffect(() => {
    if (!open) {
      queueMicrotask(() => {
        setSelected(null);
        setSearch("");
      });
      return;
    }
    const builtins = BUILT_IN_WORKFLOWS.filter((w) => w.type === "assistant");
    queueMicrotask(() => {
      setWorkflows(builtins);
      setLoading(true);
    });
    listWorkflows("assistant")
      .then((custom) => {
        const all = [...builtins, ...custom];
        setWorkflows(all);
        if (initialWorkflowId) {
          const match = all.find((w) => w.id === initialWorkflowId);
          if (match) setSelected(match);
        }
      })
      .catch(() => {
        if (initialWorkflowId) {
          const match = builtins.find((w) => w.id === initialWorkflowId);
          if (match) setSelected(match);
        }
      })
      .finally(() => setLoading(false));
    // Pre-select from builtins immediately if possible
    if (initialWorkflowId) {
      const match = builtins.find((w) => w.id === initialWorkflowId);
      if (match) queueMicrotask(() => setSelected(match));
    }
  }, [open, initialWorkflowId]);

  if (!open) return null;

  const filteredWorkflows = search
    ? workflows.filter((w) => w.title.toLowerCase().includes(search.toLowerCase()))
    : workflows;

  function handleUse() {
    if (!selected) return;
    onSelect(selected);
    onClose();
  }

  return createPortal(
    <div className="fixed inset-0 z-[200] flex items-center justify-center bg-black/10 backdrop-blur-xs">
      <div
        className={`flex h-[600px] w-full flex-col rounded-2xl bg-white shadow-2xl ${selected ? "max-w-4xl" : "max-w-2xl"}`}
      >
        {/* Header */}
        <div className="flex shrink-0 items-center justify-between border-b border-gray-100 px-4 py-4">
          <div className="flex items-center gap-1.5 text-xs text-gray-400">
            {projectName ? (
              <>
                <span>Projects</span>
                <span>›</span>
                <span>
                  {projectName}
                  {projectCmNumber ? ` (#${projectCmNumber})` : ""}
                </span>
                <span>›</span>
                <span>Assistant</span>
                <span>›</span>
                <span>Add workflow</span>
              </>
            ) : (
              <>
                <span>Assistant</span>
                <span>›</span>
                <span>Add workflow</span>
              </>
            )}
          </div>
          <button
            onClick={onClose}
            className="rounded-lg p-1.5 text-gray-400 transition-colors hover:bg-gray-100 hover:text-gray-600"
          >
            <X className="h-4 w-4" />
          </button>
        </div>

        {/* Content */}
        <div className="flex min-h-0 flex-1 flex-row overflow-hidden">
          {/* Left panel — workflow list */}
          <div className={`overflow-y-auto ${selected ? "w-80 shrink-0" : "flex-1"}`}>
            {/* Search */}
            <div className="shrink-0 px-4 pt-3 pb-2">
              <div className="flex items-center gap-1.5 rounded-md border border-gray-200 bg-gray-50 px-2.5 py-1">
                <Search className="h-3 w-3 shrink-0 text-gray-400" />
                <input
                  type="text"
                  placeholder="Search workflows…"
                  value={search}
                  onChange={(e) => setSearch(e.target.value)}
                  className="flex-1 bg-transparent text-xs text-gray-700 outline-none placeholder:text-gray-400"
                />
                {search && (
                  <button
                    onClick={() => setSearch("")}
                    className="text-gray-400 hover:text-gray-600"
                  >
                    <X className="h-3 w-3" />
                  </button>
                )}
              </div>
            </div>

            {loading ? (
              <div className="space-y-px px-4 pt-1">
                {[60, 45, 75, 50, 65, 40, 55].map((w, i) => (
                  <div
                    key={i}
                    className="flex items-center justify-between gap-3 border-b border-gray-50 py-3"
                  >
                    <div
                      className="h-3 animate-pulse rounded bg-gray-100"
                      style={{ width: `${w}%` }}
                    />
                    <div className="h-3 w-10 shrink-0 animate-pulse rounded bg-gray-100" />
                  </div>
                ))}
              </div>
            ) : filteredWorkflows.length === 0 ? (
              <p className="px-4 py-8 text-center text-sm text-gray-400">
                {search ? "No matches found" : "No assistant workflows found"}
              </p>
            ) : (
              filteredWorkflows.map((wf) => (
                <button
                  key={wf.id}
                  type="button"
                  onClick={() => setSelected((prev) => (prev?.id === wf.id ? null : wf))}
                  className={`flex w-full items-center gap-3 border-b border-gray-50 px-4 py-3 text-left text-xs transition-colors ${
                    selected?.id === wf.id ? "bg-gray-50" : "hover:bg-gray-50"
                  }`}
                >
                  <span className="flex-1 truncate text-gray-800">{wf.title}</span>
                  <span className="shrink-0 text-xs text-gray-400">
                    {wf.is_system ? "Built-in" : "Custom"}
                  </span>
                </button>
              ))
            )}
          </div>

          {/* Right panel — prompt preview */}
          {selected && (
            <div
              className={`flex flex-1 flex-col overflow-hidden border-l border-gray-100 px-3 pb-3 transition-opacity duration-200 ${rightVisible ? "opacity-100" : "opacity-0"}`}
            >
              <div className="flex shrink-0 items-center justify-between py-3">
                <p className="text-xs font-medium text-gray-700">Workflow Prompt</p>
                <button
                  onClick={() => setSelected(null)}
                  className="rounded-lg p-1 text-gray-400 transition-colors hover:bg-gray-100 hover:text-gray-600"
                >
                  <ChevronLeft className="h-3.5 w-3.5" />
                </button>
              </div>
              <div className="flex-1 overflow-y-auto rounded-md border border-gray-200 bg-gray-50 px-4 py-3 font-serif text-sm leading-relaxed text-gray-600">
                <ReactMarkdown
                  remarkPlugins={[remarkGfm]}
                  components={{
                    h1: ({ children }) => (
                      <h1 className="mt-4 mb-1 text-base font-semibold text-gray-900 first:mt-0">
                        {children}
                      </h1>
                    ),
                    h2: ({ children }) => (
                      <h2 className="mt-3 mb-1 text-sm font-semibold text-gray-900 first:mt-0">
                        {children}
                      </h2>
                    ),
                    h3: ({ children }) => (
                      <h3 className="mt-2 mb-0.5 text-xs font-semibold text-gray-900 first:mt-0">
                        {children}
                      </h3>
                    ),
                    p: ({ children }) => <p className="mb-2 last:mb-0">{children}</p>,
                    ul: ({ children }) => (
                      <ul className="mb-2 list-disc space-y-0.5 pl-4">{children}</ul>
                    ),
                    ol: ({ children }) => (
                      <ol className="mb-2 list-decimal space-y-0.5 pl-4">{children}</ol>
                    ),
                    li: ({ children }) => <li>{children}</li>,
                    strong: ({ children }) => (
                      <strong className="font-semibold text-gray-800">{children}</strong>
                    ),
                    em: ({ children }) => <em className="italic">{children}</em>,
                  }}
                >
                  {selected.prompt_md ?? "_No prompt defined._"}
                </ReactMarkdown>
              </div>
            </div>
          )}
        </div>

        {/* Footer */}
        <div className="flex shrink-0 items-center justify-end gap-2 border-t border-gray-100 px-4 py-3">
          <button
            type="button"
            onClick={onClose}
            className="rounded-lg px-3 py-1.5 text-sm text-gray-500 transition-colors hover:bg-gray-100"
          >
            Cancel
          </button>
          <button
            type="button"
            onClick={handleUse}
            disabled={!selected}
            className="rounded-lg bg-gray-900 px-4 py-1.5 text-sm font-medium text-white transition-colors hover:bg-gray-700 disabled:opacity-40"
          >
            Use
          </button>
        </div>
      </div>
    </div>,
    document.body,
  );
}
