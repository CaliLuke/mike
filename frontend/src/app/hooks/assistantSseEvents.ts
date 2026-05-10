import type {
  AssistantEvent,
  LukeCitationAnnotation,
  LukeEditAnnotation,
} from "@/app/components/shared/types";

type SseData = Record<string, unknown>;

export interface AssistantSseEventHandlers {
  setChatId: (chatId: string) => void;
  setCurrentChatId: (chatId: string) => void;
  setIsLoadingCitations: (loading: boolean) => void;
  startContentDelta: (text: string) => void;
  appendReasoningDelta: (text: string) => void;
  endReasoningBlock: () => void;
  clearStreamingPlaceholders: () => void;
  pushThinkingPlaceholder: () => void;
  pushEvent: (event: AssistantEvent) => void;
  updateMatchingEvent: (
    predicate: (event: AssistantEvent) => boolean,
    updater: (event: AssistantEvent) => AssistantEvent,
  ) => void;
  setCitations: (citations: LukeCitationAnnotation[]) => void;
}

export function handleAssistantSseEvent(
  data: SseData,
  handlers: AssistantSseEventHandlers,
): string | null {
  if (data.type === "chat_id") {
    const chatId = data.chatId as string;
    handlers.setChatId(chatId);
    handlers.setCurrentChatId(chatId);
    return chatId;
  }

  if (data.type === "content_done") {
    handlers.setIsLoadingCitations(true);
    return null;
  }

  if (data.type === "content_delta") {
    handlers.startContentDelta(data.text as string);
    return null;
  }

  if (data.type === "reasoning_delta") {
    handlers.appendReasoningDelta(data.text as string);
    return null;
  }

  if (data.type === "reasoning_block_end") {
    handlers.endReasoningBlock();
    handlers.pushThinkingPlaceholder();
    return null;
  }

  if (data.type === "tool_call_start") {
    handlers.pushEvent({
      type: "tool_call_start",
      name: (data.name as string) ?? "",
      isStreaming: true,
    });
    return null;
  }

  if (data.type === "workflow_applied") {
    handlers.pushEvent({
      type: "workflow_applied",
      workflow_id: data.workflow_id as string,
      title: data.title as string,
    });
    return null;
  }

  if (data.type === "web_page_fetched") {
    handlers.pushEvent({
      type: "web_page_fetched",
      url: data.url as string,
      title: typeof data.title === "string" ? (data.title as string) : undefined,
    });
    handlers.pushThinkingPlaceholder();
    return null;
  }

  if (data.type === "company_created") {
    handlers.pushEvent({
      type: "company_created",
      company_id: data.company_id as string,
      name: data.name as string,
      reused_existing:
        typeof data.reused_existing === "boolean" ? (data.reused_existing as boolean) : undefined,
    });
    handlers.pushThinkingPlaceholder();
    return null;
  }

  if (data.type === "company_match_warning") {
    handlers.pushEvent({
      type: "company_match_warning",
      requested_name: data.requested_name as string,
      similar_company_id: data.similar_company_id as string,
      similar_company_name: data.similar_company_name as string,
      similarity: typeof data.similarity === "number" ? (data.similarity as number) : undefined,
    });
    handlers.pushThinkingPlaceholder();
    return null;
  }

  if (data.type === "application_created") {
    handlers.pushEvent({
      type: "application_created",
      application_id: data.application_id as string,
      company_id: data.company_id as string,
      name: data.name as string,
      job_description_document_id:
        typeof data.job_description_document_id === "string"
          ? (data.job_description_document_id as string)
          : undefined,
    });
    handlers.pushThinkingPlaceholder();
    return null;
  }

  if (data.type === "doc_read_start") {
    handlers.pushEvent({
      type: "doc_read",
      filename: data.filename as string,
      isStreaming: true,
    });
    return null;
  }

  if (data.type === "doc_read") {
    handlers.updateMatchingEvent(
      (event) =>
        event.type === "doc_read" && event.filename === data.filename && !!event.isStreaming,
      (event) => ({ ...event, isStreaming: false }),
    );
    handlers.pushThinkingPlaceholder();
    return null;
  }

  if (data.type === "doc_find_start") {
    handlers.pushEvent({
      type: "doc_find",
      filename: data.filename as string,
      query: (data.query as string) ?? "",
      total_matches: 0,
      isStreaming: true,
    });
    return null;
  }

  if (data.type === "doc_find") {
    handlers.updateMatchingEvent(
      (event) =>
        event.type === "doc_find" &&
        event.filename === data.filename &&
        event.query === (data.query as string) &&
        !!event.isStreaming,
      (event) => ({
        ...event,
        isStreaming: false,
        total_matches:
          typeof data.total_matches === "number"
            ? (data.total_matches as number)
            : (event as { type: "doc_find"; total_matches: number }).total_matches,
      }),
    );
    handlers.pushThinkingPlaceholder();
    return null;
  }

  if (data.type === "doc_created_start") {
    handlers.pushEvent({
      type: "doc_created",
      filename: data.filename as string,
      download_url: "",
      isStreaming: true,
    });
    return null;
  }

  if (data.type === "doc_download") {
    handlers.pushEvent({
      type: "doc_download",
      filename: data.filename as string,
      download_url: data.download_url as string,
    });
    return null;
  }

  if (data.type === "doc_created") {
    handlers.updateMatchingEvent(
      (event) =>
        event.type === "doc_created" && event.filename === data.filename && !!event.isStreaming,
      (event) => {
        const next: Extract<AssistantEvent, { type: "doc_created" }> = {
          type: "doc_created",
          filename: (event as { filename: string }).filename,
          download_url: data.download_url as string,
          isStreaming: false,
        };
        if (typeof data.document_id === "string") next.document_id = data.document_id as string;
        if (typeof data.version_id === "string") next.version_id = data.version_id as string;
        if (typeof data.version_number === "number") {
          next.version_number = data.version_number as number;
        }
        return next;
      },
    );
    handlers.pushThinkingPlaceholder();
    return null;
  }

  if (data.type === "doc_replicate_start") {
    handlers.pushEvent({
      type: "doc_replicated",
      filename: data.filename as string,
      count: typeof data.count === "number" ? (data.count as number) : 1,
      isStreaming: true,
    });
    return null;
  }

  if (data.type === "doc_replicated") {
    handlers.updateMatchingEvent(
      (event) =>
        event.type === "doc_replicated" && event.filename === data.filename && !!event.isStreaming,
      () => ({
        type: "doc_replicated",
        filename: data.filename as string,
        count:
          typeof data.count === "number"
            ? (data.count as number)
            : Array.isArray(data.copies)
              ? (data.copies as unknown[]).length
              : 1,
        copies: Array.isArray(data.copies)
          ? (data.copies as {
              new_filename: string;
              document_id: string;
              version_id: string;
            }[])
          : undefined,
        error: typeof data.error === "string" ? (data.error as string) : undefined,
        isStreaming: false,
      }),
    );
    handlers.pushThinkingPlaceholder();
    return null;
  }

  if (data.type === "doc_edited_start") {
    handlers.pushEvent({
      type: "doc_edited",
      filename: data.filename as string,
      document_id: "",
      version_id: "",
      download_url: "",
      annotations: [],
      isStreaming: true,
    });
    return null;
  }

  if (data.type === "doc_edited") {
    handlers.updateMatchingEvent(
      (event) =>
        event.type === "doc_edited" && event.filename === data.filename && !!event.isStreaming,
      () => ({
        type: "doc_edited",
        filename: data.filename as string,
        document_id: (data.document_id as string) ?? "",
        version_id: (data.version_id as string) ?? "",
        version_number:
          typeof data.version_number === "number" ? (data.version_number as number) : null,
        download_url: (data.download_url as string) ?? "",
        annotations: Array.isArray(data.annotations)
          ? (data.annotations as LukeEditAnnotation[])
          : [],
        error: typeof data.error === "string" ? (data.error as string) : undefined,
        isStreaming: false,
      }),
    );
    handlers.pushThinkingPlaceholder();
    return null;
  }

  if (data.type === "citations") {
    handlers.clearStreamingPlaceholders();
    handlers.setCitations((data.citations ?? []) as LukeCitationAnnotation[]);
  }

  return null;
}
