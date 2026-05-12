"use client";

import type { AppendMessage, ExternalStoreAdapter } from "@assistant-ui/react";
import { AssistantRuntimeProvider, useExternalStoreRuntime } from "@assistant-ui/react";
import { useRouter } from "next/navigation";
import { type ReactNode, useEffect, useRef } from "react";

import type { LukeMessage } from "@/app/components/shared/types";
import { useChatHistoryContext } from "@/app/contexts/ChatHistoryContext";
import { type useAssistantChat } from "@/app/hooks/useAssistantChat";
import { TooltipProvider } from "@/components/ui/tooltip";

import { attachmentsToLukeFiles, lukeAttachmentAdapter } from "./attachmentAdapter";
import { SelectedModelProvider, useSelectedModelContext } from "./ComposerModelToggle";
import { makeConvertLukeMessage } from "./convertMessage";
import { aniEvent, aniWrap } from "./observability";
import { PendingWorkflowProvider, usePendingWorkflow } from "./pendingWorkflow";
import { SidePanelProvider } from "./sidePanel";
import { ToolUis } from "./toolUis";

type AssistantChat = ReturnType<typeof useAssistantChat>;

interface Props {
  chat: AssistantChat;
  /**
   * When set, the ThreadList shows only chats whose application_id
   * matches and routes new/switch links to the app-scoped paths. When
   * unset, all standalone (no-application) chats show and routes use
   * the top-level /assistant-next family.
   */
  applicationId?: string;
  children: ReactNode;
}

function RuntimeInner({ chat, applicationId, children }: Props) {
  const pending = usePendingWorkflow();
  const { model } = useSelectedModelContext();
  const router = useRouter();
  const chatHistory = useChatHistoryContext();

  // ChatHistoryProvider only auto-loads once on auth. Refresh on every
  // mount of the assistant view so a chat created on a previous page
  // (or from a fresh nav after backend rebuild) shows up in the
  // ThreadList without needing another send to trigger handleChat's
  // post-turn reload.
  const { loadChats } = chatHistory;
  useEffect(() => {
    aniEvent("runtime.mount", {
      "application.id": applicationId ?? null,
      "chat.id": chat.chatId ?? null,
    });
    void aniWrap("chat_history.load", { trigger: "mount" }, async () => {
      await loadChats();
    });
    return () => {
      aniEvent("runtime.unmount", {
        "application.id": applicationId ?? null,
        "chat.id": chat.chatId ?? null,
      });
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [loadChats]);

  const onNew = async (message: AppendMessage) => {
    const text = message.content
      .filter((p): p is { type: "text"; text: string } => p.type === "text")
      .map((p) => p.text)
      .join("");
    const files = attachmentsToLukeFiles(message.attachments);
    if (!text.trim() && files.length === 0) {
      aniEvent("composer.send.empty");
      return;
    }
    const workflow = pending.take();
    await aniWrap(
      "composer.send",
      {
        "text.length": text.length,
        "attachments.count": files.length,
        "model.id": model,
        "workflow.id": workflow?.id ?? null,
        "application.id": applicationId ?? null,
        "chat.id": chat.chatId ?? null,
      },
      async () => {
        const luke: LukeMessage = {
          role: "user",
          content: text,
          model,
          ...(workflow ? { workflow } : {}),
          ...(files.length > 0 ? { files } : {}),
        };
        await chat.handleChat(luke);
      },
    );
  };

  const onReload = async () => {
    // Find the last user message and re-send it, dropping the last
    // assistant turn so the new stream takes its place. useAssistantChat
    // appends a fresh assistant message on handleChat — trimming first
    // avoids ending up with two assistant turns side-by-side.
    const msgs = chat.messages;
    let lastUserIdx = -1;
    for (let i = msgs.length - 1; i >= 0; i--) {
      if (msgs[i].role === "user") {
        lastUserIdx = i;
        break;
      }
    }
    if (lastUserIdx < 0) {
      aniEvent("composer.reload.skip", { reason: "no_user_message" });
      return;
    }
    const lastUser = msgs[lastUserIdx];
    await aniWrap(
      "composer.reload",
      {
        "messages.dropped": msgs.length - (lastUserIdx + 1),
        "model.id": model,
        "chat.id": chat.chatId ?? null,
      },
      async () => {
        chat.setMessages(msgs.slice(0, lastUserIdx + 1));
        await chat.handleChat({ ...lastUser, model });
      },
    );
  };

  // Chats listed in the ThreadList:
  // - app-scoped view → only this application's chats
  // - standalone view → every chat the user has, since this is the
  //   "general assistant" surface (per-row routing handles app-scoped
  //   chats by pushing into their own /applications/<id>/... URL)
  const allChats = chatHistory.chats ?? [];
  const scopedChats = applicationId
    ? allChats.filter((c) => c.application_id === applicationId)
    : allChats;
  const chatById = new Map(allChats.map((c) => [c.id, c] as const));

  const chatRoot = applicationId
    ? `/applications/${applicationId}/assistant-next`
    : "/assistant-next";
  const routeForChat = (c: { id: string; application_id?: string | null }) =>
    c.application_id
      ? `/applications/${c.application_id}/assistant-next/chat/${c.id}`
      : `/assistant-next/chat/${c.id}`;

  const threadListAdapter = {
    threadId: chat.chatId,
    threads: scopedChats.map((c) => ({
      status: "regular" as const,
      id: c.id,
      title: c.title ?? undefined,
    })),
    onSwitchToNewThread: () => {
      aniEvent("thread_list.new", {
        "application.id": applicationId ?? null,
        "destination.url": chatRoot,
      });
      router.push(chatRoot);
    },
    onSwitchToThread: (threadId: string) => {
      const c = chatById.get(threadId);
      const destination = c ? routeForChat(c) : `${chatRoot}/chat/${threadId}`;
      aniEvent("thread_list.switch", {
        "thread.id": threadId,
        "thread.found": !!c,
        "thread.application_id": c?.application_id ?? null,
        "destination.url": destination,
      });
      router.push(destination);
    },
    onRename: async (threadId: string, newTitle: string) => {
      await aniWrap(
        "chat_history.rename",
        { "thread.id": threadId, "title.length": newTitle.length },
        async () => {
          await chatHistory.renameChat(threadId, newTitle);
        },
      );
    },
    onDelete: async (threadId: string) => {
      await aniWrap(
        "chat_history.delete",
        {
          "thread.id": threadId,
          "thread.is_current": chat.chatId === threadId,
        },
        async () => {
          await chatHistory.deleteChat(threadId);
          if (chat.chatId === threadId) {
            router.replace(chatRoot);
          }
        },
      );
    },
  };

  const adapter: ExternalStoreAdapter<LukeMessage> = {
    messages: chat.messages,
    isRunning: chat.isResponseLoading,
    convertMessage: makeConvertLukeMessage(chat.chatId),
    onNew,
    onReload,
    onCancel: async () => {
      chat.cancel();
    },
    adapters: {
      attachments: lukeAttachmentAdapter,
      threadList: threadListAdapter,
    },
  };

  // Adapter rebuild visibility — fires once per render burst but only
  // when the shape that drives the ThreadList actually changes. This
  // is the trace event you'd look at when "I don't see chats in the
  // list" — if `chats.total` is 0 or `threads.count` is 0, the issue
  // is upstream of assistant-ui.
  const lastAdapterSig = useRef<string>("");
  const adapterSig = JSON.stringify({
    t: chat.chatId ?? null,
    n: scopedChats.length,
    a: allChats.length,
  });
  useEffect(() => {
    if (lastAdapterSig.current === adapterSig) return;
    lastAdapterSig.current = adapterSig;
    aniEvent("adapter.rebuild", {
      "chat.id": chat.chatId ?? null,
      "application.id": applicationId ?? null,
      "messages.count": chat.messages.length,
      "messages.running": chat.isResponseLoading,
      "threads.count": scopedChats.length,
      "chats.total": allChats.length,
      "chat_history.loaded": chatHistory.chats !== null,
    });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [adapterSig]);

  const runtime = useExternalStoreRuntime<LukeMessage>(adapter);

  return (
    <AssistantRuntimeProvider runtime={runtime}>
      <ToolUis />
      {children}
    </AssistantRuntimeProvider>
  );
}

export function AssistantNextRuntime({ chat, applicationId, children }: Props) {
  return (
    <TooltipProvider delayDuration={150}>
      <SelectedModelProvider>
        <PendingWorkflowProvider>
          <SidePanelProvider>
            <RuntimeInner chat={chat} applicationId={applicationId}>
              {children}
            </RuntimeInner>
          </SidePanelProvider>
        </PendingWorkflowProvider>
      </SelectedModelProvider>
    </TooltipProvider>
  );
}
