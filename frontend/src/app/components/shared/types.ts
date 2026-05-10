// Shared TypeScript types for Luke AI legal assistant

export interface LukeFolder {
  id: string;
  application_id: string;
  user_id: string;
  name: string;
  parent_folder_id: string | null;
  created_at: string;
  updated_at: string;
}

export interface LukeApplication {
  id: string;
  user_id: string;
  is_owner?: boolean;
  company_id: string;
  company_name?: string | null;
  name: string;
  cm_number: string | null;
  shared_with?: string[];
  created_at: string;
  updated_at: string;
  documents?: LukeDocument[];
  folders?: LukeFolder[];
  document_count?: number;
  chat_count?: number;
  review_count?: number;
}

export interface LukeCompany {
  id: string;
  user_id: string;
  name: string;
  website: string | null;
  created_at: string;
  updated_at: string;
  application_count?: number;
}

export interface LukeDocument {
  id: string;
  user_id?: string;
  application_id: string | null;
  folder_id?: string | null;
  filename: string;
  file_type: string | null; // pdf | docx | doc | md | markdown | txt
  storage_path: string | null;
  pdf_storage_path: string | null;
  size_bytes: number | null;
  page_count: number | null;
  structure_tree: StructureNode[] | null;
  status: "pending" | "processing" | "ready" | "error";
  created_at: string | null;
  updated_at?: string | null;
  /** Max version_number across assistant_edit rows, null if doc is unedited. */
  latest_version_number?: number | null;
}

export interface StructureNode {
  id: string;
  title: string;
  level: number;
  page_number: number | null;
  children: StructureNode[];
}

export interface LukeChat {
  id: string;
  application_id: string | null;
  user_id: string;
  title: string | null;
  created_at: string;
}

export interface LukeEditAnnotation {
  type?: "edit_data";
  kind?: "edit";
  edit_id: string;
  document_id: string;
  version_id: string;
  /** Per-document monotonic Vn for the edit's target version. */
  version_number?: number | null;
  change_id: string;
  del_w_id?: string;
  ins_w_id?: string;
  deleted_text: string;
  inserted_text: string;
  context_before?: string;
  context_after?: string;
  reason?: string;
  status: "pending" | "accepted" | "rejected";
}

export type AssistantEvent =
  | { type: "reasoning"; text: string; isStreaming?: boolean }
  | {
      type: "tool_call_start";
      name: string;
      isStreaming?: boolean;
    }
  | { type: "thinking"; isStreaming?: boolean }
  | {
      type: "doc_read";
      filename: string;
      document_id?: string;
      isStreaming?: boolean;
    }
  | {
      type: "doc_find";
      filename: string;
      query: string;
      total_matches: number;
      isStreaming?: boolean;
    }
  | {
      type: "doc_created";
      filename: string;
      download_url: string;
      /** Set when the generated doc is persisted as a first-class document. */
      document_id?: string;
      version_id?: string;
      version_number?: number | null;
      isStreaming?: boolean;
    }
  | { type: "doc_download"; filename: string; download_url: string }
  | {
      type: "doc_replicated";
      /** Source document filename. */
      filename: string;
      /** How many copies were produced in this single tool call. */
      count: number;
      /** One entry per new copy. Empty while streaming. */
      copies?: {
        new_filename: string;
        document_id: string;
        version_id: string;
      }[];
      error?: string;
      isStreaming?: boolean;
    }
  | { type: "web_page_fetched"; url: string; title?: string }
  | { type: "company_created"; company_id: string; name: string; reused_existing?: boolean }
  | {
      type: "company_match_warning";
      requested_name: string;
      similar_company_id: string;
      similar_company_name: string;
      similarity?: number;
    }
  | {
      type: "application_created";
      application_id: string;
      company_id: string;
      name: string;
      job_description_document_id?: string;
    }
  | { type: "workflow_applied"; workflow_id: string; title: string }
  | {
      type: "doc_edited";
      filename: string;
      document_id: string;
      version_id: string;
      /** Per-document monotonic Vn written at emit time. */
      version_number?: number | null;
      download_url: string;
      annotations: LukeEditAnnotation[];
      error?: string;
      isStreaming?: boolean;
    }
  | { type: "content"; text: string; isStreaming?: boolean };

export interface LukeMessage {
  role: "user" | "assistant";
  content: string;
  files?: { filename: string; document_id?: string }[];
  workflow?: { id: string; title: string };
  model?: string;
  annotations?: LukeCitationAnnotation[];
  events?: AssistantEvent[];
  /** Set when streaming failed; rendered as a red error block. */
  error?: string;
}

export interface CitationQuote {
  page: number;
  quote: string;
}

/**
 * A citation emitted by the assistant. Single-page citations have a numeric
 * `page` and a plain `quote`. A citation that spans a page break (one
 * continuous sentence cut by a page boundary) has `page` as a range string
 * like "41-42" and a `quote` containing the `[[PAGE_BREAK]]` sentinel at the
 * break point (text before is on page 41, text after is on page 42).
 */
export interface LukeCitationAnnotation {
  type: "citation_data";
  ref: number;
  doc_id: string;
  document_id: string;
  version_id?: string | null;
  version_number?: number | null;
  filename: string;
  page: number | string;
  quote: string;
}

const PAGE_BREAK_SENTINEL = "[[PAGE_BREAK]]";

/**
 * Expand a citation into one or more (page, quote) entries suitable for
 * highlighting in the PDF viewer. A single-page citation yields one entry; a
 * cross-page citation with page "N-M" and a `[[PAGE_BREAK]]` split yields two.
 */
export function expandCitationToEntries(a: LukeCitationAnnotation): CitationQuote[] {
  const rangeMatch = typeof a.page === "string" ? a.page.match(/^(\d+)\s*-\s*(\d+)$/) : null;
  if (rangeMatch && a.quote.includes(PAGE_BREAK_SENTINEL)) {
    const startPage = parseInt(rangeMatch[1], 10);
    const endPage = parseInt(rangeMatch[2], 10);
    const [before, after] = a.quote.split(PAGE_BREAK_SENTINEL);
    return [
      { page: startPage, quote: before.trim() },
      { page: endPage, quote: after.trim() },
    ].filter((e) => e.quote.length > 0);
  }
  const pageNum = typeof a.page === "number" ? a.page : parseInt(String(a.page), 10);
  if (!Number.isFinite(pageNum)) return [];
  return [{ page: pageNum, quote: a.quote }];
}

/** Format the page(s) of a citation for display, e.g. "Page 3" or "Page 41-42". */
export function formatCitationPage(a: LukeCitationAnnotation): string {
  if (typeof a.page === "string") return `Page ${a.page}`;
  return `Page ${a.page}`;
}

/** Produce a reader-friendly version of the quote (replaces [[PAGE_BREAK]] with "..."). */
export function displayCitationQuote(a: LukeCitationAnnotation): string {
  return a.quote.replaceAll(PAGE_BREAK_SENTINEL, "...");
}

// Tabular Review

export type ColumnFormat =
  | "text"
  | "bulleted_list"
  | "number"
  | "currency"
  | "yes_no"
  | "date"
  | "tag"
  | "percentage"
  | "monetary_amount";

export interface ColumnConfig {
  index: number;
  name: string;
  prompt: string;
  format?: ColumnFormat;
  tags?: string[];
}

export interface TabularReview {
  id: string;
  application_id: string | null;
  user_id: string;
  is_owner?: boolean;
  title: string | null;
  shared_with?: string[];
  columns_config: ColumnConfig[] | null;
  workflow_id: string | null;
  practice?: string | null;
  created_at: string;
  updated_at: string;
  document_count?: number;
}

export interface TabularCell {
  id: string;
  review_id: string;
  document_id: string;
  column_index: number;
  content: {
    summary: string;
    flag?: "green" | "grey" | "yellow" | "red";
    reasoning?: string;
  } | null;
  status: "pending" | "generating" | "done" | "error";
  created_at: string;
}

// Workflows

export interface LukeWorkflow {
  id: string;
  user_id: string | null;
  title: string;
  type: "assistant" | "tabular";
  prompt_md: string | null;
  columns_config: ColumnConfig[] | null;
  is_system: boolean;
  created_at: string;
  practice?: string | null;
  shared_by_name?: string | null;
  allow_edit?: boolean;
  is_owner?: boolean;
}

// API helpers

export interface LukeChatDetailOut {
  chat: LukeChat;
  messages: LukeMessage[];
}

export interface TabularReviewDetailOut {
  review: TabularReview;
  cells: TabularCell[];
  documents: LukeDocument[];
}
