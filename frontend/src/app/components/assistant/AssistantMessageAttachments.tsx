"use client";

import type { AssistantEvent, LukeEditAnnotation } from "../shared/types";
import { EditCardsSection } from "./AssistantEditBlocks";
import { DocDownloadBlock } from "./DocDownloadBlock";
import { EditCard } from "./EditCard";

type EditResolvedHandler = (args: {
  editId: string;
  documentId: string;
  status: "accepted" | "rejected";
  versionId: string | null;
  downloadUrl: string | null;
}) => void;

export function AssistantEditCards({
  events,
  isStreaming,
  resolvedEditStatuses,
  onEditViewClick,
  onEditResolveStart,
  onEditResolved,
  onEditError,
  isEditReloading,
}: {
  events?: AssistantEvent[];
  isStreaming: boolean;
  resolvedEditStatuses?: Record<string, "accepted" | "rejected">;
  onEditViewClick?: (ann: LukeEditAnnotation, filename: string) => void;
  onEditResolveStart?: (args: {
    editId: string;
    documentId: string;
    verb: "accept" | "reject";
  }) => void;
  onEditResolved: EditResolvedHandler;
  onEditError?: (args: {
    editId: string;
    documentId: string;
    versionId: string | null;
    message: string;
  }) => void;
  isEditReloading?: (editId: string) => boolean;
}) {
  if (!events || isStreaming) return null;

  const editedEvents = events.filter((e) => e.type === "doc_edited" && !e.isStreaming) as Extract<
    AssistantEvent,
    { type: "doc_edited" }
  >[];
  const pending: {
    annotation: LukeEditAnnotation;
    filename: string;
  }[] = [];
  const filenameByDocId = new Map<string, string>();
  const statusOf = (ann: LukeEditAnnotation) => resolvedEditStatuses?.[ann.edit_id] ?? ann.status;

  for (const event of editedEvents) {
    filenameByDocId.set(event.document_id, event.filename);
    for (const annotation of event.annotations) {
      if (statusOf(annotation) === "pending") {
        pending.push({
          annotation,
          filename: event.filename,
        });
      }
    }
  }

  const cards = editedEvents.flatMap((event) =>
    event.annotations.map((annotation) => (
      <EditCard
        key={`editcard-${annotation.edit_id}`}
        annotation={annotation}
        resolvedStatus={resolvedEditStatuses?.[annotation.edit_id]}
        isReloading={isEditReloading?.(annotation.edit_id) ?? false}
        onViewClick={(a) => onEditViewClick?.(a, event.filename)}
        onResolveStart={onEditResolveStart}
        onResolved={onEditResolved}
        onError={onEditError}
      />
    )),
  );
  const resolvedCount = editedEvents.reduce(
    (acc, event) =>
      acc + event.annotations.filter((annotation) => statusOf(annotation) !== "pending").length,
    0,
  );

  if (cards.length <= 1) return cards;

  return (
    <EditCardsSection
      pending={pending}
      filenameByDocId={filenameByDocId}
      cards={cards}
      resolvedCount={resolvedCount}
      onViewClick={onEditViewClick}
      onResolveStart={onEditResolveStart}
      onResolved={onEditResolved}
      onError={onEditError}
    />
  );
}

export function EditedDocumentDownloads({
  events,
  isStreaming,
  resolvedOverrides,
  onOpenDocument,
  onEditViewClick,
  isDocReloading,
}: {
  events?: AssistantEvent[];
  isStreaming: boolean;
  resolvedOverrides: Record<string, string>;
  onOpenDocument?: (args: {
    documentId: string;
    filename: string;
    versionId: string | null;
    versionNumber: number | null;
  }) => void;
  onEditViewClick?: (ann: LukeEditAnnotation, filename: string) => void;
  isDocReloading?: (documentId: string) => boolean;
}) {
  if (!events || isStreaming) return null;

  const edited = events.filter(
    (e): e is Extract<AssistantEvent, { type: "doc_edited" }> =>
      e.type === "doc_edited" && !e.isStreaming && !!e.download_url,
  );
  const latestByDoc = new Map<string, (typeof edited)[number]>();
  for (const event of edited) latestByDoc.set(event.document_id, event);

  return Array.from(latestByDoc.values()).map((event) => (
    <div key={`edited-download-${event.document_id}`} className="mt-2 mb-3 flex flex-col gap-2">
      <DocDownloadBlock
        filename={event.filename}
        download_url={resolvedOverrides[event.document_id] ?? event.download_url}
        versionNumber={event.version_number ?? null}
        onOpen={
          onOpenDocument
            ? () =>
                onOpenDocument({
                  documentId: event.document_id,
                  filename: event.filename,
                  versionId: event.version_id ?? null,
                  versionNumber: event.version_number ?? null,
                })
            : onEditViewClick && event.annotations[0]
              ? () => onEditViewClick(event.annotations[0], event.filename)
              : undefined
        }
        isReloading={isDocReloading?.(event.document_id) ?? false}
      />
    </div>
  ));
}

export function CreatedDocumentDownloads({
  events,
  isStreaming,
  onOpenDocument,
}: {
  events?: AssistantEvent[];
  isStreaming: boolean;
  onOpenDocument?: (args: {
    documentId: string;
    filename: string;
    versionId: string | null;
    versionNumber: number | null;
  }) => void;
}) {
  if (!events || isStreaming) return null;

  const created = events.filter((e) => e.type === "doc_created" && e.download_url) as Extract<
    AssistantEvent,
    { type: "doc_created" }
  >[];
  if (created.length === 0) return null;

  return (
    <div className="mt-2 mb-3 flex flex-col gap-2">
      {created.map((event, i) => {
        const documentId = event.document_id;
        const versionId = event.version_id ?? null;
        const versionNumber = event.version_number ?? null;
        const openDocument =
          onOpenDocument && documentId
            ? () =>
                onOpenDocument({
                  documentId,
                  filename: event.filename,
                  versionId,
                  versionNumber,
                })
            : undefined;
        return (
          <DocDownloadBlock
            key={i}
            filename={event.filename}
            download_url={event.download_url}
            versionNumber={versionNumber}
            onOpen={openDocument}
          />
        );
      })}
    </div>
  );
}
