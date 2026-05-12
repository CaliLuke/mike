"use client";

import { ChevronLeft } from "lucide-react";
import Link from "next/link";
import { useEffect, useState } from "react";

import { ChatThreadList } from "@/app/(pages)/assistant-next/ChatThreadList";
import { aniEvent } from "@/app/(pages)/assistant-next/observability";
import { AssistantNextRuntime } from "@/app/(pages)/assistant-next/RuntimeProvider";
import { SidePanelMount } from "@/app/(pages)/assistant-next/SidePanelMount";
import type { LukeMessage } from "@/app/components/shared/types";
import { useAssistantChat } from "@/app/hooks/useAssistantChat";
import { getApplication } from "@/app/lib/lukeApi";
import { Thread } from "@/components/assistant-ui/thread";

interface Props {
  applicationId: string;
  chatId?: string;
  initialMessages?: LukeMessage[];
}

/**
 * Application-scoped chat shell. Same Thread + side-panel layout as
 * /assistant-next, but with applicationId threaded into useAssistantChat
 * so the SSE request goes to /applications/{id}/chat. Adds a thin
 * breadcrumb header so the user knows which application context is
 * active.
 */
export function AppScopedChat({ applicationId, chatId, initialMessages = [] }: Props) {
  const [applicationName, setApplicationName] = useState<string | null>(null);
  const chat = useAssistantChat({
    initialMessages,
    chatId,
    applicationId,
    chatRouteBase: "/assistant-next/chat",
  });

  useEffect(() => {
    aniEvent("page.mount", {
      route: chatId ? "app_scoped.chat" : "app_scoped.empty",
      "application.id": applicationId,
      "chat.id": chatId ?? null,
    });
  }, [applicationId, chatId]);

  useEffect(() => {
    let cancelled = false;
    getApplication(applicationId)
      .then((a) => {
        if (!cancelled) setApplicationName(a.name);
      })
      .catch((err) => {
        aniEvent("app_scoped.application_fetch.error", {
          "application.id": applicationId,
          "error.message": err instanceof Error ? err.message : String(err),
        });
      });
    return () => {
      cancelled = true;
    };
  }, [applicationId]);

  return (
    <AssistantNextRuntime chat={chat} applicationId={applicationId}>
      <div className="relative flex h-full w-full flex-col">
        <header className="border-border bg-background flex items-center gap-2 border-b px-4 py-2 text-sm">
          <Link
            href={`/applications/${applicationId}`}
            className="text-muted-foreground hover:text-foreground flex items-center gap-1 transition-colors"
          >
            <ChevronLeft className="h-4 w-4" />
            <span>{applicationName ?? "Application"}</span>
          </Link>
        </header>
        <div className="relative flex flex-1 overflow-hidden">
          <ChatThreadList />
          <div className="relative flex h-full flex-1 flex-col">
            <Thread />
          </div>
          <SidePanelMount />
        </div>
      </div>
    </AssistantNextRuntime>
  );
}
