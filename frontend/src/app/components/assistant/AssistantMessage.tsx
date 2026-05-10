"use client";

import { Check, Copy } from "lucide-react";
import { useRef, useState } from "react";

import { PreResponseWrapper } from "../shared/PreResponseWrapper";
import type { AssistantEvent, LukeCitationAnnotation, LukeEditAnnotation } from "../shared/types";
import {
  ApplicationCreatedBlock,
  CompanyCreatedBlock,
  CompanyMatchWarningBlock,
  DocCreatedBlock,
  DocEditedBlock,
  DocFindBlock,
  DocReadBlock,
  DocReplicatedBlock,
  ReasoningBlock,
  ResponseStatus,
  WebPageFetchedBlock,
  WorkflowAppliedBlock,
} from "./AssistantEventBlocks";
import { MarkdownContent, preprocessCitations } from "./AssistantMarkdownContent";
import {
  AssistantEditCards,
  CreatedDocumentDownloads,
  EditedDocumentDownloads,
} from "./AssistantMessageAttachments";

type StatusState = "active" | "error" | null;

interface Props {
  content: string;
  events?: AssistantEvent[];
  isStreaming?: boolean;
  isError?: boolean;
  /** Human-readable error text rendered alongside the red Luke icon. */
  errorMessage?: string;
  annotations?: LukeCitationAnnotation[];
  onCitationClick?: (citation: LukeCitationAnnotation) => void;
  minHeight?: string;
  onWorkflowClick?: (workflowId: string) => void;
  onEditViewClick?: (ann: LukeEditAnnotation, filename: string) => void;
  /**
   * Opens the editor panel for a document without auto-highlighting any
   * specific edit. Used by the download card click — opening a doc to
   * read/download shouldn't jump the viewer to the first edit.
   */
  onOpenDocument?: (args: {
    documentId: string;
    filename: string;
    versionId: string | null;
    versionNumber: number | null;
  }) => void;
  /**
   * Fires immediately when the user clicks Accept / Reject (single card
   * or the bulk "Accept all" / "Reject all"), before the backend call.
   * Parents use this to flip download cards / editor viewers into a
   * "saving" state for the duration of the round-trip.
   */
  onEditResolveStart?: (args: {
    editId: string;
    documentId: string;
    verb: "accept" | "reject";
  }) => void;
  onEditResolved?: (args: {
    editId: string;
    documentId: string;
    status: "accepted" | "rejected";
    versionId: string | null;
    downloadUrl: string | null;
  }) => void;
  onEditError?: (args: {
    editId: string;
    documentId: string;
    versionId: string | null;
    message: string;
  }) => void;
  isDocReloading?: (documentId: string) => boolean;
  /**
   * True while an accept/reject request for this specific edit is in
   * flight. Used to disable just that edit's Accept/Reject controls
   * (sibling edits on the same doc stay clickable).
   */
  isEditReloading?: (editId: string) => boolean;
  /**
   * External override for individual edit statuses. When present, an
   * EditCard looks up its edit_id here and treats the mapped value
   * ("accepted" / "rejected") as authoritative — used so bulk-resolved
   * edits flip their per-card UI without per-card clicks.
   */
  resolvedEditStatuses?: Record<string, "accepted" | "rejected">;
}

export function AssistantMessage({
  content: _content,
  events,
  isStreaming = false,
  isError = false,
  errorMessage,
  annotations = [],
  onCitationClick,
  minHeight = "0px",
  onWorkflowClick,
  onEditViewClick,
  onOpenDocument,
  onEditResolveStart,
  onEditResolved,
  onEditError,
  isDocReloading,
  isEditReloading,
  resolvedEditStatuses,
}: Props) {
  const contentDivRef = useRef<HTMLDivElement | null>(null);
  const [isCopied, setIsCopied] = useState(false);
  // Per-document override of the download URL, set as Accept/Reject resolves
  // each tracked change and produces a new version.
  const [resolvedOverrides, setResolvedOverrides] = useState<Record<string, string>>({});

  const handleEditResolved = (args: {
    editId: string;
    documentId: string;
    status: "accepted" | "rejected";
    versionId: string | null;
    downloadUrl: string | null;
  }) => {
    if (args.downloadUrl) {
      setResolvedOverrides((prev) => ({
        ...prev,
        [args.documentId]: args.downloadUrl as string,
      }));
    }
    onEditResolved?.(args);
  };

  const status: StatusState = isError ? "error" : isStreaming ? "active" : null;

  // Pre-process citations for all content events. Each [N] marker resolves
  // to exactly one annotation (models are instructed to use shared refs
  // only for cross-page continuations via the [[PAGE_BREAK]] sentinel).
  const citationsList: LukeCitationAnnotation[] = [];
  const processedTexts: string[] = [];
  if (events) {
    for (const event of events) {
      processedTexts.push(
        event.type === "content" ? preprocessCitations(event.text, annotations, citationsList) : "",
      );
    }
  }
  const handleCopy = async () => {
    try {
      let html = "";
      let plainText = "";
      if (contentDivRef.current) {
        const clone = contentDivRef.current.cloneNode(true) as HTMLElement;
        html = clone.innerHTML;
        plainText = clone.textContent || "";
      }
      const item = new ClipboardItem({
        "text/html": new Blob([html], { type: "text/html" }),
        "text/plain": new Blob([plainText], { type: "text/plain" }),
      });
      await navigator.clipboard.write([item]);
      setIsCopied(true);
      setTimeout(() => setIsCopied(false), 2000);
    } catch {
      // ignore
    }
  };

  const lastContentIdx = events
    ? events.reduce((last, e, idx) => (e.type === "content" ? idx : last), -1)
    : -1;

  // Walk events in chronological order and group consecutive non-content
  // events into their own PreResponseWrapper. Content events render
  // between wrappers, so reasoning/tool chatter that arrives after the
  // model has already streamed some prose gets its own wrapper.
  type EventGroup =
    | { kind: "pre"; events: AssistantEvent[]; indices: number[] }
    | {
        kind: "content";
        event: Extract<AssistantEvent, { type: "content" }>;
        index: number;
      };

  const groups: EventGroup[] = [];
  if (events) {
    let current: Extract<EventGroup, { kind: "pre" }> | null = null;
    events.forEach((e, i) => {
      if (e.type === "content") {
        if (current) {
          groups.push(current);
          current = null;
        }
        groups.push({ kind: "content", event: e, index: i });
      } else {
        if (!current) current = { kind: "pre", events: [], indices: [] };
        current.events.push(e);
        current.indices.push(i);
      }
    });
    if (current) groups.push(current);
  }

  const hasContentAfter = (groupIdx: number): boolean => {
    for (let i = groupIdx + 1; i < groups.length; i++) {
      const g = groups[i];
      if (g.kind === "content" && g.event.text.length > 0) return true;
    }
    return false;
  };

  const renderEvent = (
    event: AssistantEvent,
    i: number,
    allEvents: AssistantEvent[],
    globalIdx: number,
  ) => {
    const nextEvent = allEvents[i + 1];
    const showConnector = nextEvent !== undefined && nextEvent.type !== "content";

    if (event.type === "content") {
      const isLastContent = globalIdx === lastContentIdx;
      const processed = processedTexts[globalIdx];
      return (
        <div key={globalIdx}>
          <MarkdownContent
            text={processed}
            citationsList={citationsList}
            onCitationClick={onCitationClick}
            divRef={isLastContent ? contentDivRef : undefined}
          />
        </div>
      );
    }
    if (event.type === "reasoning") {
      return (
        <ReasoningBlock
          key={globalIdx}
          text={event.text}
          isStreaming={!!event.isStreaming}
          showConnector={showConnector}
        />
      );
    }
    if (event.type === "tool_call_start") {
      return (
        <div
          key={globalIdx}
          className="relative flex items-center font-serif text-sm text-gray-500"
        >
          {showConnector && (
            <div className="absolute top-[13px] bottom-0 left-[2.5px] h-[calc(100%+11px)] w-[1px] bg-gray-300" />
          )}
          <div className="h-1.5 w-1.5 shrink-0 animate-spin rounded-full border border-gray-400 border-t-transparent" />
          <span className="ml-2 font-medium">Running</span>
          <span className="ml-1">{event.name ? `${event.name}...` : "tool..."}</span>
        </div>
      );
    }
    if (event.type === "thinking") {
      return (
        <div
          key={globalIdx}
          className="relative flex items-center font-serif text-sm text-gray-500"
        >
          {showConnector && (
            <div className="absolute top-[13px] bottom-0 left-[2.5px] h-[calc(100%+11px)] w-[1px] bg-gray-300" />
          )}
          <div className="h-1.5 w-1.5 shrink-0 animate-spin rounded-full border border-gray-400 border-t-transparent" />
          <span className="ml-2">Thinking...</span>
        </div>
      );
    }
    if (event.type === "doc_read") {
      const ann = annotations.find((a) => a.filename === event.filename);
      return (
        <DocReadBlock
          key={globalIdx}
          filename={event.filename}
          isStreaming={event.isStreaming}
          onClick={
            !event.isStreaming && ann && onCitationClick ? () => onCitationClick(ann) : undefined
          }
          showConnector={showConnector}
        />
      );
    }
    if (event.type === "doc_find") {
      return (
        <DocFindBlock
          key={globalIdx}
          filename={event.filename}
          query={event.query}
          totalMatches={event.total_matches}
          isStreaming={!!event.isStreaming}
          showConnector={showConnector}
        />
      );
    }
    if (event.type === "doc_created") {
      return (
        <DocCreatedBlock
          key={globalIdx}
          filename={event.filename}
          isStreaming={event.isStreaming}
          showConnector={showConnector}
        />
      );
    }
    if (event.type === "doc_replicated") {
      // The backend now does N copies in one tool call and reports
      // count + copies on a single event, so no consecutive-event
      // aggregation needed.
      return (
        <DocReplicatedBlock
          key={globalIdx}
          filename={event.filename}
          count={event.count}
          isStreaming={!!event.isStreaming}
          hasError={!!event.error}
          showConnector={showConnector}
        />
      );
    }
    if (event.type === "doc_edited") {
      return (
        <DocEditedBlock
          key={globalIdx}
          filename={event.filename}
          isStreaming={event.isStreaming}
          hasError={!!event.error}
          showConnector={showConnector}
        />
      );
    }
    if (event.type === "workflow_applied") {
      return (
        <WorkflowAppliedBlock
          key={globalIdx}
          title={event.title}
          showConnector={showConnector}
          onClick={onWorkflowClick ? () => onWorkflowClick(event.workflow_id) : undefined}
        />
      );
    }
    if (event.type === "company_created") {
      return (
        <CompanyCreatedBlock
          key={globalIdx}
          name={event.name}
          reusedExisting={event.reused_existing}
          showConnector={showConnector}
        />
      );
    }
    if (event.type === "company_match_warning") {
      return (
        <CompanyMatchWarningBlock
          key={globalIdx}
          requestedName={event.requested_name}
          similarCompanyName={event.similar_company_name}
          similarity={event.similarity}
          showConnector={showConnector}
        />
      );
    }
    if (event.type === "web_page_fetched") {
      return (
        <WebPageFetchedBlock
          key={globalIdx}
          title={event.title}
          url={event.url}
          showConnector={showConnector}
        />
      );
    }
    if (event.type === "application_created") {
      return (
        <ApplicationCreatedBlock
          key={globalIdx}
          name={event.name}
          savedJobDescription={!!event.job_description_document_id}
          showConnector={showConnector}
        />
      );
    }
    return null;
  };

  return (
    <div style={{ minHeight }}>
      <ResponseStatus status={status} />
      <div className="font-inter relative mt-2 w-full">
        {events && events.length > 0 ? (
          <div className="flex flex-col gap-4">
            {groups.map((g, gIdx) => {
              if (g.kind === "content") {
                const isLastContent = g.index === lastContentIdx;
                return (
                  <div key={`c-${g.index}`}>
                    <MarkdownContent
                      text={processedTexts[g.index]}
                      citationsList={citationsList}
                      onCitationClick={onCitationClick}
                      divRef={isLastContent ? contentDivRef : undefined}
                    />
                  </div>
                );
              }
              const subsequentContent = hasContentAfter(gIdx);
              const wrapperIsStreaming = g.events.some(
                (event) => "isStreaming" in event && !!event.isStreaming,
              );
              return (
                <PreResponseWrapper
                  key={`p-${g.indices[0]}`}
                  stepCount={g.events.length}
                  shouldMinimize={subsequentContent}
                  isStreaming={wrapperIsStreaming}
                >
                  {g.events.map((event, i) => renderEvent(event, i, g.events, g.indices[i]))}
                </PreResponseWrapper>
              );
            })}
            <AssistantEditCards
              events={events}
              isStreaming={isStreaming}
              resolvedEditStatuses={resolvedEditStatuses}
              onEditViewClick={onEditViewClick}
              onEditResolveStart={onEditResolveStart}
              onEditResolved={handleEditResolved}
              onEditError={onEditError}
              isEditReloading={isEditReloading}
            />
          </div>
        ) : null}

        {isError && (
          <div className="mt-2 flex items-start gap-2 rounded-lg border border-red-200 bg-red-50 px-3 py-2 font-serif text-sm text-red-700">
            <span className="leading-snug">{errorMessage ?? "Sorry, something went wrong."}</span>
          </div>
        )}

        <EditedDocumentDownloads
          events={events}
          isStreaming={isStreaming}
          resolvedOverrides={resolvedOverrides}
          onOpenDocument={onOpenDocument}
          onEditViewClick={onEditViewClick}
          isDocReloading={isDocReloading}
        />
        <CreatedDocumentDownloads
          events={events}
          isStreaming={isStreaming}
          onOpenDocument={onOpenDocument}
        />

        {/* Copy button */}
        <div className="flex items-center justify-start gap-2 pt-2 pb-4 font-sans md:pb-8">
          {!isStreaming && (
            <button
              className="rounded p-1.5 text-gray-500 hover:bg-gray-100 hover:text-gray-700"
              onClick={handleCopy}
            >
              {isCopied ? (
                <Check className="h-3.5 w-3.5 text-green-600" />
              ) : (
                <Copy className="h-3.5 w-3.5" />
              )}
            </button>
          )}
        </div>
      </div>
    </div>
  );
}
