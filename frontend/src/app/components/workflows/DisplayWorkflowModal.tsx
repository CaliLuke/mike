"use client";

import { ChevronDown, Folder, MessageSquare, Search, Table2, X } from "lucide-react";
import { useRouter } from "next/navigation";
import { useEffect, useRef, useState } from "react";
import { createPortal } from "react-dom";
import ReactMarkdown from "react-markdown";
import remarkGfm from "remark-gfm";

import { useChatHistoryContext } from "@/app/contexts/ChatHistoryContext";
import { createTabularReview } from "@/app/lib/lukeApi";

import { FileDirectory } from "../shared/FileDirectory";
import type { LukeDocument, LukeWorkflow } from "../shared/types";
import type { LukeApplication } from "../shared/types";
import { useDirectoryData } from "../shared/useDirectoryData";
import { formatIcon, formatLabel } from "../tabular/columnFormat";

interface Props {
  workflows: LukeWorkflow[];
  workflow: LukeWorkflow | null;
  onClose: () => void;
}

// ---------------------------------------------------------------------------
// Toggle switch
// ---------------------------------------------------------------------------
function Toggle({ on, onToggle }: { on: boolean; onToggle: () => void }) {
  return (
    <button
      type="button"
      onClick={onToggle}
      className={`relative inline-flex h-5 w-9 shrink-0 rounded-full border-2 border-transparent transition-colors duration-200 ${on ? "bg-gray-900" : "bg-gray-200"}`}
    >
      <span
        className={`pointer-events-none inline-block h-4 w-4 rounded-full bg-white shadow transition-transform duration-200 ${on ? "translate-x-4" : "translate-x-0"}`}
      />
    </button>
  );
}

// ---------------------------------------------------------------------------
// Simple application picker (input + dropdown)
// ---------------------------------------------------------------------------
function SimpleApplicationPicker({
  applications,
  selectedId,
  onSelect,
}: {
  applications: LukeApplication[];
  selectedId: string | null;
  onSelect: (id: string | null) => void;
}) {
  const [search, setSearch] = useState("");
  const [open, setOpen] = useState(false);
  const selected = applications.find((p) => p.id === selectedId);
  const filtered = search
    ? applications.filter((p) => p.name.toLowerCase().includes(search.toLowerCase()))
    : applications;

  return (
    <div className="relative">
      <input
        type="text"
        value={selectedId ? (selected?.name ?? "") : search}
        onChange={(e) => {
          setSearch(e.target.value);
          setOpen(true);
          onSelect(null);
        }}
        onFocus={() => setOpen(true)}
        onBlur={() => setTimeout(() => setOpen(false), 150)}
        placeholder="Select a application…"
        className="w-full rounded-md border border-gray-200 bg-gray-50 px-3 py-2 text-xs text-gray-700 outline-none placeholder:text-gray-400"
      />
      {selectedId && (
        <button
          onMouseDown={() => {
            onSelect(null);
            setSearch("");
          }}
          className="absolute top-1/2 right-2 -translate-y-1/2 text-gray-400 hover:text-gray-600"
        >
          <X className="h-3 w-3" />
        </button>
      )}
      {open && !selectedId && (
        <div className="absolute top-full right-0 left-0 z-10 mt-1 max-h-40 overflow-y-auto rounded-md border border-gray-200 bg-white shadow-sm">
          {filtered.length === 0 ? (
            <p className="px-3 py-3 text-center text-xs text-gray-400">No applications found</p>
          ) : (
            filtered.map((p) => (
              <button
                key={p.id}
                onMouseDown={() => {
                  onSelect(p.id);
                  setSearch("");
                  setOpen(false);
                }}
                className="flex w-full items-center gap-2 px-3 py-1.5 text-left text-xs text-gray-700 hover:bg-gray-50"
              >
                <Folder className="h-3.5 w-3.5 shrink-0 text-gray-400" />
                {p.name}
              </button>
            ))
          )}
        </div>
      )}
    </div>
  );
}

// ---------------------------------------------------------------------------
// Shared markdown renderer
// ---------------------------------------------------------------------------
function MarkdownBody({ content }: { content: string }) {
  return (
    <ReactMarkdown
      remarkPlugins={[remarkGfm]}
      components={{
        h1: ({ children }) => (
          <h1 className="mt-4 mb-1 text-base font-semibold text-gray-900 first:mt-0">{children}</h1>
        ),
        h2: ({ children }) => (
          <h2 className="mt-3 mb-1 text-sm font-semibold text-gray-900 first:mt-0">{children}</h2>
        ),
        h3: ({ children }) => (
          <h3 className="mt-2 mb-0.5 text-xs font-semibold text-gray-900 first:mt-0">{children}</h3>
        ),
        p: ({ children }) => <p className="mb-2 last:mb-0">{children}</p>,
        ul: ({ children }) => <ul className="mb-2 list-disc space-y-0.5 pl-4">{children}</ul>,
        ol: ({ children }) => <ol className="mb-2 list-decimal space-y-0.5 pl-4">{children}</ol>,
        li: ({ children }) => <li>{children}</li>,
        strong: ({ children }) => (
          <strong className="font-semibold text-gray-800">{children}</strong>
        ),
        em: ({ children }) => <em className="italic">{children}</em>,
      }}
    >
      {content}
    </ReactMarkdown>
  );
}

// ---------------------------------------------------------------------------
// Right panel for assistant workflows (select screen)
// ---------------------------------------------------------------------------
function AssistantPanel({ workflow }: { workflow: LukeWorkflow }) {
  return (
    <div className="flex flex-1 flex-col overflow-hidden border-t border-l border-gray-200 px-3 pb-3">
      <div className="shrink-0 py-3">
        <p className="text-xs font-medium text-gray-700">Workflow Prompt</p>
      </div>
      <div className="flex-1 overflow-y-auto rounded-md border border-gray-200 bg-gray-50 px-4 py-3 font-serif text-sm leading-relaxed text-gray-600">
        <MarkdownBody content={workflow.prompt_md ?? "_No prompt defined._"} />
      </div>
    </div>
  );
}

// ---------------------------------------------------------------------------
// Right panel for tabular workflows — accordion column list (select screen)
// ---------------------------------------------------------------------------
function TabularPanel({ workflow }: { workflow: LukeWorkflow }) {
  const [expandedIndex, setExpandedIndex] = useState<number | null>(null);
  const columns = (workflow.columns_config ?? []).sort((a, b) => a.index - b.index);

  return (
    <div className="flex flex-1 flex-col overflow-hidden border-t border-l border-gray-200 px-3 pb-3">
      <div className="shrink-0 py-3">
        <p className="text-xs font-medium text-gray-700">Columns</p>
      </div>
      <div className="flex-1 overflow-y-auto rounded-md border border-gray-200 bg-gray-50">
        {columns.length === 0 ? (
          <p className="px-4 py-6 text-center text-xs text-gray-400">No columns defined</p>
        ) : (
          columns.map((col) => {
            const isExpanded = expandedIndex === col.index;
            const FormatIcon = formatIcon(col.format ?? "text");
            return (
              <div key={col.index} className="border-b border-gray-200">
                <button
                  type="button"
                  onClick={() => setExpandedIndex(isExpanded ? null : col.index)}
                  className="flex w-full items-center gap-2.5 px-3 py-2.5 text-left text-xs transition-colors hover:bg-white"
                >
                  <FormatIcon className="h-3.5 w-3.5 shrink-0 text-gray-400" />
                  <span className="flex-1 truncate text-gray-800">{col.name}</span>
                  <span className="shrink-0 text-gray-400">
                    {formatLabel(col.format ?? "text")}
                  </span>
                  <ChevronDown
                    className={`h-3 w-3 shrink-0 text-gray-300 transition-transform duration-150 ${isExpanded ? "rotate-180" : ""}`}
                  />
                </button>
                {isExpanded && (
                  <div className="space-y-3 border-t border-gray-200 bg-white px-4 py-3 font-serif text-sm leading-relaxed text-gray-600">
                    {col.tags && col.tags.length > 0 && (
                      <div>
                        <p className="mb-1.5 font-sans text-xs font-medium text-gray-400">Tags</p>
                        <div className="flex flex-wrap gap-1.5">
                          {col.tags.map((tag) => (
                            <span
                              key={tag}
                              className="inline-block rounded-full bg-gray-100 px-2 py-0.5 font-sans text-xs text-gray-600"
                            >
                              {tag}
                            </span>
                          ))}
                        </div>
                      </div>
                    )}
                    <div>
                      <p className="mb-1 font-sans text-xs font-medium text-gray-400">Prompt</p>
                      <MarkdownBody content={col.prompt || "_No prompt defined._"} />
                    </div>
                  </div>
                )}
              </div>
            );
          })
        )}
      </div>
    </div>
  );
}

// ---------------------------------------------------------------------------
// DisplayWorkflowModal
// ---------------------------------------------------------------------------
export function DisplayWorkflowModal({ workflows, workflow, onClose }: Props) {
  const [screen, setScreen] = useState<"select" | "configure">("select");
  const [selected, setSelected] = useState<LukeWorkflow | null>(workflow);
  const [listSearch, setListSearch] = useState("");
  const selectedRowRef = useRef<HTMLButtonElement>(null);

  // Configure screen state
  const [inApplication, setInApplication] = useState(false);
  const [selectedApplicationId, setSelectedApplicationId] = useState<string | null>(null);
  const [selectedDocIds, setSelectedDocIds] = useState<Set<string>>(new Set());
  const [docSearch, setDocSearch] = useState("");
  const [assistantPrompt, setAssistantPrompt] = useState("");
  const [saving, setSaving] = useState(false);

  const router = useRouter();
  const { saveChat, setNewChatMessages } = useChatHistoryContext();
  const {
    loading: dirLoading,
    applications,
    standaloneDocuments,
  } = useDirectoryData(screen === "configure");

  useEffect(() => {
    if (selected && selectedRowRef.current) {
      selectedRowRef.current.scrollIntoView({ block: "nearest" });
    }
  }, [selected]);

  function resetConfigureState() {
    setInApplication(false);
    setSelectedApplicationId(null);
    setSelectedDocIds(new Set());
    setDocSearch("");
    setAssistantPrompt("");
  }

  function handleClose() {
    setSelected(null);
    setScreen("select");
    setListSearch("");
    resetConfigureState();
    onClose();
  }

  if (!workflow) return null;
  const wf = selected ?? workflow;

  // ---------------------------------------------------------------------------
  // Handlers
  // ---------------------------------------------------------------------------
  async function handleStartChat() {
    setSaving(true);
    try {
      const applicationId = inApplication ? (selectedApplicationId ?? undefined) : undefined;
      const chatId = await saveChat(applicationId);
      if (!chatId) return;
      const allDocs: LukeDocument[] = [
        ...standaloneDocuments,
        ...applications.flatMap((p) => p.documents || []),
      ];
      const files = allDocs
        .filter((d) => selectedDocIds.has(d.id))
        .map((d) => ({ filename: d.filename, document_id: d.id }));
      const content = assistantPrompt.trim()
        ? `implement workflow\n\n${assistantPrompt.trim()}`
        : "implement workflow";
      setNewChatMessages([
        {
          role: "user",
          content,
          files: files.length > 0 ? files : undefined,
        },
      ]);
      handleClose();
      router.push(
        applicationId
          ? `/applications/${applicationId}/assistant/chat/${chatId}`
          : `/assistant/chat/${chatId}`,
      );
    } finally {
      setSaving(false);
    }
  }

  async function handleCreateReview() {
    const allDocs: LukeDocument[] = [
      ...standaloneDocuments,
      ...applications.flatMap((p) => p.documents || []),
    ];
    const docIds = allDocs.filter((d) => selectedDocIds.has(d.id)).map((d) => d.id);
    const applicationId = inApplication ? (selectedApplicationId ?? undefined) : undefined;

    setSaving(true);
    try {
      const review = await createTabularReview({
        title: wf.title,
        document_ids: docIds,
        columns_config: wf.columns_config || [],
        workflow_id: wf.is_system ? undefined : wf.id,
        application_id: applicationId,
      });
      handleClose();
      router.push(
        applicationId
          ? `/applications/${applicationId}/tabular-reviews/${review.id}`
          : `/tabular-reviews/${review.id}`,
      );
    } finally {
      setSaving(false);
    }
  }

  // ---------------------------------------------------------------------------
  // Tabular doc browser helpers
  // ---------------------------------------------------------------------------
  const q = docSearch.toLowerCase().trim();
  const selectedApplication = applications.find((p) => p.id === selectedApplicationId);
  const applicationDocs = selectedApplication?.documents ?? [];

  const filteredApplicationDocs = q
    ? applicationDocs.filter((d) => d.filename.toLowerCase().includes(q))
    : applicationDocs;

  const filteredStandalone = q
    ? standaloneDocuments.filter((d) => d.filename.toLowerCase().includes(q))
    : standaloneDocuments;

  const filteredAllApplications = applications
    .map((p) => ({
      ...p,
      documents: (p.documents || []).filter((d) => !q || d.filename.toLowerCase().includes(q)),
    }))
    .filter((p) => !q || p.name.toLowerCase().includes(q) || p.documents.length > 0);

  // ---------------------------------------------------------------------------
  // Render
  // ---------------------------------------------------------------------------
  return createPortal(
    <div className="fixed inset-0 z-[101] flex items-center justify-center bg-black/20 backdrop-blur-xs">
      <div
        className={`flex h-[600px] w-full flex-col rounded-2xl bg-white shadow-2xl transition-all duration-200 ${screen === "select" ? "max-w-4xl" : "max-w-2xl"}`}
      >
        {/* Header */}
        <div className="flex shrink-0 items-center justify-between px-5 py-4">
          <div className="flex items-center gap-1.5 text-xs text-gray-400">
            {screen === "select" ? (
              <>
                <span>Workflows</span>
                <span>›</span>
                <span>Select workflow</span>
              </>
            ) : (
              <>
                <button
                  onClick={() => {
                    resetConfigureState();
                    setScreen("select");
                  }}
                  className="transition-colors hover:text-gray-700"
                >
                  Workflows
                </button>
                <span>›</span>
                <span className="max-w-[160px] truncate">{wf.title}</span>
                <span>›</span>
                <span>{wf.type === "assistant" ? "New Chat" : "New Review"}</span>
              </>
            )}
          </div>
          <button
            onClick={onClose}
            className="rounded-lg p-1.5 text-gray-400 hover:bg-gray-100 hover:text-gray-600"
          >
            <X className="h-4 w-4" />
          </button>
        </div>

        {/* ── SELECT SCREEN ── */}
        {screen === "select" && (
          <>
            <div className="flex min-h-0 flex-1 flex-row overflow-hidden">
              {/* Left: workflow list */}
              <div className="flex w-80 shrink-0 flex-col border-t border-gray-200">
                {/* Search */}
                <div className="shrink-0 border-b border-gray-100 px-3 py-2">
                  <div className="flex items-center gap-1.5 rounded-md border border-gray-200 bg-gray-50 px-2.5 py-1">
                    <Search className="h-3 w-3 shrink-0 text-gray-400" />
                    <input
                      type="text"
                      placeholder="Search…"
                      value={listSearch}
                      onChange={(e) => setListSearch(e.target.value)}
                      className="flex-1 bg-transparent text-xs text-gray-700 outline-none placeholder:text-gray-400"
                    />
                    {listSearch && (
                      <button
                        onClick={() => setListSearch("")}
                        className="text-gray-400 hover:text-gray-600"
                      >
                        <X className="h-3 w-3" />
                      </button>
                    )}
                  </div>
                </div>
                {/* List */}
                <div className="flex-1 overflow-y-auto">
                  {workflows
                    .filter(
                      (wfItem) =>
                        !listSearch ||
                        wfItem.title.toLowerCase().includes(listSearch.toLowerCase()),
                    )
                    .map((wfItem) => {
                      const isSelected = selected?.id === wfItem.id;
                      const Icon = wfItem.type === "tabular" ? Table2 : MessageSquare;
                      return (
                        <button
                          key={wfItem.id}
                          ref={isSelected ? selectedRowRef : null}
                          type="button"
                          onClick={() => setSelected(wfItem)}
                          className={`flex w-full items-center gap-3 border-b border-gray-200 px-4 py-3 text-left text-xs transition-colors ${isSelected ? "bg-gray-100" : "hover:bg-gray-50"}`}
                        >
                          <span
                            className={`flex-1 truncate ${isSelected ? "font-medium text-gray-900" : "text-gray-700"}`}
                          >
                            {wfItem.title}
                          </span>
                          <Icon className="h-3.5 w-3.5 shrink-0 text-gray-400" />
                        </button>
                      );
                    })}
                </div>
              </div>

              {/* Right: workflow detail */}
              {wf.type === "assistant" ? (
                <AssistantPanel key={wf.id} workflow={wf} />
              ) : (
                <TabularPanel key={wf.id} workflow={wf} />
              )}
            </div>

            <div className="flex shrink-0 items-center justify-between border-t border-gray-200 px-5 py-3">
              {wf.is_system ? (
                <button
                  onClick={() => {
                    router.push(`/workflows/${wf.id}`);
                    handleClose();
                  }}
                  className="rounded-lg border border-gray-200 px-3 py-1.5 text-sm text-gray-500 transition-colors hover:bg-gray-50"
                >
                  View Page
                </button>
              ) : (
                <button
                  onClick={() => {
                    router.push(`/workflows/${wf.id}`);
                    handleClose();
                  }}
                  className="rounded-lg border border-gray-200 px-3 py-1.5 text-sm text-gray-500 transition-colors hover:bg-gray-50"
                >
                  Edit
                </button>
              )}
              <button
                onClick={() => setScreen("configure")}
                className="rounded-lg bg-gray-900 px-5 py-2 text-sm font-medium text-white hover:bg-gray-700"
              >
                Use
              </button>
            </div>
          </>
        )}

        {/* ── ASSISTANT CONFIGURE SCREEN ── */}
        {screen === "configure" && wf.type === "assistant" && (
          <>
            <div className="flex min-h-0 flex-1 flex-col overflow-hidden">
              {/* Add-on prompt */}
              <div className="shrink-0 px-5 pb-3">
                <p className="mb-2 text-xs font-medium text-gray-700">Message (optional)</p>
                <textarea
                  rows={3}
                  value={assistantPrompt}
                  onChange={(e) => setAssistantPrompt(e.target.value)}
                  placeholder="Add any additional instructions to the workflow prompt…"
                  className="w-full resize-none rounded-md border border-gray-200 bg-gray-50 px-3 py-2 text-sm leading-relaxed text-gray-700 outline-none placeholder:text-gray-400"
                />
              </div>

              {/* Toggle row */}
              <div className="flex shrink-0 flex-col gap-2 px-5 py-3">
                <span className="text-xs font-medium text-gray-700">Create in a application</span>
                <Toggle
                  on={inApplication}
                  onToggle={() => {
                    setInApplication(!inApplication);
                    setSelectedApplicationId(null);
                    setSelectedDocIds(new Set());
                    setDocSearch("");
                  }}
                />
              </div>

              {inApplication ? (
                <>
                  <div className="shrink-0 px-5 pt-1 pb-1">
                    <p className="text-xs font-medium text-gray-700">Select application</p>
                  </div>
                  <div className="shrink-0 px-5 pb-2">
                    <SimpleApplicationPicker
                      applications={applications}
                      selectedId={selectedApplicationId}
                      onSelect={setSelectedApplicationId}
                    />
                  </div>
                </>
              ) : (
                <>
                  <div className="shrink-0 px-5 pt-1 pb-1">
                    <p className="text-xs font-medium text-gray-700">Select documents</p>
                  </div>

                  {/* Search */}
                  <div className="shrink-0 px-4 pt-1.5 pb-1">
                    <div className="flex items-center gap-1.5 rounded-md border border-gray-200 bg-gray-50 px-2.5 py-1">
                      <Search className="h-3 w-3 shrink-0 text-gray-400" />
                      <input
                        type="text"
                        placeholder="Search…"
                        value={docSearch}
                        onChange={(e) => setDocSearch(e.target.value)}
                        className="flex-1 bg-transparent text-xs text-gray-700 outline-none placeholder:text-gray-400"
                      />
                      {docSearch && (
                        <button
                          onClick={() => setDocSearch("")}
                          className="text-gray-400 hover:text-gray-600"
                        >
                          <X className="h-3 w-3" />
                        </button>
                      )}
                    </div>
                  </div>

                  {/* File browser */}
                  <div className="flex-1 overflow-y-auto px-4 pb-2">
                    <FileDirectory
                      standaloneDocs={filteredStandalone}
                      directoryApplications={filteredAllApplications}
                      loading={dirLoading}
                      selectedIds={selectedDocIds}
                      onChange={setSelectedDocIds}
                      allowMultiple
                      forceExpanded={!!q}
                      emptyMessage={q ? "No matches found" : "No documents yet"}
                    />
                  </div>
                </>
              )}
            </div>

            <div className="flex shrink-0 items-center justify-between border-t border-gray-200 px-5 py-3">
              <span className="text-xs text-gray-400">
                {!inApplication && selectedDocIds.size > 0 ? `${selectedDocIds.size} selected` : ""}
              </span>
              <button
                onClick={handleStartChat}
                disabled={saving || (inApplication && !selectedApplicationId)}
                className="rounded-lg bg-gray-900 px-5 py-2 text-sm font-medium text-white hover:bg-gray-700 disabled:opacity-50"
              >
                {saving ? "Starting…" : "Start Chat"}
              </button>
            </div>
          </>
        )}

        {/* ── TABULAR CONFIGURE SCREEN ── */}
        {screen === "configure" && wf.type === "tabular" && (
          <>
            <div className="flex min-h-0 flex-1 flex-col overflow-hidden">
              {/* Toggle stacked */}
              <div className="flex shrink-0 flex-col gap-2 px-5 pb-3">
                <span className="text-xs font-medium text-gray-700">Create in a application</span>
                <Toggle
                  on={inApplication}
                  onToggle={() => {
                    setInApplication(!inApplication);
                    setSelectedApplicationId(null);
                    setDocSearch("");
                    setSelectedDocIds(new Set());
                  }}
                />
              </div>

              {/* Application section */}
              {inApplication && (
                <>
                  <div className="shrink-0 px-5 pt-1 pb-1">
                    <p className="text-xs font-medium text-gray-700">Select Application</p>
                  </div>
                  <div className="shrink-0 px-5 pb-2">
                    <SimpleApplicationPicker
                      applications={applications}
                      selectedId={selectedApplicationId}
                      onSelect={(id) => {
                        setSelectedApplicationId(id);
                        if (!id) setSelectedDocIds(new Set());
                      }}
                    />
                  </div>
                </>
              )}

              {/* Documents section */}
              <div className="shrink-0 px-5 pt-3 pb-1">
                <p className="text-xs font-medium text-gray-700">Select Documents</p>
              </div>

              {/* Search */}
              <div className="shrink-0 px-4 pt-1.5 pb-1">
                <div className="flex items-center gap-1.5 rounded-md border border-gray-200 bg-gray-50 px-2.5 py-1">
                  <Search className="h-3 w-3 shrink-0 text-gray-400" />
                  <input
                    type="text"
                    placeholder="Search…"
                    value={docSearch}
                    onChange={(e) => setDocSearch(e.target.value)}
                    className="flex-1 bg-transparent text-xs text-gray-700 outline-none placeholder:text-gray-400"
                  />
                  {docSearch && (
                    <button
                      onClick={() => setDocSearch("")}
                      className="text-gray-400 hover:text-gray-600"
                    >
                      <X className="h-3 w-3" />
                    </button>
                  )}
                </div>
              </div>

              {/* File browser */}
              <div className="flex-1 overflow-y-auto px-4 pb-2">
                <FileDirectory
                  standaloneDocs={inApplication ? filteredApplicationDocs : filteredStandalone}
                  directoryApplications={inApplication ? [] : filteredAllApplications}
                  loading={dirLoading}
                  selectedIds={selectedDocIds}
                  onChange={setSelectedDocIds}
                  allowMultiple
                  forceExpanded={!!q || inApplication}
                  emptyMessage={
                    q
                      ? "No matches found"
                      : inApplication
                        ? "No documents in this application"
                        : "No documents yet"
                  }
                />
              </div>
            </div>

            <div className="flex shrink-0 items-center justify-between border-t border-gray-200 px-5 py-3">
              <span className="text-xs text-gray-400">
                {selectedDocIds.size > 0 ? `${selectedDocIds.size} selected` : ""}
              </span>
              <button
                onClick={handleCreateReview}
                disabled={
                  saving || selectedDocIds.size === 0 || (inApplication && !selectedApplicationId)
                }
                className="rounded-lg bg-gray-900 px-5 py-2 text-sm font-medium text-white hover:bg-gray-700 disabled:opacity-50"
              >
                {saving ? "Creating…" : "Create Review"}
              </button>
            </div>
          </>
        )}
      </div>
    </div>,
    document.body,
  );
}
