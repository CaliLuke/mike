"use client";

/* eslint-disable max-lines, react-hooks/purity, react-hooks/set-state-in-effect, @typescript-eslint/no-non-null-assertion */

import {
  AlertCircle,
  ChevronDown,
  ChevronRight,
  Download,
  File,
  FileText,
  Folder,
  FolderOpen,
  FolderPlus,
  Loader2,
  MessageSquare,
  Pencil,
  Plus,
  Table2,
  Upload,
} from "lucide-react";
import { usePathname, useRouter, useSearchParams } from "next/navigation";
import { useEffect, useRef, useState } from "react";

import { LibraryDocumentsSection } from "@/app/components/applications/LibraryDocumentsSection";
import { AddDocumentsModal } from "@/app/components/shared/AddDocumentsModal";
import { DocViewModal } from "@/app/components/shared/DocViewModal";
import { HeaderSearchBtn } from "@/app/components/shared/HeaderSearchBtn";
import { OwnerOnlyModal } from "@/app/components/shared/OwnerOnlyModal";
import { RenameableTitle } from "@/app/components/shared/RenameableTitle";
import { RowActions } from "@/app/components/shared/RowActions";
import { ToolbarTabs } from "@/app/components/shared/ToolbarTabs";
import type {
  ColumnConfig,
  LukeApplication,
  LukeChat,
  LukeDocument,
  LukeFolder,
  TabularReview,
} from "@/app/components/shared/types";
import { UploadNewVersionModal } from "@/app/components/shared/UploadNewVersionModal";
import { AddNewTRModal } from "@/app/components/tabular/AddNewTRModal";
import { useChatHistoryContext } from "@/app/contexts/ChatHistoryContext";
import {
  createApplicationFolder,
  createTabularReview,
  deleteApplicationFolder,
  deleteChat,
  deleteDocument,
  deleteTabularReview,
  downloadDocumentsZip,
  getApplication,
  getDocumentUrl,
  listApplicationChats,
  listDocumentVersions,
  type LukeDocumentVersion,
  moveDocumentToFolder,
  moveSubfolderToFolder,
  moveTabularReviewToFolder,
  renameApplicationFolder,
  renameChat,
  renameDocumentVersion,
  updateApplication,
  updateTabularReview,
  uploadDocumentVersion,
} from "@/app/lib/lukeApi";
import { canonicalOwnerId, isSameOwner } from "@/app/lib/ownership";
import { getTracer, trackClick } from "@/app/lib/telemetry";
import { useAuth } from "@/contexts/AuthContext";

interface Props {
  applicationId: string;
}

type Tab = "documents" | "assistant";

type ContextMenu = {
  x: number;
  y: number;
  folderId: string | null; // null = right-clicked on root/empty space
  showFolderActions: boolean; // true when right-clicked on a specific folder row
};

const CHECK_W = "w-8 shrink-0";
const NAME_COL_W = "w-[300px] shrink-0";

function formatBytes(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}

function formatDate(iso: string) {
  return new Date(iso).toLocaleDateString(undefined, {
    day: "numeric",
    month: "short",
    year: "numeric",
  });
}

function DocIcon({ fileType }: { fileType: string | null }) {
  if (fileType === "pdf") return <FileText className="h-4 w-4 shrink-0 text-red-600" />;
  if (fileType === "docx" || fileType === "doc")
    return <File className="h-4 w-4 shrink-0 text-blue-600" />;
  return <File className="h-4 w-4 shrink-0 text-gray-500" />;
}

/**
 * Stacked rows rendered beneath a doc row when its Version column is
 * expanded. Each row shows a past (or current) version with its number,
 * source, date, and a download button that fetches that specific version.
 */
function DocVersionHistory({
  docId,
  filename,
  loading,
  versions,
  onDownloadVersion,
  onOpenVersion,
  onRenameVersion,
}: {
  docId: string;
  filename: string;
  loading: boolean;
  versions: LukeDocumentVersion[];
  onDownloadVersion: (docId: string, versionId: string, filename: string) => void;
  onOpenVersion?: (versionId: string, versionLabel: string) => void;
  onRenameVersion?: (versionId: string, displayName: string | null) => Promise<void> | void;
}) {
  const [editingVersionId, setEditingVersionId] = useState<string | null>(null);
  const [editingValue, setEditingValue] = useState("");

  const commit = async (versionId: string) => {
    const trimmed = editingValue.trim();
    setEditingVersionId(null);
    // Empty string → clear override (falls back to V{n})
    const next = trimmed.length > 0 ? trimmed : null;
    await onRenameVersion?.(versionId, next);
  };
  if (loading && versions.length === 0) {
    return (
      <div className="flex h-9 items-center border-b border-gray-50 bg-gray-50/60 text-xs text-gray-500">
        <div className={`sticky left-0 z-[60] ${CHECK_W} self-stretch bg-gray-50/60`} />
        <div className={`sticky left-8 z-[60] ${NAME_COL_W} bg-gray-50/60 p-2`}>
          <div className="flex items-center gap-2">
            <Loader2 className="h-3 w-3 animate-spin text-gray-400" />
            <span>Loading versions…</span>
          </div>
        </div>
      </div>
    );
  }
  if (versions.length === 0) {
    return (
      <div className="flex h-9 items-center border-b border-gray-50 bg-gray-50/60 text-xs text-gray-400">
        <div className={`sticky left-0 z-[60] ${CHECK_W} self-stretch bg-gray-50/60`} />
        <div className={`sticky left-8 z-[60] ${NAME_COL_W} bg-gray-50/60 p-2`}>
          <div>No version history.</div>
        </div>
      </div>
    );
  }
  // Most recent version first.
  const ordered = [...versions].reverse();
  return (
    <>
      {ordered.map((v) => {
        const numberLabel =
          typeof v.version_number === "number" && v.version_number >= 1
            ? `${v.version_number}`
            : v.source === "upload"
              ? "Original"
              : "—";
        const displayLabel = v.display_name?.trim() || numberLabel;
        const dt = new Date(v.created_at);
        const dateLabel = Number.isNaN(dt.valueOf())
          ? ""
          : dt.toLocaleString(undefined, {
              month: "short",
              day: "numeric",
              year: "numeric",
              hour: "numeric",
              minute: "2-digit",
            });
        const isEditing = editingVersionId === v.id;
        return (
          <div
            key={`ver-${docId}-${v.id}`}
            onClick={() => {
              if (isEditing) return;
              onOpenVersion?.(v.id, displayLabel);
            }}
            className="group flex h-9 cursor-pointer items-center border-b border-gray-50 bg-gray-50/60 pr-8 text-xs text-gray-600 transition-colors hover:bg-gray-100/80"
          >
            <div
              className={`sticky left-0 z-[60] ${CHECK_W} self-stretch bg-gray-50/60 group-hover:bg-gray-100/80`}
            />
            <div
              className={`sticky left-8 z-[60] ${NAME_COL_W} bg-gray-50/60 p-2 group-hover:bg-gray-100/80`}
            >
              <div className="flex items-center gap-2">
                <span className="shrink-0 text-gray-400">↳</span>
                {isEditing ? (
                  <input
                    autoFocus
                    value={editingValue}
                    onClick={(e) => e.stopPropagation()}
                    onChange={(e) => setEditingValue(e.target.value)}
                    onKeyDown={(e) => {
                      if (e.key === "Enter") {
                        e.preventDefault();
                        void commit(v.id);
                      } else if (e.key === "Escape") {
                        setEditingVersionId(null);
                      }
                    }}
                    onBlur={() => void commit(v.id)}
                    className="max-w-[240px] min-w-0 flex-1 border-b border-gray-300 bg-transparent text-xs text-gray-800 outline-none focus:border-gray-500"
                  />
                ) : (
                  <span className="truncate font-medium text-gray-700">{displayLabel}</span>
                )}
                {!isEditing && onRenameVersion && (
                  <button
                    onClick={(e) => {
                      e.stopPropagation();
                      setEditingVersionId(v.id);
                      setEditingValue(v.display_name ?? "");
                    }}
                    title="Rename version"
                    className="shrink-0 rounded p-0.5 text-gray-400 opacity-0 transition group-hover:opacity-100 hover:bg-gray-200 hover:text-gray-700"
                  >
                    <Pencil className="h-3 w-3" />
                  </button>
                )}
                <span className="truncate text-gray-400">{dateLabel}</span>
                <span className="shrink-0 text-gray-300">·</span>
                <span className="truncate text-gray-400">{v.source}</span>
              </div>
            </div>
            <div className="ml-auto w-20 shrink-0" />
            <div className="w-24 shrink-0" />
            <div className="ml-auto w-20 shrink-0" />
            <div className="flex w-8 shrink-0 justify-end">
              <button
                onClick={(e) => {
                  e.stopPropagation();
                  onDownloadVersion(docId, v.id, filename);
                }}
                title="Download this version"
                className="flex h-6 w-6 items-center justify-center rounded text-gray-500 transition-colors hover:bg-gray-100 hover:text-gray-800"
              >
                <Download className="h-3.5 w-3.5" />
              </button>
            </div>
          </div>
        );
      })}
    </>
  );
}

export function ApplicationPage({ applicationId }: Props) {
  const [application, setApplication] = useState<LukeApplication | null>(null);
  const [folders, setFolders] = useState<LukeFolder[]>([]);
  const [chats, setChats] = useState<LukeChat[]>([]);
  const [loading, setLoading] = useState(true);
  const searchParams = useSearchParams();
  const tabParam = searchParams.get("tab");
  const tab: Tab = tabParam === "assistant" ? "assistant" : "documents";
  const [addDocsOpen, setAddDocsOpen] = useState(false);
  const [ownerOnlyAction, setOwnerOnlyAction] = useState<string | null>(null);
  const { user } = useAuth();
  const [uploadVersionDoc, setUploadVersionDoc] = useState<LukeDocument | null>(null);
  const [viewingDoc, setViewingDoc] = useState<LukeDocument | null>(null);
  const [viewingDocVersion, setViewingDocVersion] = useState<{
    id: string;
    label: string;
  } | null>(null);
  const [creatingChat, setCreatingChat] = useState(false);
  const [creatingReview, setCreatingReview] = useState(false);
  const [newTRModalOpen, setNewTRModalOpen] = useState(false);

  const traceChatOwnerAction = (
    action: "rename" | "delete",
    chat: LukeChat | undefined,
    surface: "application.bulk" | "application.row",
    allowed: boolean,
  ) => {
    const span = getTracer().startSpan(
      allowed ? "chat.owner_action.allowed" : "chat.owner_action.blocked",
      {
        attributes: {
          "chat.action": action,
          "chat.id": chat?.id ?? "",
          "chat.owner_id": chat?.user_id ?? "",
          "chat.owner_id.normalized": canonicalOwnerId(chat?.user_id),
          "user.id": user?.id ?? "",
          "user.id.normalized": canonicalOwnerId(user?.id),
          "ownership.allowed": allowed,
          "ownership.surface": surface,
        },
      },
    );
    span.end();
  };

  // Per-tab selection
  const [selectedDocIds, setSelectedDocIds] = useState<string[]>([]);
  const [selectedChatIds, setSelectedChatIds] = useState<string[]>([]);
  const [selectedReviewIds, setSelectedReviewIds] = useState<string[]>([]);

  // Version-history expansion (per-doc). versionsByDocId caches fetched
  // versions so toggling closed + open again doesn't refetch. loadingIds
  // drives the inline spinner in the version cell while a fetch is in
  // flight.
  const [expandedVersionDocIds, setExpandedVersionDocIds] = useState<Set<string>>(() => new Set());
  const [versionsByDocId, setVersionsByDocId] = useState<Map<string, LukeDocumentVersion[]>>(
    () => new Map(),
  );
  const [loadingVersionDocIds, setLoadingVersionDocIds] = useState<Set<string>>(() => new Set());

  const toggleVersions = async (docId: string) => {
    const already = expandedVersionDocIds.has(docId);
    if (already) {
      setExpandedVersionDocIds((prev) => {
        const next = new Set(prev);
        next.delete(docId);
        return next;
      });
      return;
    }
    // Opening — expand immediately so the user sees a loading state.
    setExpandedVersionDocIds((prev) => new Set([...prev, docId]));
    if (versionsByDocId.has(docId)) return;
    setLoadingVersionDocIds((prev) => new Set([...prev, docId]));
    try {
      const res = await listDocumentVersions(docId);
      setVersionsByDocId((prev) => {
        const next = new Map(prev);
        next.set(docId, res.versions);
        return next;
      });
    } catch (e) {
      console.error("listDocumentVersions failed", e);
    } finally {
      setLoadingVersionDocIds((prev) => {
        const next = new Set(prev);
        next.delete(docId);
        return next;
      });
    }
  };

  async function downloadDocVersion(docId: string, versionId: string, filename: string) {
    try {
      const resolved = await getDocumentUrl(docId, versionId);
      const a = document.createElement("a");
      a.href = resolved.url;
      // Prefer the backend's resolved filename (which honours the
      // version's display_name). Fall back to the passed filename
      // if for some reason it's missing.
      a.download = resolved.filename || filename;
      a.click();
    } catch (e) {
      console.error("downloadDocVersion failed", e);
    }
  }

  /**
   * Trigger a file picker and upload the chosen file as a new version of
   * the given document. On success, refresh the application (for the doc's
   * latest_version_number) and re-fetch the version list so the history
   * panel shows the new row.
   */
  function handleUploadNewVersion(doc: LukeDocument) {
    setUploadVersionDoc(doc);
  }

  async function submitNewVersion(doc: LukeDocument, file: File, displayName: string) {
    try {
      await uploadDocumentVersion(doc.id, file, displayName);
      // Refresh application so doc.latest_version_number and filename advance.
      const updated = await getApplication(applicationId);
      setApplication(updated);
      // Re-fetch versions for this doc (invalidate cache first).
      setVersionsByDocId((prev) => {
        const next = new Map(prev);
        next.delete(doc.id);
        return next;
      });
      // Ensure the history panel is expanded so the user sees it.
      setExpandedVersionDocIds((prev) => new Set([...prev, doc.id]));
      const res = await listDocumentVersions(doc.id);
      setVersionsByDocId((prev) => {
        const next = new Map(prev);
        next.set(doc.id, res.versions);
        return next;
      });
    } catch (e) {
      console.error("uploadDocumentVersion failed", e);
    }
  }

  /**
   * Patch a version's display_name and update the local cache in place.
   */
  async function handleRenameVersion(docId: string, versionId: string, displayName: string | null) {
    try {
      const updated = await renameDocumentVersion(docId, versionId, displayName);
      setVersionsByDocId((prev) => {
        const list = prev.get(docId);
        if (!list) return prev;
        const next = new Map(prev);
        next.set(
          docId,
          list.map((v) => (v.id === versionId ? updated : v)),
        );
        return next;
      });
    } catch (e) {
      console.error("renameDocumentVersion failed", e);
    }
  }

  // Inline rename for chats and reviews
  const [renamingChatId, setRenamingChatId] = useState<string | null>(null);
  const [renameChatValue, setRenameChatValue] = useState("");
  const [renamingReviewId, setRenamingReviewId] = useState<string | null>(null);
  const [renameReviewValue, setRenameReviewValue] = useState("");

  // Folder state
  const [expandedFolderIds, setExpandedFolderIds] = useState<Set<string>>(new Set());
  // undefined = not creating; null = creating at root; string = creating inside that folder id
  const [creatingFolderIn, setCreatingFolderIn] = useState<string | null | undefined>(undefined);
  const [newFolderName, setNewFolderName] = useState("");
  const [renamingFolderId, setRenamingFolderId] = useState<string | null>(null);
  const [renameFolderValue, setRenameFolderValue] = useState("");
  const [contextMenu, setContextMenu] = useState<ContextMenu | null>(null);
  const contextMenuRef = useRef<HTMLDivElement>(null);
  const newFolderInputRef = useRef<HTMLDivElement | null>(null);
  const [dragOverFolderId, setDragOverFolderId] = useState<string | null>(null);
  const [dragOverRoot, setDragOverRoot] = useState(false);

  // Actions dropdown
  const [actionsOpen, setActionsOpen] = useState(false);
  const actionsRef = useRef<HTMLDivElement>(null);
  const [search, setSearch] = useState("");

  const router = useRouter();
  const pathname = usePathname();
  const { saveChat } = useChatHistoryContext();

  function handleTabChange(newTab: Tab) {
    const base = `/applications/${applicationId}`;
    if (newTab === "assistant") {
      // The chat view is now its own route with a ThreadList for past
      // conversations — no more in-page table.
      router.push(`${base}/assistant-next`);
      return;
    }
    const url = newTab === "documents" ? base : `${base}?tab=${newTab}`;
    router.push(url);
  }

  // Old ?tab=assistant URLs land directly on the chat now — there is
  // no more in-page chat-list table to render.
  useEffect(() => {
    if (tab === "assistant") {
      trackClick("assistant_next.legacy_tab.redirect", {
        "application.id": applicationId,
        "from.url": pathname,
        "to.url": `/applications/${applicationId}/assistant-next`,
      });
      router.replace(`/applications/${applicationId}/assistant-next`);
    }
  }, [tab, applicationId, router, pathname]);

  useEffect(() => {
    Promise.all([
      getApplication(applicationId),
      listApplicationChats(applicationId).catch(() => [] as LukeChat[]),
    ])
      .then(([proj, applicationChats]) => {
        setApplication(proj);
        const loadedFolders = proj.folders ?? [];
        setFolders(loadedFolders);
        setExpandedFolderIds(new Set(loadedFolders.map((f) => f.id)));
        setChats(applicationChats);
      })
      .finally(() => setLoading(false));
  }, [applicationId]);

  // Reset selection and close dropdowns when tab changes
  useEffect(() => {
    setSelectedDocIds([]);
    setSelectedChatIds([]);
    setSelectedReviewIds([]);
    setActionsOpen(false);
    setContextMenu(null);
  }, [tab]);

  useEffect(() => {
    function handleClick(e: MouseEvent) {
      if (actionsRef.current && !actionsRef.current.contains(e.target as Node))
        setActionsOpen(false);
    }
    if (actionsOpen) document.addEventListener("mousedown", handleClick);
    return () => document.removeEventListener("mousedown", handleClick);
  }, [actionsOpen]);

  // Close context menu on outside click
  useEffect(() => {
    if (!contextMenu) return;
    function handle(e: MouseEvent) {
      if (contextMenuRef.current && !contextMenuRef.current.contains(e.target as Node))
        setContextMenu(null);
    }
    document.addEventListener("mousedown", handle);
    return () => document.removeEventListener("mousedown", handle);
  }, [contextMenu]);

  // Clear all drag state when any drag operation ends
  useEffect(() => {
    function handleDragEnd() {
      setDragOverFolderId(null);
      setDragOverRoot(false);
    }
    document.addEventListener("dragend", handleDragEnd);
    return () => document.removeEventListener("dragend", handleDragEnd);
  }, []);

  // Scroll new-folder input into view whenever it appears
  useEffect(() => {
    if (creatingFolderIn !== undefined) {
      newFolderInputRef.current?.scrollIntoView({ behavior: "smooth", block: "nearest" });
    }
  }, [creatingFolderIn]);

  // ── Folder handlers ───────────────────────────────────────────────────────

  function toggleFolder(id: string) {
    setExpandedFolderIds((prev) => {
      const next = new Set(prev);
      if (next.has(id)) {
        next.delete(id);
      } else {
        next.add(id);
      }
      return next;
    });
  }

  async function handleCreateFolder(parentId: string | null) {
    const name = newFolderName.trim();
    setNewFolderName("");
    if (!name) {
      setCreatingFolderIn(undefined);
      return;
    }

    // Immediately hide the input and show an optimistic folder row
    setCreatingFolderIn(undefined);
    const tempId = `temp-${Date.now()}`;
    const optimistic: LukeFolder = {
      id: tempId,
      application_id: applicationId,
      user_id: "",
      name,
      parent_folder_id: parentId,
      created_at: new Date().toISOString(),
      updated_at: new Date().toISOString(),
    };
    setFolders((prev) => [...prev, optimistic]);
    setExpandedFolderIds((prev) => new Set([...prev, tempId]));
    if (parentId) setExpandedFolderIds((prev) => new Set([...prev, parentId]));

    // Replace with real folder from API
    const folder = await createApplicationFolder(applicationId, name, parentId ?? undefined);
    setFolders((prev) => prev.map((f) => (f.id === tempId ? folder : f)));
    setExpandedFolderIds((prev) => {
      const next = new Set(prev);
      next.delete(tempId);
      next.add(folder.id);
      return next;
    });
  }

  async function handleRenameFolder(folderId: string) {
    const name = renameFolderValue.trim();
    setRenamingFolderId(null);
    if (!name) return;
    setFolders((prev) => prev.map((f) => (f.id === folderId ? { ...f, name } : f)));
    await renameApplicationFolder(applicationId, folderId, name);
  }

  async function handleDeleteFolder(folderId: string) {
    // Collect all subfolder IDs that will cascade-delete
    const toDelete = new Set<string>();
    function collectIds(id: string) {
      toDelete.add(id);
      folders.filter((f) => f.parent_folder_id === id).forEach((f) => collectIds(f.id));
    }
    collectIds(folderId);

    setFolders((prev) => prev.filter((f) => !toDelete.has(f.id)));
    setApplication((prev) =>
      prev
        ? {
            ...prev,
            documents: (prev.documents ?? []).map((d) =>
              d.folder_id && toDelete.has(d.folder_id) ? { ...d, folder_id: null } : d,
            ),
            reviews: (prev.reviews ?? []).map((r) =>
              r.folder_id && toDelete.has(r.folder_id) ? { ...r, folder_id: null } : r,
            ),
          }
        : prev,
    );
    await deleteApplicationFolder(applicationId, folderId);
  }

  // ── Doc/chat/review handlers ──────────────────────────────────────────────

  function handleDocsSelected(newDocs: LukeDocument[]) {
    setApplication((prev) =>
      prev
        ? {
            ...prev,
            documents: [
              ...(prev.documents || []),
              ...newDocs.filter((d) => !prev.documents?.some((e) => e.id === d.id)),
            ],
          }
        : prev,
    );
  }

  async function handleRemoveDocFromFolder(docId: string) {
    setApplication((prev) =>
      prev
        ? {
            ...prev,
            documents: (prev.documents ?? []).map((d) =>
              d.id === docId ? { ...d, folder_id: null } : d,
            ),
          }
        : prev,
    );
    await moveDocumentToFolder(applicationId, docId, null);
  }

  async function handleRemoveDoc(docId: string) {
    const doc = application?.documents?.find((d) => d.id === docId);
    // Backend only lets the doc creator delete. Warn the requester
    // instead of letting the request 404 silently.
    if (doc && user?.id && doc.user_id && doc.user_id !== user.id) {
      setOwnerOnlyAction("delete this document");
      return;
    }
    await deleteDocument(docId);
    setApplication((prev) =>
      prev ? { ...prev, documents: prev.documents?.filter((d) => d.id !== docId) || [] } : prev,
    );
  }

  async function handleNewChat() {
    setCreatingChat(true);
    try {
      const id = await saveChat(applicationId);
      if (id) router.push(`/applications/${applicationId}/assistant-next/chat/${id}`);
    } finally {
      setCreatingChat(false);
    }
  }

  function handleNewReview() {
    const docs = application?.documents?.filter((d) => d.status === "ready") || [];
    if (docs.length === 0) return;
    setNewTRModalOpen(true);
  }

  async function handleCreateReview(
    title: string,
    _applicationId?: string,
    documentIds?: string[],
    columnsConfig?: ColumnConfig[] | null,
  ) {
    setCreatingReview(true);
    try {
      const docs = application?.documents?.filter((d) => d.status === "ready") || [];
      const review = await createTabularReview({
        title: title || undefined,
        document_ids: documentIds ?? docs.map((d) => d.id),
        columns_config: columnsConfig ?? [],
        application_id: applicationId,
      });
      router.push(`/applications/${applicationId}/tabular-reviews/${review.id}`);
    } finally {
      setCreatingReview(false);
    }
  }

  async function handleTitleCommit(newName: string) {
    if (!newName || newName === application?.name) return;
    setApplication((prev) => (prev ? { ...prev, name: newName } : prev));
    await updateApplication(applicationId, { name: newName });
  }

  async function submitChatRename(chatId: string) {
    const trimmed = renameChatValue.trim();
    setRenamingChatId(null);
    if (!trimmed) return;
    const chat = chats.find((c) => c.id === chatId);
    if (chat && user?.id && !isSameOwner(chat.user_id, user.id)) {
      traceChatOwnerAction("rename", chat, "application.row", false);
      setOwnerOnlyAction("rename this chat");
      return;
    }
    traceChatOwnerAction("rename", chat, "application.row", true);
    setChats((prev) => prev.map((c) => (c.id === chatId ? { ...c, title: trimmed } : c)));
    await renameChat(chatId, trimmed);
  }

  async function submitReviewRename(reviewId: string) {
    const trimmed = renameReviewValue.trim();
    setRenamingReviewId(null);
    if (!trimmed) return;
    const review = (application?.reviews ?? []).find((r) => r.id === reviewId);
    if (review && user?.id && review.user_id !== user.id) {
      setOwnerOnlyAction("rename this tabular review");
      return;
    }
    setApplication((prev) =>
      prev
        ? {
            ...prev,
            reviews: (prev.reviews ?? []).map((r) =>
              r.id === reviewId ? { ...r, title: trimmed } : r,
            ),
          }
        : prev,
    );
    await updateTabularReview(reviewId, { title: trimmed });
  }

  async function downloadDoc(docId: string) {
    const { url, filename } = await getDocumentUrl(docId);
    const a = document.createElement("a");
    a.href = url;
    a.download = filename;
    a.click();
  }

  async function handleDownloadSelectedDocs() {
    setActionsOpen(false);
    const ids = [...selectedDocIds];
    if (ids.length === 1) {
      await downloadDoc(ids[0]);
      return;
    }
    const blob = await downloadDocumentsZip(ids);
    const a = document.createElement("a");
    a.href = URL.createObjectURL(blob);
    a.download = "documents.zip";
    a.click();
    URL.revokeObjectURL(a.href);
  }

  async function handleRemoveSelectedFromFolder() {
    const ids = selectedDocIds.filter((id) => {
      const folderId = docs.find((d) => d.id === id)?.folder_id;
      return folderId !== null && folderId !== undefined;
    });
    setActionsOpen(false);
    if (ids.length === 0) return;
    setApplication((prev) =>
      prev
        ? {
            ...prev,
            documents: (prev.documents ?? []).map((d) =>
              ids.includes(d.id) ? { ...d, folder_id: null } : d,
            ),
          }
        : prev,
    );
    await Promise.all(
      ids.map((id) => moveDocumentToFolder(applicationId, id, null).catch(() => {})),
    );
  }

  async function handleDeleteSelectedDocs() {
    const ids = [...selectedDocIds];
    setActionsOpen(false);
    // Filter to docs the requester owns (server-side gate).
    const owned = ids.filter((id) => {
      const d = application?.documents?.find((dd) => dd.id === id);
      return !d || !d.user_id || !user?.id || d.user_id === user.id;
    });
    const blocked = ids.length - owned.length;
    setSelectedDocIds([]);
    await Promise.all(owned.map((id) => deleteDocument(id).catch(() => {})));
    setApplication((prev) =>
      prev
        ? { ...prev, documents: prev.documents?.filter((d) => !owned.includes(d.id)) || [] }
        : prev,
    );
    if (blocked > 0) {
      setOwnerOnlyAction(
        `delete ${blocked} of the selected documents — only the document creator can delete a document`,
      );
    }
  }

  async function handleDeleteSelectedChats() {
    const ids = [...selectedChatIds];
    setActionsOpen(false);
    const owned = ids.filter((id) => {
      const c = chats.find((cc) => cc.id === id);
      const allowed = !c || !user?.id || isSameOwner(c.user_id, user.id);
      traceChatOwnerAction("delete", c, "application.bulk", allowed);
      return allowed;
    });
    const blocked = ids.length - owned.length;
    setSelectedChatIds([]);
    await Promise.all(owned.map((id) => deleteChat(id).catch(() => {})));
    setChats((prev) => prev.filter((c) => !owned.includes(c.id)));
    if (blocked > 0) {
      setOwnerOnlyAction(
        `delete ${blocked} of the selected chats — only the chat creator can delete a chat`,
      );
    }
  }

  async function handleDeleteSelectedReviews() {
    const ids = [...selectedReviewIds];
    setActionsOpen(false);
    const owned = ids.filter((id) => {
      const r = (application?.reviews ?? []).find((rr) => rr.id === id);
      return !r || !user?.id || r.user_id === user.id;
    });
    const blocked = ids.length - owned.length;
    setSelectedReviewIds([]);
    await Promise.all(owned.map((id) => deleteTabularReview(id).catch(() => {})));
    setApplication((prev) =>
      prev ? { ...prev, reviews: (prev.reviews ?? []).filter((r) => !owned.includes(r.id)) } : prev,
    );
    if (blocked > 0) {
      setOwnerOnlyAction(
        `delete ${blocked} of the selected reviews — only the review creator can delete a review`,
      );
    }
  }

  // ── Drag & drop ───────────────────────────────────────────────────────────

  function wouldCreateCycle(movingId: string, targetId: string): boolean {
    // Returns true if targetId is movingId or a descendant of it
    let cur: LukeFolder | undefined = folders.find((f) => f.id === targetId);
    while (cur) {
      if (cur.id === movingId) return true;
      if (!cur.parent_folder_id) break;
      cur = folders.find((f) => f.id === cur!.parent_folder_id);
    }
    return false;
  }

  async function handleDropOnFolder(targetFolderId: string | null, dt: DataTransfer) {
    const docId = dt.getData("application/luke-doc");
    const reviewId = dt.getData("application/luke-review");
    const subFolderId = dt.getData("application/luke-folder");
    if (docId) {
      const doc = (application?.documents ?? []).find((d) => d.id === docId);
      if (!doc || (doc.folder_id ?? null) === targetFolderId) return;
      setApplication((prev) =>
        prev
          ? {
              ...prev,
              documents: (prev.documents ?? []).map((d) =>
                d.id === docId ? { ...d, folder_id: targetFolderId } : d,
              ),
            }
          : prev,
      );
      await moveDocumentToFolder(applicationId, docId, targetFolderId);
    } else if (reviewId) {
      const review = (application?.reviews ?? []).find((r) => r.id === reviewId);
      if (!review || (review.folder_id ?? null) === targetFolderId) return;
      setApplication((prev) =>
        prev
          ? {
              ...prev,
              reviews: (prev.reviews ?? []).map((r) =>
                r.id === reviewId ? { ...r, folder_id: targetFolderId } : r,
              ),
            }
          : prev,
      );
      await moveTabularReviewToFolder(applicationId, reviewId, targetFolderId);
    } else if (subFolderId && subFolderId !== targetFolderId) {
      if (targetFolderId !== null && wouldCreateCycle(subFolderId, targetFolderId)) return;
      const folder = folders.find((f) => f.id === subFolderId);
      if (!folder || (folder.parent_folder_id ?? null) === targetFolderId) return;
      setFolders((prev) =>
        prev.map((f) => (f.id === subFolderId ? { ...f, parent_folder_id: targetFolderId } : f)),
      );
      await moveSubfolderToFolder(applicationId, subFolderId, targetFolderId);
    }
  }

  // ── Tree rendering ────────────────────────────────────────────────────────

  function renderFolderInput(parentId: string | null) {
    if (creatingFolderIn !== parentId) return null;
    return (
      <div
        ref={newFolderInputRef}
        className="group flex h-10 items-center border-b border-gray-50 pr-8"
        key={`new-folder-${parentId ?? "root"}`}
      >
        <div className={`sticky left-0 z-[60] ${CHECK_W} self-stretch bg-white`} />
        <div className={`sticky left-8 z-[60] ${NAME_COL_W} bg-white p-2`}>
          <div className="flex items-center gap-1.5">
            <ChevronRight className="h-3.5 w-3.5 shrink-0 text-gray-300" />
            <FolderPlus className="h-4 w-4 shrink-0 text-amber-400" />
            <input
              autoFocus
              className="min-w-0 flex-1 border-b border-gray-300 bg-transparent text-sm text-gray-800 outline-none"
              placeholder="Folder name"
              value={newFolderName}
              onChange={(e) => setNewFolderName(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === "Enter") void handleCreateFolder(parentId);
                if (e.key === "Escape") {
                  setCreatingFolderIn(undefined);
                  setNewFolderName("");
                }
              }}
              onBlur={() => void handleCreateFolder(parentId)}
            />
          </div>
        </div>
        <div className="ml-auto w-20 shrink-0" />
        <div className="w-24 shrink-0" />
        <div className="w-20 shrink-0" />
        <div className="w-32 shrink-0" />
        <div className="w-32 shrink-0" />
        <div className="w-8 shrink-0" />
      </div>
    );
  }

  // Shared review-row renderer used by the unified Documents view in both
  // search-mode (flat) and folder-tree (per-level) layouts. Reviews share
  // the docs table columns: Name (title), Type ("Review"), Size/Version
  // em-dashes, Created, Updated. Clicking opens the tabular review page.
  function renderReviewRow(review: TabularReview) {
    const selected = selectedReviewIds.includes(review.id);
    const isRenaming = renamingReviewId === review.id;
    const rowBg = selected ? "bg-gray-50" : "bg-white";
    return (
      <div
        key={`review-${review.id}`}
        draggable={!isRenaming}
        onDragStart={(e) => {
          e.dataTransfer.setData("application/luke-review", review.id);
          e.dataTransfer.effectAllowed = "move";
        }}
        onClick={() => {
          if (isRenaming) return;
          router.push(`/applications/${applicationId}/tabular-reviews/${review.id}`);
        }}
        onContextMenu={(e) => e.stopPropagation()}
        className="group flex h-10 cursor-pointer items-center border-b border-gray-50 pr-8 transition-colors hover:bg-gray-50"
      >
        <div
          className={`sticky left-0 z-[60] ${CHECK_W} flex items-center justify-center p-2 ${rowBg} group-hover:bg-gray-50`}
          onClick={(e) => e.stopPropagation()}
        >
          <input
            type="checkbox"
            checked={selected}
            onChange={() =>
              setSelectedReviewIds((prev) =>
                prev.includes(review.id)
                  ? prev.filter((x) => x !== review.id)
                  : [...prev, review.id],
              )
            }
            className="h-2.5 w-2.5 cursor-pointer rounded border-gray-200 accent-black"
          />
        </div>
        <div className={`sticky left-8 z-[60] ${NAME_COL_W} p-2 ${rowBg} group-hover:bg-gray-50`}>
          <div className="flex items-center gap-2">
            <Table2 className="h-4 w-4 shrink-0 text-gray-400" />
            {isRenaming ? (
              <input
                autoFocus
                value={renameReviewValue}
                onChange={(e) => setRenameReviewValue(e.target.value)}
                onKeyDown={(e) => {
                  if (e.key === "Enter") submitReviewRename(review.id);
                  if (e.key === "Escape") setRenamingReviewId(null);
                }}
                onBlur={() => submitReviewRename(review.id)}
                onClick={(e) => e.stopPropagation()}
                className="min-w-0 flex-1 bg-transparent text-sm text-gray-800 outline-none"
              />
            ) : (
              <span className="truncate text-sm text-gray-800">
                {review.title ?? "Untitled Review"}
              </span>
            )}
          </div>
        </div>
        <div className="ml-auto w-20 shrink-0 truncate text-xs text-gray-500 uppercase">Review</div>
        <div className="w-24 shrink-0 truncate text-sm text-gray-500">
          {(review.document_count ?? 0) > 0 ? (
            `${review.document_count} doc${review.document_count === 1 ? "" : "s"}`
          ) : (
            <span className="text-gray-300">—</span>
          )}
        </div>
        <div className="w-20 shrink-0 truncate text-sm text-gray-500">
          {(review.columns_config?.length ?? 0) > 0 ? (
            `${review.columns_config!.length} col${review.columns_config!.length === 1 ? "" : "s"}`
          ) : (
            <span className="text-gray-300">—</span>
          )}
        </div>
        <div className="w-32 shrink-0 truncate text-sm text-gray-500">
          {review.created_at ? (
            formatDate(review.created_at)
          ) : (
            <span className="text-gray-300">—</span>
          )}
        </div>
        <div className="w-32 shrink-0 truncate text-sm text-gray-500">
          {review.updated_at ? (
            formatDate(review.updated_at)
          ) : (
            <span className="text-gray-300">—</span>
          )}
        </div>
        <div className="flex w-8 shrink-0 justify-end" onClick={(e) => e.stopPropagation()}>
          <RowActions
            onRename={() => {
              if (user?.id && review.user_id !== user.id) {
                setOwnerOnlyAction("rename this tabular review");
                return;
              }
              setRenameReviewValue(review.title ?? "Untitled Review");
              setRenamingReviewId(review.id);
            }}
            onRemoveFromFolder={
              review.folder_id
                ? async () => {
                    setApplication((prev) =>
                      prev
                        ? {
                            ...prev,
                            reviews: (prev.reviews ?? []).map((r) =>
                              r.id === review.id ? { ...r, folder_id: null } : r,
                            ),
                          }
                        : prev,
                    );
                    await moveTabularReviewToFolder(applicationId, review.id, null);
                  }
                : undefined
            }
            onDelete={async () => {
              if (user?.id && review.user_id !== user.id) {
                setOwnerOnlyAction("delete this tabular review");
                return;
              }
              await deleteTabularReview(review.id);
              setApplication((prev) =>
                prev
                  ? { ...prev, reviews: (prev.reviews ?? []).filter((r) => r.id !== review.id) }
                  : prev,
              );
            }}
          />
        </div>
      </div>
    );
  }

  function renderLevel(parentId: string | null, depth: number) {
    const childFolders = folders
      .filter((f) => f.parent_folder_id === parentId)
      .sort((a, b) => a.name.localeCompare(b.name));
    const childDocs = (application?.documents ?? []).filter(
      (d) => (d.folder_id ?? null) === parentId,
    );
    const childReviews = (application?.reviews ?? []).filter(
      (r) => (r.folder_id ?? null) === parentId,
    );

    return (
      <>
        {/* Files first */}
        {childDocs.map((doc) => {
          const isProcessing = doc.status === "pending" || doc.status === "processing";
          const isError = doc.status === "error";
          const isVersionsOpen = expandedVersionDocIds.has(doc.id);
          const hasVersions =
            typeof doc.latest_version_number === "number" && doc.latest_version_number >= 1;
          return (
            <div key={`doc-${doc.id}`}>
              <div
                draggable
                onDragStart={(e) => {
                  e.dataTransfer.setData("application/luke-doc", doc.id);
                  e.dataTransfer.effectAllowed = "move";
                }}
                onClick={() => {
                  setViewingDocVersion(null);
                  setViewingDoc(doc);
                }}
                onContextMenu={(e) => e.stopPropagation()}
                className="group flex h-10 cursor-pointer items-center border-b border-gray-50 pr-8 transition-colors hover:bg-gray-50"
              >
                {(() => {
                  const rowBg = selectedDocIds.includes(doc.id) ? "bg-gray-50" : "bg-white";
                  return (
                    <>
                      <div
                        className={`sticky left-0 z-[60] ${CHECK_W} flex items-center justify-center p-2 ${rowBg} group-hover:bg-gray-50`}
                        onClick={(e) => e.stopPropagation()}
                      >
                        <input
                          type="checkbox"
                          checked={selectedDocIds.includes(doc.id)}
                          onChange={() =>
                            setSelectedDocIds((prev) =>
                              prev.includes(doc.id)
                                ? prev.filter((x) => x !== doc.id)
                                : [...prev, doc.id],
                            )
                          }
                          className="h-2.5 w-2.5 cursor-pointer rounded border-gray-200 accent-black"
                        />
                      </div>
                      <div
                        className={`sticky left-8 z-[60] ${NAME_COL_W} p-2 ${rowBg} group-hover:bg-gray-50`}
                      >
                        <div className="flex items-center gap-2">
                          {isProcessing ? (
                            <Loader2 className="h-4 w-4 shrink-0 animate-spin text-gray-400" />
                          ) : isError ? (
                            <AlertCircle className="h-4 w-4 shrink-0 text-red-500" />
                          ) : (
                            <DocIcon fileType={doc.file_type} />
                          )}
                          <span className="truncate text-sm text-gray-800">{doc.filename}</span>
                        </div>
                      </div>
                      <div className="ml-auto w-20 shrink-0 truncate text-xs text-gray-500 uppercase">
                        {doc.file_type ?? <span className="text-gray-300">—</span>}
                      </div>
                      <div className="w-24 shrink-0 truncate text-sm text-gray-500">
                        {doc.size_bytes !== null && doc.size_bytes !== undefined ? (
                          formatBytes(doc.size_bytes)
                        ) : (
                          <span className="text-gray-300">—</span>
                        )}
                      </div>
                      <div
                        className="flex w-20 shrink-0 items-center gap-1 text-sm text-gray-500"
                        onClick={(e) => e.stopPropagation()}
                      >
                        {hasVersions ? (
                          <button
                            onClick={() => void toggleVersions(doc.id)}
                            className="flex items-center gap-1 rounded px-1 py-0.5 transition-colors hover:bg-gray-100"
                          >
                            <span>{doc.latest_version_number}</span>
                            {isVersionsOpen ? (
                              <ChevronDown className="h-3 w-3 text-gray-400" />
                            ) : (
                              <ChevronRight className="h-3 w-3 text-gray-400" />
                            )}
                          </button>
                        ) : (
                          <span className="pl-1 text-gray-300">—</span>
                        )}
                      </div>
                      <div className="w-32 shrink-0 truncate text-sm text-gray-500">
                        {doc.created_at ? (
                          formatDate(doc.created_at)
                        ) : (
                          <span className="text-gray-300">—</span>
                        )}
                      </div>
                      <div className="w-32 shrink-0 truncate text-sm text-gray-500">
                        {doc.updated_at ? (
                          formatDate(doc.updated_at)
                        ) : (
                          <span className="text-gray-300">—</span>
                        )}
                      </div>
                      <div className="flex w-8 shrink-0 justify-end">
                        {!isProcessing && (
                          <RowActions
                            onDownload={() => downloadDoc(doc.id)}
                            onShowAllVersions={
                              hasVersions && !isVersionsOpen
                                ? () => void toggleVersions(doc.id)
                                : undefined
                            }
                            onUploadNewVersion={() => void handleUploadNewVersion(doc)}
                            onRemoveFromFolder={
                              doc.folder_id ? () => handleRemoveDocFromFolder(doc.id) : undefined
                            }
                            onDelete={() => handleRemoveDoc(doc.id)}
                          />
                        )}
                      </div>
                    </>
                  );
                })()}
              </div>
              {isVersionsOpen && (
                <DocVersionHistory
                  docId={doc.id}
                  filename={doc.filename}
                  loading={loadingVersionDocIds.has(doc.id)}
                  versions={versionsByDocId.get(doc.id) ?? []}
                  onDownloadVersion={downloadDocVersion}
                  onOpenVersion={(versionId, label) => {
                    setViewingDocVersion({ id: versionId, label });
                    setViewingDoc(doc);
                  }}
                  onRenameVersion={(versionId, displayName) =>
                    handleRenameVersion(doc.id, versionId, displayName)
                  }
                />
              )}
            </div>
          );
        })}

        {/* Tabular reviews appear alongside docs in this folder */}
        {childReviews.map((review) => renderReviewRow(review))}

        {/* Subfolders after files, sorted alphabetically */}
        {childFolders.map((folder) => {
          const isExpanded = expandedFolderIds.has(folder.id);
          const isRenaming = renamingFolderId === folder.id;
          return (
            <div key={`folder-${folder.id}`}>
              <div
                draggable
                onDragStart={(e) => {
                  e.dataTransfer.setData("application/luke-folder", folder.id);
                  e.dataTransfer.effectAllowed = "move";
                  e.stopPropagation();
                }}
                onDragOver={(e) => {
                  e.preventDefault();
                  e.stopPropagation();
                  setDragOverFolderId(folder.id);
                }}
                onDragLeave={(e) => {
                  e.stopPropagation();
                  setDragOverFolderId(null);
                }}
                onDrop={async (e) => {
                  e.preventDefault();
                  e.stopPropagation();
                  setDragOverFolderId(null);
                  setDragOverRoot(false);
                  await handleDropOnFolder(folder.id, e.dataTransfer);
                }}
                onClick={() => toggleFolder(folder.id)}
                onContextMenu={(e) => {
                  e.preventDefault();
                  e.stopPropagation();
                  setContextMenu({
                    x: e.clientX,
                    y: e.clientY,
                    folderId: folder.id,
                    showFolderActions: true,
                  });
                }}
                className={`group flex h-10 cursor-pointer items-center border-b border-gray-50 pr-8 transition-colors select-none hover:bg-gray-50 ${dragOverFolderId === folder.id ? "bg-blue-50 ring-1 ring-blue-200 ring-inset" : ""}`}
              >
                <div
                  className={`sticky left-0 z-[60] ${CHECK_W} flex items-center justify-center p-2 ${dragOverFolderId === folder.id ? "bg-blue-50" : "bg-white"} self-stretch group-hover:bg-gray-50`}
                >
                  {isExpanded ? (
                    <ChevronDown className="h-3.5 w-3.5 shrink-0 text-gray-400" />
                  ) : (
                    <ChevronRight className="h-3.5 w-3.5 shrink-0 text-gray-400" />
                  )}
                </div>
                <div
                  className={`sticky left-8 z-[60] ${NAME_COL_W} p-2 ${dragOverFolderId === folder.id ? "bg-blue-50" : "bg-white"} group-hover:bg-gray-50`}
                >
                  <div className="flex items-center gap-1.5">
                    {isExpanded ? (
                      <FolderOpen className="h-4 w-4 shrink-0 text-amber-500" />
                    ) : (
                      <Folder className="h-4 w-4 shrink-0 text-amber-500" />
                    )}
                    {isRenaming ? (
                      <input
                        autoFocus
                        className="min-w-0 flex-1 bg-transparent text-sm text-gray-800 outline-none"
                        value={renameFolderValue}
                        onChange={(e) => setRenameFolderValue(e.target.value)}
                        onKeyDown={(e) => {
                          if (e.key === "Enter") void handleRenameFolder(folder.id);
                          if (e.key === "Escape") setRenamingFolderId(null);
                        }}
                        onBlur={() => void handleRenameFolder(folder.id)}
                        onClick={(e) => e.stopPropagation()}
                      />
                    ) : (
                      <span className="truncate text-sm text-gray-800">{folder.name}</span>
                    )}
                  </div>
                </div>
                <div className="ml-auto w-20 shrink-0 text-xs text-gray-300">—</div>
                <div className="w-24 shrink-0 text-sm text-gray-300">—</div>
                <div className="w-20 shrink-0 text-sm text-gray-300">—</div>
                <div className="w-32 shrink-0 text-sm text-gray-300">—</div>
                <div className="w-32 shrink-0 text-sm text-gray-300">—</div>
                <div className="flex w-8 shrink-0 justify-end" onClick={(e) => e.stopPropagation()}>
                  <RowActions
                    onRename={() => {
                      setRenameFolderValue(folder.name);
                      setRenamingFolderId(folder.id);
                    }}
                    onDelete={() => handleDeleteFolder(folder.id)}
                  />
                </div>
              </div>
              {isExpanded && renderLevel(folder.id, depth + 1)}
            </div>
          );
        })}

        {/* New-folder input row at the bottom of this level */}
        {renderFolderInput(parentId)}
      </>
    );
  }

  // ── Loading skeleton ──────────────────────────────────────────────────────

  if (loading) {
    return (
      <div className="flex-1 overflow-y-auto bg-white">
        <div className="flex items-start justify-between px-8 py-4">
          <div className="flex items-center gap-1.5 font-serif text-2xl font-medium">
            <span className="text-gray-400">Applications</span>
            <span className="text-gray-300">›</span>
            <div className="h-6 w-40 animate-pulse rounded bg-gray-100" />
          </div>
          <div className="flex items-center gap-2">
            <div className="h-8 w-16 animate-pulse rounded bg-gray-100" />
            <div className="h-8 w-28 animate-pulse rounded bg-gray-100" />
          </div>
        </div>
        <div className="flex h-10 items-center gap-5 border-b border-gray-200 px-8">
          <div className="h-3 w-20 animate-pulse rounded bg-gray-100" />
          <div className="h-3 w-10 animate-pulse rounded bg-gray-100" />
          <div className="h-3 w-24 animate-pulse rounded bg-gray-100" />
        </div>
        <div className="flex h-8 items-center border-b border-gray-200 pr-8">
          <div className="w-8 shrink-0" />
          <div className="min-w-0 flex-1 pr-4 pl-3">
            <div className="h-2.5 w-8 animate-pulse rounded bg-gray-100" />
          </div>
          <div className="w-20 shrink-0">
            <div className="h-2.5 w-8 animate-pulse rounded bg-gray-100" />
          </div>
          <div className="w-24 shrink-0">
            <div className="h-2.5 w-8 animate-pulse rounded bg-gray-100" />
          </div>
          <div className="w-8 shrink-0" />
        </div>
        {[1, 2, 3, 4, 5].map((i) => (
          <div key={i} className="flex h-10 items-center border-b border-gray-50 pr-8">
            <div className="w-8 shrink-0" />
            <div className="min-w-0 flex-1 pr-4 pl-3">
              <div className="h-3.5 w-56 animate-pulse rounded bg-gray-100" />
            </div>
            <div className="w-20 shrink-0">
              <div className="h-3 w-8 animate-pulse rounded bg-gray-100" />
            </div>
            <div className="w-24 shrink-0">
              <div className="h-3 w-12 animate-pulse rounded bg-gray-100" />
            </div>
            <div className="w-8 shrink-0" />
          </div>
        ))}
      </div>
    );
  }

  if (!application) {
    return (
      <div className="flex h-full items-center justify-center">
        <p className="text-gray-400">Application not found</p>
      </div>
    );
  }

  const docs = application.documents || [];
  const reviews = application.reviews ?? [];
  const q = search.toLowerCase();
  const filteredDocs = q ? docs.filter((d) => d.filename.toLowerCase().includes(q)) : docs;
  const filteredChats = q ? chats.filter((c) => (c.title ?? "").toLowerCase().includes(q)) : chats;
  const filteredReviews = q
    ? reviews.filter((r) => (r.title ?? "").toLowerCase().includes(q))
    : reviews;

  // In the unified Documents view, the header checkbox + bulk actions span
  // both docs and reviews. Selection state is still kept in two arrays
  // because the delete/move calls go to different endpoints — they're
  // joined here for the toolbar's "all selected" indicators.
  const allDocsAndReviewsSelected =
    filteredDocs.length + filteredReviews.length > 0 &&
    filteredDocs.every((d) => selectedDocIds.includes(d.id)) &&
    filteredReviews.every((r) => selectedReviewIds.includes(r.id));
  const someDocsAndReviewsSelected =
    !allDocsAndReviewsSelected &&
    (filteredDocs.some((d) => selectedDocIds.includes(d.id)) ||
      filteredReviews.some((r) => selectedReviewIds.includes(r.id)));
  const allChatsSelected =
    filteredChats.length > 0 && filteredChats.every((c) => selectedChatIds.includes(c.id));
  const someChatsSelected =
    !allChatsSelected && filteredChats.some((c) => selectedChatIds.includes(c.id));

  const currentSelectionCount =
    tab === "documents" ? selectedDocIds.length + selectedReviewIds.length : selectedChatIds.length;

  const handleDeleteSelectedAll = async () => {
    // Dispatch in parallel to the right backends. Both helpers already
    // close the Actions menu and warn about owner-only failures.
    await Promise.all([
      selectedDocIds.length > 0 ? handleDeleteSelectedDocs() : Promise.resolve(),
      selectedReviewIds.length > 0 ? handleDeleteSelectedReviews() : Promise.resolve(),
    ]);
  };
  const handleDeleteSelected =
    tab === "documents" ? handleDeleteSelectedAll : handleDeleteSelectedChats;

  const actionsDropdown =
    currentSelectionCount > 0 ? (
      <div ref={actionsRef} className="relative">
        <button
          onClick={() => setActionsOpen((v) => !v)}
          className="flex items-center gap-1 text-xs font-medium text-gray-700 transition-colors hover:text-gray-900"
        >
          Actions
          <ChevronDown className="h-3.5 w-3.5" />
        </button>
        {actionsOpen && (
          <div className="absolute top-full right-0 z-50 mt-1 w-36 overflow-hidden rounded-lg border border-gray-100 bg-white shadow-lg">
            {tab === "documents" && (
              <button
                onClick={handleDownloadSelectedDocs}
                className="w-full px-3 py-1.5 text-left text-xs text-gray-600 transition-colors hover:bg-gray-50"
              >
                Download
              </button>
            )}
            {tab === "documents" &&
              selectedDocIds.some((id) => {
                const folderId = docs.find((d) => d.id === id)?.folder_id;
                return folderId !== null && folderId !== undefined;
              }) && (
                <button
                  onClick={handleRemoveSelectedFromFolder}
                  className="w-full px-3 py-1.5 text-left text-xs text-gray-600 transition-colors hover:bg-gray-50"
                >
                  Remove from subfolder
                </button>
              )}
            <button
              onClick={handleDeleteSelected}
              className="w-full px-3 py-1.5 text-left text-xs text-red-600 transition-colors hover:bg-red-50"
            >
              Delete
            </button>
          </div>
        )}
      </div>
    ) : null;

  const toolbarActions = (
    <div className="flex items-center gap-2">
      {actionsDropdown}
      {tab === "documents" && (
        <>
          <button
            onClick={() => {
              setCreatingFolderIn(null);
              setNewFolderName("");
            }}
            className="flex items-center gap-1 px-3 text-xs font-medium text-gray-500 transition-colors hover:text-gray-700"
          >
            <FolderPlus className="h-3.5 w-3.5" />
            Add Subfolder
          </button>
          <button
            onClick={() => setAddDocsOpen(true)}
            className="flex items-center gap-1 px-3 text-xs font-medium text-gray-500 transition-colors hover:text-gray-700"
          >
            <Upload className="h-3.5 w-3.5" />
            Add Documents
          </button>
        </>
      )}
    </div>
  );

  return (
    <div className="flex h-full flex-1 flex-col overflow-y-auto bg-white">
      {/* Page header */}
      <div className="flex items-start justify-between px-8 py-4">
        <div>
          <div className="flex items-center gap-1.5 font-serif text-2xl font-medium">
            <button
              onClick={() => router.push("/applications")}
              className="text-gray-400 transition-colors hover:text-gray-600"
            >
              Applications
            </button>
            <span className="text-gray-300">›</span>
            {tab !== "documents" ? (
              <button
                onClick={() => router.push(`/applications/${applicationId}`)}
                className="text-gray-500 transition-colors hover:text-gray-700"
              >
                {application.name}
              </button>
            ) : (
              <RenameableTitle value={application.name} onCommit={handleTitleCommit} />
            )}
            {tab !== "documents" && (
              <>
                <span className="text-gray-300">›</span>
                <span className="text-gray-900">
                  {tab === "assistant" ? "Assistant" : "Tabular Reviews"}
                </span>
              </>
            )}
          </div>
          <div className="mt-1 flex items-center gap-2">
            {application.company_name && (
              <button
                onClick={() => router.push("/companies")}
                className="text-xs text-gray-400 transition-colors hover:text-gray-700"
              >
                {application.company_name}
              </button>
            )}
            <span
              className={`inline-flex items-center rounded-full px-2 py-0.5 text-[10px] font-medium ${
                (application.status ?? "in_progress") === "closed"
                  ? "bg-gray-100 text-gray-500"
                  : "bg-emerald-50 text-emerald-700"
              }`}
            >
              {(application.status ?? "in_progress") === "closed" ? "Closed" : "In progress"}
            </span>
            {application.job_description_url && (
              <a
                href={application.job_description_url}
                target="_blank"
                rel="noreferrer"
                className="text-xs text-gray-400 transition-colors hover:text-gray-700"
                title="Open job description"
              >
                Job posting ↗
              </a>
            )}
          </div>
        </div>
        <div className="flex items-center gap-2">
          <HeaderSearchBtn value={search} onChange={setSearch} placeholder="Search…" />
          <div className="group relative">
            <button
              onClick={() => !creatingChat && handleNewChat()}
              className={`flex h-8 items-center justify-center gap-1.5 px-3 text-sm transition-colors ${
                !creatingChat
                  ? "cursor-pointer text-gray-500 hover:text-gray-900"
                  : "cursor-default text-gray-300"
              }`}
            >
              {creatingChat ? (
                <Loader2 className="h-4 w-4 animate-spin" />
              ) : (
                <Plus className="h-4 w-4" />
              )}
              Chat
            </button>
          </div>
          <div className="group relative">
            <button
              onClick={() => docs.length > 0 && !creatingReview && handleNewReview()}
              className={`flex h-8 items-center justify-center gap-1.5 px-3 text-sm transition-colors ${
                docs.length > 0
                  ? "cursor-pointer text-gray-500 hover:text-gray-900"
                  : "cursor-default text-gray-300"
              }`}
            >
              {creatingReview ? (
                <Loader2 className="h-4 w-4 animate-spin" />
              ) : (
                <Plus className="h-4 w-4" />
              )}
              Tabular Review
            </button>
            {docs.length === 0 && (
              <div className="pointer-events-none absolute top-full right-0 z-10 mt-1.5 hidden items-center rounded-lg bg-gray-900 px-2.5 py-1.5 text-xs whitespace-nowrap text-white shadow-lg group-hover:flex">
                Upload a document first
              </div>
            )}
          </div>
        </div>
      </div>

      <ToolbarTabs
        tabs={[
          { id: "documents", label: "Documents" },
          { id: "assistant", label: "Assistant" },
        ]}
        active={tab}
        onChange={handleTabChange}
        actions={<>{toolbarActions}</>}
      />

      {/* Table content */}
      <div className="min-h-0 w-full flex-1 overflow-x-auto">
        <div className="flex min-h-full min-w-max flex-col">
          {/* Tab: Documents */}
          {tab === "documents" && (
            <div className="flex min-h-0 flex-1 flex-col">
              <LibraryDocumentsSection documents={application.library_documents} />
              {/* Table header */}
              <div className="flex h-8 shrink-0 items-center border-b border-gray-200 pr-8 text-xs font-medium text-gray-500 select-none">
                <div
                  className={`sticky left-0 z-[60] ${CHECK_W} relative flex items-center justify-center self-stretch bg-white before:absolute before:inset-x-0 before:bottom-0 before:h-px before:bg-white`}
                >
                  <input
                    type="checkbox"
                    checked={allDocsAndReviewsSelected}
                    ref={(el) => {
                      if (el) el.indeterminate = someDocsAndReviewsSelected;
                    }}
                    onChange={() => {
                      if (allDocsAndReviewsSelected) {
                        setSelectedDocIds([]);
                        setSelectedReviewIds([]);
                      } else {
                        setSelectedDocIds(filteredDocs.map((d) => d.id));
                        setSelectedReviewIds(filteredReviews.map((r) => r.id));
                      }
                    }}
                    className="h-2.5 w-2.5 cursor-pointer rounded border-gray-200 accent-black"
                  />
                </div>
                <div className={`sticky left-8 z-[60] ${NAME_COL_W} bg-white pl-2 text-left`}>
                  Name
                </div>
                <div className="ml-auto w-20 shrink-0 text-left">Type</div>
                <div className="w-24 shrink-0 text-left">Size</div>
                <div className="w-20 shrink-0 text-left">Version</div>
                <div className="w-32 shrink-0 text-left">Created</div>
                <div className="w-32 shrink-0 text-left">Updated</div>
                <div className="w-8 shrink-0" />
              </div>

              {/* Blue ring wraps everything below the header when root-dropping */}
              <div className="relative flex min-h-0 flex-1 flex-col">
                {dragOverRoot && dragOverFolderId === null && (
                  <div className="pointer-events-none absolute inset-0 z-20 border-2 border-blue-400" />
                )}

                {/* Empty state */}
                {docs.length === 0 && folders.length === 0 && reviews.length === 0 ? (
                  <div
                    onClick={() => setAddDocsOpen(true)}
                    className="flex flex-1 cursor-pointer flex-col items-center justify-center py-24 text-center"
                  >
                    <Upload className="mb-3 h-8 w-8 text-gray-200" />
                    <p className="text-sm text-gray-400">Drop PDF or DOCX files here</p>
                  </div>
                ) : (
                  <div
                    className="flex flex-1 flex-col"
                    onContextMenu={(e) => {
                      e.preventDefault();
                      setContextMenu({
                        x: e.clientX,
                        y: e.clientY,
                        folderId: null,
                        showFolderActions: false,
                      });
                    }}
                    onClick={() => setContextMenu(null)}
                    onDragOver={(e) => {
                      e.preventDefault();
                      setDragOverRoot(true);
                    }}
                    onDragLeave={(e) => {
                      if (!e.currentTarget.contains(e.relatedTarget as Node)) {
                        setDragOverRoot(false);
                      }
                    }}
                    onDrop={async (e) => {
                      e.preventDefault();
                      setDragOverRoot(false);
                      setDragOverFolderId(null);
                      await handleDropOnFolder(null, e.dataTransfer);
                    }}
                  >
                    {/* Search: flat list (docs + reviews); no search: folder tree */}
                    {q ? filteredReviews.map((review) => renderReviewRow(review)) : null}
                    {q
                      ? filteredDocs.map((doc) => {
                          const isProcessing =
                            doc.status === "pending" || doc.status === "processing";
                          const isError = doc.status === "error";
                          const isVersionsOpen = expandedVersionDocIds.has(doc.id);
                          const hasVersions =
                            typeof doc.latest_version_number === "number" &&
                            doc.latest_version_number >= 1;
                          return (
                            <div key={doc.id}>
                              <div
                                onClick={() => {
                                  setViewingDocVersion(null);
                                  setViewingDoc(doc);
                                }}
                                className="group flex h-10 cursor-pointer items-center border-b border-gray-50 pr-8 transition-colors hover:bg-gray-50"
                              >
                                <div
                                  className={`sticky left-0 z-[60] ${CHECK_W} flex items-center justify-center p-2 ${selectedDocIds.includes(doc.id) ? "bg-gray-50" : "bg-white"} group-hover:bg-gray-50`}
                                  onClick={(e) => e.stopPropagation()}
                                >
                                  <input
                                    type="checkbox"
                                    checked={selectedDocIds.includes(doc.id)}
                                    onChange={() =>
                                      setSelectedDocIds((prev) =>
                                        prev.includes(doc.id)
                                          ? prev.filter((x) => x !== doc.id)
                                          : [...prev, doc.id],
                                      )
                                    }
                                    className="h-2.5 w-2.5 cursor-pointer rounded border-gray-200 accent-black"
                                  />
                                </div>
                                <div
                                  className={`sticky left-8 z-[60] ${NAME_COL_W} p-2 ${selectedDocIds.includes(doc.id) ? "bg-gray-50" : "bg-white"} group-hover:bg-gray-50`}
                                >
                                  <div className="flex items-center gap-2">
                                    {isProcessing ? (
                                      <Loader2 className="h-4 w-4 shrink-0 animate-spin text-gray-400" />
                                    ) : isError ? (
                                      <AlertCircle className="h-4 w-4 shrink-0 text-red-500" />
                                    ) : (
                                      <DocIcon fileType={doc.file_type} />
                                    )}
                                    <span className="truncate text-sm text-gray-800">
                                      {doc.filename}
                                    </span>
                                  </div>
                                </div>
                                <div className="ml-auto w-20 shrink-0 truncate text-xs text-gray-500 uppercase">
                                  {doc.file_type ?? <span className="text-gray-300">—</span>}
                                </div>
                                <div className="w-24 shrink-0 truncate text-sm text-gray-500">
                                  {doc.size_bytes !== null && doc.size_bytes !== undefined ? (
                                    formatBytes(doc.size_bytes)
                                  ) : (
                                    <span className="text-gray-300">—</span>
                                  )}
                                </div>
                                <div
                                  className="flex w-20 shrink-0 items-center gap-1 text-sm text-gray-500"
                                  onClick={(e) => e.stopPropagation()}
                                >
                                  {hasVersions ? (
                                    <button
                                      onClick={() => void toggleVersions(doc.id)}
                                      className="flex items-center gap-1 rounded px-1 py-0.5 transition-colors hover:bg-gray-100"
                                    >
                                      <span>{doc.latest_version_number}</span>
                                      {isVersionsOpen ? (
                                        <ChevronDown className="h-3 w-3 text-gray-400" />
                                      ) : (
                                        <ChevronRight className="h-3 w-3 text-gray-400" />
                                      )}
                                    </button>
                                  ) : (
                                    <span className="pl-1 text-gray-300">—</span>
                                  )}
                                </div>
                                <div className="w-32 shrink-0 truncate text-sm text-gray-500">
                                  {doc.created_at ? (
                                    formatDate(doc.created_at)
                                  ) : (
                                    <span className="text-gray-300">—</span>
                                  )}
                                </div>
                                <div className="w-32 shrink-0 truncate text-sm text-gray-500">
                                  {doc.updated_at ? (
                                    formatDate(doc.updated_at)
                                  ) : (
                                    <span className="text-gray-300">—</span>
                                  )}
                                </div>
                                <div className="flex w-8 shrink-0 justify-end">
                                  {!isProcessing && (
                                    <RowActions
                                      onDownload={() => downloadDoc(doc.id)}
                                      onShowAllVersions={
                                        hasVersions && !isVersionsOpen
                                          ? () => void toggleVersions(doc.id)
                                          : undefined
                                      }
                                      onUploadNewVersion={() => void handleUploadNewVersion(doc)}
                                      onDelete={() => handleRemoveDoc(doc.id)}
                                    />
                                  )}
                                </div>
                              </div>
                              {isVersionsOpen && (
                                <DocVersionHistory
                                  docId={doc.id}
                                  filename={doc.filename}
                                  loading={loadingVersionDocIds.has(doc.id)}
                                  versions={versionsByDocId.get(doc.id) ?? []}
                                  onDownloadVersion={downloadDocVersion}
                                  onOpenVersion={(versionId, label) => {
                                    setViewingDocVersion({ id: versionId, label });
                                    setViewingDoc(doc);
                                  }}
                                  onRenameVersion={(versionId, displayName) =>
                                    handleRenameVersion(doc.id, versionId, displayName)
                                  }
                                />
                              )}
                            </div>
                          );
                        })
                      : renderLevel(null, 0)}
                    {/* Spacer — fills remaining height and extends the root drop zone */}
                    <div className="min-h-16 flex-1" />
                  </div>
                )}

                {/* Context menu */}
                {contextMenu && (
                  <div
                    ref={contextMenuRef}
                    className="fixed z-50 w-44 overflow-hidden rounded-lg border border-gray-100 bg-white text-xs shadow-lg"
                    style={{ top: contextMenu.y, left: contextMenu.x }}
                    onClick={(e) => e.stopPropagation()}
                  >
                    <button
                      className="flex w-full items-center gap-2 px-3 py-1.5 text-left text-gray-700 hover:bg-gray-50"
                      onClick={() => {
                        setCreatingFolderIn(contextMenu.folderId);
                        setNewFolderName("");
                        if (contextMenu.folderId)
                          setExpandedFolderIds((prev) => new Set([...prev, contextMenu.folderId!]));
                        setContextMenu(null);
                      }}
                    >
                      <FolderPlus className="h-3.5 w-3.5 text-gray-400" />
                      {contextMenu.showFolderActions ? "New subfolder inside" : "New subfolder"}
                    </button>
                    {contextMenu.showFolderActions && contextMenu.folderId && (
                      <>
                        <button
                          className="w-full px-3 py-1.5 text-left text-gray-700 hover:bg-gray-50"
                          onClick={() => {
                            const f = folders.find((x) => x.id === contextMenu.folderId);
                            setRenameFolderValue(f?.name ?? "");
                            setRenamingFolderId(contextMenu.folderId!);
                            setContextMenu(null);
                          }}
                        >
                          Rename folder
                        </button>
                        <button
                          className="w-full px-3 py-1.5 text-left text-red-600 hover:bg-red-50"
                          onClick={() => {
                            handleDeleteFolder(contextMenu.folderId!);
                            setContextMenu(null);
                          }}
                        >
                          Delete folder
                        </button>
                      </>
                    )}
                  </div>
                )}
              </div>
              {/* end blue ring wrapper */}
            </div>
          )}

          {/* Tab: Assistant */}
          {tab === "assistant" && (
            <>
              <div className="flex h-8 items-center border-b border-gray-200 pr-8 text-xs font-medium text-gray-500 select-none">
                <div
                  className={`sticky left-0 z-[60] ${CHECK_W} relative flex items-center justify-center self-stretch bg-white before:absolute before:inset-x-0 before:bottom-0 before:h-px before:bg-white`}
                >
                  <input
                    type="checkbox"
                    checked={allChatsSelected}
                    ref={(el) => {
                      if (el) el.indeterminate = someChatsSelected;
                    }}
                    onChange={() => {
                      if (allChatsSelected) setSelectedChatIds([]);
                      else setSelectedChatIds(filteredChats.map((c) => c.id));
                    }}
                    className="h-2.5 w-2.5 cursor-pointer rounded border-gray-200 accent-black"
                  />
                </div>
                <div className={`sticky left-8 z-[60] ${NAME_COL_W} bg-white pl-2 text-left`}>
                  Chats
                </div>
                <div className="ml-auto w-32 shrink-0 text-left">Created</div>
                <div className="w-8 shrink-0" />
              </div>
              {chats.length === 0 ? (
                <div className="mx-auto flex w-full max-w-xs flex-col items-start py-24">
                  <MessageSquare className="mb-4 h-8 w-8 text-gray-300" />
                  <p className="font-serif text-2xl font-medium text-gray-900">Assistant</p>
                  <p className="mt-1 max-w-xs text-xs text-gray-400">
                    Ask questions and get answers grounded in the documents in this application.
                  </p>
                  <button
                    onClick={() => handleNewChat()}
                    className="mt-4 inline-flex items-center gap-1 rounded-full bg-gray-900 px-3 py-1 text-xs font-medium text-white shadow-md transition-colors hover:bg-gray-700"
                  >
                    + Create New
                  </button>
                </div>
              ) : (
                <div>
                  {filteredChats.map((chat) => (
                    <div
                      key={chat.id}
                      onClick={() => {
                        if (renamingChatId === chat.id) return;
                        router.push(
                          `/applications/${applicationId}/assistant-next/chat/${chat.id}`,
                        );
                      }}
                      className="group flex h-10 cursor-pointer items-center border-b border-gray-50 pr-8 transition-colors hover:bg-gray-50"
                    >
                      <div
                        className={`sticky left-0 z-[60] ${CHECK_W} flex items-center justify-center p-2 ${selectedChatIds.includes(chat.id) ? "bg-gray-50" : "bg-white"} group-hover:bg-gray-50`}
                        onClick={(e) => e.stopPropagation()}
                      >
                        <input
                          type="checkbox"
                          checked={selectedChatIds.includes(chat.id)}
                          onChange={() =>
                            setSelectedChatIds((prev) =>
                              prev.includes(chat.id)
                                ? prev.filter((x) => x !== chat.id)
                                : [...prev, chat.id],
                            )
                          }
                          className="h-2.5 w-2.5 cursor-pointer rounded border-gray-200 accent-black"
                        />
                      </div>
                      <div
                        className={`sticky left-8 z-[60] ${NAME_COL_W} p-2 ${selectedChatIds.includes(chat.id) ? "bg-gray-50" : "bg-white"} group-hover:bg-gray-50`}
                      >
                        {renamingChatId === chat.id ? (
                          <input
                            autoFocus
                            value={renameChatValue}
                            onChange={(e) => setRenameChatValue(e.target.value)}
                            onKeyDown={(e) => {
                              if (e.key === "Enter") submitChatRename(chat.id);
                              if (e.key === "Escape") setRenamingChatId(null);
                            }}
                            onBlur={() => submitChatRename(chat.id)}
                            onClick={(e) => e.stopPropagation()}
                            className="w-full bg-transparent text-sm text-gray-800 outline-none"
                          />
                        ) : (
                          <span className="block truncate text-sm text-gray-800">
                            {chat.title ?? "Untitled Chat"}
                          </span>
                        )}
                      </div>
                      <div className="ml-auto w-32 shrink-0 truncate text-sm text-gray-500">
                        {formatDate(chat.created_at)}
                      </div>
                      <div
                        className="flex w-8 shrink-0 justify-end"
                        onClick={(e) => e.stopPropagation()}
                      >
                        <RowActions
                          onRename={() => {
                            if (user?.id && !isSameOwner(chat.user_id, user.id)) {
                              traceChatOwnerAction("rename", chat, "application.row", false);
                              setOwnerOnlyAction("rename this chat");
                              return;
                            }
                            traceChatOwnerAction("rename", chat, "application.row", true);
                            setRenameChatValue(chat.title ?? "Untitled Chat");
                            setRenamingChatId(chat.id);
                          }}
                          onDelete={async () => {
                            if (user?.id && !isSameOwner(chat.user_id, user.id)) {
                              traceChatOwnerAction("delete", chat, "application.row", false);
                              setOwnerOnlyAction("delete this chat");
                              return;
                            }
                            traceChatOwnerAction("delete", chat, "application.row", true);
                            await deleteChat(chat.id);
                            setChats((prev) => prev.filter((c) => c.id !== chat.id));
                          }}
                        />
                      </div>
                    </div>
                  ))}
                </div>
              )}
            </>
          )}
        </div>
      </div>

      <AddDocumentsModal
        open={addDocsOpen}
        onClose={() => setAddDocsOpen(false)}
        onSelect={handleDocsSelected}
        breadcrumb={["Applications", application.name, "Add Documents"]}
        applicationId={applicationId}
      />

      <UploadNewVersionModal
        open={!!uploadVersionDoc}
        doc={uploadVersionDoc}
        onClose={() => setUploadVersionDoc(null)}
        onSubmit={(file, displayName) => submitNewVersion(uploadVersionDoc!, file, displayName)}
      />

      <DocViewModal
        doc={viewingDoc}
        versionId={viewingDocVersion?.id ?? null}
        versionLabel={viewingDocVersion?.label ?? null}
        onClose={() => {
          setViewingDoc(null);
          setViewingDocVersion(null);
        }}
        onDelete={(doc) => handleRemoveDoc(doc.id)}
      />

      <AddNewTRModal
        open={newTRModalOpen}
        onClose={() => setNewTRModalOpen(false)}
        onAdd={handleCreateReview}
        applicationDocs={application?.documents?.filter((d) => d.status === "ready")}
        applicationName={application?.name}
      />

      <OwnerOnlyModal
        open={!!ownerOnlyAction}
        action={ownerOnlyAction ?? undefined}
        onClose={() => setOwnerOnlyAction(null)}
      />
    </div>
  );
}
