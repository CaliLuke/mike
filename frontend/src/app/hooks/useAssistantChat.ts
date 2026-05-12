"use client";

import { useRouter } from "next/navigation";
import { useRef, useState } from "react";

import type {
  AssistantEvent,
  LukeCitationAnnotation,
  LukeMessage,
} from "@/app/components/shared/types";
import { useChatHistoryContext } from "@/app/contexts/ChatHistoryContext";
import { streamApplicationChat, streamChat } from "@/app/lib/lukeApi";
import { getTracer } from "@/app/lib/telemetry";

import {
  appendCancelledAssistantMessage,
  appendErroredAssistantMessage,
  findLastContentIndex,
} from "./assistantChatMessages";
import { handleAssistantSseEvent } from "./assistantSseEvents";
import { handleAssistantSseEventV2 } from "./assistantSseEventsV2";
import { useGenerateChatTitle } from "./useGenerateChatTitle";

interface UseAssistantChatOptions {
  initialMessages?: LukeMessage[];
  chatId?: string;
  applicationId?: string;
  /**
   * Base path used when `router.replace`-ing to the chat detail URL
   * once a fresh chat completes its first turn. Defaults to the
   * legacy `/assistant/chat` (`/applications/{id}/assistant/chat`
   * when app-scoped). Set this when mounting the hook on the
   * assistant-next route family so the URL matches.
   */
  chatRouteBase?: "/assistant/chat" | "/assistant-next/chat";
}

export function useAssistantChat({
  initialMessages = [],
  chatId: initialChatId,
  applicationId,
  chatRouteBase = "/assistant/chat",
}: UseAssistantChatOptions = {}) {
  const router = useRouter();
  const { replaceChatId, loadChats, setCurrentChatId, saveChat, setNewChatMessages } =
    useChatHistoryContext();
  const { generate: generateTitle } = useGenerateChatTitle();

  const [messages, setMessages] = useState<LukeMessage[]>(initialMessages);
  const [isResponseLoading, setIsResponseLoading] = useState(false);
  const [isLoadingCitations, setIsLoadingCitations] = useState(false);
  const [chatId, setChatId] = useState<string | undefined>(initialChatId);

  const abortControllerRef = useRef<AbortController | null>(null);

  const dripIntervalRef = useRef<ReturnType<typeof setInterval> | null>(null);
  const dripTargetRef = useRef<string>("");
  const dripDisplayLenRef = useRef<number>(0);
  const eventsRef = useRef<AssistantEvent[]>([]);
  const DRIP_CHARS_PER_TICK = 8;

  const stopDrip = () => {
    if (dripIntervalRef.current !== null) {
      clearInterval(dripIntervalRef.current);
      dripIntervalRef.current = null;
    }
  };

  const updateLastContentEvent = (
    prev: LukeMessage[],
    text: string,
    isStreaming?: boolean,
  ): LukeMessage[] => {
    const updated = [...prev];
    const last = updated[updated.length - 1];
    if (last?.role !== "assistant") return prev;
    const events = last.events ?? [];
    const idx = findLastContentIndex(events);
    if (idx < 0) return prev;
    const newEvents = [...events];
    newEvents[idx] = isStreaming
      ? { type: "content", text, isStreaming: true }
      : { type: "content", text };
    updated[updated.length - 1] = { ...last, events: newEvents };
    return updated;
  };

  const flushDrip = () => {
    stopDrip();
    const target = dripTargetRef.current;
    dripDisplayLenRef.current = target.length;
    setMessages((prev) => updateLastContentEvent(prev, target));
  };

  /**
   * Finalize any in-flight streaming content event and reset the drip
   * counters so the next content_delta starts a fresh block. Called
   * before any non-content event is appended, so interleaved content /
   * reasoning / tool events stay in chronological order — without the
   * later content block inheriting the earlier block's accumulated text.
   */
  const finalizeStreamingContent = () => {
    stopDrip();
    const events = eventsRef.current;
    const last = events[events.length - 1];
    if (last?.type === "content" && last.isStreaming) {
      const finalText = dripTargetRef.current;
      eventsRef.current = [...events.slice(0, -1), { type: "content", text: finalText }];
      const snapshot = [...eventsRef.current];
      setMessages((prev) => {
        const updated = [...prev];
        const lastMsg = updated[updated.length - 1];
        if (lastMsg?.role === "assistant") {
          updated[updated.length - 1] = {
            ...lastMsg,
            events: snapshot,
          };
        }
        return updated;
      });
    }
    dripTargetRef.current = "";
    dripDisplayLenRef.current = 0;
  };

  // If the model transitions from reasoning into content/tool without a
  // reasoning_block_end (or the events arrive out of order), the prior
  // reasoning event would otherwise stay flagged isStreaming forever.
  const finalizeStreamingReasoning = () => {
    const events = eventsRef.current;
    const last = events[events.length - 1];
    if (last?.type !== "reasoning" || !last.isStreaming) return;
    eventsRef.current = [...events.slice(0, -1), { type: "reasoning", text: last.text }];
    const snapshot = [...eventsRef.current];
    setMessages((prev) => {
      const updated = [...prev];
      const lastMsg = updated[updated.length - 1];
      if (lastMsg?.role === "assistant") {
        updated[updated.length - 1] = {
          ...lastMsg,
          events: snapshot,
        };
      }
      return updated;
    });
  };

  const startDrip = () => {
    if (dripIntervalRef.current !== null) return;
    dripIntervalRef.current = setInterval(() => {
      const target = dripTargetRef.current;
      const displayLen = dripDisplayLenRef.current;
      if (displayLen >= target.length) return;

      const newLen = Math.min(displayLen + DRIP_CHARS_PER_TICK, target.length);
      dripDisplayLenRef.current = newLen;
      const visibleText = target.slice(0, newLen);
      const events = eventsRef.current;
      const lastIdx = events.length - 1;
      const last = events[lastIdx];
      if (last?.type === "content" && last.isStreaming) {
        const next = events.slice();
        next[lastIdx] = {
          type: "content",
          text: visibleText,
          isStreaming: true,
        };
        eventsRef.current = next;
      }

      setMessages((prev) => updateLastContentEvent(prev, visibleText, true));
    }, 16);
  };

  const cancel = () => {
    if (abortControllerRef.current) {
      abortControllerRef.current.abort();
      abortControllerRef.current = null;
      setIsResponseLoading(false);
      setIsLoadingCitations(false);
    }
  };

  // Transient placeholder events (tool_call_start, thinking) fill the
  // latency gap between real SSE events so the wrapper doesn't look stuck.
  // Anytime a real event arrives, drop any streaming placeholder first.
  const isStreamingPlaceholder = (e: AssistantEvent) =>
    (e.type === "tool_call_start" || e.type === "thinking") && !!e.isStreaming;

  const clearStreamingPlaceholders = () => {
    const before = eventsRef.current;
    const after = before.filter((e) => !isStreamingPlaceholder(e));
    if (after.length === before.length) return;
    eventsRef.current = after;
    const snapshot = [...after];
    setMessages((prev) => {
      const updated = [...prev];
      const last = updated[updated.length - 1];
      if (last?.role === "assistant") {
        updated[updated.length - 1] = { ...last, events: snapshot };
      }
      return updated;
    });
  };

  const pushThinkingPlaceholder = () => {
    const events = eventsRef.current;
    const last = events[events.length - 1];
    // Don't stack placeholders back-to-back; one "Thinking…" line is plenty.
    if (last && isStreamingPlaceholder(last)) return;
    eventsRef.current = [...events, { type: "thinking" as const, isStreaming: true }];
    const snapshot = [...eventsRef.current];
    setMessages((prev) => {
      const updated = [...prev];
      const lastMsg = updated[updated.length - 1];
      if (lastMsg?.role === "assistant") {
        updated[updated.length - 1] = { ...lastMsg, events: snapshot };
      }
      return updated;
    });
  };

  const pushEvent = (event: AssistantEvent) => {
    finalizeStreamingContent();
    finalizeStreamingReasoning();
    // Drop any in-flight placeholder unless we're pushing one ourselves.
    let next = eventsRef.current;
    if (event.type !== "tool_call_start" && event.type !== "thinking") {
      next = next.filter((e) => !isStreamingPlaceholder(e));
    }
    eventsRef.current = [...next, event];
    const snapshot = [...eventsRef.current];
    setMessages((prev) => {
      const updated = [...prev];
      const last = updated[updated.length - 1];
      if (last?.role === "assistant") {
        updated[updated.length - 1] = { ...last, events: snapshot };
      }
      return updated;
    });
  };

  const updateMatchingEvent = (
    predicate: (e: AssistantEvent) => boolean,
    updater: (e: AssistantEvent) => AssistantEvent,
  ) => {
    const events = eventsRef.current;
    const idx = [...events]
      .map((_, i) => i)
      .reverse()
      .find((i) => predicate(events[i]));
    if (idx === undefined) return;
    const newEvents = [...events];
    newEvents[idx] = updater(events[idx]);
    eventsRef.current = newEvents;
    const snapshot = [...newEvents];
    setMessages((prev) => {
      const updated = [...prev];
      const last = updated[updated.length - 1];
      if (last?.role === "assistant") {
        updated[updated.length - 1] = { ...last, events: snapshot };
      }
      return updated;
    });
  };

  const startContentDelta = (text: string) => {
    clearStreamingPlaceholders();
    finalizeStreamingReasoning();

    const events = eventsRef.current;
    const lastEvent = events[events.length - 1];
    if (lastEvent?.type !== "content" || !lastEvent.isStreaming) {
      dripTargetRef.current = text;
      dripDisplayLenRef.current = 0;
      eventsRef.current = [
        ...events,
        {
          type: "content",
          text: "",
          isStreaming: true,
        },
      ];
      const snapshot = [...eventsRef.current];
      setMessages((prev) => {
        const updated = [...prev];
        const last = updated[updated.length - 1];
        if (last?.role === "assistant") {
          updated[updated.length - 1] = {
            ...last,
            events: snapshot,
          };
        }
        return updated;
      });
    } else {
      dripTargetRef.current += text;
    }

    startDrip();
  };

  const appendReasoningDelta = (text: string) => {
    let events = eventsRef.current;
    const last = events[events.length - 1];
    if (last?.type === "reasoning" && last.isStreaming) {
      eventsRef.current = [
        ...events.slice(0, -1),
        {
          type: "reasoning",
          text: last.text + text,
          isStreaming: true,
        },
      ];
    } else {
      finalizeStreamingContent();
      clearStreamingPlaceholders();
      events = eventsRef.current;
      eventsRef.current = [
        ...events,
        {
          type: "reasoning",
          text,
          isStreaming: true,
        },
      ];
    }
    const snapshot = [...eventsRef.current];
    setMessages((prev) => {
      const updated = [...prev];
      const last = updated[updated.length - 1];
      if (last?.role === "assistant") {
        updated[updated.length - 1] = {
          ...last,
          events: snapshot,
        };
      }
      return updated;
    });
  };

  const endReasoningBlock = () => {
    const events = eventsRef.current;
    const last = events[events.length - 1];
    if (last?.type === "reasoning" && last.isStreaming) {
      eventsRef.current = [
        ...events.slice(0, -1),
        {
          type: "reasoning",
          text: last.text,
        },
      ];
    }
    const snapshot = [...eventsRef.current];
    setMessages((prev) => {
      const updated = [...prev];
      const last = updated[updated.length - 1];
      if (last?.role === "assistant") {
        updated[updated.length - 1] = {
          ...last,
          events: snapshot,
        };
      }
      return updated;
    });
  };

  const setCitations = (incoming: LukeCitationAnnotation[]) => {
    setMessages((prev) => {
      const updated = [...prev];
      const last = updated[updated.length - 1];
      if (last?.role === "assistant") {
        updated[updated.length - 1] = {
          ...last,
          annotations: incoming,
        };
      }
      return updated;
    });
  };

  const handleChat = async (
    message: LukeMessage,
    opts?: {
      displayedDoc?: { filename: string; documentId: string } | null;
    },
  ): Promise<string | null> => {
    if (!message.content.trim()) return null;

    setIsResponseLoading(true);

    const lastMessage = messages[messages.length - 1];
    const isMessageAlreadyAdded =
      lastMessage && lastMessage.role === "user" && lastMessage.content === message.content;

    const newMessages: LukeMessage[] = isMessageAlreadyAdded ? messages : [...messages, message];

    setMessages([...newMessages, { role: "assistant", content: "", annotations: [], events: [] }]);

    let streamedChatId: string | null = null;

    stopDrip();
    dripTargetRef.current = "";
    dripDisplayLenRef.current = 0;
    eventsRef.current = [];

    try {
      const controller = new AbortController();
      abortControllerRef.current = controller;

      const apiMessages = newMessages.map((currentMessage) => ({
        role: currentMessage.role,
        content: currentMessage.content,
        files: currentMessage.files,
        workflow: currentMessage.workflow,
      }));

      const model = message.model;

      const displayedDoc = opts?.displayedDoc ?? null;

      // Pull the user's attachments from the just-submitted message.
      // These are the files dragged into / picked from the chat input
      // for this turn (separate from the running history of past
      // attachments). Sent as a request-level field so the backend
      // can call them out specifically in the system prompt.
      const attachedDocs = (message.files?.filter((f) => !!f.document_id) ?? []).map((f) => ({
        filename: f.filename,
        document_id: f.document_id as string,
      }));

      // Per-chat client-side span: closes the browser-side blind spot.
      // Records fetch latency, when each notable event lands relative to
      // the start, per-event-type counts, and the exit reason. Trace
      // context propagates via FetchInstrumentation so the server's
      // chatv2.sse.handler span links to this one as parent.
      const sseSpan = getTracer().startSpan("chatv2.client.sse", {
        attributes: {
          "chat.id": chatId ?? "",
          "chat.application_scoped": !!applicationId,
          "chat.request_message_count": apiMessages.length,
          "chat.attached_document_count": attachedDocs.length,
        },
      });
      const sseStartMs = performance.now();
      let firstEventMs: number | null = null;
      let firstContentDeltaMs: number | null = null;
      let firstChatCompletedMs: number | null = null;
      const typeCounts: Record<string, number> = {};
      let bytesReceived = 0;
      let exitReason = "unknown";

      try {
        const response = await (applicationId
          ? streamApplicationChat({
              applicationId,
              messages: apiMessages,
              chat_id: chatId,
              model,
              displayed_doc: displayedDoc
                ? {
                    filename: displayedDoc.filename,
                    document_id: displayedDoc.documentId,
                  }
                : undefined,
              attached_documents: attachedDocs.length > 0 ? attachedDocs : undefined,
              signal: controller.signal,
            })
          : streamChat({
              messages: apiMessages,
              chat_id: chatId,
              model,
              signal: controller.signal,
            }));

        sseSpan.setAttribute("chatv2.client.time_to_response_ms", performance.now() - sseStartMs);
        sseSpan.setAttribute("chatv2.client.http_status", response.status);

        if (!response.ok) {
          const errText = await response.text();
          exitReason = "http_error";
          throw new Error(`HTTP ${response.status}: ${errText}`);
        }

        const reader = response.body?.getReader();
        if (!reader) {
          exitReason = "no_body";
          throw new Error("No response body");
        }

        const decoder = new TextDecoder();
        let buffer = "";
        const chatVersion = response.headers.get("x-luke-chat-version");
        sseSpan.setAttribute("chatv2.client.chat_version", chatVersion ?? "v1");
        const dispatch = chatVersion === "v2" ? handleAssistantSseEventV2 : handleAssistantSseEvent;

        while (true) {
          const { done, value } = await reader.read();
          if (done) {
            exitReason = exitReason === "unknown" ? "stream_done" : exitReason;
            break;
          }

          bytesReceived += value?.length ?? 0;
          buffer += decoder.decode(value, { stream: true });
          const lines = buffer.split("\n");
          buffer = lines.pop() || "";

          for (const line of lines) {
            const trimmed = line.trim();
            if (!trimmed || !trimmed.startsWith("data:")) continue;

            const dataStr = trimmed.slice(5).trim();
            if (dataStr === "[DONE]") continue;

            try {
              const data = JSON.parse(dataStr);
              const eventType = typeof data.type === "string" ? data.type : "unknown";
              typeCounts[eventType] = (typeCounts[eventType] ?? 0) + 1;
              const now = performance.now();
              if (firstEventMs === null) firstEventMs = now - sseStartMs;
              if (firstContentDeltaMs === null && eventType === "content_delta") {
                firstContentDeltaMs = now - sseStartMs;
              }
              if (firstChatCompletedMs === null && eventType === "chat_completed") {
                firstChatCompletedMs = now - sseStartMs;
                exitReason = "chat_completed";
              }
              if (eventType === "backend_error") exitReason = "backend_error";

              const nextChatId = dispatch(data, {
                setChatId,
                setCurrentChatId,
                setIsLoadingCitations,
                startContentDelta,
                appendReasoningDelta,
                endReasoningBlock,
                clearStreamingPlaceholders,
                pushThinkingPlaceholder,
                pushEvent,
                updateMatchingEvent,
                setCitations,
              });
              if (nextChatId) streamedChatId = nextChatId;
            } catch (e) {
              console.warn("[useAssistantChat] failed to parse SSE line:", trimmed, e);
            }
          }
        }
      } catch (e) {
        if (exitReason === "unknown") {
          exitReason = e instanceof Error && e.name === "AbortError" ? "aborted" : "thrown_error";
        }
        if (e instanceof Error) sseSpan.recordException(e);
        throw e;
      } finally {
        sseSpan.setAttribute("chatv2.client.exit_reason", exitReason);
        sseSpan.setAttribute("chatv2.client.bytes_received", bytesReceived);
        sseSpan.setAttribute("chatv2.client.total_duration_ms", performance.now() - sseStartMs);
        if (firstEventMs !== null) {
          sseSpan.setAttribute("chatv2.client.time_to_first_event_ms", firstEventMs);
        }
        if (firstContentDeltaMs !== null) {
          sseSpan.setAttribute("chatv2.client.time_to_first_content_delta_ms", firstContentDeltaMs);
        }
        if (firstChatCompletedMs !== null) {
          sseSpan.setAttribute("chatv2.client.time_to_chat_completed_ms", firstChatCompletedMs);
        }
        for (const [t, c] of Object.entries(typeCounts)) {
          sseSpan.setAttribute(`chatv2.client.count.${t}`, c);
        }
        sseSpan.end();
      }

      flushDrip();
      finalizeStreamingReasoning();
      setIsResponseLoading(false);
      setIsLoadingCitations(false);

      const finalChatId = streamedChatId || chatId || null;
      if (finalChatId && finalChatId !== chatId) {
        if (chatId) {
          replaceChatId(chatId, finalChatId, message.content.trim().slice(0, 120) || "New Chat");
        }
        setCurrentChatId(finalChatId);
        const chatBasePath = applicationId
          ? `/applications/${applicationId}${chatRouteBase}`
          : chatRouteBase;
        router.replace(`${chatBasePath}/${finalChatId}`);
      }

      await loadChats();

      const finalChatIdForTitle = streamedChatId || chatId || null;
      if (finalChatIdForTitle && newMessages.length === 1) {
        const titleParts = [message.content];
        if (message.workflow) titleParts.push(`Workflow: ${message.workflow.title}`);
        if (message.files?.length)
          titleParts.push(`Files: ${message.files.map((f) => f.filename).join(", ")}`);
        void generateTitle(finalChatIdForTitle, titleParts.join("\n"));
      }

      return streamedChatId || null;
    } catch (error: unknown) {
      if ((error as { name?: string }).name === "AbortError") {
        flushDrip();
        setMessages(appendCancelledAssistantMessage);
      } else {
        stopDrip();
        const err = error as { message?: unknown };
        const errorMessage =
          typeof err.message === "string" && err.message
            ? err.message
            : "Sorry, something went wrong.";
        setMessages((prev) => appendErroredAssistantMessage(prev, errorMessage));
      }

      setIsResponseLoading(false);
      setIsLoadingCitations(false);
      return null;
    } finally {
      abortControllerRef.current = null;
    }
  };

  const handleNewChat = async (
    message: LukeMessage,
    applicationId?: string,
  ): Promise<string | null> => {
    if (!message.content.trim()) return null;

    setMessages([message]);
    setNewChatMessages([message]);

    const newChatId = await saveChat(applicationId);
    if (newChatId) {
      setChatId(newChatId);
      setCurrentChatId(newChatId);
    }

    return newChatId;
  };

  return {
    messages,
    isResponseLoading,
    setIsResponseLoading,
    isLoadingCitations,
    handleChat,
    handleNewChat,
    setMessages,
    cancel,
    chatId,
  };
}
