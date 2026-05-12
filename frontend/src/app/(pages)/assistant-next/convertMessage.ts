import type { ThreadMessageLike } from "@assistant-ui/react";

import type { AssistantEvent, LukeMessage } from "@/app/components/shared/types";

import { LUKE_DOCUMENT_PART, type LukeDocumentPartData } from "./attachmentAdapter";

// JSON-compatible coercion of an arbitrary event-payload object so it
// satisfies ReadonlyJSONObject (tool-call args type). Our SSE payloads
// are already JSON-derived; the round-trip through JSON.parse asserts
// the shape and strips any non-serializable holdovers.
function asJsonArgs(obj: Record<string, unknown>): Record<string, never> {
  return JSON.parse(JSON.stringify(obj)) as Record<string, never>;
}

/**
 * Per-event-type discriminator: which AssistantEvent variants are best
 * rendered as a "tool-call" message part (vs. text or reasoning)? Each
 * one becomes a tool-call part with `toolName === event.type`, with
 * the rest of the event payload passed through as `args`.
 *
 * The matching tool UI is registered in toolUis.tsx — keep these
 * arrays and the renderer map in sync.
 */
const TOOL_EVENT_TYPES = new Set<AssistantEvent["type"]>([
  "tool_call_start",
  "doc_read",
  "doc_find",
  "doc_created",
  "doc_edited",
  "doc_replicated",
  "doc_download",
  "web_page_fetched",
  "company_created",
  "company_match_warning",
  "application_created",
  "workflow_applied",
  "replay_error",
]);

/**
 * Transient placeholders that useAssistantChat injects to mask SSE
 * latency. They get evicted by `clearStreamingPlaceholders` when a
 * real event arrives, but a snapshot can still contain one mid-render
 * — drop them at conversion time so assistant-ui doesn't grab them
 * into a ToolGroup. `thinking` is *always* a placeholder; a
 * `tool_call_start` is a placeholder only while still streaming with
 * no concrete summary / error yet (i.e. tool_completed hasn't landed).
 *
 * The message-level `isRunning` state on the external store already
 * conveys "assistant is thinking" without us materialising a tool-call.
 */
function isStreamingPlaceholder(event: AssistantEvent): boolean {
  if (event.type === "thinking") return true;
  if (event.type === "tool_call_start") {
    return !!event.isStreaming && !event.summary && !event.error;
  }
  return false;
}

type ContentArray = Exclude<ThreadMessageLike["content"], string>;
type ContentPart = ContentArray[number];

function eventToPart(event: AssistantEvent, idx: number, messageIdx: number): ContentPart | null {
  if (isStreamingPlaceholder(event)) return null;
  if (event.type === "content") {
    return { type: "text", text: event.text };
  }
  if (event.type === "reasoning") {
    return { type: "reasoning", text: event.text };
  }
  if (!TOOL_EVENT_TYPES.has(event.type)) {
    return null;
  }
  // args is everything-but-type so the renderer sees a familiar shape.
  const { type: _type, ...rest } = event as { type: string } & Record<string, unknown>;
  void _type;
  // assistant-ui derives part status from the surrounding message status;
  // we surface our own isStreaming flag through args so the tool renderer
  // can keep its existing in-progress visuals.
  const args = asJsonArgs(rest);
  // argsText drives ToolFallback's pretty-printed `ARGS` block. We
  // pass the same JSON in for `result` because the SSE payload IS the
  // tool result for these synthetic tool-calls — keeps ToolFallback's
  // `RESULT` block populated without needing a separate stream.
  const argsText = JSON.stringify(rest, null, 2);
  return {
    type: "tool-call",
    toolCallId: `m${messageIdx}-e${idx}-${event.type}`,
    toolName: event.type,
    args,
    argsText,
    result: args,
  };
}

/**
 * Build a chat-scoped converter. We prefix every message id with the
 * chat id so that switching threads doesn't collide with the runtime's
 * MessageRepository keys (it caches by id; same id with different
 * content across thread switches triggers
 * "Entry not available in the store").
 */
export function makeConvertLukeMessage(
  chatId: string | undefined,
): (message: LukeMessage, idx: number) => ThreadMessageLike {
  const idPrefix = chatId ?? "new";
  return (message, idx) => convertLukeMessage(message, idx, idPrefix);
}

export function convertLukeMessage(
  message: LukeMessage,
  idx: number,
  idPrefix = "new",
): ThreadMessageLike {
  if (message.role === "user") {
    const parts: ContentPart[] = [{ type: "text", text: message.content }];
    const attachments = (message.files ?? [])
      .filter((f) => !!f.document_id)
      .map((f) => {
        const data: LukeDocumentPartData = {
          document_id: f.document_id as string,
          filename: f.filename,
        };
        return {
          id: data.document_id,
          type: "document" as const,
          name: data.filename,
          status: { type: "complete" as const },
          content: [{ type: "data" as const, name: LUKE_DOCUMENT_PART, data }],
        };
      });
    return {
      role: "user",
      content: parts,
      id: `${idPrefix}:u${idx}`,
      ...(attachments.length > 0 ? { attachments } : {}),
    };
  }

  const parts: ContentPart[] = [];
  const events = message.events ?? [];
  for (let i = 0; i < events.length; i++) {
    const part = eventToPart(events[i], i, idx);
    if (part) parts.push(part);
  }
  if (parts.length === 0 && message.content) {
    parts.push({ type: "text", text: message.content });
  }

  const annotations = message.annotations ?? [];
  return {
    role: "assistant",
    content: parts,
    id: `${idPrefix}:a${idx}`,
    status:
      message.error !== undefined
        ? { type: "incomplete", reason: "error", error: message.error }
        : undefined,
    metadata: {
      custom: {
        luke_citations: annotations,
      },
    },
  };
}
