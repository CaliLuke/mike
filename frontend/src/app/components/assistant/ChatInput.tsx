"use client";

import {
  ArrowRight,
  Check,
  File,
  FileText,
  FolderOpen,
  Library,
  Loader2,
  Square,
  Upload,
  X,
} from "lucide-react";
import { forwardRef, useCallback, useImperativeHandle, useRef, useState } from "react";

import { useSelectedModel } from "@/app/hooks/useSelectedModel";
import { uploadStandaloneDocument } from "@/app/lib/lukeApi";
import {
  getModelProvider,
  isModelAvailable,
  type ModelProvider,
} from "@/app/lib/modelAvailability";
import { trackClick } from "@/app/lib/telemetry";
import { useUserProfile } from "@/contexts/UserProfileContext";

import { AddDocumentsModal } from "../shared/AddDocumentsModal";
import { ApiKeyMissingModal } from "../shared/ApiKeyMissingModal";
import type { LukeDocument, LukeMessage } from "../shared/types";
import { AddDocButton } from "./AddDocButton";
import { AssistantWorkflowModal } from "./AssistantWorkflowModal";
import { ModelToggle } from "./ModelToggle";

// Pending upload — a tile is shown immediately on drop with the filename
// and a spinner; on success it gets replaced by the real attached doc chip.
interface PendingUpload {
  id: string;
  filename: string;
  error?: string;
}

export interface ChatInputHandle {
  addDoc: (doc: LukeDocument) => void;
}

interface Props {
  onSubmit: (message: LukeMessage) => void;
  onCancel: () => void;
  isLoading: boolean;
  hideAddDocButton?: boolean;
  hideWorkflowButton?: boolean;
  onApplicationsClick?: () => void;
  applicationName?: string;
  applicationCmNumber?: string | null;
}

export const ChatInput = forwardRef<ChatInputHandle, Props>(function ChatInput(
  {
    onSubmit,
    onCancel,
    isLoading,
    hideAddDocButton,
    hideWorkflowButton,
    onApplicationsClick,
    applicationName,
    applicationCmNumber,
  }: Props,
  ref,
) {
  const [value, setValue] = useState("");
  const [attachedDocs, setAttachedDocs] = useState<LukeDocument[]>([]);
  const [selectedWorkflow, setSelectedWorkflow] = useState<{
    id: string;
    title: string;
  } | null>(null);
  const [model, setModel] = useSelectedModel();
  const { profile } = useUserProfile();
  const apiKeys = {
    claudeApiKey: profile?.claudeApiKey ?? null,
    geminiApiKey: profile?.geminiApiKey ?? null,
  };
  const textareaRef = useRef<HTMLTextAreaElement>(null);
  const [docSelectorOpen, setDocSelectorOpen] = useState(false);
  const [workflowModalOpen, setWorkflowModalOpen] = useState(false);
  const [apiKeyModalProvider, setApiKeyModalProvider] = useState<ModelProvider | null>(null);
  const [pendingUploads, setPendingUploads] = useState<PendingUpload[]>([]);
  const [dragActive, setDragActive] = useState(false);
  // dragenter/leave fires on every descendant, so count instead of toggling
  // so the overlay only disappears when the cursor leaves the wrapper itself.
  const dragDepthRef = useRef(0);

  useImperativeHandle(ref, () => ({
    addDoc: (doc: LukeDocument) => {
      setAttachedDocs((prev) => {
        if (prev.some((d) => d.id === doc.id)) return prev;
        return [...prev, doc];
      });
    },
  }));

  const handleAddDocFromApplication = useCallback((doc: LukeDocument) => {
    setAttachedDocs((prev) => {
      if (prev.some((d) => d.id === doc.id)) return prev;
      return [...prev, doc];
    });
  }, []);

  const handleAddDocsFromSelector = useCallback((selectedDocs: LukeDocument[]) => {
    setAttachedDocs((prev) => {
      const existing = new Set(prev.map((d) => d.id));
      return [...prev, ...selectedDocs.filter((d) => !existing.has(d.id))];
    });
  }, []);

  // uploadDroppedFiles: each file becomes a pending tile immediately, then
  // gets uploaded via POST /single-documents and promoted to an attached
  // doc chip. Failures stay as tiles with a red error label until the user
  // clicks the X.
  const uploadDroppedFiles = useCallback(async (files: File[]) => {
    if (files.length === 0) return;
    const pending: PendingUpload[] = files.map((f) => ({
      id: `pending_${crypto.randomUUID()}`,
      filename: f.name,
    }));
    setPendingUploads((prev) => [...prev, ...pending]);
    await Promise.all(
      files.map(async (file, i) => {
        const pendingID = pending[i].id;
        try {
          const doc = await uploadStandaloneDocument(file);
          // Drop the pending tile + add the real doc as an attached chip.
          setPendingUploads((prev) => prev.filter((p) => p.id !== pendingID));
          setAttachedDocs((prev) => {
            if (prev.some((d) => d.id === doc.id)) return prev;
            return [...prev, doc];
          });
        } catch (e) {
          setPendingUploads((prev) =>
            prev.map((p) =>
              p.id === pendingID
                ? { ...p, error: e instanceof Error ? e.message : "Upload failed" }
                : p,
            ),
          );
        }
      }),
    );
  }, []);

  const handleDragEnter = (e: React.DragEvent<HTMLDivElement>) => {
    if (!Array.from(e.dataTransfer?.types ?? []).includes("Files")) return;
    e.preventDefault();
    dragDepthRef.current += 1;
    setDragActive(true);
  };
  const handleDragOver = (e: React.DragEvent<HTMLDivElement>) => {
    if (!Array.from(e.dataTransfer?.types ?? []).includes("Files")) return;
    e.preventDefault(); // required to allow drop
  };
  const handleDragLeave = (e: React.DragEvent<HTMLDivElement>) => {
    if (!Array.from(e.dataTransfer?.types ?? []).includes("Files")) return;
    dragDepthRef.current = Math.max(0, dragDepthRef.current - 1);
    if (dragDepthRef.current === 0) setDragActive(false);
  };
  const handleDrop = (e: React.DragEvent<HTMLDivElement>) => {
    if (!Array.from(e.dataTransfer?.types ?? []).includes("Files")) return;
    e.preventDefault();
    dragDepthRef.current = 0;
    setDragActive(false);
    const files = Array.from(e.dataTransfer?.files ?? []);
    if (files.length > 0) void uploadDroppedFiles(files);
  };

  const handleChange = (e: React.ChangeEvent<HTMLTextAreaElement>) => {
    setValue(e.target.value);
    const el = e.target;
    el.style.height = "auto";
    el.style.height = `${el.scrollHeight}px`;
  };

  const handleSubmit = () => {
    const query = value.trim();
    if (!query || isLoading) return;
    if (!isModelAvailable(model, apiKeys)) {
      setApiKeyModalProvider(getModelProvider(model));
      trackClick("chat.send.blocked", { reason: "api_key_missing", model });
      return;
    }
    setValue("");
    if (textareaRef.current) {
      textareaRef.current.style.height = "auto";
    }

    const files = attachedDocs.map((d) => ({
      filename: d.filename,
      document_id: d.id,
    }));
    setAttachedDocs([]);
    const wf = selectedWorkflow;
    setSelectedWorkflow(null);

    trackClick("chat.send", {
      "chat.input.length": query.length,
      "chat.attachments": files.length,
      "chat.workflow": wf?.title ?? null,
      model,
    });

    onSubmit?.({
      role: "user",
      content: query,
      files: files.length > 0 ? files : undefined,
      workflow: wf ?? undefined,
      model,
    });
  };

  const handleActionClick = () => {
    if (isLoading) {
      trackClick("chat.cancel");
      onCancel();
    } else {
      handleSubmit();
    }
  };

  const handleKeyDown = (e: React.KeyboardEvent<HTMLTextAreaElement>) => {
    if (e.key === "Enter" && !e.shiftKey) {
      e.preventDefault();
      handleSubmit();
    }
  };

  return (
    <>
      <div
        className="relative w-full"
        onDragEnter={handleDragEnter}
        onDragOver={handleDragOver}
        onDragLeave={handleDragLeave}
        onDrop={handleDrop}
      >
        {dragActive && (
          <div className="pointer-events-none absolute inset-0 z-10 flex items-center justify-center rounded-[16px] border-2 border-dashed border-gray-900 bg-white/90 backdrop-blur-[2px] md:rounded-[20px]">
            <div className="flex items-center gap-2 text-sm font-medium text-gray-900">
              <Upload className="h-4 w-4" />
              Drop to attach to this chat
            </div>
          </div>
        )}
        <div className="rounded-[16px] border border-gray-300 bg-white md:rounded-[20px]">
          {/* Attached chips */}
          {(selectedWorkflow || attachedDocs.length > 0 || pendingUploads.length > 0) && (
            <div className="flex flex-wrap gap-1.5 px-2 pt-2">
              {selectedWorkflow && (
                <div className="inline-flex items-center gap-1 rounded-full border border-white/20 bg-blue-600 py-0.5 pr-1 pl-2.5 text-xs text-white shadow backdrop-blur-sm">
                  <Library className="h-2.5 w-2.5 shrink-0" />
                  <span className="max-w-[140px] truncate">{selectedWorkflow.title}</span>
                  <button
                    type="button"
                    onClick={() => setSelectedWorkflow(null)}
                    className="ml-0.5 rounded-full p-0.5 text-white/60 transition-colors hover:bg-white/20 hover:text-white"
                  >
                    <X className="h-2.5 w-2.5" />
                  </button>
                </div>
              )}
              {attachedDocs.map((doc) => {
                const ft = doc.file_type?.toLowerCase();
                const isPdf = ft === "pdf";
                return (
                  <div
                    key={doc.id}
                    className="inline-flex items-center gap-1 rounded-full border border-white/20 bg-black py-0.5 pr-1 pl-2 text-xs text-white shadow backdrop-blur-sm"
                  >
                    {isPdf ? (
                      <FileText className="h-2.5 w-2.5 shrink-0 text-red-400" />
                    ) : (
                      <File className="h-2.5 w-2.5 shrink-0 text-blue-400" />
                    )}
                    <span className="max-w-[140px] truncate">{doc.filename}</span>
                    <button
                      type="button"
                      onClick={() => setAttachedDocs((prev) => prev.filter((d) => d.id !== doc.id))}
                      className="ml-0.5 rounded-full p-0.5 text-white/60 transition-colors hover:bg-white/20 hover:text-white"
                    >
                      <X className="h-2.5 w-2.5" />
                    </button>
                  </div>
                );
              })}
              {pendingUploads.map((p) => (
                <div
                  key={p.id}
                  className={`inline-flex items-center gap-1 rounded-full border py-0.5 pr-1 pl-2 text-xs shadow backdrop-blur-sm ${
                    p.error
                      ? "border-red-200 bg-red-50 text-red-700"
                      : "border-gray-200 bg-gray-100 text-gray-700"
                  }`}
                  title={p.error ?? "Uploading…"}
                >
                  {p.error ? (
                    <X className="h-2.5 w-2.5 shrink-0 text-red-600" />
                  ) : (
                    <Loader2 className="h-2.5 w-2.5 shrink-0 animate-spin text-gray-500" />
                  )}
                  <span className="max-w-[140px] truncate">{p.filename}</span>
                  <button
                    type="button"
                    onClick={() => setPendingUploads((prev) => prev.filter((x) => x.id !== p.id))}
                    className="ml-0.5 rounded-full p-0.5 opacity-70 transition-opacity hover:opacity-100"
                    aria-label={`Remove ${p.filename}`}
                  >
                    <X className="h-2.5 w-2.5" />
                  </button>
                </div>
              ))}
            </div>
          )}

          {/* Input */}
          <div className="px-4 pt-4">
            <textarea
              ref={textareaRef}
              rows={1}
              placeholder="Ask a question about your documents..."
              value={value}
              onChange={handleChange}
              onKeyDown={handleKeyDown}
              className="max-h-48 w-full resize-none overflow-hidden border-0 bg-transparent p-0 text-base text-sm leading-6 outline-none placeholder:text-gray-400"
            />
          </div>

          {/* Controls */}
          <div className="flex items-center justify-between p-2 md:p-2.5">
            <div className="flex items-center gap-1">
              {!hideAddDocButton && (
                <AddDocButton
                  onSelectDoc={handleAddDocFromApplication}
                  onBrowseAll={() => setDocSelectorOpen(true)}
                  selectedDocIds={attachedDocs.map((d) => d.id)}
                />
              )}
              {onApplicationsClick && (
                <button
                  type="button"
                  onClick={onApplicationsClick}
                  aria-label="Open applications"
                  className="flex h-8 items-center gap-1.5 rounded-lg px-2 text-sm text-gray-400 transition-colors hover:bg-gray-100 hover:text-gray-700"
                >
                  <FolderOpen className="h-3.5 w-3.5" />
                  <span className="hidden sm:inline">Applications</span>
                </button>
              )}
              {!hideWorkflowButton && (
                <button
                  type="button"
                  onClick={() => setWorkflowModalOpen(true)}
                  aria-label="Open workflows"
                  className={`flex h-8 items-center gap-1.5 rounded-lg px-2 text-sm transition-colors ${selectedWorkflow ? "text-blue-600 hover:bg-blue-50" : "text-gray-400 hover:bg-gray-100 hover:text-gray-700"}`}
                >
                  {selectedWorkflow ? (
                    <Check className="h-3.5 w-3.5" />
                  ) : (
                    <Library className="h-3.5 w-3.5" />
                  )}
                  <span className="hidden sm:inline">Workflows</span>
                </button>
              )}
            </div>

            <div className="flex items-center gap-1">
              <ModelToggle value={model} onChange={setModel} apiKeys={apiKeys} />
              <button
                type="button"
                className="relative flex h-8 w-8 cursor-pointer items-center justify-center rounded-[10px] border border-white/30 bg-gradient-to-b from-neutral-700 to-black text-white backdrop-blur-xl transition-all duration-150 active:enabled:scale-95 disabled:cursor-default disabled:from-neutral-600 disabled:to-black"
                onClick={handleActionClick}
                disabled={!isLoading && !value.trim()}
              >
                {isLoading ? (
                  <Square className="h-4 w-4" fill="currentColor" strokeWidth={0} />
                ) : (
                  <ArrowRight className="h-4 w-4" />
                )}
              </button>
            </div>
          </div>
        </div>
      </div>

      <AddDocumentsModal
        open={docSelectorOpen}
        onClose={() => setDocSelectorOpen(false)}
        onSelect={handleAddDocsFromSelector}
        breadcrumb={["Assistant", "Add Documents"]}
      />
      <AssistantWorkflowModal
        open={workflowModalOpen}
        onClose={() => setWorkflowModalOpen(false)}
        onSelect={(wf) => {
          setSelectedWorkflow({ id: wf.id, title: wf.title });
          setWorkflowModalOpen(false);
        }}
        applicationName={applicationName}
        applicationCmNumber={applicationCmNumber}
      />
      <ApiKeyMissingModal
        open={apiKeyModalProvider !== null}
        provider={apiKeyModalProvider}
        onClose={() => setApiKeyModalProvider(null)}
      />
    </>
  );
});
