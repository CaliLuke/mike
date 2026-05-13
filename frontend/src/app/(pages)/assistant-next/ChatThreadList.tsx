"use client";

import {
  ThreadListItemMorePrimitive,
  ThreadListItemPrimitive,
  ThreadListPrimitive,
} from "@assistant-ui/react";
import {
  MessageSquareIcon,
  MoreHorizontalIcon,
  PanelLeftClose,
  PlusIcon,
  TrashIcon,
} from "lucide-react";
import { useEffect } from "react";

import { TooltipIconButton } from "@/components/assistant-ui/tooltip-icon-button";

import { aniEvent } from "./observability";

interface Props {
  /**
   * When true, render a slim 36px rail with just "+ New" and an expand
   * affordance — keeps the chat-history nav reachable without spending
   * 240px of horizontal real estate. The parent owns the collapsed state
   * (e.g. AppScopedChat defaults it to true so docs get the screen).
   */
  collapsed?: boolean;
  onToggleCollapsed?: () => void;
}

/**
 * Past-conversation list rendered alongside the active chat. The thread
 * list adapter (see RuntimeProvider) wires this to the existing
 * useChatHistoryContext + lukeApi chat endpoints — selecting an item
 * routes to /assistant-next/chat/<id>, "+ New" routes to the chat
 * root, Delete calls deleteChat().
 *
 * Uses assistant-ui's headless primitives — no chat-rendering logic
 * lives here, just structure + Tailwind chrome.
 */
export function ChatThreadList({ collapsed = false, onToggleCollapsed }: Props = {}) {
  useEffect(() => {
    aniEvent("thread_list.mount");
    return () => aniEvent("thread_list.unmount");
  }, []);

  if (collapsed) {
    return (
      <div className="border-border bg-background flex h-full w-9 shrink-0 flex-col items-center gap-1 border-r p-1.5">
        {onToggleCollapsed && (
          <TooltipIconButton
            tooltip="Show chat history"
            onClick={() => {
              aniEvent("thread_list.toggle", { collapsed: false });
              onToggleCollapsed();
            }}
            className="size-7"
          >
            <MessageSquareIcon className="size-4" />
          </TooltipIconButton>
        )}
        <ThreadListPrimitive.New asChild>
          <TooltipIconButton tooltip="New chat" className="size-7">
            <PlusIcon className="size-4" />
          </TooltipIconButton>
        </ThreadListPrimitive.New>
      </div>
    );
  }

  return (
    <ThreadListPrimitive.Root className="border-border bg-background flex h-full w-60 shrink-0 flex-col gap-1 border-r p-2">
      <div className="mb-1 flex items-center gap-1">
        <ThreadListPrimitive.New className="border-border hover:bg-muted flex h-9 flex-1 items-center gap-2 rounded-lg border px-3 text-sm font-medium transition-colors">
          <PlusIcon className="size-4" />
          New chat
        </ThreadListPrimitive.New>
        {onToggleCollapsed && (
          <TooltipIconButton
            tooltip="Hide chat history"
            onClick={() => {
              aniEvent("thread_list.toggle", { collapsed: true });
              onToggleCollapsed();
            }}
            className="size-9"
          >
            <PanelLeftClose className="size-4" />
          </TooltipIconButton>
        )}
      </div>
      <div className="flex-1 overflow-y-auto">
        <ThreadListPrimitive.Items>{() => <ThreadListItem />}</ThreadListPrimitive.Items>
      </div>
    </ThreadListPrimitive.Root>
  );
}

function ThreadListItem() {
  return (
    <ThreadListItemPrimitive.Root className="group hover:bg-muted data-[active]:bg-muted relative flex h-9 items-center rounded-lg ps-3 pe-1 text-sm transition-colors">
      <ThreadListItemPrimitive.Trigger className="flex-1 truncate text-left">
        <ThreadListItemPrimitive.Title fallback="New chat" />
      </ThreadListItemPrimitive.Trigger>
      <ThreadListItemMorePrimitive.Root>
        <ThreadListItemMorePrimitive.Trigger asChild>
          <TooltipIconButton
            tooltip="More"
            className="size-7 opacity-0 transition-opacity group-hover:opacity-100 data-[state=open]:opacity-100"
          >
            <MoreHorizontalIcon className="size-4" />
          </TooltipIconButton>
        </ThreadListItemMorePrimitive.Trigger>
        <ThreadListItemMorePrimitive.Content
          side="bottom"
          align="end"
          className="bg-popover text-popover-foreground z-50 min-w-32 overflow-hidden rounded-md border p-1 shadow-md"
        >
          <ThreadListItemPrimitive.Delete asChild>
            <ThreadListItemMorePrimitive.Item className="text-destructive hover:bg-destructive/10 flex cursor-pointer items-center gap-2 rounded-sm px-2 py-1.5 text-sm">
              <TrashIcon className="size-4" />
              Delete
            </ThreadListItemMorePrimitive.Item>
          </ThreadListItemPrimitive.Delete>
        </ThreadListItemMorePrimitive.Content>
      </ThreadListItemMorePrimitive.Root>
    </ThreadListItemPrimitive.Root>
  );
}
