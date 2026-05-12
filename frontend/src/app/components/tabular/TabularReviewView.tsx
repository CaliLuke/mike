/* eslint-disable max-lines -- entity-row support in P3 pushes this over the
   default cap; we'll split TRView into header/table/sidepanel containers
   alongside the chat-v2 frontend cleanup. */
"use client";

import { ChevronDown, Download, Loader2, MessageSquare, Play, Plus } from "lucide-react";
import { useRouter, useSearchParams } from "next/navigation";
import { useEffect, useRef, useState } from "react";

import { useSidebar } from "@/app/contexts/SidebarContext";
import {
  clearTabularCells,
  getApplication,
  getTabularReview,
  regenerateTabularCell,
  streamTabularGeneration,
  updateTabularReview,
} from "@/app/lib/lukeApi";
import {
  getModelProvider,
  isModelAvailable,
  type ModelProvider,
} from "@/app/lib/modelAvailability";
import { getTracer } from "@/app/lib/telemetry";
import { useAuth } from "@/contexts/AuthContext";
import { useUserProfile } from "@/contexts/UserProfileContext";

import { AddApplicationDocsModal } from "../shared/AddApplicationDocsModal";
import { AddDocumentsModal } from "../shared/AddDocumentsModal";
import { ApiKeyMissingModal } from "../shared/ApiKeyMissingModal";
import { HeaderSearchBtn } from "../shared/HeaderSearchBtn";
import { OwnerOnlyModal } from "../shared/OwnerOnlyModal";
import { RenameableTitle } from "../shared/RenameableTitle";
import type {
  ColumnConfig,
  LukeApplication,
  LukeDocument,
  TabularCell,
  TabularReview,
  TabularReviewRow,
  TabularRowCell,
} from "../shared/types";
import { AddColumnModal } from "./AddColumnModal";
import { exportTabularReviewToExcel } from "./exportToExcel";
import { TRChatPanel } from "./TRChatPanel";
import { TREntityTable } from "./TREntityTable";
import { TRSidePanel } from "./TRSidePanel";
import type { TRTableHandle } from "./TRTable";
import { TRTable } from "./TRTable";

interface Props {
  reviewId: string;
  applicationId?: string;
}

export function TRView({ reviewId, applicationId }: Props) {
  const { setSidebarOpen } = useSidebar();
  const [review, setReview] = useState<TabularReview | null>(null);
  const [application, setApplication] = useState<LukeApplication | null>(null);
  const [cells, setCells] = useState<TabularCell[]>([]);
  const [entityRows, setEntityRows] = useState<TabularReviewRow[]>([]);
  const [entityRowCells, setEntityRowCells] = useState<TabularRowCell[]>([]);
  const [documents, setDocuments] = useState<LukeDocument[]>([]);
  const [columns, setColumns] = useState<ColumnConfig[]>([]);
  const isEntityMode = review?.row_mode === "entity";
  const [loading, setLoading] = useState(true);
  const [generating, setGenerating] = useState(false);
  const [savingColumn, setSavingColumn] = useState(false);
  const [savingColumnsConfig, setSavingColumnsConfig] = useState(false);
  const [addColOpen, setAddColOpen] = useState(false);
  const [addDocsOpen, setAddDocsOpen] = useState(false);
  const [ownerOnlyAction, setOwnerOnlyAction] = useState<string | null>(null);
  const { user: _user } = useAuth();
  const [expandedCell, setExpandedCell] = useState<TabularCell | null>(null);
  const [expandedCellCitation, setExpandedCellCitation] = useState<
    { quote: string; page: number } | undefined
  >(undefined);
  const [selectedDocIds, setSelectedDocIds] = useState<string[]>([]);
  const [actionsOpen, setActionsOpen] = useState(false);
  const [search, setSearch] = useState("");
  const searchParams = useSearchParams();
  const initialChatParam = searchParams.get("chat");
  const [chatOpen, setChatOpen] = useState(!!initialChatParam);
  const [selectedChatId, setSelectedChatId] = useState<string | null>(
    initialChatParam && initialChatParam !== "new" ? initialChatParam : null,
  );
  const [highlightedCell, setHighlightedCell] = useState<{ colIdx: number; rowIdx: number } | null>(
    null,
  );
  const [apiKeyModalProvider, setApiKeyModalProvider] = useState<ModelProvider | null>(null);
  const actionsRef = useRef<HTMLDivElement>(null);
  const tableRef = useRef<TRTableHandle>(null);
  const router = useRouter();
  const { profile } = useUserProfile();
  const apiKeys = {
    claudeApiKey: profile?.claudeApiKey ?? null,
    geminiApiKey: profile?.geminiApiKey ?? null,
  };
  const tabularModel = profile?.tabularModel ?? "gemma4";

  useEffect(() => {
    const params = new URLSearchParams(window.location.search);
    if (chatOpen) {
      params.set("chat", selectedChatId ?? "new");
    } else {
      params.delete("chat");
    }
    const query = params.toString();
    const newUrl = `${window.location.pathname}${query ? `?${query}` : ""}`;
    window.history.replaceState(null, "", newUrl);
  }, [chatOpen, selectedChatId]);

  useEffect(() => {
    if (!actionsOpen) return;
    function handleClickOutside(e: MouseEvent) {
      if (actionsRef.current && !actionsRef.current.contains(e.target as Node))
        setActionsOpen(false);
    }
    document.addEventListener("mousedown", handleClickOutside);
    return () => document.removeEventListener("mousedown", handleClickOutside);
  }, [actionsOpen]);

  useEffect(() => {
    const fetches: Promise<unknown>[] = [
      getTabularReview(reviewId).then(({ review, cells, rows, row_cells, documents }) => {
        setReview(review);
        setCells(cells);
        setEntityRows(rows ?? []);
        setEntityRowCells(row_cells ?? []);
        setDocuments(documents);
        setColumns(review.columns_config || []);
      }),
    ];
    if (applicationId) {
      fetches.push(
        getApplication(applicationId)
          .then(setApplication)
          .catch(() => {}),
      );
    }
    Promise.all(fetches).finally(() => setLoading(false));
  }, [reviewId, applicationId]);

  function getNextColumnIndex() {
    return columns.reduce((max, column) => Math.max(max, column.index), -1) + 1;
  }

  async function saveColumnsConfig(nextColumns: ColumnConfig[]) {
    setSavingColumnsConfig(true);
    try {
      const updated = await updateTabularReview(reviewId, {
        columns_config: nextColumns,
        document_ids: documents.map((document) => document.id),
      });
      setReview(updated);
      setColumns(updated.columns_config || nextColumns);
    } finally {
      setSavingColumnsConfig(false);
    }
  }

  async function handleAddDocuments(newDocs: LukeDocument[]) {
    const toAdd = newDocs.filter((d) => !documents.some((existing) => existing.id === d.id));
    if (!toAdd.length) return;
    const allIds = [...documents.map((d) => d.id), ...toAdd.map((d) => d.id)];

    await updateTabularReview(reviewId, {
      document_ids: allIds,
      columns_config: columns,
    });
    setDocuments((prev) => [...prev, ...toAdd]);
    if (columns.length > 0) {
      setCells((prev) => [
        ...prev,
        ...toAdd.flatMap((doc) =>
          columns.map((col) => ({
            id: `new-${doc.id}-${col.index}`,
            review_id: reviewId,
            document_id: doc.id,
            column_index: col.index,
            content: null,
            status: "pending" as const,
            created_at: new Date().toISOString(),
          })),
        ),
      ]);
    }
  }

  async function handleRegenerateCell(docId: string, colIndex: number) {
    setCells((prev) =>
      prev.map((c) =>
        c.document_id === docId && c.column_index === colIndex
          ? { ...c, status: "generating" as const, content: null }
          : c,
      ),
    );
    setExpandedCell((prev) =>
      prev ? { ...prev, status: "generating" as const, content: null } : null,
    );
    try {
      const result = await regenerateTabularCell(reviewId, docId, colIndex);
      setCells((prev) =>
        prev.map((c) =>
          c.document_id === docId && c.column_index === colIndex
            ? { ...c, status: "done" as const, content: result }
            : c,
        ),
      );
      setExpandedCell((prev) =>
        prev ? { ...prev, status: "done" as const, content: result } : null,
      );
    } catch (err) {
      console.error("Regeneration failed", err);
      setCells((prev) =>
        prev.map((c) =>
          c.document_id === docId && c.column_index === colIndex
            ? { ...c, status: "error" as const }
            : c,
        ),
      );
      setExpandedCell((prev) => (prev ? { ...prev, status: "error" as const } : null));
    }
  }

  async function handleGenerate() {
    if (!review || generating) return;

    // If columns changed since last save, update the review first
    if (columns.length === 0) return;

    if (!isModelAvailable(tabularModel, apiKeys)) {
      setApiKeyModalProvider(getModelProvider(tabularModel));
      return;
    }

    setGenerating(true);

    const span = getTracer().startSpan("tabular.client.generate", {
      attributes: {
        "tabular_review.id": reviewId,
        "tabular.documents.count": documents.length,
        "tabular.columns.count": columns.length,
        "tabular.cells.expected": documents.length * columns.length,
        "tabular.model": tabularModel ?? "",
      },
    });
    const startedAt = performance.now();
    let cellUpdates = 0;
    let bytesReceived = 0;
    let firstEventMs: number | null = null;
    let exitReason = "done";

    // Optimistically set empty/pending/error cells to generating (skip done cells)
    setCells((prev) =>
      documents.flatMap((doc) =>
        columns.map((col) => {
          const existing = prev.find(
            (c) => c.document_id === doc.id && c.column_index === col.index,
          );
          if (existing?.status === "done" && existing?.content) {
            return existing;
          }
          return existing
            ? {
                ...existing,
                status: "generating" as const,
                content: null,
              }
            : {
                id: `${doc.id}-${col.index}`,
                review_id: reviewId,
                document_id: doc.id,
                column_index: col.index,
                content: null,
                status: "generating" as const,
                created_at: new Date().toISOString(),
              };
        }),
      ),
    );

    try {
      const response = await streamTabularGeneration(
        reviewId,
        documents.map((doc) => doc.id),
        columns.map((col) => col.index),
      );
      if (!response.body) throw new Error("No body");

      const reader = response.body.getReader();
      const decoder = new TextDecoder();
      let buffer = "";

      while (true) {
        const { done, value } = await reader.read();
        if (done) break;
        if (value) bytesReceived += value.byteLength;
        buffer += decoder.decode(value, { stream: true });
        const lines = buffer.split("\n");
        buffer = lines.pop() ?? "";

        for (const line of lines) {
          if (!line.startsWith("data:")) continue;
          const dataStr = line.slice(5).trim();
          if (dataStr === "[DONE]") break;
          if (firstEventMs === null) firstEventMs = performance.now() - startedAt;
          try {
            const data = JSON.parse(dataStr);
            if (data.type === "cell_update") {
              cellUpdates++;
              if (data.row_id) {
                // Entity-mode cell update — match by row_id + column_index.
                setEntityRowCells((prev) => {
                  const idx = prev.findIndex(
                    (c) => c.row_id === data.row_id && c.column_index === data.column_index,
                  );
                  if (idx >= 0) {
                    const next = prev.slice();
                    next[idx] = {
                      ...next[idx],
                      content: data.content,
                      status: data.status,
                    };
                    return next;
                  }
                  return [...prev, data.cell as TabularRowCell];
                });
              } else {
                setCells((prev) =>
                  prev.map((c) =>
                    c.document_id === data.document_id && c.column_index === data.column_index
                      ? {
                          ...c,
                          content: data.content,
                          status: data.status,
                        }
                      : c,
                  ),
                );
              }
            } else if (data.type === "row_created") {
              setEntityRows((prev) => {
                if (prev.some((r) => r.id === data.row_id)) return prev;
                return [...prev, data.row as TabularReviewRow];
              });
            } else if (data.type === "row_extract_failed") {
              console.warn("Anchor extraction failed for", data.document_id, data.error);
            }
          } catch {}
        }
      }
    } catch (err) {
      exitReason = "exception";
      console.error("Generation failed", err);
      span.recordException(err as Error);
    } finally {
      span.setAttributes({
        "tabular.cells.received": cellUpdates,
        "tabular.bytes_received": bytesReceived,
        "tabular.time_to_first_event_ms": firstEventMs ?? -1,
        "tabular.duration_ms": performance.now() - startedAt,
        "tabular.exit_reason": exitReason,
      });
      span.end();
      setGenerating(false);
    }
  }

  async function handleAddColumn(newColumns: ColumnConfig[]) {
    const startIndex = getNextColumnIndex();
    const normalizedColumns = newColumns.map((column, index) => ({
      ...column,
      index: startIndex + index,
    }));
    const newCols = [...columns, ...normalizedColumns];
    setSavingColumn(true);
    setColumns(newCols);
    setCells((prev) => [
      ...prev,
      ...documents
        .filter((doc) =>
          normalizedColumns.some(
            (column) =>
              !prev.some(
                (cell) => cell.document_id === doc.id && cell.column_index === column.index,
              ),
          ),
        )
        .flatMap((doc) =>
          normalizedColumns
            .filter(
              (column) =>
                !prev.some(
                  (cell) => cell.document_id === doc.id && cell.column_index === column.index,
                ),
            )
            .map((column) => ({
              id: `new-${doc.id}-${column.index}`,
              review_id: reviewId,
              document_id: doc.id,
              column_index: column.index,
              content: null,
              status: "pending" as const,
              created_at: new Date().toISOString(),
            })),
        ),
    ]);
    try {
      await saveColumnsConfig(newCols);
    } catch (err) {
      setColumns(columns);
      setCells((prev) =>
        prev.filter(
          (cell) => !normalizedColumns.some((column) => column.index === cell.column_index),
        ),
      );
      console.error("Failed to save column", err);
    } finally {
      setSavingColumn(false);
    }
  }

  async function handleUpdateColumn(nextColumn: ColumnConfig) {
    const nextColumns = columns.map((column) =>
      column.index === nextColumn.index ? nextColumn : column,
    );
    const previousColumns = columns;
    setColumns(nextColumns);
    try {
      await saveColumnsConfig(nextColumns);
    } catch (err) {
      setColumns(previousColumns);
      console.error("Failed to update column", err);
    }
  }

  async function handleDeleteColumn(columnIndex: number) {
    const previousColumns = columns;
    const nextColumns = columns.filter((column) => column.index !== columnIndex);
    setColumns(nextColumns);
    try {
      await saveColumnsConfig(nextColumns);
    } catch (err) {
      setColumns(previousColumns);
      console.error("Failed to delete column", err);
    }
  }

  function handleTabularCitationClick(colIdx: number, rowIdx: number) {
    setSearch("");
    setHighlightedCell({ colIdx, rowIdx });
    setTimeout(() => {
      tableRef.current?.scrollToCell(colIdx, rowIdx);
    }, 50);
    setTimeout(() => setHighlightedCell(null), 3000);
  }

  async function handleDeleteDocuments() {
    const remaining = documents.filter((d) => !selectedDocIds.includes(d.id));
    setDocuments(remaining);
    setCells((prev) => prev.filter((c) => !selectedDocIds.includes(c.document_id)));
    setSelectedDocIds([]);
    setActionsOpen(false);
    await updateTabularReview(reviewId, {
      document_ids: remaining.map((d) => d.id),
      columns_config: columns,
    });
  }

  async function handleClearResults() {
    const docIds = [...selectedDocIds];
    if (docIds.length === 0) return;
    setCells((prev) =>
      prev.map((c) =>
        docIds.includes(c.document_id) ? { ...c, content: null, status: "pending" } : c,
      ),
    );
    setSelectedDocIds([]);
    setActionsOpen(false);
    await clearTabularCells(reviewId, docIds);
  }

  async function handleTitleCommit(newTitle: string) {
    if (!newTitle || newTitle === review?.title) return;
    setReview((prev) => (prev ? { ...prev, title: newTitle } : prev));
    await updateTabularReview(reviewId, { title: newTitle });
  }

  const q = search.toLowerCase();
  const filteredDocuments = q
    ? documents.filter((d) => d.filename.toLowerCase().includes(q))
    : documents;

  return (
    <div className="flex h-full overflow-hidden bg-white">
      <div className="flex flex-1 flex-col overflow-hidden">
        {/* Header */}
        <div className="flex shrink-0 items-start justify-between gap-4 bg-white px-8 py-4">
          <div className="flex items-center gap-1.5 font-serif text-2xl font-medium">
            {applicationId && (
              <>
                <button
                  onClick={() => router.push("/applications")}
                  className="text-gray-500 transition-colors hover:text-gray-700"
                >
                  Applications
                </button>
                <span className="text-gray-300">›</span>
                <button
                  onClick={() => router.push(`/applications/${applicationId}`)}
                  className="text-gray-500 transition-colors hover:text-gray-700"
                >
                  {loading ? (
                    <div className="h-6 w-32 animate-pulse rounded bg-gray-100" />
                  ) : (
                    (application?.name ?? "")
                  )}
                </button>
                <span className="text-gray-300">›</span>
                <button
                  onClick={() => router.push(`/applications/${applicationId}?tab=reviews`)}
                  className="text-gray-500 transition-colors hover:text-gray-700"
                >
                  Tabular Reviews
                </button>
              </>
            )}
            {!applicationId && (
              <button
                onClick={() => router.push("/tabular-reviews")}
                className="text-gray-500 transition-colors hover:text-gray-700"
              >
                Tabular Reviews
              </button>
            )}
            <span className="text-gray-300">›</span>
            {loading ? (
              <div className="h-6 w-40 animate-pulse rounded bg-gray-100" />
            ) : (
              <RenameableTitle
                value={review?.title || "Untitled Review"}
                onCommit={handleTitleCommit}
              />
            )}
          </div>
          {!loading && (
            <div className="flex items-center gap-2">
              <HeaderSearchBtn
                value={search}
                onChange={setSearch}
                placeholder="Search documents…"
              />
              <button
                onClick={() =>
                  exportTabularReviewToExcel({
                    reviewTitle: review?.title || "Tabular Review",
                    columns,
                    documents,
                    cells,
                  })
                }
                disabled={columns.length === 0 || documents.length === 0}
                title="Export to Excel"
                className={`flex h-8 items-center justify-center gap-1.5 px-3 text-sm transition-colors ${
                  columns.length === 0 || documents.length === 0
                    ? "cursor-default text-gray-300"
                    : "cursor-pointer text-gray-700 hover:text-gray-900"
                }`}
              >
                <Download className="h-4 w-4" />
                Export
              </button>
              <button
                onClick={handleGenerate}
                disabled={
                  generating ||
                  columns.length === 0 ||
                  documents.length === 0 ||
                  savingColumnsConfig
                }
                className={`flex h-8 items-center justify-center gap-1.5 px-3 text-sm transition-colors ${
                  generating ||
                  columns.length === 0 ||
                  documents.length === 0 ||
                  savingColumnsConfig
                    ? "cursor-default text-gray-300"
                    : "cursor-pointer text-gray-700 hover:text-gray-900"
                }`}
              >
                {generating ? (
                  <Loader2 className="h-4 w-4 animate-spin" />
                ) : (
                  <Play className="h-4 w-4" />
                )}
                {generating ? "Running…" : "Run"}
              </button>
            </div>
          )}
        </div>

        {/* Toolbar */}
        <div className="flex h-10 items-center gap-4 border-b border-gray-200 px-8">
          <button
            onClick={() => {
              if (!chatOpen) setSidebarOpen(false);
              if (chatOpen) setSelectedChatId(null);
              setChatOpen((v) => !v);
            }}
            disabled={loading || columns.length === 0 || documents.length === 0}
            className={`flex items-center gap-1 text-xs font-medium transition-colors ${
              loading || columns.length === 0 || documents.length === 0
                ? "cursor-default text-gray-300"
                : "text-gray-700 hover:text-gray-900"
            }`}
          >
            <MessageSquare className="h-3.5 w-3.5" />
            Assistant in Tabular Review
          </button>
          <div className="ml-auto flex items-center gap-4">
            {selectedDocIds.length > 0 && (
              <div ref={actionsRef} className="relative">
                <button
                  onClick={() => setActionsOpen((v) => !v)}
                  className="flex items-center gap-1 text-xs font-medium text-gray-600 transition-colors hover:text-gray-900"
                >
                  Actions
                  <ChevronDown className="h-3.5 w-3.5" />
                </button>
                {actionsOpen && (
                  <div className="absolute top-full right-0 z-50 mt-1 w-36 overflow-hidden rounded-lg border border-gray-100 bg-white shadow-lg">
                    <button
                      onClick={handleClearResults}
                      className="w-full px-3 py-1.5 text-left text-xs text-gray-700 transition-colors hover:bg-gray-50"
                    >
                      Clear results
                    </button>
                    <button
                      onClick={handleDeleteDocuments}
                      className="w-full px-3 py-1.5 text-left text-xs text-red-600 transition-colors hover:bg-red-50"
                    >
                      Delete
                    </button>
                  </div>
                )}
              </div>
            )}
            <button
              onClick={() => setAddDocsOpen(true)}
              disabled={loading || savingColumnsConfig}
              className={`flex items-center gap-1 text-xs font-medium transition-colors ${
                loading || savingColumnsConfig
                  ? "cursor-default text-gray-300"
                  : "text-gray-700 hover:text-gray-900"
              }`}
            >
              <Plus className="h-3.5 w-3.5" />
              Add Documents
            </button>
            <button
              onClick={() => setAddColOpen(true)}
              disabled={loading || savingColumn || savingColumnsConfig}
              className={`flex items-center gap-1 text-xs font-medium transition-colors ${
                loading || savingColumn || savingColumnsConfig
                  ? "cursor-default text-gray-300"
                  : "text-gray-700 hover:text-gray-900"
              }`}
            >
              <Plus className="h-3.5 w-3.5" />
              Add Columns
            </button>
          </div>
        </div>

        {/* Table area */}
        <div className="flex flex-1 overflow-hidden">
          {chatOpen && (
            <TRChatPanel
              reviewId={reviewId}
              reviewTitle={review?.title ?? null}
              applicationName={application?.name ?? null}
              columns={columns}
              documents={documents}
              onCitationClick={handleTabularCitationClick}
              onClose={() => {
                setSelectedChatId(null);
                setChatOpen(false);
              }}
              initialChatId={selectedChatId}
              onChatIdChange={setSelectedChatId}
            />
          )}
          {isEntityMode ? (
            <TREntityTable
              columns={columns}
              rows={entityRows}
              rowCells={entityRowCells}
              documents={documents}
            />
          ) : (
            <TRTable
              ref={tableRef}
              loading={loading}
              columns={columns}
              documents={filteredDocuments}
              cells={cells}
              highlightedCell={highlightedCell}
              savingColumn={savingColumn}
              savingColumnsConfig={savingColumnsConfig}
              selectedDocIds={selectedDocIds}
              onSelectionChange={setSelectedDocIds}
              onExpand={(cell) => {
                setExpandedCell(cell);
                setExpandedCellCitation(undefined);
              }}
              onCitationClick={(cell, page, quote) => {
                setExpandedCell(cell);
                setExpandedCellCitation({ quote, page });
              }}
              onUpdateColumn={handleUpdateColumn}
              onDeleteColumn={handleDeleteColumn}
              onAddColumn={() => setAddColOpen(true)}
              onAddDocuments={() => setAddDocsOpen(true)}
            />
          )}
        </div>
      </div>

      {/* Cell detail side panel */}
      {expandedCell &&
        (() => {
          const expandedDoc = documents.find((d) => d.id === expandedCell.document_id);
          const expandedCol = columns.find((c) => c.index === expandedCell.column_index);
          if (!expandedDoc || !expandedCol) return null;
          return (
            <TRSidePanel
              cell={expandedCell}
              document={expandedDoc}
              column={expandedCol}
              columns={columns}
              onClose={() => {
                setExpandedCell(null);
                setExpandedCellCitation(undefined);
              }}
              onNavigate={(columnIndex) => {
                const nextCell = cells.find(
                  (c) =>
                    c.document_id === expandedCell.document_id && c.column_index === columnIndex,
                );
                if (nextCell) {
                  setExpandedCell(nextCell);
                  setExpandedCellCitation(undefined);
                }
              }}
              onRegenerate={() =>
                handleRegenerateCell(expandedCell.document_id, expandedCell.column_index)
              }
              displayDocument={expandedCellCitation !== undefined}
              citationQuote={expandedCellCitation?.quote}
              citationPage={expandedCellCitation?.page}
            />
          );
        })()}

      <AddColumnModal
        open={addColOpen}
        existingCount={columns.length}
        onClose={() => setAddColOpen(false)}
        onAdd={handleAddColumn}
      />

      {application ? (
        <AddApplicationDocsModal
          open={addDocsOpen}
          onClose={() => setAddDocsOpen(false)}
          onSelect={(docs: LukeDocument[]) => handleAddDocuments(docs)}
          breadcrumb={[
            "Applications",
            application.name,
            "Tabular Reviews",
            ...(review ? [review.title || "Untitled Review"] : []),
            "Add Documents",
          ]}
          applicationId={application.id}
          excludeDocIds={new Set(documents.map((d) => d.id))}
        />
      ) : (
        <AddDocumentsModal
          open={addDocsOpen}
          onClose={() => setAddDocsOpen(false)}
          onSelect={(docs: LukeDocument[]) => handleAddDocuments(docs)}
          breadcrumb={[
            "Tabular Reviews",
            ...(review ? [review.title || "Untitled Review"] : []),
            "Add Documents",
          ]}
        />
      )}

      <OwnerOnlyModal
        open={!!ownerOnlyAction}
        action={ownerOnlyAction ?? undefined}
        onClose={() => setOwnerOnlyAction(null)}
      />

      <ApiKeyMissingModal
        open={apiKeyModalProvider !== null}
        provider={apiKeyModalProvider}
        onClose={() => setApiKeyModalProvider(null)}
      />
    </div>
  );
}
