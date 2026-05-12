"use client";

import { createContext, type ReactNode, useCallback, useContext, useMemo, useState } from "react";

import type { AssistantSidePanelTab } from "@/app/components/assistant/AssistantSidePanel";
import type { LukeCitationAnnotation, LukeEditAnnotation } from "@/app/components/shared/types";

import { aniEvent } from "./observability";

interface OpenDocumentArgs {
  documentId: string;
  filename: string;
  versionId: string | null;
  versionNumber: number | null;
}

interface SidePanelApi {
  tabs: AssistantSidePanelTab[];
  activeTabId: string | null;
  panelMounted: boolean;
  panelVisible: boolean;
  reloadingDocIds: ReadonlySet<string>;
  reloadingEditIds: ReadonlySet<string>;
  resolvedEditStatuses: Readonly<Record<string, "accepted" | "rejected">>;
  resolvedEditDownloadUrl: Readonly<Record<string, string>>;
  openDocument: (args: OpenDocumentArgs) => void;
  openCitation: (citation: LukeCitationAnnotation) => void;
  openEdit: (ann: LukeEditAnnotation, filename: string) => void;
  activateTab: (id: string) => void;
  closeTab: (id: string) => void;
  closeAllTabs: () => void;
  handleEditResolveStart: (args: {
    editId: string;
    documentId: string;
    verb: "accept" | "reject";
  }) => void;
  handleEditResolved: (args: {
    editId: string;
    documentId: string;
    status: "accepted" | "rejected";
    versionId: string | null;
    downloadUrl: string | null;
  }) => void;
  handleEditError: (args: {
    editId: string;
    documentId: string;
    versionId: string | null;
    message: string;
  }) => void;
  handleWarningDismiss: (tabId: string) => void;
  handleScrollChange: (tabId: string, scrollTop: number) => void;
}

const SidePanelContext = createContext<SidePanelApi | null>(null);

export function useSidePanel(): SidePanelApi {
  const ctx = useContext(SidePanelContext);
  if (!ctx) throw new Error("useSidePanel must be used inside SidePanelProvider");
  return ctx;
}

/**
 * Optional accessor — returns null when no provider is mounted so
 * components that want to remain usable both inside and outside the
 * assistant-next route can short-circuit (no panel = no open handler).
 */
export function useSidePanelOptional(): SidePanelApi | null {
  return useContext(SidePanelContext);
}

export function SidePanelProvider({ children }: { children: ReactNode }) {
  const [tabs, setTabs] = useState<AssistantSidePanelTab[]>([]);
  const [activeTabId, setActiveTabId] = useState<string | null>(null);
  const [panelMounted, setPanelMounted] = useState(false);
  const [panelVisible, setPanelVisible] = useState(false);
  const [reloadingDocIds, setReloadingDocIds] = useState<Set<string>>(() => new Set());
  const [reloadingEditIds, setReloadingEditIds] = useState<Set<string>>(() => new Set());
  const [resolvedEditStatuses, setResolvedEditStatuses] = useState<
    Record<string, "accepted" | "rejected">
  >({});
  const [resolvedEditDownloadUrl, setResolvedEditDownloadUrl] = useState<Record<string, string>>(
    {},
  );

  const showPanel = useCallback(() => {
    setPanelMounted(true);
    requestAnimationFrame(() => requestAnimationFrame(() => setPanelVisible(true)));
  }, []);

  const upsertTab = useCallback(
    (tab: AssistantSidePanelTab) => {
      aniEvent("side_panel.tab.upsert", {
        "tab.kind": tab.kind,
        "tab.id": tab.id,
        "doc.id": tab.documentId,
      });
      setTabs((prev) => {
        const idx = prev.findIndex((t) => t.documentId === tab.documentId);
        if (idx >= 0) {
          const existing = prev[idx];
          const copy = prev.slice();
          copy[idx] = {
            ...tab,
            id: existing.id,
            warning: existing.warning,
            initialScrollTop: existing.initialScrollTop,
          };
          return copy;
        }
        return [...prev, tab];
      });
      setActiveTabId(tab.id);
      showPanel();
    },
    [showPanel],
  );

  const openDocument = useCallback(
    (args: OpenDocumentArgs) => {
      upsertTab({
        kind: "document",
        id: args.documentId,
        documentId: args.documentId,
        filename: args.filename,
        versionId: args.versionId,
        versionNumber: args.versionNumber,
      });
    },
    [upsertTab],
  );

  const openCitation = useCallback(
    (citation: LukeCitationAnnotation) => {
      upsertTab({
        kind: "citation",
        id: citation.document_id,
        documentId: citation.document_id,
        filename: citation.filename,
        versionId: citation.version_id ?? null,
        versionNumber: citation.version_number ?? null,
        citation,
      });
    },
    [upsertTab],
  );

  const openEdit = useCallback(
    (ann: LukeEditAnnotation, filename: string) => {
      upsertTab({
        kind: "edit",
        id: ann.document_id,
        documentId: ann.document_id,
        filename,
        versionId: ann.version_id ?? null,
        versionNumber: ann.version_number ?? null,
        edit: ann,
      });
    },
    [upsertTab],
  );

  const closeAllTabs = useCallback(() => {
    aniEvent("side_panel.close_all");
    setPanelVisible(false);
    setTimeout(() => {
      setTabs([]);
      setActiveTabId(null);
      setPanelMounted(false);
    }, 300);
  }, []);

  const closeTab = useCallback(
    (id: string) => {
      aniEvent("side_panel.tab.close", { "tab.id": id });
      setTabs((prev) => {
        const next = prev.filter((t) => t.id !== id);
        if (next.length === 0) {
          setPanelVisible(false);
          setTimeout(() => {
            setActiveTabId(null);
            setPanelMounted(false);
          }, 300);
          return next;
        }
        if (activeTabId === id) {
          const idx = prev.findIndex((t) => t.id === id);
          const neighbour = next[idx] ?? next[idx - 1] ?? next[0];
          setActiveTabId(neighbour?.id ?? null);
        }
        return next;
      });
    },
    [activeTabId],
  );

  const activateTab = useCallback((id: string) => {
    aniEvent("side_panel.tab.activate", { "tab.id": id });
    setActiveTabId(id);
  }, []);

  const handleEditResolveStart = useCallback(
    (args: { editId: string; documentId: string; verb: "accept" | "reject" }) => {
      aniEvent("side_panel.edit.resolve_start", {
        "edit.id": args.editId,
        "doc.id": args.documentId,
        "edit.verb": args.verb,
      });
      setReloadingDocIds((prev) => {
        if (prev.has(args.documentId)) return prev;
        const next = new Set(prev);
        next.add(args.documentId);
        return next;
      });
      setReloadingEditIds((prev) => {
        if (prev.has(args.editId)) return prev;
        const next = new Set(prev);
        next.add(args.editId);
        return next;
      });
    },
    [],
  );

  const handleEditResolved = useCallback(
    (args: {
      editId: string;
      documentId: string;
      status: "accepted" | "rejected";
      versionId: string | null;
      downloadUrl: string | null;
    }) => {
      aniEvent("side_panel.edit.resolved", {
        "edit.id": args.editId,
        "doc.id": args.documentId,
        "edit.status": args.status,
        "version.id": args.versionId,
        "download.url.present": !!args.downloadUrl,
      });
      setResolvedEditStatuses((prev) => ({ ...prev, [args.editId]: args.status }));
      if (args.downloadUrl) {
        const url = args.downloadUrl;
        setResolvedEditDownloadUrl((prev) => ({ ...prev, [args.documentId]: url }));
      }
      setReloadingDocIds((prev) => {
        if (!prev.has(args.documentId)) return prev;
        const next = new Set(prev);
        next.delete(args.documentId);
        return next;
      });
      setReloadingEditIds((prev) => {
        if (!prev.has(args.editId)) return prev;
        const next = new Set(prev);
        next.delete(args.editId);
        return next;
      });
    },
    [],
  );

  const handleEditError = useCallback(
    (args: { editId: string; documentId: string; versionId: string | null; message: string }) => {
      aniEvent("side_panel.edit.error", {
        "edit.id": args.editId,
        "doc.id": args.documentId,
        "version.id": args.versionId,
        "error.message": args.message,
      });
      setReloadingDocIds((prev) => {
        if (!prev.has(args.documentId)) return prev;
        const next = new Set(prev);
        next.delete(args.documentId);
        return next;
      });
      setReloadingEditIds((prev) => {
        if (!prev.has(args.editId)) return prev;
        const next = new Set(prev);
        next.delete(args.editId);
        return next;
      });
    },
    [],
  );

  const handleWarningDismiss = useCallback((tabId: string) => {
    setTabs((prev) => prev.map((t) => (t.id === tabId ? { ...t, warning: null } : t)));
  }, []);

  const handleScrollChange = useCallback((tabId: string, scrollTop: number) => {
    setTabs((prev) =>
      prev.map((t) => (t.id === tabId ? { ...t, initialScrollTop: scrollTop } : t)),
    );
  }, []);

  const api = useMemo<SidePanelApi>(
    () => ({
      tabs,
      activeTabId,
      panelMounted,
      panelVisible,
      reloadingDocIds,
      reloadingEditIds,
      resolvedEditStatuses,
      resolvedEditDownloadUrl,
      openDocument,
      openCitation,
      openEdit,
      activateTab,
      closeTab,
      closeAllTabs,
      handleEditResolveStart,
      handleEditResolved,
      handleEditError,
      handleWarningDismiss,
      handleScrollChange,
    }),
    [
      tabs,
      activeTabId,
      panelMounted,
      panelVisible,
      reloadingDocIds,
      reloadingEditIds,
      resolvedEditStatuses,
      resolvedEditDownloadUrl,
      openDocument,
      openCitation,
      openEdit,
      activateTab,
      closeTab,
      closeAllTabs,
      handleEditResolveStart,
      handleEditResolved,
      handleEditError,
      handleWarningDismiss,
      handleScrollChange,
    ],
  );

  return <SidePanelContext.Provider value={api}>{children}</SidePanelContext.Provider>;
}
