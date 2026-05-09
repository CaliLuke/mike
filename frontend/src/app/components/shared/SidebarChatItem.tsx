"use client";

import { Check, MoreHorizontal, Pencil, Trash2, X } from "lucide-react";
import { useEffect,useRef, useState } from "react";

import { OwnerOnlyModal } from "@/app/components/shared/OwnerOnlyModal";
import type { LukeChat } from "@/app/components/shared/types";
import { useChatHistoryContext } from "@/app/contexts/ChatHistoryContext";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { useAuth } from "@/contexts/AuthContext";

interface Props {
  chat: LukeChat;
  isActive: boolean;
  onSelect: () => void;
  projectName?: string;
}

export function SidebarChatItem({ chat, isActive, onSelect, projectName }: Props) {
  const { renameChat, deleteChat } = useChatHistoryContext();
  const { user } = useAuth();
  const [isRenaming, setIsRenaming] = useState(false);
  const [editTitle, setEditTitle] = useState(chat.title ?? "");
  const [ownerOnlyAction, setOwnerOnlyAction] = useState<string | null>(null);
  const editInputRef = useRef<HTMLInputElement>(null);
  // Sidebar can show collaborator chats from projects the user owns;
  // rename/delete are still creator-only on the backend, so guard here.
  const isChatOwner = !!user?.id && chat.user_id === user.id;

  useEffect(() => {
    if (isRenaming) editInputRef.current?.focus();
  }, [isRenaming]);

  const handleRenameSave = async () => {
    const trimmed = editTitle.trim();
    if (trimmed) await renameChat(chat.id, trimmed);
    setIsRenaming(false);
  };

  const handleRenameCancel = () => {
    setIsRenaming(false);
    setEditTitle(chat.title ?? "");
  };

  return (
    <div
      className={`group relative flex h-9 w-full items-center rounded-md transition-colors ${
        isActive ? "bg-gray-100" : "hover:bg-gray-100"
      }`}
    >
      {isRenaming ? (
        <div className="flex w-full items-center px-2 py-1">
          <input
            ref={editInputRef}
            type="text"
            value={editTitle}
            onChange={(e) => setEditTitle(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === "Enter") void handleRenameSave();
              if (e.key === "Escape") handleRenameCancel();
            }}
            className="flex-1 rounded bg-white px-1 py-0.5 text-sm shadow-inner focus:ring-1 focus:ring-blue-500 focus:outline-none"
          />
          <button
            onClick={() => void handleRenameSave()}
            className="ml-1.5 rounded py-2 text-green-600 hover:bg-gray-200"
          >
            <Check className="h-3 w-3" />
          </button>
          <button
            onClick={handleRenameCancel}
            className="ml-1 rounded py-2 text-red-600 hover:bg-gray-200"
          >
            <X className="h-3 w-3" />
          </button>
        </div>
      ) : (
        <>
          <button
            onClick={onSelect}
            onMouseEnter={(e) => {
              const el = e.currentTarget;
              const overflow = el.scrollWidth - el.clientWidth;
              if (overflow > 0) el.scrollTo({ left: overflow, behavior: "smooth" });
            }}
            onMouseLeave={(e) => {
              e.currentTarget.scrollTo({ left: 0, behavior: "smooth" });
            }}
            className={`scrollbar-none min-w-0 flex-1 overflow-x-hidden px-3 py-2 text-left text-xs whitespace-nowrap ${
              isActive ? "text-gray-900" : "text-gray-700"
            }`}
            title={
              projectName
                ? `${projectName}: ${chat.title ?? "Untitled chat"}`
                : (chat.title ?? "Untitled chat")
            }
          >
            {projectName && <span className="font-normal text-gray-400">{projectName}: </span>}
            {chat.title ?? "Untitled chat"}
          </button>

          <DropdownMenu>
            <DropdownMenuTrigger asChild>
              <button
                className={`mr-1 p-1 text-gray-500 transition-opacity hover:text-gray-900 ${
                  isActive ? "opacity-100" : "opacity-0 group-hover:opacity-100"
                }`}
              >
                <MoreHorizontal className="h-4 w-4" />
              </button>
            </DropdownMenuTrigger>
            <DropdownMenuContent align="end" className="z-101">
              <DropdownMenuItem
                onClick={() => {
                  if (!isChatOwner) {
                    setOwnerOnlyAction("rename this chat");
                    return;
                  }
                  setEditTitle(chat.title ?? "");
                  setIsRenaming(true);
                }}
              >
                <Pencil className="mr-2 h-4 w-4" />
                Rename
              </DropdownMenuItem>
              <DropdownMenuItem
                onClick={() => {
                  if (!isChatOwner) {
                    setOwnerOnlyAction("delete this chat");
                    return;
                  }
                  void deleteChat(chat.id);
                }}
                className="text-red-600 focus:text-red-600"
              >
                <Trash2 className="mr-2 h-4 w-4" />
                Delete
              </DropdownMenuItem>
            </DropdownMenuContent>
          </DropdownMenu>
        </>
      )}
      <OwnerOnlyModal
        open={!!ownerOnlyAction}
        action={ownerOnlyAction ?? undefined}
        onClose={() => setOwnerOnlyAction(null)}
      />
    </div>
  );
}
