// V2 SSE dispatcher. See backend chatv2/events.go for the full event list and
// /Users/luca/.claude/plans/yeah-sounds-more-reasonable-shimmering-sunrise.md
// for the migration plan.
//
// P0 only ships the stub events (chat_started, chat_completed) plus passthrough
// for the events that already match the V1 shape (reasoning_delta,
// content_delta, citations). Later phases extend this handler with per-turn
// scoping and unified tool_* dispatch.
import type { AssistantSseEventHandlers } from "./assistantSseEvents";

type SseData = Record<string, unknown>;

export function handleAssistantSseEventV2(
  data: SseData,
  handlers: AssistantSseEventHandlers,
): string | null {
  const type = data.type;

  if (type === "chat_started") {
    const chatId = data.chat_id as string;
    handlers.setChatId(chatId);
    handlers.setCurrentChatId(chatId);
    return chatId;
  }

  if (type === "turn_started" || type === "turn_completed") {
    // P0: no-op. Later phases render per-turn boundaries.
    return null;
  }

  if (type === "content_delta") {
    handlers.startContentDelta(data.text as string);
    return null;
  }

  if (type === "content_done") {
    handlers.setIsLoadingCitations(true);
    return null;
  }

  if (type === "reasoning_delta") {
    handlers.appendReasoningDelta(data.text as string);
    return null;
  }

  if (type === "reasoning_block_end") {
    handlers.endReasoningBlock();
    handlers.pushThinkingPlaceholder();
    return null;
  }

  if (type === "citations") {
    handlers.clearStreamingPlaceholders();
    handlers.setCitations(
      Array.isArray(data.citations)
        ? (data.citations as Parameters<AssistantSseEventHandlers["setCitations"]>[0])
        : [],
    );
    return null;
  }

  if (type === "chat_completed") {
    // Defensive: if any streaming "Thinking…" placeholder is still in the
    // event list (e.g. the model produced reasoning but zero content_delta
    // chunks made it through, or only reasoning_delta arrived before the
    // stream closed), drop it so the UI doesn't sit forever on the
    // spinner. The persisted timeline has the full message; a reconnect
    // would replay it correctly via getChat.
    handlers.clearStreamingPlaceholders();
    handlers.endReasoningBlock();
    return null;
  }

  if (type === "chat_message_persisted") {
    // Nothing to render today; future "Saved." indicator can hook here.
    return null;
  }

  if (type === "backend_error") {
    handlers.clearStreamingPlaceholders();
    handlers.pushEvent({
      type: "replay_error",
      message:
        typeof data.message === "string" && data.message
          ? data.message
          : "The assistant ran into a backend error.",
    });
    return null;
  }

  if (type === "tool_started") {
    const name = canonicalToShortName((data.name as string) ?? "");
    handlers.pushEvent({
      type: "tool_call_start",
      name,
      isStreaming: true,
      status: "running",
    });
    return null;
  }

  if (type === "tool_progress") {
    // V2 tool_progress events forward the v1-style intermediate payload
    // (doc_read_start, web_page_fetched, etc.) from the underlying tool
    // executor. We dispatch them through the v1 handler so the existing
    // renderers (DocReadBlock, ApplicationCreatedBlock, ...) just work.
    return forwardProgressToV1Renderer(data, handlers);
  }

  if (type === "tool_completed") {
    const name = canonicalToShortName((data.name as string) ?? "");
    const summary = summariseToolResult(name, data.result as Record<string, unknown> | undefined);
    handlers.updateMatchingEvent(
      (e) => e.type === "tool_call_start" && e.name === name && e.status === "running",
      (e) => ({ ...e, isStreaming: false, status: "done", summary }),
    );
    // Also emit a v1-style enriched event so detailed UI cards (CompanyCard,
    // WebPageFetched, etc.) still render where they exist.
    forwardCompletedToV1Renderer(data, handlers);
    return null;
  }

  if (type === "tool_failed") {
    const name = canonicalToShortName((data.name as string) ?? "");
    const errMsg = (data.error as string) ?? "unknown error";
    handlers.updateMatchingEvent(
      (e) => e.type === "tool_call_start" && e.name === name && e.status === "running",
      (e) => ({ ...e, isStreaming: false, status: "failed", error: errMsg }),
    );
    return null;
  }

  return null;
}

// canonicalToShortName drops the "career_context." namespace so the UI sees
// the same short tool names V1 used.
function canonicalToShortName(canonical: string): string {
  const idx = canonical.lastIndexOf(".");
  return idx >= 0 ? canonical.slice(idx + 1) : canonical;
}

// summariseToolResult turns the backend's structured summary into the short
// one-line string the tool block shows under "Used <tool>".
function summariseToolResult(
  name: string,
  summary: Record<string, unknown> | undefined,
): string | undefined {
  if (!summary) return undefined;
  if (typeof summary.error === "string" && summary.error) {
    return summary.error;
  }
  switch (name) {
    case "create_company":
      return typeof summary.name === "string"
        ? `${summary.name}${summary.reused_existing ? " (reused)" : ""}`
        : undefined;
    case "create_application":
      return typeof summary.name === "string" ? (summary.name as string) : undefined;
    case "fetch_web_page":
      if (typeof summary.title === "string" && summary.title) return summary.title as string;
      if (typeof summary.url === "string") return summary.url as string;
      return undefined;
    default:
      return undefined;
  }
}

// forwardProgressToV1Renderer takes a V2 tool_progress event whose payload
// embeds a v1-style sub-event (e.g. {type:"doc_read_start", filename:...})
// and dispatches it through the v1 handler so existing renderers fire.
function forwardProgressToV1Renderer(data: SseData, handlers: AssistantSseEventHandlers): null {
  // Strip the v2 envelope keys, keep the rest as a v1-shaped event.
  const { turn, tool_call_id, ...rest } = data as {
    turn?: number;
    tool_call_id?: string;
    [key: string]: unknown;
  };
  void turn;
  void tool_call_id;
  if (typeof rest.type !== "string") return null;
  // Lazy import to avoid a circular dep; the v1 handler is already in the
  // module graph because useAssistantChat imports it directly.
  void import("./assistantSseEvents").then(({ handleAssistantSseEvent }) => {
    handleAssistantSseEvent(rest as SseData, handlers);
  });
  return null;
}

// forwardCompletedToV1Renderer synthesizes the v1 "completion" event for
// the tool name from the V2 summary, so detail-rich UI (company card, etc.)
// renders.
function forwardCompletedToV1Renderer(data: SseData, handlers: AssistantSseEventHandlers): null {
  const canonical = (data.name as string) ?? "";
  const name = canonicalToShortName(canonical);
  const summary = (data.result as Record<string, unknown>) ?? {};
  switch (name) {
    case "create_company":
      handlers.pushEvent({
        type: "company_created",
        company_id: (summary.company_id as string) ?? "",
        name: (summary.name as string) ?? "",
        reused_existing:
          typeof summary.reused_existing === "boolean"
            ? (summary.reused_existing as boolean)
            : undefined,
      });
      handlers.pushThinkingPlaceholder();
      return null;
    case "create_application":
      handlers.pushEvent({
        type: "application_created",
        application_id: (summary.application_id as string) ?? "",
        company_id: "",
        name: (summary.name as string) ?? "",
      });
      handlers.pushThinkingPlaceholder();
      return null;
    case "fetch_web_page":
      handlers.pushEvent({
        type: "web_page_fetched",
        url: (summary.url as string) ?? "",
        title: typeof summary.title === "string" ? (summary.title as string) : undefined,
      });
      handlers.pushThinkingPlaceholder();
      return null;
    default:
      // For tools without a dedicated rich renderer, the tool_call_start
      // placeholder finalisation (in the caller) is enough.
      return null;
  }
}
