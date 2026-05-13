"use client";

import { ChevronLeft, ChevronRight, FileText } from "lucide-react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { useEffect, useMemo, useState } from "react";

import { ChatThreadList } from "@/app/(pages)/assistant-next/ChatThreadList";
import { aniEvent } from "@/app/(pages)/assistant-next/observability";
import { AssistantNextRuntime } from "@/app/(pages)/assistant-next/RuntimeProvider";
import { useSidePanel } from "@/app/(pages)/assistant-next/sidePanel";
import { SidePanelMount } from "@/app/(pages)/assistant-next/SidePanelMount";
import { ApplicationExplorer } from "@/app/components/applications/ApplicationExplorer";
import type { LukeApplication, LukeMessage, TabularReview } from "@/app/components/shared/types";
import { useAssistantChat } from "@/app/hooks/useAssistantChat";
import { getApplication } from "@/app/lib/lukeApi";
import { Thread } from "@/components/assistant-ui/thread";
import { TooltipIconButton } from "@/components/assistant-ui/tooltip-icon-button";

interface Props {
  applicationId: string;
  chatId?: string;
  initialMessages?: LukeMessage[];
}

/**
 * Application-scoped chat shell. Three-pane layout:
 *   1. ChatThreadList (left, collapsible — default collapsed so docs get
 *      the screen)
 *   2. Thread (center-left) + SidePanelMount (center-right, slides in
 *      when a document is opened)
 *   3. DocsExplorerRail (right, collapsible) — the application's docs +
 *      tabular reviews; clicking a doc opens it in the side panel,
 *      clicking a review routes to its tabular reviews page.
 */
export function AppScopedChat({ applicationId, chatId, initialMessages = [] }: Props) {
  const [application, setApplication] = useState<LukeApplication | null>(null);
  const [threadListCollapsed, setThreadListCollapsed] = useState(true);
  const [explorerCollapsed, setExplorerCollapsed] = useState(false);

  const chat = useAssistantChat({
    initialMessages,
    chatId,
    applicationId,
    chatRouteBase: "/assistant-next/chat",
  });

  useEffect(() => {
    aniEvent("page.mount", {
      route: chatId ? "app_scoped.chat" : "app_scoped.empty",
      "application.id": applicationId,
      "chat.id": chatId ?? null,
    });
  }, [applicationId, chatId]);

  useEffect(() => {
    let cancelled = false;
    getApplication(applicationId)
      .then((a) => {
        if (!cancelled) setApplication(a);
      })
      .catch((err) => {
        aniEvent("app_scoped.application_fetch.error", {
          "application.id": applicationId,
          "error.message": err instanceof Error ? err.message : String(err),
        });
      });
    return () => {
      cancelled = true;
    };
  }, [applicationId]);

  // Reactive refresh: whenever the assistant lands a completed mutation
  // event (doc_created / doc_replicated / doc_edited), refetch the
  // application so the docs rail picks up the new/changed file without
  // requiring a browser reload. Keyed by a stable signature derived from
  // committed events only, so streaming partials don't thrash the fetch.
  const applicationMutationSignature = useMemo(() => {
    const created: string[] = [];
    const replicated: string[] = [];
    const editedPerDoc: Record<string, number> = {};
    for (const msg of chat.messages) {
      for (const ev of msg.events ?? []) {
        if ("isStreaming" in ev && ev.isStreaming) continue;
        if (ev.type === "doc_created" && ev.document_id) {
          created.push(`${ev.document_id}:${ev.version_id ?? ""}:${ev.filename}`);
          continue;
        }
        if (ev.type === "doc_replicated") {
          for (const c of ev.copies ?? []) {
            replicated.push(`${c.document_id}:${c.version_id}:${c.new_filename}`);
          }
          continue;
        }
        if (ev.type === "doc_edited") {
          editedPerDoc[ev.document_id] = Math.max(
            editedPerDoc[ev.document_id] ?? 0,
            (ev.version_number as number | null | undefined) ?? 0,
          );
        }
      }
    }
    return [
      `created=${created.sort().join(",")}`,
      `replicated=${replicated.sort().join(",")}`,
      `edited=${Object.entries(editedPerDoc)
        .map(([k, v]) => `${k}=${v}`)
        .sort()
        .join(",")}`,
    ].join("|");
  }, [chat.messages]);

  useEffect(() => {
    // Empty signature on first render — `created=|replicated=|edited=` is
    // the no-mutation case. Refetching once on that initial value would
    // duplicate the mount-effect fetch above, so skip it.
    if (applicationMutationSignature === "created=|replicated=|edited=") return;
    let cancelled = false;
    aniEvent("app_scoped.refetch.on_mutation", {
      "application.id": applicationId,
      signature: applicationMutationSignature,
    });
    getApplication(applicationId)
      .then((a) => {
        if (!cancelled) setApplication(a);
      })
      .catch((err) => {
        aniEvent("app_scoped.refetch.on_mutation.error", {
          "application.id": applicationId,
          "error.message": err instanceof Error ? err.message : String(err),
        });
      });
    return () => {
      cancelled = true;
    };
  }, [applicationMutationSignature, applicationId]);

  return (
    <AssistantNextRuntime chat={chat} applicationId={applicationId}>
      <div className="relative flex h-full w-full flex-col">
        <header className="border-border bg-background flex items-center gap-2 border-b px-4 py-2 text-sm">
          <Link
            href={`/applications/${applicationId}`}
            className="text-muted-foreground hover:text-foreground flex items-center gap-1 transition-colors"
          >
            <ChevronLeft className="h-4 w-4" />
            <span>{application?.name ?? "Application"}</span>
          </Link>
        </header>
        <div className="relative flex flex-1 overflow-hidden">
          <ChatThreadList
            collapsed={threadListCollapsed}
            onToggleCollapsed={() => setThreadListCollapsed((v) => !v)}
          />
          <div className="relative flex h-full flex-1 flex-col">
            <Thread />
          </div>
          <SidePanelMount />
          <DocsExplorerRail
            applicationId={applicationId}
            application={application}
            collapsed={explorerCollapsed}
            onToggleCollapsed={() => setExplorerCollapsed((v) => !v)}
          />
        </div>
      </div>
    </AssistantNextRuntime>
  );
}

interface RailProps {
  applicationId: string;
  application: LukeApplication | null;
  collapsed: boolean;
  onToggleCollapsed: () => void;
}

/**
 * Right-side rail showing this application's docs + reviews. Lives
 * inside the runtime provider so it can call useSidePanel(); clicking a
 * doc opens it in the same side panel the chat opens citations and
 * tracked-changes into. Reviews route to their dedicated page (the chat
 * surface doesn't render review tables).
 */
function DocsExplorerRail({ applicationId, application, collapsed, onToggleCollapsed }: RailProps) {
  const router = useRouter();
  const sidePanel = useSidePanel();

  if (collapsed) {
    return (
      <div className="border-border bg-background flex h-full w-9 shrink-0 flex-col items-center gap-1 border-l p-1.5">
        <TooltipIconButton
          tooltip="Show documents"
          onClick={() => {
            aniEvent("explorer.toggle", { collapsed: false });
            onToggleCollapsed();
          }}
          className="size-7"
        >
          <FileText className="size-4" />
        </TooltipIconButton>
      </div>
    );
  }

  const documents = application?.documents ?? [];
  const folders = application?.folders ?? [];
  const reviews: TabularReview[] = application?.reviews ?? [];

  return (
    <div className="border-border bg-background flex h-full w-64 shrink-0 flex-col border-l">
      <div className="border-border flex h-9 shrink-0 items-center justify-between border-b px-2 text-xs font-medium text-gray-700">
        <span>Documents</span>
        <TooltipIconButton
          tooltip="Hide documents"
          onClick={() => {
            aniEvent("explorer.toggle", { collapsed: true });
            onToggleCollapsed();
          }}
          className="size-6"
        >
          <ChevronRight className="size-3.5" />
        </TooltipIconButton>
      </div>
      <div className="flex-1 overflow-y-auto">
        <ApplicationExplorer
          documents={documents}
          folders={folders}
          reviews={reviews}
          onDocClick={(doc) => {
            sidePanel.openDocument({
              documentId: doc.id,
              filename: doc.filename,
              versionId: null,
              versionNumber: doc.latest_version_number ?? null,
            });
          }}
          onReviewClick={(review) => {
            router.push(`/applications/${applicationId}/tabular-reviews/${review.id}`);
          }}
        />
      </div>
    </div>
  );
}
