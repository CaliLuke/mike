import type { AssistantEvent, LukeMessage } from "@/app/components/shared/types";

export function findLastContentIndex(events: AssistantEvent[]): number {
  for (let i = events.length - 1; i >= 0; i--) {
    if (events[i].type === "content") return i;
  }
  return -1;
}

export function appendCancelledAssistantMessage(prev: LukeMessage[]): LukeMessage[] {
  const last = prev[prev.length - 1];
  const cancelText = "Cancelled by user";
  if (last?.role === "assistant") {
    const updated = [...prev];
    const events = last.events ?? [];
    const idx = findLastContentIndex(events);
    if (idx >= 0) {
      const newEvents = [...events];
      const existing = newEvents[idx] as {
        type: "content";
        text: string;
      };
      newEvents[idx] = {
        type: "content",
        text: existing.text ? `${existing.text}\n\n${cancelText}` : cancelText,
      };
      updated[updated.length - 1] = {
        ...last,
        events: newEvents,
      };
    } else {
      updated[updated.length - 1] = {
        ...last,
        events: [...events, { type: "content", text: cancelText }],
      };
    }
    return updated;
  }
  return [
    ...prev,
    {
      role: "assistant",
      content: "",
      events: [{ type: "content", text: cancelText }],
    },
  ];
}

export function appendErroredAssistantMessage(
  prev: LukeMessage[],
  errorMessage: string,
): LukeMessage[] {
  const last = prev[prev.length - 1];
  if (last?.role === "assistant") {
    const updated = [...prev];
    updated[updated.length - 1] = {
      ...last,
      error: errorMessage,
    };
    return updated;
  }
  return [
    ...prev,
    {
      role: "assistant",
      content: "",
      error: errorMessage,
    },
  ];
}
