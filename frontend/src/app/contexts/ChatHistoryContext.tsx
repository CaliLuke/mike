"use client";

import {
  createContext,
  type ReactNode,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useState,
} from "react";

import type { LukeChat, LukeMessage } from "@/app/components/shared/types";
import { createChat, deleteChat, listChats, renameChat } from "@/app/lib/lukeApi";
import { useAuth } from "@/contexts/AuthContext";

interface ChatHistoryContextType {
  chats: LukeChat[] | null;
  currentChatId: string | null;
  setCurrentChatId: (chatId: string | null) => void;
  loadChats: () => Promise<void>;
  saveChat: (applicationId?: string) => Promise<string | null>;
  renameChat: (chatId: string, title: string) => Promise<void>;
  newChatMessages: LukeMessage[] | null;
  setNewChatMessages: (messages: LukeMessage[] | null) => void;
  replaceChatId: (oldChatId: string, newChatId: string, title?: string) => void;
  deleteChat: (chatId: string) => Promise<void>;
}

const ChatHistoryContext = createContext<ChatHistoryContextType | undefined>(undefined);

export function ChatHistoryProvider({ children }: { children: ReactNode }) {
  const { user } = useAuth();
  const [chats, setChats] = useState<LukeChat[] | null>(null);
  const [currentChatId, setCurrentChatId] = useState<string | null>(null);
  const [newChatMessages, setNewChatMessages] = useState<LukeMessage[] | null>(null);

  const loadChats = useCallback(async () => {
    if (!user) {
      setChats([]);
      return;
    }

    try {
      const data = await listChats();
      setChats(data);
    } catch {
      setChats([]);
    }
  }, [user]);

  useEffect(() => {
    if (!user) {
      queueMicrotask(() => {
        setChats([]);
        setCurrentChatId(null);
      });
      return;
    }

    queueMicrotask(() => {
      void loadChats();
    });
  }, [user, loadChats]);

  const replaceChatId = useCallback((oldChatId: string, newChatId: string, title?: string) => {
    if (!oldChatId || !newChatId || oldChatId === newChatId) {
      setCurrentChatId(newChatId || oldChatId || null);
      return;
    }

    setChats((prev) => {
      if (!prev) return prev;

      const nextChats = prev.map((chat) =>
        chat.id === oldChatId ? { ...chat, id: newChatId, title: title ?? chat.title } : chat,
      );

      const seen = new Set<string>();
      return nextChats.filter((chat) => {
        if (seen.has(chat.id)) return false;
        seen.add(chat.id);
        return true;
      });
    });
    setCurrentChatId(newChatId);
  }, []);

  const saveChat = useCallback(
    async (applicationId?: string): Promise<string | null> => {
      try {
        const { id } = await createChat(
          applicationId ? { application_id: applicationId } : undefined,
        );
        const now = new Date().toISOString();
        const newChat: LukeChat = {
          id,
          application_id: applicationId ?? null,
          user_id: user?.id ?? "",
          title: null,
          created_at: now,
        };
        setChats((prev) => [newChat, ...(prev ?? [])]);
        return id;
      } catch {
        return null;
      }
    },
    [user],
  );

  const renameChatFn = useCallback(
    async (chatId: string, title: string) => {
      setChats((prev) => (prev ?? []).map((c) => (c.id === chatId ? { ...c, title } : c)));
      try {
        await renameChat(chatId, title);
      } catch {
        void loadChats();
      }
    },
    [loadChats],
  );

  const deleteChatFn = useCallback(
    async (chatId: string) => {
      setChats((prev) => (prev ?? []).filter((c) => c.id !== chatId));
      if (currentChatId === chatId) setCurrentChatId(null);
      try {
        await deleteChat(chatId);
      } catch {
        void loadChats();
      }
    },
    [currentChatId, loadChats],
  );

  const value = useMemo(
    () => ({
      chats,
      currentChatId,
      setCurrentChatId,
      loadChats,
      saveChat,
      renameChat: renameChatFn,
      newChatMessages,
      setNewChatMessages,
      replaceChatId,
      deleteChat: deleteChatFn,
    }),
    [
      chats,
      currentChatId,
      loadChats,
      saveChat,
      renameChatFn,
      newChatMessages,
      replaceChatId,
      deleteChatFn,
    ],
  );

  return <ChatHistoryContext.Provider value={value}>{children}</ChatHistoryContext.Provider>;
}

export function useChatHistoryContext() {
  const context = useContext(ChatHistoryContext);
  if (!context) {
    throw new Error("useChatHistoryContext must be used within a ChatHistoryProvider");
  }
  return context;
}
