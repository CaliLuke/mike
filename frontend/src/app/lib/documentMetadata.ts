/**
 * Document metadata API client — deferred classifier + library linking.
 * Split out of lukeApi.ts to keep that file under the eslint max-lines cap.
 */

import type {
  LukeApplicationLink,
  LukeDocument,
  LukeDocumentMetadataPatch,
  LukeMetadataQueueAck,
  LukeMetadataQueueStats,
} from "@/app/components/shared/types";

import { apiRequest } from "./lukeApi";

export async function processDocumentMetadata(documentId: string): Promise<LukeMetadataQueueAck> {
  return apiRequest<LukeMetadataQueueAck>(`/single-documents/${documentId}/process-metadata`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({}),
  });
}

export async function processDocumentMetadataBatch(payload: {
  document_ids?: string[];
  filter?: "unprocessed" | "error" | "all";
}): Promise<LukeMetadataQueueAck> {
  return apiRequest<LukeMetadataQueueAck>(`/single-documents/process-metadata`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(payload),
  });
}

export async function getMetadataQueue(): Promise<LukeMetadataQueueStats> {
  return apiRequest<LukeMetadataQueueStats>(`/single-documents/metadata-queue`);
}

export async function patchDocumentMetadata(
  documentId: string,
  patch: LukeDocumentMetadataPatch,
): Promise<LukeDocument> {
  return apiRequest<LukeDocument>(`/single-documents/${documentId}/metadata`, {
    method: "PATCH",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(patch),
  });
}

export async function addDocumentApplicationLink(
  documentId: string,
  applicationId: string,
  relation: "referenced" | "derived_into" = "referenced",
): Promise<LukeApplicationLink> {
  return apiRequest<LukeApplicationLink>(`/single-documents/${documentId}/application-links`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ application_id: applicationId, relation }),
  });
}

export async function deleteDocumentApplicationLink(
  documentId: string,
  applicationId: string,
): Promise<void> {
  await apiRequest<void>(`/single-documents/${documentId}/application-links/${applicationId}`, {
    method: "DELETE",
  });
}
