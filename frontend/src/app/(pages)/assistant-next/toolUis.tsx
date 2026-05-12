"use client";

import type { ToolCallMessagePartComponent } from "@assistant-ui/react";
import { makeAssistantToolUI } from "@assistant-ui/react";
import { useEffect, useRef } from "react";

import {
  ApplicationCreatedBlock,
  CompanyCreatedBlock,
  CompanyMatchWarningBlock,
  DocFindBlock,
  DocReadBlock,
  DocReplicatedBlock,
  WebPageFetchedBlock,
  WorkflowAppliedBlock,
} from "@/app/components/assistant/AssistantEventBlocks";
import { DocDownloadBlock } from "@/app/components/assistant/DocDownloadBlock";
import { EditCard } from "@/app/components/assistant/EditCard";
import type { LukeEditAnnotation } from "@/app/components/shared/types";

import { aniEvent } from "./observability";
import { useSidePanelOptional } from "./sidePanel";

/**
 * Fire a single event per tool-call when it first transitions out of
 * "running" (i.e. when the SSE event lands as complete or error). Skips
 * the very first render-while-running so the trace stays signal-heavy.
 */
function useToolTerminalTelemetry(toolName: string, toolCallId: string, statusType: string): void {
  const firedRef = useRef(false);
  useEffect(() => {
    if (firedRef.current) return;
    if (statusType === "running") return;
    firedRef.current = true;
    aniEvent("tool_ui.terminal", {
      "tool.name": toolName,
      "tool.call_id": toolCallId,
      "tool.status": statusType,
    });
  }, [toolName, toolCallId, statusType]);
}

/**
 * Wrap a tool-call render fn so it emits a one-shot terminal event when
 * the SSE finishes the tool. Keeps each `makeAssistantToolUI({ render })`
 * call site to a single function — no per-renderer hook boilerplate.
 */
function traced(
  toolName: string,
  Render: ToolCallMessagePartComponent,
): ToolCallMessagePartComponent {
  // Wrapping a ToolCallMessagePartComponent in another component lets
  // us hook in `useToolTerminalTelemetry` without calling Render as a
  // plain function (it's typed as a React component, not a function).
  const Traced: ToolCallMessagePartComponent = (props) => {
    useToolTerminalTelemetry(toolName, props.toolCallId, props.status.type);
    return <Render {...props} />;
  };
  Traced.displayName = `Traced(${toolName})`;
  return Traced;
}

// args is JSON-coerced from the original event payload by convertMessage —
// strict typing here would just chase the union we already know. The
// makeAssistantToolUI render() receives { args, result, status, toolName, ... }.

type Args = Record<string, unknown>;

const str = (a: Args, k: string) => (typeof a[k] === "string" ? (a[k] as string) : "");
const num = (a: Args, k: string) => (typeof a[k] === "number" ? (a[k] as number) : 0);
const bool = (a: Args, k: string) => (typeof a[k] === "boolean" ? (a[k] as boolean) : undefined);
const running = (status: { type: string }) => status.type === "running";

const DocRead = makeAssistantToolUI<Args, unknown>({
  toolName: "doc_read",
  render: traced("doc_read", ({ args = {}, status }) => (
    <DocReadBlock filename={str(args, "filename")} isStreaming={running(status)} />
  )),
});

const DocFind = makeAssistantToolUI<Args, unknown>({
  toolName: "doc_find",
  render: traced("doc_find", ({ args = {}, status }) => (
    <DocFindBlock
      filename={str(args, "filename")}
      query={str(args, "query")}
      totalMatches={num(args, "total_matches")}
      isStreaming={running(status)}
    />
  )),
});

function DocCreatedRender({ args, status }: { args: Args; status: { type: string } }) {
  const download = str(args, "download_url");
  const filename = str(args, "filename");
  const documentId = str(args, "document_id") || null;
  const versionId = str(args, "version_id") || null;
  const versionNumber =
    typeof args.version_number === "number" ? (args.version_number as number) : null;
  const panel = useSidePanelOptional();
  if (running(status) || !download) {
    return (
      <div className="text-muted-foreground flex items-center gap-2 text-sm">
        <div className="h-1.5 w-1.5 animate-spin rounded-full border border-current border-t-transparent" />
        <span className="font-medium">Creating</span>
        <span>{filename}</span>
      </div>
    );
  }
  return (
    <DocDownloadBlock
      filename={filename}
      download_url={download}
      versionNumber={versionNumber}
      onOpen={
        panel && documentId
          ? () =>
              panel.openDocument({
                documentId,
                filename,
                versionId,
                versionNumber,
              })
          : undefined
      }
    />
  );
}

const DocCreated = makeAssistantToolUI<Args, unknown>({
  toolName: "doc_created",
  render: traced("doc_created", ({ args = {}, status }) => (
    <DocCreatedRender args={args} status={status} />
  )),
});

const DocReplicated = makeAssistantToolUI<Args, unknown>({
  toolName: "doc_replicated",
  render: traced("doc_replicated", ({ args = {}, status }) => (
    <DocReplicatedBlock
      filename={str(args, "filename")}
      count={num(args, "count")}
      hasError={typeof args.error === "string" && args.error.length > 0}
      isStreaming={running(status)}
    />
  )),
});

function DocEditedRender({ args, status }: { args: Args; status: { type: string } }) {
  const download = str(args, "download_url");
  const filename = str(args, "filename");
  const documentId = str(args, "document_id");
  const versionId = str(args, "version_id") || null;
  const versionNumber =
    typeof args.version_number === "number" ? (args.version_number as number) : null;
  const annotations = (
    Array.isArray(args.annotations) ? args.annotations : []
  ) as LukeEditAnnotation[];
  const panel = useSidePanelOptional();
  const resolvedDownload = panel?.resolvedEditDownloadUrl[documentId] ?? download;

  if (running(status) || !resolvedDownload) {
    return (
      <div className="text-muted-foreground flex items-center gap-2 text-sm">
        <div className="h-1.5 w-1.5 animate-spin rounded-full border border-current border-t-transparent" />
        <span className="font-medium">Editing</span>
        <span>{filename}</span>
        {annotations.length > 0 ? (
          <span className="opacity-60">({annotations.length} changes)</span>
        ) : null}
      </div>
    );
  }

  return (
    <div className="flex flex-col gap-2">
      {annotations.map((ann) => (
        <EditCard
          key={`editcard-${ann.edit_id}`}
          annotation={ann}
          resolvedStatus={panel?.resolvedEditStatuses[ann.edit_id]}
          isReloading={panel?.reloadingEditIds.has(ann.edit_id) ?? false}
          onViewClick={(a) => panel?.openEdit(a, filename)}
          onResolveStart={panel?.handleEditResolveStart}
          onResolved={panel?.handleEditResolved}
          onError={panel?.handleEditError}
        />
      ))}
      <DocDownloadBlock
        filename={filename}
        download_url={resolvedDownload}
        versionNumber={versionNumber}
        isReloading={panel?.reloadingDocIds.has(documentId) ?? false}
        onOpen={
          panel && documentId
            ? () =>
                panel.openDocument({
                  documentId,
                  filename,
                  versionId,
                  versionNumber,
                })
            : undefined
        }
      />
    </div>
  );
}

const DocEdited = makeAssistantToolUI<Args, unknown>({
  toolName: "doc_edited",
  render: traced("doc_edited", ({ args = {}, status }) => (
    <DocEditedRender args={args} status={status} />
  )),
});

const DocDownload = makeAssistantToolUI<Args, unknown>({
  toolName: "doc_download",
  render: traced("doc_download", ({ args = {} }) => (
    <a
      href={str(args, "download_url")}
      target="_blank"
      rel="noreferrer"
      className="text-primary text-sm underline underline-offset-4"
    >
      Download {str(args, "filename")}
    </a>
  )),
});

const WebPageFetched = makeAssistantToolUI<Args, unknown>({
  toolName: "web_page_fetched",
  render: traced("web_page_fetched", ({ args = {} }) => (
    <WebPageFetchedBlock
      title={typeof args.title === "string" ? (args.title as string) : undefined}
      url={str(args, "url")}
    />
  )),
});

const CompanyCreated = makeAssistantToolUI<Args, unknown>({
  toolName: "company_created",
  render: traced("company_created", ({ args = {} }) => (
    <CompanyCreatedBlock name={str(args, "name")} reusedExisting={bool(args, "reused_existing")} />
  )),
});

const CompanyMatchWarning = makeAssistantToolUI<Args, unknown>({
  toolName: "company_match_warning",
  render: traced("company_match_warning", ({ args = {} }) => (
    <CompanyMatchWarningBlock
      requestedName={str(args, "requested_name")}
      similarCompanyName={str(args, "similar_company_name")}
      similarity={typeof args.similarity === "number" ? (args.similarity as number) : undefined}
    />
  )),
});

const ApplicationCreated = makeAssistantToolUI<Args, unknown>({
  toolName: "application_created",
  render: traced("application_created", ({ args = {} }) => (
    <ApplicationCreatedBlock
      name={str(args, "name")}
      savedJobDescription={!!str(args, "job_description_document_id")}
    />
  )),
});

const WorkflowApplied = makeAssistantToolUI<Args, unknown>({
  toolName: "workflow_applied",
  render: traced("workflow_applied", ({ args = {} }) => (
    <WorkflowAppliedBlock title={str(args, "title")} />
  )),
});

const ToolCallStart = makeAssistantToolUI<Args, unknown>({
  toolName: "tool_call_start",
  render: traced("tool_call_start", ({ args = {}, status }) => {
    const name = str(args, "name") || "tool";
    const summary = str(args, "summary");
    const error = str(args, "error");
    const phase = error ? "failed" : running(status) ? "running" : "done";
    const dot = phase === "failed" ? "bg-red-500" : phase === "done" ? "bg-emerald-500" : "";
    return (
      <div className="text-muted-foreground flex items-center gap-2 text-sm">
        {phase === "running" ? (
          <div className="h-1.5 w-1.5 animate-spin rounded-full border border-current border-t-transparent" />
        ) : (
          <div className={`h-1.5 w-1.5 rounded-full ${dot}`} />
        )}
        <span className="font-medium">
          {phase === "failed" ? "Tool failed" : phase === "done" ? "Used" : "Using"}
        </span>
        <span>{name}</span>
        {summary ? <span className="opacity-60">: {summary}</span> : null}
        {error ? <span className="text-red-500">— {error}</span> : null}
      </div>
    );
  }),
});

const ReplayError = makeAssistantToolUI<Args, unknown>({
  toolName: "replay_error",
  render: traced("replay_error", ({ args = {} }) => (
    <div className="text-sm text-red-600">Replay error: {str(args, "message")}</div>
  )),
});

/**
 * Mounts per-event tool UIs for *artifact* tools only — tools whose
 * output should remain visible after the chain-of-thought is collapsed
 * (downloadable docs, applied edits). Diagnostic / scratch tools
 * (doc_read, doc_find, web_page_fetched, etc.) deliberately have no
 * custom UI so they fall back to the polished `ToolFallback` inside the
 * chain-of-thought accordion, which renders `argsText` + `result` and
 * looks the way the user expects from the assistant-ui screenshot.
 */
export function ToolUis() {
  return (
    <>
      <DocCreated />
      <DocEdited />
      <DocDownload />
    </>
  );
}

// Suppress unused warnings for the renderer components that used to be
// mounted as toolUIs. We keep them around because they still render
// inside the chain-of-thought when a turn has no result data, but we
// no longer register them with makeAssistantToolUI.
void DocRead;
void DocFind;
void DocReplicated;
void WebPageFetched;
void CompanyCreated;
void CompanyMatchWarning;
void ApplicationCreated;
void WorkflowApplied;
void ToolCallStart;
void ReplayError;
