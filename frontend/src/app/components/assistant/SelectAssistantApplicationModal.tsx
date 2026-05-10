"use client";

import { Loader2, X } from "lucide-react";
import { useRouter } from "next/navigation";
import { useState } from "react";
import { createPortal } from "react-dom";

import { useChatHistoryContext } from "@/app/contexts/ChatHistoryContext";

import { ApplicationPicker } from "../shared/ApplicationPicker";
import { useDirectoryData } from "../shared/useDirectoryData";

interface Props {
  open: boolean;
  onClose: () => void;
}

export function SelectAssistantApplicationModal({ open, onClose }: Props) {
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [creating, setCreating] = useState(false);
  const router = useRouter();
  const { saveChat } = useChatHistoryContext();
  const { loading, applications } = useDirectoryData(open);

  if (!open) return null;

  function handleClose() {
    setSelectedId(null);
    onClose();
  }

  async function handleContinue() {
    if (!selectedId) return;
    setCreating(true);
    try {
      const chatId = await saveChat(selectedId);
      if (!chatId) return;
      handleClose();
      router.push(`/applications/${selectedId}/assistant/chat/${chatId}`);
    } finally {
      setCreating(false);
    }
  }

  return createPortal(
    <div className="fixed inset-0 z-[200] flex items-center justify-center bg-black/10 backdrop-blur-xs">
      <div className="flex h-[600px] w-full max-w-2xl flex-col rounded-2xl bg-white shadow-2xl">
        {/* Header */}
        <div className="flex items-center justify-between px-5 py-4">
          <div className="flex items-center gap-1.5 text-xs text-gray-400">
            <span>Assistant</span>
            <span>›</span>
            <span>Start Chat in a Application</span>
          </div>
          <button
            onClick={handleClose}
            className="rounded-lg p-1.5 text-gray-400 hover:bg-gray-100 hover:text-gray-600"
          >
            <X className="h-4 w-4" />
          </button>
        </div>

        <ApplicationPicker
          applications={applications}
          loading={loading}
          selectedId={selectedId}
          onSelect={setSelectedId}
        />

        {/* Footer */}
        <div className="flex items-center justify-end gap-2 border-t border-gray-100 px-4 py-3">
          <button
            onClick={handleClose}
            className="rounded-lg px-3 py-1.5 text-sm text-gray-500 hover:bg-gray-100"
          >
            Cancel
          </button>
          <button
            onClick={handleContinue}
            disabled={!selectedId || creating}
            className="rounded-lg bg-gray-900 px-4 py-1.5 text-sm font-medium text-white hover:bg-gray-700 disabled:opacity-40"
          >
            {creating ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : "Continue"}
          </button>
        </div>
      </div>
    </div>,
    document.body,
  );
}
