"use client";

import { ArrowRight, Check, File, FileText, FolderOpen, Library, Square, X } from "lucide-react";
import { forwardRef, useCallback, useImperativeHandle, useRef, useState } from "react";

import { useSelectedModel } from "@/app/hooks/useSelectedModel";
import {
  getModelProvider,
  isModelAvailable,
  type ModelProvider,
} from "@/app/lib/modelAvailability";
import { useUserProfile } from "@/contexts/UserProfileContext";

import { AddDocumentsModal } from "../shared/AddDocumentsModal";
import { ApiKeyMissingModal } from "../shared/ApiKeyMissingModal";
import type { LukeDocument, LukeMessage } from "../shared/types";
import { AddDocButton } from "./AddDocButton";
import { AssistantWorkflowModal } from "./AssistantWorkflowModal";
import { ModelToggle } from "./ModelToggle";

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
      <div className="w-full">
        <div className="rounded-[16px] border border-gray-300 bg-white md:rounded-[20px]">
          {/* Attached chips */}
          {(selectedWorkflow || attachedDocs.length > 0) && (
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
