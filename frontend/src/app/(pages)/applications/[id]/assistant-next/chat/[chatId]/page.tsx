"use client";

import { useParams, useRouter } from "next/navigation";
import { useEffect, useRef, useState } from "react";

import { AppScopedChat } from "@/app/(pages)/applications/[id]/assistant-next/AppScopedChat";
import { aniEvent } from "@/app/(pages)/assistant-next/observability";
import type { LukeMessage } from "@/app/components/shared/types";
import { useChatHistoryContext } from "@/app/contexts/ChatHistoryContext";
import { getChat } from "@/app/lib/lukeApi";

export default function ApplicationAssistantNextChatPage() {
  const router = useRouter();
  const params = useParams();
  // Surreal record IDs contain `:` which Next.js leaves URL-encoded
  // in `params`; decode so downstream comparisons (chat.application_id,
  // chat.id) match the canonical form.
  const applicationId = decodeURIComponent(params.id as string);
  const chatId = decodeURIComponent(params.chatId as string);

  const { setCurrentChatId, newChatMessages, setNewChatMessages } = useChatHistoryContext();

  const [initial, setInitial] = useState<LukeMessage[] | null>(null);
  const hasLoaded = useRef(false);

  useEffect(() => {
    setCurrentChatId(chatId);
  }, [chatId, setCurrentChatId]);

  useEffect(() => {
    if (hasLoaded.current) return;
    hasLoaded.current = true;

    if (newChatMessages?.length) {
      // queueMicrotask to defer the setState past the effect body so the
      // react-hooks/set-state-in-effect lint rule stays happy.
      const pending = newChatMessages;
      aniEvent("chat_detail.hydrate", {
        "chat.id": chatId,
        "application.id": applicationId,
        source: "new_chat_messages",
        "messages.count": pending.length,
      });
      queueMicrotask(() => {
        setInitial(pending);
        setNewChatMessages(null);
      });
      return;
    }
    getChat(chatId)
      .then(({ messages }) => {
        aniEvent("chat_detail.hydrate", {
          "chat.id": chatId,
          "application.id": applicationId,
          source: "fetch",
          "messages.count": messages.length,
        });
        setInitial(messages.length ? messages : []);
      })
      .catch((err) => {
        aniEvent("chat_detail.hydrate.error", {
          "chat.id": chatId,
          "application.id": applicationId,
          "error.message": err instanceof Error ? err.message : String(err),
        });
        router.replace(`/applications/${applicationId}/assistant-next`);
      });
  }, [applicationId, chatId, newChatMessages, router, setNewChatMessages]);

  if (initial === null) {
    return (
      <div className="flex h-full items-center justify-center">
        <div className="border-muted-foreground/30 border-t-foreground h-6 w-6 animate-spin rounded-full border-2" />
      </div>
    );
  }

  return <AppScopedChat applicationId={applicationId} chatId={chatId} initialMessages={initial} />;
}
