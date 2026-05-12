"use client";

import { useEffect } from "react";

import { useAssistantChat } from "@/app/hooks/useAssistantChat";
import { Thread } from "@/components/assistant-ui/thread";

import { ChatThreadList } from "./ChatThreadList";
import { aniEvent } from "./observability";
import { AssistantNextRuntime } from "./RuntimeProvider";
import { SidePanelMount } from "./SidePanelMount";

/**
 * Spike-turned-replacement: assistant chat on top of assistant-ui.
 *
 * Wires our useAssistantChat hook into useExternalStoreRuntime and
 * renders via the polished Thread (`@/components/assistant-ui/thread`)
 * with per-event tool UIs, @ mentions for companies/applications,
 * / slash for workflows, attachment upload, and a side panel for
 * documents / citations / edits.
 */
export default function AssistantNextPage() {
  useEffect(() => {
    aniEvent("page.mount", { route: "standalone.empty" });
  }, []);
  const chat = useAssistantChat({ chatRouteBase: "/assistant-next/chat" });
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
