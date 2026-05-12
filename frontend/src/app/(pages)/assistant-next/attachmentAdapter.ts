import type { AttachmentAdapter, CompleteAttachment, PendingAttachment } from "@assistant-ui/react";

import type { LukeDocument } from "@/app/components/shared/types";
import { uploadStandaloneDocument } from "@/app/lib/lukeApi";

import { aniEvent, aniWrap } from "./observability";

/**
 * Data part name we use to stash the uploaded LukeDocument on a
 * CompleteAttachment. Read in onNew to convert assistant-ui attachments
 * back into LukeMessage.files entries.
 */
export const LUKE_DOCUMENT_PART = "luke-document";

export type LukeDocumentPartData = {
  document_id: string;
  filename: string;
};

const ACCEPT = [
  "application/pdf",
  "application/msword",
  "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
  "text/plain",
  "text/markdown",
  ".pdf",
  ".doc",
  ".docx",
  ".txt",
  ".md",
].join(",");

/**
 * Uploads dropped/picked files via the standalone-document API and
 * carries the resulting document_id through to onNew via a data
 * message part on each CompleteAttachment.
 *
 * The upload happens inside `add` so the user sees a pending tile
 * immediately; `send` just lifts the resolved state into a
 * CompleteAttachment.
 */
export const lukeAttachmentAdapter: AttachmentAdapter = {
  accept: ACCEPT,

  async add({ file }): Promise<PendingAttachment> {
    return aniWrap(
      "attachment.add",
      {
        "file.name": file.name,
        "file.size": file.size,
        "file.type": file.type || "application/octet-stream",
      },
      async (span) => {
        const doc: LukeDocument = await uploadStandaloneDocument(file);
        span.setAttribute("document.id", doc.id);
        const data: LukeDocumentPartData = {
          document_id: doc.id,
          filename: doc.filename ?? file.name,
        };
        return {
          id: doc.id,
          type: "document",
          name: data.filename,
          contentType: file.type || "application/octet-stream",
          file,
          content: [{ type: "data", name: LUKE_DOCUMENT_PART, data }],
          status: { type: "requires-action", reason: "composer-send" },
        };
      },
    );
  },

  async send(attachment): Promise<CompleteAttachment> {
    aniEvent("attachment.send", {
      "attachment.id": attachment.id,
      "attachment.type": attachment.type,
      "attachment.name": attachment.name,
    });
    return {
      id: attachment.id,
      type: attachment.type,
      name: attachment.name,
      contentType: attachment.contentType,
      content: attachment.content ?? [],
      status: { type: "complete" },
    };
  },

  async remove(attachment): Promise<void> {
    // Uploaded docs persist in the user's library — same as the old
    // ChatInput, removing a pending chip only drops the local
    // attachment, not the underlying document.
    aniEvent("attachment.remove", { "attachment.id": attachment.id });
  },
};

/**
 * Pull document_ids out of an AppendMessage's attachments so onNew can
 * build the LukeMessage.files array.
 */
export function attachmentsToLukeFiles(
  attachments: readonly CompleteAttachment[] | undefined,
): LukeDocumentPartData[] {
  if (!attachments?.length) return [];
  const out: LukeDocumentPartData[] = [];
  for (const att of attachments) {
    for (const part of att.content ?? []) {
      if (part.type === "data" && part.name === LUKE_DOCUMENT_PART) {
        const data = part.data as LukeDocumentPartData | undefined;
        if (data?.document_id && data.filename) out.push(data);
      }
    }
  }
  return out;
}
