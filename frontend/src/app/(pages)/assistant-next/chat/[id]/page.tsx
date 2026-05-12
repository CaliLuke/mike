"use client";

import { useParams, useRouter } from "next/navigation";
import { useEffect, useRef } from "react";

import { useChatHistoryContext } from "@/app/contexts/ChatHistoryContext";
import { useAssistantChat } from "@/app/hooks/useAssistantChat";
import { getChat } from "@/app/lib/lukeApi";
import { Thread } from "@/components/assistant-ui/thread";

import { ChatThreadList } from "../../ChatThreadList";
import { aniEvent } from "../../observability";
import { AssistantNextRuntime } from "../../RuntimeProvider";
import { SidePanelMount } from "../../SidePanelMount";

export default function AssistantNextChatPage() {
  const router = useRouter();
  const params = useParams();
  // chat id is `chats:chat_…`; Next.js leaves `:` URL-encoded in
  // params, decode so all id comparisons line up.
  const id = decodeURIComponent(params.id as string);

  const { setCurrentChatId, newChatMessages, setNewChatMessages } = useChatHistoryContext();

  const initialMessages = newChatMessages ?? [];
  const chat = useAssistantChat({
    initialMessages,
    chatId: id,
    chatRouteBase: "/assistant-next/chat",
  });
  const { messages, isResponseLoading, handleChat, setMessages } = chat;

  const hasAutoSent = useRef(false);
  const hasLoaded = useRef(false);

  useEffect(() => {
    aniEvent("page.mount", { route: "standalone.chat", "chat.id": id });
    setCurrentChatId(id);
  }, [id, setCurrentChatId]);

  useEffect(() => {
    if (initialMessages.length > 0) {
      aniEvent("chat_detail.hydrate", {
        "chat.id": id,
        source: "new_chat_messages",
        "messages.count": initialMessages.length,
      });
      if (newChatMessages) setNewChatMessages(null);
      return;
    }
    if (hasLoaded.current || messages.length > 0) return;
    hasLoaded.current = true;

    getChat(id)
      .then(({ messages: loaded }) => {
        aniEvent("chat_detail.hydrate", {
          "chat.id": id,
          source: "fetch",
          "messages.count": loaded.length,
        });
        if (loaded.length > 0) {
          setMessages(loaded);
        }
      })
      .catch((err) => {
        aniEvent("chat_detail.hydrate.error", {
          "chat.id": id,
          "error.message": err instanceof Error ? err.message : String(err),
        });
        router.replace("/assistant-next");
      });
  }, [
    id,
    initialMessages.length,
    messages.length,
    newChatMessages,
    router,
    setMessages,
    setNewChatMessages,
  ]);

  useEffect(() => {
    if (
      newChatMessages &&
      newChatMessages.length === 1 &&
      newChatMessages[0].role === "user" &&
      !hasAutoSent.current &&
      !isResponseLoading &&
      messages.length === 1
    ) {
      hasAutoSent.current = true;
      void handleChat(newChatMessages[0]);
    }
  }, [handleChat, isResponseLoading, messages.length, newChatMessages]);

  return (
    <AssistantNextRuntime chat={chat}>
      <div className="relative flex h-full w-full">
        <ChatThreadList />
        <div className="relative flex h-full flex-1 flex-col">
          <Thread />
        </div>
        <SidePanelMount />
      </div>
    </AssistantNextRuntime>
  );
}
