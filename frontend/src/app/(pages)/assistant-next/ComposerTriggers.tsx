"use client";

import {
  ComposerPrimitive,
  unstable_useTriggerPopoverScopeContext as useTriggerPopoverScopeContext,
  useAuiState,
} from "@assistant-ui/react";
import { useQuery } from "@tanstack/react-query";
import { Building2, FolderOpen, Library } from "lucide-react";

import type { LukeApplication, LukeCompany, LukeWorkflow } from "@/app/components/shared/types";
import { BUILT_IN_WORKFLOWS } from "@/app/components/workflows/builtinWorkflows";
import { listApplications, listCompanies, listWorkflows } from "@/app/lib/lukeApi";

import { aniEvent } from "./observability";
import { usePendingWorkflow } from "./pendingWorkflow";
import { buildMentionAdapter, buildSlashAdapter } from "./triggerAdapters";

/**
 * @ mentions for companies + applications (insert chip into composer)
 * and / slash for workflows (action — sets pending workflow on the
 * runtime so the next send attaches it).
 *
 * Render this inside `ComposerPrimitive.Unstable_TriggerPopoverRoot`.
 * The popover DOM is positioned absolute over the composer; the wrapper
 * sets `relative` on the outer composer shell already.
 */
export function ComposerTriggers() {
  const companiesQ = useQuery<LukeCompany[]>({
    queryKey: ["assistant-next", "companies"],
    queryFn: listCompanies,
    staleTime: 60_000,
  });
  const applicationsQ = useQuery<LukeApplication[]>({
    queryKey: ["assistant-next", "applications"],
    queryFn: listApplications,
    staleTime: 60_000,
  });
  const workflowsQ = useQuery<LukeWorkflow[]>({
    queryKey: ["assistant-next", "workflows", "assistant"],
    queryFn: () => listWorkflows("assistant"),
    staleTime: 60_000,
  });

  const builtins = BUILT_IN_WORKFLOWS.filter((w) => w.type === "assistant");
  const allWorkflows = [...builtins, ...(workflowsQ.data ?? [])];

  const mentionAdapter = buildMentionAdapter(companiesQ.data ?? [], applicationsQ.data ?? []);
  const slashAdapter = buildSlashAdapter(allWorkflows);
  const pendingWorkflow = usePendingWorkflow();

  return (
    <>
      <ComposerPrimitive.Unstable_TriggerPopover char="@" adapter={mentionAdapter}>
        <ComposerPrimitive.Unstable_TriggerPopover.Directive
          onInserted={(item) => {
            aniEvent("trigger.mention.insert", {
              "item.id": item.id,
              "item.type": item.type,
              "companies.count": companiesQ.data?.length ?? 0,
              "applications.count": applicationsQ.data?.length ?? 0,
            });
          }}
        />
        <TriggerPanel
          renderCategoryIcon={(id) =>
            id === "companies" ? (
              <Building2 className="h-4 w-4" />
            ) : (
              <FolderOpen className="h-4 w-4" />
            )
          }
        />
      </ComposerPrimitive.Unstable_TriggerPopover>

      <ComposerPrimitive.Unstable_TriggerPopover char="/" adapter={slashAdapter}>
        <ComposerPrimitive.Unstable_TriggerPopover.Action
          removeOnExecute
          onExecute={(item) => {
            const meta = item.metadata as { workflow_id?: string; title?: string } | undefined;
            aniEvent("trigger.slash.execute", {
              "item.id": item.id,
              "workflow.id": meta?.workflow_id ?? null,
              "workflow.title.present": !!meta?.title,
              "workflows.count": allWorkflows.length,
            });
            if (!meta?.workflow_id || !meta.title) return;
            pendingWorkflow.set({ id: meta.workflow_id, title: meta.title });
          }}
        />
        <TriggerPanel renderCategoryIcon={() => <Library className="h-4 w-4" />} />
      </ComposerPrimitive.Unstable_TriggerPopover>
    </>
  );
}

interface PanelProps {
  renderCategoryIcon: (categoryId: string) => React.ReactNode;
}

function TriggerPanel({ renderCategoryIcon }: PanelProps) {
  // The TriggerPopover wrapper always renders our children regardless
  // of activation — only the sub-primitives (Categories/Items/Back)
  // null out. If we render the styled panel unconditionally, an empty
  // chrome lingers after the trigger char is deleted. Gate on `open`.
  const { open } = useTriggerPopoverScopeContext();
  // When the composer is centered (empty state) we put the popover
  // BELOW the composer so it doesn't cover the welcome text; once a
  // conversation is going the composer sticks to the bottom, so the
  // popover floats ABOVE it.
  const isEmpty = useAuiState((s) => s.thread.isEmpty);
  if (!open) return null;

  const position = isEmpty ? "top-full mt-2" : "bottom-full mb-2";

  return (
    <div
      className={`absolute ${position} bg-popover text-popover-foreground left-0 z-50 max-h-72 w-72 overflow-auto rounded-lg border p-1 shadow-lg`}
      role="listbox"
    >
      <ComposerPrimitive.Unstable_TriggerPopoverBack className="text-muted-foreground hover:bg-accent flex w-full items-center gap-2 rounded px-2 py-1.5 text-xs">
        ← Back
      </ComposerPrimitive.Unstable_TriggerPopoverBack>

      <ComposerPrimitive.Unstable_TriggerPopoverCategories>
        {(categories) =>
          categories.map((cat) => (
            <ComposerPrimitive.Unstable_TriggerPopoverCategoryItem
              key={cat.id}
              categoryId={cat.id}
              className="hover:bg-accent data-[highlighted]:bg-accent flex w-full items-center gap-2 rounded px-2 py-1.5 text-left text-sm"
            >
              {renderCategoryIcon(cat.id)}
              <span>{cat.label}</span>
            </ComposerPrimitive.Unstable_TriggerPopoverCategoryItem>
          ))
        }
      </ComposerPrimitive.Unstable_TriggerPopoverCategories>

      <ComposerPrimitive.Unstable_TriggerPopoverItems>
        {(items) =>
          items.length === 0 ? (
            <div className="text-muted-foreground px-2 py-2 text-xs">No matches</div>
          ) : (
            items.map((item, idx) => (
              <ComposerPrimitive.Unstable_TriggerPopoverItem
                key={item.id}
                item={item}
                index={idx}
                className="hover:bg-accent data-[highlighted]:bg-accent flex w-full flex-col items-start rounded px-2 py-1.5 text-left text-sm"
              >
                <span>{item.label}</span>
                {item.description ? (
                  <span className="text-muted-foreground text-xs">{item.description}</span>
                ) : null}
              </ComposerPrimitive.Unstable_TriggerPopoverItem>
            ))
          )
        }
      </ComposerPrimitive.Unstable_TriggerPopoverItems>
    </div>
  );
}
