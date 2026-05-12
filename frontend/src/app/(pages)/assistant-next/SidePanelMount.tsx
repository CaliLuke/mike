"use client";

import { AssistantSidePanel } from "@/app/components/assistant/AssistantSidePanel";

import { useSidePanel } from "./sidePanel";

/**
 * Mounts the side panel as a sibling of <Thread />. Handles the
 * mount/visibility lifecycle that the panel slides off when closed.
 */
export function SidePanelMount() {
  const panel = useSidePanel();
  if (!panel.panelMounted) return null;
  return (
    <div
      className={`fixed inset-0 z-40 transition-transform duration-300 ease-in-out md:relative md:inset-auto md:z-auto md:h-full md:flex-shrink-0 ${
        panel.panelVisible ? "translate-x-0" : "translate-x-full"
      }`}
    >
      <AssistantSidePanel
        tabs={panel.tabs}
        activeTabId={panel.activeTabId}
        onActivateTab={panel.activateTab}
        onCloseTab={panel.closeTab}
        onCloseAll={panel.closeAllTabs}
        isEditorReloading={(documentId) => panel.reloadingDocIds.has(documentId)}
        isEditReloading={(editId) => panel.reloadingEditIds.has(editId)}
        onEditResolveStart={panel.handleEditResolveStart}
        onEditResolved={panel.handleEditResolved}
        onEditError={panel.handleEditError}
        onWarningDismiss={panel.handleWarningDismiss}
        onScrollChange={panel.handleScrollChange}
      />
    </div>
  );
}
