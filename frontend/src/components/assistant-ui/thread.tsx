import { ComposerAttachments, UserMessageAttachments } from "@/components/assistant-ui/attachment";
import { Reasoning } from "@/components/assistant-ui/reasoning";

import { ToolFallback } from "@/components/assistant-ui/tool-fallback";
import { TooltipIconButton } from "@/components/assistant-ui/tooltip-icon-button";
import { Avatar, AvatarFallback } from "@/components/ui/avatar";
import { Button } from "@/components/ui/button";
import { LukeIcon } from "@/components/chat/luke-icon";
import { cn } from "@/lib/utils";
// Spike-specific imports — coupling thread.tsx to the assistant-next
// route is acceptable while we evaluate the library. If the spike wins,
// these belong in a hostable extension surface.
import { AddAttachmentMenu } from "@/app/(pages)/assistant-next/AddAttachmentMenu";
import { ChainOfThoughtAccordion } from "@/app/(pages)/assistant-next/ChainOfThoughtAccordion";
import { CitedText } from "@/app/(pages)/assistant-next/CitedText";
import { ComposerModelToggle } from "@/app/(pages)/assistant-next/ComposerModelToggle";
import { ComposerTriggers } from "@/app/(pages)/assistant-next/ComposerTriggers";
import { PendingWorkflowChip } from "@/app/(pages)/assistant-next/PendingWorkflowChip";
import {
  ActionBarMorePrimitive,
  ActionBarPrimitive,
  AuiIf,
  BranchPickerPrimitive,
  ComposerPrimitive,
  ErrorPrimitive,
  MessagePartPrimitive,
  MessagePrimitive,
  SuggestionPrimitive,
  ThreadPrimitive,
  useAuiState,
} from "@assistant-ui/react";
import {
  ArrowDownIcon,
  ArrowUpIcon,
  BrainIcon,
  CheckIcon,
  ChevronLeftIcon,
  ChevronRightIcon,
  CopyIcon,
  DownloadIcon,
  MoreHorizontalIcon,
  PencilIcon,
  RefreshCwIcon,
  SquareIcon,
} from "lucide-react";
import type { FC } from "react";

export const Thread: FC = () => {
  return (
    <ThreadPrimitive.Root
      className="aui-root aui-thread-root bg-background @container flex h-full flex-col"
      style={{
        ["--thread-max-width" as string]: "44rem",
        ["--composer-radius" as string]: "24px",
        ["--composer-padding" as string]: "10px",
      }}
    >
      <ThreadPrimitive.Viewport
        turnAnchor="top"
        data-slot="aui_thread-viewport"
        className="relative flex flex-1 flex-col overflow-x-auto overflow-y-scroll scroll-smooth"
      >
        <div className="mx-auto flex w-full max-w-(--thread-max-width) flex-1 flex-col px-4 pt-4">
          {/* Empty thread: welcome + composer floats centered. */}
          <AuiIf condition={(s) => s.thread.isEmpty}>
            <div className="flex grow flex-col items-center justify-center gap-6">
              <ThreadWelcome />
              <div className="w-full">
                <Composer />
              </div>
            </div>
          </AuiIf>

          {/* Active thread: messages scroll, composer sticks to bottom. */}
          <AuiIf condition={(s) => !s.thread.isEmpty}>
            <div data-slot="aui_message-group" className="mb-10 flex flex-col gap-y-8 empty:hidden">
              <ThreadPrimitive.Messages>{() => <ThreadMessage />}</ThreadPrimitive.Messages>
            </div>

            <ThreadPrimitive.ViewportFooter className="aui-thread-viewport-footer bg-background sticky bottom-0 mt-auto flex flex-col gap-4 overflow-visible rounded-t-(--composer-radius) pb-4 md:pb-6">
              <ThreadScrollToBottom />
              <Composer />
            </ThreadPrimitive.ViewportFooter>
          </AuiIf>
        </div>
      </ThreadPrimitive.Viewport>
    </ThreadPrimitive.Root>
  );
};

const ThreadMessage: FC = () => {
  const role = useAuiState((s) => s.message.role);
  const isEditing = useAuiState((s) => s.message.composer.isEditing);

  if (isEditing) return <EditComposer />;
  if (role === "user") return <UserMessage />;
  return <AssistantMessage />;
};

const ThreadScrollToBottom: FC = () => {
  return (
    <ThreadPrimitive.ScrollToBottom asChild>
      <TooltipIconButton
        tooltip="Scroll to bottom"
        variant="outline"
        className="aui-thread-scroll-to-bottom dark:border-border dark:bg-background dark:hover:bg-accent absolute -top-12 z-10 self-center rounded-full p-4 disabled:invisible"
      >
        <ArrowDownIcon />
      </TooltipIconButton>
    </ThreadPrimitive.ScrollToBottom>
  );
};

const ThreadWelcome: FC = () => {
  return (
    <div className="aui-thread-welcome-root flex w-full flex-col items-center text-center">
      <h1 className="aui-thread-welcome-message-inner fade-in slide-in-from-bottom-1 animate-in fill-mode-both text-2xl font-semibold duration-200">
        Hello there!
      </h1>
      <p className="aui-thread-welcome-message-inner fade-in slide-in-from-bottom-1 animate-in fill-mode-both text-muted-foreground text-xl delay-75 duration-200">
        How can I help you today? Try{" "}
        <kbd className="bg-muted rounded px-1.5 py-0.5 text-sm">@</kbd> for companies or
        applications, <kbd className="bg-muted rounded px-1.5 py-0.5 text-sm">/</kbd> for workflows.
      </p>
      <div className="mt-6 w-full">
        <ThreadSuggestions />
      </div>
    </div>
  );
};

const ThreadSuggestions: FC = () => {
  return (
    <div className="aui-thread-welcome-suggestions grid w-full gap-2 pb-4 @md:grid-cols-2">
      <ThreadPrimitive.Suggestions>{() => <ThreadSuggestionItem />}</ThreadPrimitive.Suggestions>
    </div>
  );
};

const ThreadSuggestionItem: FC = () => {
  return (
    <div className="aui-thread-welcome-suggestion-display fade-in slide-in-from-bottom-2 animate-in fill-mode-both duration-200 nth-[n+3]:hidden @md:nth-[n+3]:block">
      <SuggestionPrimitive.Trigger send asChild>
        <Button
          variant="ghost"
          className="aui-thread-welcome-suggestion bg-background hover:bg-muted h-auto w-full flex-wrap items-start justify-start gap-1 rounded-3xl border px-4 py-3 text-start text-sm transition-colors @md:flex-col"
        >
          <SuggestionPrimitive.Title className="aui-thread-welcome-suggestion-text-1 font-medium" />
          <SuggestionPrimitive.Description className="aui-thread-welcome-suggestion-text-2 text-muted-foreground empty:hidden" />
        </Button>
      </SuggestionPrimitive.Trigger>
    </div>
  );
};

const Composer: FC = () => {
  // The `relative` wrapper anchors trigger-popover panels (`absolute
  // bottom-full`) right above the composer regardless of where the
  // composer is mounted in the layout — in the centered empty state
  // the next positioned ancestor would otherwise be ThreadViewport,
  // leaving the popover stranded near the top of the page.
  return (
    <ComposerPrimitive.Unstable_TriggerPopoverRoot>
      <div className="relative w-full">
        <ComposerTriggers />
        <ComposerPrimitive.Root className="aui-composer-root relative flex w-full flex-col">
          <ComposerPrimitive.AttachmentDropzone asChild>
            <div
              data-slot="aui_composer-shell"
              className="bg-background focus-within:border-ring/75 focus-within:ring-ring/20 data-[dragging=true]:border-ring data-[dragging=true]:bg-accent/50 flex w-full flex-col gap-2 rounded-(--composer-radius) border p-(--composer-padding) transition-shadow focus-within:ring-2 data-[dragging=true]:border-dashed"
            >
              <PendingWorkflowChip />
              <ComposerAttachments />
              <ComposerPrimitive.Input
                placeholder="Send a message..."
                className="aui-composer-input placeholder:text-muted-foreground/80 max-h-32 min-h-10 w-full resize-none bg-transparent px-1.75 py-1 text-sm outline-none"
                rows={1}
                autoFocus
                aria-label="Message input"
              />
              <ComposerAction />
            </div>
          </ComposerPrimitive.AttachmentDropzone>
        </ComposerPrimitive.Root>
      </div>
    </ComposerPrimitive.Unstable_TriggerPopoverRoot>
  );
};

const ComposerAction: FC = () => {
  return (
    <div className="aui-composer-action-wrapper relative flex items-center justify-between gap-2">
      <AddAttachmentMenu />
      <div className="flex items-center gap-1">
        <ComposerModelToggle />
        <AuiIf condition={(s) => !s.thread.isRunning}>
          <ComposerPrimitive.Send asChild>
            <TooltipIconButton
              tooltip="Send message"
              side="bottom"
              type="button"
              variant="default"
              size="icon"
              className="aui-composer-send size-8 rounded-full"
              aria-label="Send message"
            >
              <ArrowUpIcon className="aui-composer-send-icon size-4" />
            </TooltipIconButton>
          </ComposerPrimitive.Send>
        </AuiIf>
        <AuiIf condition={(s) => s.thread.isRunning}>
          <ComposerPrimitive.Cancel asChild>
            <Button
              type="button"
              variant="default"
              size="icon"
              className="aui-composer-cancel size-8 rounded-full"
              aria-label="Stop generating"
            >
              <SquareIcon className="aui-composer-cancel-icon size-3 fill-current" />
            </Button>
          </ComposerPrimitive.Cancel>
        </AuiIf>
      </div>
    </div>
  );
};

const MessageError: FC = () => {
  return (
    <MessagePrimitive.Error>
      <ErrorPrimitive.Root className="aui-message-error-root border-destructive bg-destructive/10 text-destructive dark:bg-destructive/5 mt-2 rounded-md border p-3 text-sm dark:text-red-200">
        <ErrorPrimitive.Message className="aui-message-error-message line-clamp-2" />
      </ErrorPrimitive.Root>
    </MessagePrimitive.Error>
  );
};

const AssistantMessage: FC = () => {
  return (
    <MessagePrimitive.Root
      data-slot="aui_assistant-message-root"
      data-role="assistant"
      className="fade-in slide-in-from-bottom-1 animate-in relative grid grid-cols-[auto_minmax(0,1fr)] gap-x-3 duration-150 [contain-intrinsic-size:auto_300px] [content-visibility:auto]"
    >
      <Avatar
        data-slot="aui_assistant-message-avatar"
        className="border-border bg-background mt-0.5 h-7 w-7 rounded-full border"
      >
        <AvatarFallback className="bg-background flex items-center justify-center">
          <LukeIcon size={18} />
        </AvatarFallback>
      </Avatar>
      <div
        data-slot="aui_assistant-message-content"
        className="text-foreground px-2 leading-relaxed wrap-break-word"
      >
        <MessagePrimitive.GroupedParts
          groupBy={(part) => {
            if (part.type === "reasoning") return ["group-chainOfThought", "group-reasoning"];
            if (part.type === "tool-call") {
              // Artifact tools (downloadable doc, edit cards, doc links)
              // render outside the chain so they stay visible when the
              // user collapses the thinking. Diagnostic / scratch tools
              // (doc_read, web_page_fetched, create_company, etc.) fold
              // into the chain-of-thought.
              if (
                part.toolName === "doc_created" ||
                part.toolName === "doc_edited" ||
                part.toolName === "doc_download"
              ) {
                return null;
              }
              return ["group-chainOfThought", "group-tool"];
            }
            return null;
          }}
        >
          {({ part, children }) => {
            switch (part.type) {
              case "group-chainOfThought":
                // Single accordion for the entire reasoning + tool-call
                // sequence. The inner group-* branches just pass their
                // children through — no nested toggles — so the user
                // expands ONE thing and sees the full thinking trail
                // interleaved.
                return <ChainOfThoughtAccordion>{children}</ChainOfThoughtAccordion>;
              case "group-reasoning":
                return <div className="flex flex-col gap-3">{children}</div>;
              case "group-tool":
                return <div className="flex flex-col gap-2">{children}</div>;
              case "text":
                return <CitedText text={part.text} />;
              case "reasoning":
                // Inside the chain: a brain-icon-prefixed italic line
                // matching the assistant-ui chain-of-thought screenshot.
                // Falls back to <Reasoning /> when rendered outside any
                // chain group (e.g. if grouping was ever skipped).
                return (
                  <div className="text-muted-foreground flex items-start gap-2 text-sm">
                    <BrainIcon className="mt-1 size-4 shrink-0 opacity-60" />
                    <div className="prose prose-sm max-w-none italic">
                      <Reasoning {...part} />
                    </div>
                  </div>
                );
              case "tool-call":
                // `toolUI` is set for artifact tools (doc_created,
                // doc_edited, doc_download); everything else falls
                // through to ToolFallback, which renders the polished
                // collapsible with ARGS + RESULT JSON.
                return part.toolUI ?? <ToolFallback {...part} />;
              default:
                return null;
            }
          }}
        </MessagePrimitive.GroupedParts>
        <MessageError />
      </div>

      <div
        data-slot="aui_assistant-message-footer"
        className="col-start-2 ms-2 mt-1 flex items-center"
      >
        <BranchPicker />
        <AssistantActionBar />
      </div>
    </MessagePrimitive.Root>
  );
};

const AssistantActionBar: FC = () => {
  return (
    <ActionBarPrimitive.Root
      hideWhenRunning
      autohide="never"
      className="aui-assistant-action-bar-root text-muted-foreground -ms-1 flex gap-1"
    >
      <ActionBarPrimitive.Copy asChild>
        <TooltipIconButton tooltip="Copy">
          <AuiIf condition={(s) => s.message.isCopied}>
            <CheckIcon />
          </AuiIf>
          <AuiIf condition={(s) => !s.message.isCopied}>
            <CopyIcon />
          </AuiIf>
        </TooltipIconButton>
      </ActionBarPrimitive.Copy>
      <ActionBarPrimitive.Reload asChild>
        <TooltipIconButton tooltip="Regenerate response">
          <RefreshCwIcon />
        </TooltipIconButton>
      </ActionBarPrimitive.Reload>
      <ActionBarMorePrimitive.Root>
        <ActionBarMorePrimitive.Trigger asChild>
          <TooltipIconButton tooltip="More" className="data-[state=open]:bg-accent">
            <MoreHorizontalIcon />
          </TooltipIconButton>
        </ActionBarMorePrimitive.Trigger>
        <ActionBarMorePrimitive.Content
          side="bottom"
          align="start"
          className="aui-action-bar-more-content bg-popover text-popover-foreground z-50 min-w-32 overflow-hidden rounded-md border p-1 shadow-md"
        >
          <ActionBarPrimitive.ExportMarkdown asChild>
            <ActionBarMorePrimitive.Item className="aui-action-bar-more-item hover:bg-accent hover:text-accent-foreground focus:bg-accent focus:text-accent-foreground flex cursor-pointer items-center gap-2 rounded-sm px-2 py-1.5 text-sm outline-none select-none">
              <DownloadIcon className="size-4" />
              Export as Markdown
            </ActionBarMorePrimitive.Item>
          </ActionBarPrimitive.ExportMarkdown>
        </ActionBarMorePrimitive.Content>
      </ActionBarMorePrimitive.Root>
    </ActionBarPrimitive.Root>
  );
};

// Text renderer for user messages. Mirrors the polished `MarkdownText`
// behaviour the assistant side uses, but plain — user input shouldn't
// be re-rendered as markdown (avoids surprising formatting from
// asterisks, backticks, etc. in typed prompts). `MessagePartPrimitive.Text`
// reads the current text part from context and emits it; `InProgress`
// adds the streaming caret while the part is still landing.
const UserText: FC = () => {
  return (
    <p className="whitespace-pre-wrap">
      <MessagePartPrimitive.Text />
      <MessagePartPrimitive.InProgress>
        <span className="ms-0.5 animate-pulse" aria-hidden>
          ▊
        </span>
      </MessagePartPrimitive.InProgress>
    </p>
  );
};

const UserMessage: FC = () => {
  return (
    <MessagePrimitive.Root
      data-slot="aui_user-message-root"
      className="fade-in slide-in-from-bottom-1 animate-in grid auto-rows-auto grid-cols-[minmax(72px,1fr)_auto] content-start gap-y-2 px-2 duration-150 [contain-intrinsic-size:auto_60px] [content-visibility:auto] [&:where(>*)]:col-start-2"
      data-role="user"
    >
      <UserMessageAttachments />

      <div className="aui-user-message-content-wrapper relative col-start-2 min-w-0">
        <div className="aui-user-message-content peer bg-muted text-foreground rounded-2xl px-4 py-2.5 wrap-break-word empty:hidden">
          <MessagePrimitive.Parts>
            {({ part }) => {
              // User messages today only carry text parts (attachments
              // render via UserMessageAttachments). Explicit children-
              // render-function form is what the assistant-ui docs
              // recommend for new code; functionally identical to the
              // default but easier to extend later (image parts,
              // data parts, etc.).
              if (part.type === "text") return <UserText />;
              return null;
            }}
          </MessagePrimitive.Parts>
        </div>
        <div className="aui-user-action-bar-wrapper absolute start-0 top-1/2 -translate-x-full -translate-y-1/2 pe-2 peer-empty:hidden rtl:translate-x-full">
          <UserActionBar />
        </div>
      </div>

      <BranchPicker
        data-slot="aui_user-branch-picker"
        className="col-span-full col-start-1 row-start-3 -me-1 justify-end"
      />
    </MessagePrimitive.Root>
  );
};

const UserActionBar: FC = () => {
  return (
    <ActionBarPrimitive.Root
      hideWhenRunning
      autohide="not-last"
      className="aui-user-action-bar-root flex flex-col items-end"
    >
      <ActionBarPrimitive.Edit asChild>
        <TooltipIconButton tooltip="Edit" className="aui-user-action-edit p-4">
          <PencilIcon />
        </TooltipIconButton>
      </ActionBarPrimitive.Edit>
    </ActionBarPrimitive.Root>
  );
};

const EditComposer: FC = () => {
  return (
    <MessagePrimitive.Root data-slot="aui_edit-composer-wrapper" className="flex flex-col px-2">
      <ComposerPrimitive.Root className="aui-edit-composer-root bg-muted ms-auto flex w-full max-w-[85%] flex-col rounded-2xl">
        <ComposerPrimitive.Input
          className="aui-edit-composer-input text-foreground min-h-14 w-full resize-none bg-transparent p-4 text-sm outline-none"
          autoFocus
        />
        <div className="aui-edit-composer-footer mx-3 mb-3 flex items-center gap-2 self-end">
          <ComposerPrimitive.Cancel asChild>
            <Button variant="ghost" size="sm">
              Cancel
            </Button>
          </ComposerPrimitive.Cancel>
          <ComposerPrimitive.Send asChild>
            <Button size="sm">Update</Button>
          </ComposerPrimitive.Send>
        </div>
      </ComposerPrimitive.Root>
    </MessagePrimitive.Root>
  );
};

const BranchPicker: FC<BranchPickerPrimitive.Root.Props> = ({ className, ...rest }) => {
  return (
    <BranchPickerPrimitive.Root
      hideWhenSingleBranch
      className={cn(
        "aui-branch-picker-root text-muted-foreground -ms-2 me-2 inline-flex items-center text-xs",
        className,
      )}
      {...rest}
    >
      <BranchPickerPrimitive.Previous asChild>
        <TooltipIconButton tooltip="Previous">
          <ChevronLeftIcon />
        </TooltipIconButton>
      </BranchPickerPrimitive.Previous>
      <span className="aui-branch-picker-state font-medium">
        <BranchPickerPrimitive.Number /> / <BranchPickerPrimitive.Count />
      </span>
      <BranchPickerPrimitive.Next asChild>
        <TooltipIconButton tooltip="Next">
          <ChevronRightIcon />
        </TooltipIconButton>
      </BranchPickerPrimitive.Next>
    </BranchPickerPrimitive.Root>
  );
};
