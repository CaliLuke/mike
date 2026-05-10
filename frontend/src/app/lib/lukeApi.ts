/**
 * Luke API client — all requests to the local backend.
 */

import type {
  AssistantEvent,
  LukeApplication,
  LukeChat,
  LukeChatDetailOut,
  LukeCitationAnnotation,
  LukeCompany,
  LukeDocument,
  LukeFolder,
  LukeMessage,
  LukeWorkflow,
  TabularReview,
  TabularReviewDetailOut,
} from "@/app/components/shared/types";

// Server-side shape before mapping
interface ServerMessage {
  id: string;
  chat_id: string;
  role: "user" | "assistant";
  content: string | AssistantEvent[] | null;
  files?: { filename: string; document_id?: string }[] | null;
  workflow?: { id: string; title: string } | null;
  annotations?: LukeCitationAnnotation[] | null;
  created_at: string;
}
interface ServerChatDetailOut {
  chat: LukeChat;
  messages: ServerMessage[];
}

export const API_BASE = process.env.NEXT_PUBLIC_API_BASE_URL ?? "http://localhost:3001";

export async function apiRequest<T>(path: string, init?: RequestInit): Promise<T> {
  const { headers: initHeaders, ...restInit } = init ?? {};
  const response = await fetch(`${API_BASE}${path}`, {
    cache: "no-store",
    ...restInit,
    headers: {
      Accept: "application/json",
      ...(initHeaders as Record<string, string> | undefined),
    },
  });

  if (!response.ok) {
    const detail = await response.text();
    throw new Error(detail || `API error: ${response.status}`);
  }

  if (response.status === 204 || response.headers.get("content-length") === "0") {
    return undefined as T;
  }

  return (await response.json()) as T;
}

// ---------------------------------------------------------------------------
// Companies
// ---------------------------------------------------------------------------

export async function listCompanies(): Promise<LukeCompany[]> {
  return apiRequest<LukeCompany[]>("/companies");
}

export async function createCompany(name: string, website?: string): Promise<LukeCompany> {
  return apiRequest<LukeCompany>("/companies", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ name, website }),
  });
}

export async function updateCompany(
  companyId: string,
  payload: { name?: string; website?: string },
): Promise<LukeCompany> {
  return apiRequest<LukeCompany>(`/companies/${companyId}`, {
    method: "PATCH",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(payload),
  });
}

export async function deleteCompany(companyId: string): Promise<void> {
  await apiRequest(`/companies/${companyId}`, { method: "DELETE" });
}

// ---------------------------------------------------------------------------
// Applications
// ---------------------------------------------------------------------------

export async function listApplications(): Promise<LukeApplication[]> {
  return apiRequest<LukeApplication[]>("/applications");
}

export async function createApplication(
  name: string,
  companyId: string,
  cm_number?: string,
): Promise<LukeApplication> {
  return apiRequest<LukeApplication>("/applications", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ name, company_id: companyId, cm_number }),
  });
}

export async function deleteAccount(): Promise<void> {
  return apiRequest<void>("/user/account", { method: "DELETE" });
}

export async function getApplication(applicationId: string): Promise<LukeApplication> {
  return apiRequest<LukeApplication>(`/applications/${applicationId}`);
}

export async function updateApplication(
  applicationId: string,
  payload: {
    name?: string;
    company_id?: string;
    cm_number?: string;
    shared_with?: string[];
  },
): Promise<LukeApplication> {
  return apiRequest<LukeApplication>(`/applications/${applicationId}`, {
    method: "PATCH",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(payload),
  });
}

export async function deleteApplication(applicationId: string): Promise<void> {
  await apiRequest(`/applications/${applicationId}`, { method: "DELETE" });
}

export interface ApplicationPeople {
  owner: {
    email: string;
    display_name: string | null;
  };
  members: {
    email: string;
    display_name: string | null;
  }[];
}

export async function getApplicationPeople(applicationId: string): Promise<ApplicationPeople> {
  return apiRequest<ApplicationPeople>(`/applications/${applicationId}/people`);
}

// ---------------------------------------------------------------------------
// Documents
// ---------------------------------------------------------------------------

// ---------------------------------------------------------------------------
// Folders
// ---------------------------------------------------------------------------

export async function createApplicationFolder(
  applicationId: string,
  name: string,
  parentFolderId?: string | null,
): Promise<LukeFolder> {
  return apiRequest<LukeFolder>(`/applications/${applicationId}/folders`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      name,
      parent_folder_id: parentFolderId ?? null,
    }),
  });
}

export async function renameApplicationFolder(
  applicationId: string,
  folderId: string,
  name: string,
): Promise<LukeFolder> {
  return apiRequest<LukeFolder>(`/applications/${applicationId}/folders/${folderId}`, {
    method: "PATCH",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ name }),
  });
}

export async function deleteApplicationFolder(
  applicationId: string,
  folderId: string,
): Promise<void> {
  await apiRequest(`/applications/${applicationId}/folders/${folderId}`, {
    method: "DELETE",
  });
}

export async function moveSubfolderToFolder(
  applicationId: string,
  folderId: string,
  parentFolderId: string | null,
): Promise<LukeFolder> {
  return apiRequest<LukeFolder>(`/applications/${applicationId}/folders/${folderId}`, {
    method: "PATCH",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ parent_folder_id: parentFolderId }),
  });
}

export async function moveDocumentToFolder(
  applicationId: string,
  documentId: string,
  folderId: string | null,
): Promise<LukeDocument> {
  return apiRequest<LukeDocument>(`/applications/${applicationId}/documents/${documentId}/folder`, {
    method: "PATCH",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ folder_id: folderId }),
  });
}

export async function addDocumentToApplication(
  applicationId: string,
  documentId: string,
): Promise<LukeDocument> {
  return apiRequest<LukeDocument>(`/applications/${applicationId}/documents/${documentId}`, {
    method: "POST",
  });
}

export interface LukeDocumentVersion {
  id: string;
  version_number: number | null;
  source: string;
  created_at: string;
  display_name: string | null;
}

export async function listDocumentVersions(documentId: string): Promise<{
  current_version_id: string | null;
  versions: LukeDocumentVersion[];
}> {
  return apiRequest(`/single-documents/${documentId}/versions`);
}

export async function uploadDocumentVersion(
  documentId: string,
  file: File,
  displayName?: string,
): Promise<LukeDocumentVersion> {
  const form = new FormData();
  form.append("file", file);
  if (displayName) form.append("display_name", displayName);
  const response = await fetch(`${API_BASE}/single-documents/${documentId}/versions`, {
    method: "POST",
    body: form,
  });
  if (!response.ok) throw new Error(await response.text());
  return response.json() as Promise<LukeDocumentVersion>;
}

export async function renameDocumentVersion(
  documentId: string,
  versionId: string,
  displayName: string | null,
): Promise<LukeDocumentVersion> {
  return apiRequest<LukeDocumentVersion>(`/single-documents/${documentId}/versions/${versionId}`, {
    method: "PATCH",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ display_name: displayName }),
  });
}

export async function uploadApplicationDocument(
  applicationId: string,
  file: File,
): Promise<LukeDocument> {
  const form = new FormData();
  form.append("file", file);
  const response = await fetch(`${API_BASE}/applications/${applicationId}/documents`, {
    method: "POST",
    body: form,
  });
  if (!response.ok) throw new Error(await response.text());
  return response.json() as Promise<LukeDocument>;
}

export async function uploadStandaloneDocument(file: File): Promise<LukeDocument> {
  const form = new FormData();
  form.append("file", file);
  const response = await fetch(`${API_BASE}/single-documents`, {
    method: "POST",
    body: form,
  });
  if (!response.ok) throw new Error(await response.text());
  return response.json() as Promise<LukeDocument>;
}

export async function listStandaloneDocuments(): Promise<LukeDocument[]> {
  return apiRequest<LukeDocument[]>("/single-documents");
}

export async function deleteDocument(documentId: string): Promise<void> {
  await apiRequest(`/single-documents/${documentId}`, { method: "DELETE" });
}

export async function getDocumentUrl(
  documentId: string,
  versionId?: string | null,
): Promise<{ url: string; filename: string; version_id: string | null }> {
  const qs = versionId ? `?version_id=${encodeURIComponent(versionId)}` : "";
  return apiRequest(`/single-documents/${documentId}/url${qs}`);
}

export async function downloadDocumentsZip(documentIds: string[]): Promise<Blob> {
  const response = await fetch(`${API_BASE}/single-documents/download-zip`, {
    method: "POST",
    cache: "no-store",
    headers: {
      "Content-Type": "application/json",
    },
    body: JSON.stringify({ document_ids: documentIds }),
  });
  if (!response.ok) {
    const detail = await response.text();
    throw new Error(detail || `API error: ${response.status}`);
  }
  return response.blob();
}

// ---------------------------------------------------------------------------
// Chat
// ---------------------------------------------------------------------------

export async function createChat(payload?: { application_id?: string }): Promise<{ id: string }> {
  return apiRequest<{ id: string }>("/chat/create", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(payload ?? {}),
  });
}

export async function listChats(): Promise<LukeChat[]> {
  return apiRequest<LukeChat[]>("/chat");
}

export async function listApplicationChats(applicationId: string): Promise<LukeChat[]> {
  return apiRequest<LukeChat[]>(`/applications/${applicationId}/chats`);
}

export async function getChat(chatId: string): Promise<LukeChatDetailOut> {
  const raw = await apiRequest<ServerChatDetailOut>(`/chat/${chatId}`);
  const messages: LukeMessage[] = raw.messages.map((m) => {
    if (m.role === "user") {
      return {
        role: "user",
        content: typeof m.content === "string" ? m.content : "",
        files: m.files ?? undefined,
        workflow: m.workflow ?? undefined,
      };
    }
    const events = Array.isArray(m.content) ? (m.content as AssistantEvent[]) : undefined;
    return {
      role: "assistant",
      content:
        events
          ?.filter((e) => e.type === "content")
          .map((e) => (e as { type: "content"; text: string }).text)
          .join("") ?? "",
      annotations: m.annotations ?? undefined,
      events,
    };
  });
  return { chat: raw.chat, messages };
}

export async function renameChat(chatId: string, title: string): Promise<void> {
  await apiRequest(`/chat/${chatId}`, {
    method: "PATCH",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ title }),
  });
}

export async function deleteChat(chatId: string): Promise<void> {
  await apiRequest(`/chat/${chatId}`, { method: "DELETE" });
}

export async function generateChatTitle(
  chatId: string,
  message: string,
): Promise<{ title: string }> {
  return apiRequest<{ title: string }>(`/chat/${chatId}/generate-title`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ message }),
  });
}

export async function streamChat(payload: {
  messages: {
    role: string;
    content: string;
    files?: { filename: string; document_id?: string }[];
    workflow?: { id: string; title: string };
  }[];
  chat_id?: string;
  application_id?: string;
  model?: string;
  signal?: AbortSignal;
}): Promise<Response> {
  const { signal, ...body } = payload;
  return fetch(`${API_BASE}/chat`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Accept: "text/event-stream",
    },
    body: JSON.stringify(body),
    signal,
  });
}

type StreamChatMessage = {
  role: string;
  content: string;
  files?: { filename: string; document_id?: string }[];
  workflow?: { id: string; title: string };
};

export async function streamApplicationChat(payload: {
  applicationId: string;
  messages: StreamChatMessage[];
  chat_id?: string;
  model?: string;
  displayed_doc?: { filename: string; document_id: string };
  attached_documents?: { filename: string; document_id: string }[];
  signal?: AbortSignal;
}): Promise<Response> {
  const { applicationId, signal, ...body } = payload;
  return fetch(`${API_BASE}/applications/${applicationId}/chat`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Accept: "text/event-stream",
    },
    body: JSON.stringify(body),
    signal,
  });
}

// ---------------------------------------------------------------------------
// Tabular Review
// ---------------------------------------------------------------------------

export async function listTabularReviews(applicationId?: string): Promise<TabularReview[]> {
  const qs = applicationId ? `?application_id=${encodeURIComponent(applicationId)}` : "";
  return apiRequest<TabularReview[]>(`/tabular-review${qs}`);
}

export async function createTabularReview(payload: {
  title?: string;
  document_ids: string[];
  columns_config: { index: number; name: string; prompt: string }[];
  workflow_id?: string;
  application_id?: string;
}): Promise<TabularReview> {
  return apiRequest<TabularReview>("/tabular-review", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(payload),
  });
}

export async function getTabularReview(reviewId: string): Promise<TabularReviewDetailOut> {
  return apiRequest<TabularReviewDetailOut>(`/tabular-review/${reviewId}`);
}

export async function updateTabularReview(
  reviewId: string,
  payload: {
    title?: string;
    columns_config?: { index: number; name: string; prompt: string }[];
    document_ids?: string[];
    application_id?: string | null;
  },
): Promise<TabularReview> {
  return apiRequest<TabularReview>(`/tabular-review/${reviewId}`, {
    method: "PATCH",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(payload),
  });
}

export async function generateTabularColumnPrompt(
  title: string,
  options?: { format?: string; documentName?: string; tags?: string[] },
): Promise<{ prompt: string; source: "preset" | "llm" | "fallback" }> {
  return apiRequest<{
    prompt: string;
    source: "preset" | "llm" | "fallback";
  }>("/tabular-review/prompt", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      title,
      format: options?.format,
      documentName: options?.documentName,
      tags: options?.tags,
    }),
  });
}

export async function uploadReviewDocument(
  reviewId: string,
  file: File,
  options?: {
    applicationId?: string;
    documentIds?: string[];
    columnsConfig?: { index: number; name: string; prompt: string }[];
  },
): Promise<LukeDocument> {
  const uploaded = options?.applicationId
    ? await uploadApplicationDocument(options.applicationId, file)
    : await uploadStandaloneDocument(file);

  await updateTabularReview(reviewId, {
    columns_config: options?.columnsConfig,
    document_ids: [...(options?.documentIds ?? []), uploaded.id],
  });

  return uploaded;
}

export async function deleteTabularReview(reviewId: string): Promise<void> {
  await apiRequest(`/tabular-review/${reviewId}`, { method: "DELETE" });
}

export async function streamTabularGeneration(
  reviewId: string,
  documentIds: string[],
  columnIndices: number[],
): Promise<Response> {
  return fetch(`${API_BASE}/tabular-review/${reviewId}/generate`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      document_ids: documentIds,
      column_indices: columnIndices,
    }),
  });
}

export async function streamTabularChat(
  reviewId: string,
  messages: { role: string; content: string }[],
  chat_id?: string | null,
  signal?: AbortSignal,
  context?: { reviewTitle?: string | null; applicationName?: string | null },
): Promise<Response> {
  return fetch(`${API_BASE}/tabular-review/${reviewId}/chat`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      messages,
      chat_id: chat_id ?? undefined,
      review_title: context?.reviewTitle ?? undefined,
      application_name: context?.applicationName ?? undefined,
    }),
    signal: signal ?? undefined,
  });
}

export interface TRCitationAnnotation {
  type: "tabular_citation";
  ref: number;
  col_index: number;
  row_index: number;
  col_name: string;
  doc_name: string;
  quote: string;
}

interface RawTRMessage {
  id: string;
  chat_id: string;
  role: "user" | "assistant";
  content: string | AssistantEvent[] | null;
  annotations?: TRCitationAnnotation[] | null;
  created_at: string;
}

export interface TRDisplayMessage {
  role: "user" | "assistant";
  content: string;
  events?: AssistantEvent[];
  annotations?: TRCitationAnnotation[];
}

export interface TRChat {
  id: string;
  title: string | null;
  created_at: string;
  updated_at: string;
}

export function mapTRMessages(raw: RawTRMessage[]): TRDisplayMessage[] {
  return raw.map((m) => {
    if (m.role === "user") {
      return {
        role: "user" as const,
        content: typeof m.content === "string" ? m.content : "",
      };
    }
    const events = Array.isArray(m.content) ? (m.content as AssistantEvent[]) : undefined;
    const content =
      events
        ?.filter((e) => e.type === "content")
        .map((e) => (e as { type: "content"; text: string }).text)
        .join("") ?? "";
    return {
      role: "assistant" as const,
      content,
      events,
      annotations: m.annotations ?? undefined,
    };
  });
}

export async function getTabularChats(reviewId: string): Promise<TRChat[]> {
  return apiRequest<TRChat[]>(`/tabular-review/${reviewId}/chats`);
}

export async function getTabularChatMessages(
  reviewId: string,
  chatId: string,
): Promise<RawTRMessage[]> {
  return apiRequest<RawTRMessage[]>(`/tabular-review/${reviewId}/chats/${chatId}/messages`);
}

export async function deleteTabularChat(reviewId: string, chatId: string): Promise<void> {
  await apiRequest(`/tabular-review/${reviewId}/chats/${chatId}`, {
    method: "DELETE",
  });
}

export async function regenerateTabularCell(
  reviewId: string,
  documentId: string,
  columnIndex: number,
): Promise<{
  summary: string;
  flag: "green" | "grey" | "yellow" | "red";
  reasoning: string;
}> {
  return apiRequest(`/tabular-review/${reviewId}/regenerate-cell`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      document_id: documentId,
      column_index: columnIndex,
    }),
  });
}

export async function clearTabularCells(reviewId: string, documentIds: string[]): Promise<void> {
  await apiRequest(`/tabular-review/${reviewId}/clear-cells`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ document_ids: documentIds }),
  });
}

// ---------------------------------------------------------------------------
// Workflows
// ---------------------------------------------------------------------------

type WorkflowType = LukeWorkflow["type"];

export async function listWorkflows(type: WorkflowType): Promise<LukeWorkflow[]> {
  return apiRequest<LukeWorkflow[]>(`/workflows?type=${type}`);
}

export async function getWorkflow(workflowId: string): Promise<LukeWorkflow> {
  return apiRequest<LukeWorkflow>(`/workflows/${workflowId}`);
}

export async function createWorkflow(payload: {
  title: string;
  type: "assistant" | "tabular";
  prompt_md?: string;
  columns_config?: { index: number; name: string; prompt: string }[];
  practice?: string | null;
}): Promise<LukeWorkflow> {
  return apiRequest<LukeWorkflow>("/workflows", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(payload),
  });
}

export async function updateWorkflow(
  workflowId: string,
  payload: {
    title?: string;
    prompt_md?: string;
    columns_config?: { index: number; name: string; prompt: string }[];
    practice?: string | null;
  },
): Promise<LukeWorkflow> {
  return apiRequest<LukeWorkflow>(`/workflows/${workflowId}`, {
    method: "PATCH",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(payload),
  });
}

export async function deleteWorkflow(workflowId: string): Promise<void> {
  await apiRequest(`/workflows/${workflowId}`, { method: "DELETE" });
}

export async function listHiddenWorkflows(): Promise<string[]> {
  return apiRequest<string[]>("/workflows/hidden");
}

export async function hideWorkflow(workflowId: string): Promise<void> {
  await apiRequest("/workflows/hidden", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ workflow_id: workflowId }),
  });
}

export async function unhideWorkflow(workflowId: string): Promise<void> {
  await apiRequest(`/workflows/hidden/${workflowId}`, { method: "DELETE" });
}

export async function shareWorkflow(
  workflowId: string,
  payload: { emails: string[]; allow_edit: boolean },
): Promise<void> {
  await apiRequest<void>(`/workflows/${workflowId}/share`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(payload),
  });
}

export async function listWorkflowShares(workflowId: string): Promise<
  {
    id: string;
    shared_with_email: string;
    allow_edit: boolean;
    created_at: string;
  }[]
> {
  return apiRequest(`/workflows/${workflowId}/shares`);
}

export async function deleteWorkflowShare(workflowId: string, shareId: string): Promise<void> {
  await apiRequest(`/workflows/${workflowId}/shares/${shareId}`, {
    method: "DELETE",
  });
}
