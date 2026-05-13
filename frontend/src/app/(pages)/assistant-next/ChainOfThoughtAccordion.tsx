"use client";

import { useAuiState } from "@assistant-ui/react";
import { BrainIcon, CheckIcon, ChevronDownIcon, CopyIcon, DownloadIcon } from "lucide-react";
import { type ReactNode, useState } from "react";

import { TooltipIconButton } from "@/components/assistant-ui/tooltip-icon-button";
import { Collapsible, CollapsibleContent, CollapsibleTrigger } from "@/components/ui/collapsible";
import { cn } from "@/lib/utils";

import { aniEvent } from "./observability";

/**
 * One collapsible wrapper for an entire chain of thought (consecutive
 * reasoning + tool-call parts of the current assistant turn). A single
 * Copy button next to the chevron grabs the full trail — there's no
 * need for per-section copy because the chain is unified.
 *
 * Defaults to OPEN while running so the user can watch the chain
 * stream, snaps closed when the turn completes (matches the polished
 * assistant-ui chain-of-thought UX).
 */
export function ChainOfThoughtAccordion({ children }: { children: ReactNode }) {
  const running = useAuiState((s) => s.message.status?.type === "running");
  const fullTrail = useAuiState((s) => formatChainOfThought(s.message.parts));
  const fullMarkdown = useAuiState((s) => formatChainOfThoughtMarkdown(s.message.parts));
  const [copied, setCopied] = useState(false);

  const onCopy = async (e: React.MouseEvent) => {
    e.stopPropagation();
    e.preventDefault();
    aniEvent("chain_of_thought.copy", { "trail.chars": fullTrail.length });
    try {
      await navigator.clipboard.writeText(fullTrail);
      setCopied(true);
      window.setTimeout(() => setCopied(false), 1500);
    } catch (err) {
      aniEvent("chain_of_thought.copy.error", {
        "error.message": err instanceof Error ? err.message : String(err),
      });
    }
  };

  const onExportMarkdown = (e: React.MouseEvent) => {
    e.stopPropagation();
    e.preventDefault();
    aniEvent("chain_of_thought.export_markdown", { "markdown.chars": fullMarkdown.length });
    const blob = new Blob([fullMarkdown], { type: "text/markdown;charset=utf-8" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    const ts = new Date().toISOString().replace(/[:.]/g, "-").slice(0, 19);
    a.download = `chain-of-thought-${ts}.md`;
    document.body.appendChild(a);
    a.click();
    a.remove();
    window.setTimeout(() => URL.revokeObjectURL(url), 1000);
  };

  return (
    <div className="mb-3 flex w-full flex-col">
      <Collapsible
        data-slot="aui_chain-of-thought"
        defaultOpen={running}
        onOpenChange={(open) => aniEvent("chain_of_thought.toggle", { open })}
        className="bg-background w-full rounded-lg border"
      >
        <CollapsibleTrigger
          className={cn(
            "group/cot-trigger text-muted-foreground hover:text-foreground flex w-full items-center gap-2 px-3 py-2 text-left text-sm transition-colors",
          )}
        >
          <ChevronDownIcon
            className={cn(
              "size-4 shrink-0 transition-transform duration-200",
              "group-data-[state=closed]/cot-trigger:-rotate-90",
              "group-data-[state=open]/cot-trigger:rotate-0",
            )}
          />
          <BrainIcon className="size-4 shrink-0" />
          <span className="font-medium">{running ? "Thinking…" : "Thinking"}</span>
        </CollapsibleTrigger>
        <CollapsibleContent className="border-t px-3 py-3">
          <div className="flex flex-col gap-3">{children}</div>
        </CollapsibleContent>
      </Collapsible>
      {/* Action row lives below the card, mirroring how the message-
          level action bar sits below the assistant message body — keeps
          the card header chrome to just the toggle + label, no widgets
          cramped inside. */}
      <div className="ms-1 mt-1 flex items-center gap-1">
        <TooltipIconButton
          tooltip="Copy chain of thought"
          side="bottom"
          onClick={onCopy}
          className="text-muted-foreground hover:text-foreground size-7"
          aria-label="Copy chain of thought"
          disabled={fullTrail.length === 0}
        >
          {copied ? <CheckIcon className="size-3.5" /> : <CopyIcon className="size-3.5" />}
        </TooltipIconButton>
        <TooltipIconButton
          tooltip="Export as Markdown"
          side="bottom"
          onClick={onExportMarkdown}
          className="text-muted-foreground hover:text-foreground size-7"
          aria-label="Export chain of thought as Markdown"
          disabled={fullMarkdown.length === 0}
        >
          <DownloadIcon className="size-3.5" />
        </TooltipIconButton>
      </div>
    </div>
  );
}

/**
 * Flatten the message's reasoning + tool-call parts into a plain-text
 * trail suitable for clipboard sharing. Drops artifact tool-calls
 * (doc_created / doc_edited / doc_download) since those render outside
 * the chain. Order preserved from the message parts array.
 */
function formatChainOfThought(parts: readonly unknown[]): string {
  const ARTIFACT_TOOLS = new Set(["doc_created", "doc_edited", "doc_download"]);
  const blocks: string[] = [];
  for (const raw of parts) {
    const p = raw as {
      type?: string;
      text?: string;
      toolName?: string;
      argsText?: string;
      result?: unknown;
    };
    if (p.type === "reasoning") {
      if (typeof p.text === "string" && p.text.length > 0) {
        blocks.push(p.text);
      }
      continue;
    }
    if (p.type === "tool-call") {
      const name = p.toolName ?? "tool";
      if (ARTIFACT_TOOLS.has(name)) continue;
      const lines = [`▸ ${name}`];
      const argsText = p.argsText && p.argsText !== "{}" ? p.argsText : null;
      if (argsText) lines.push(`  args: ${argsText}`);
      if (p.result !== undefined && p.result !== null) {
        const resultText =
          typeof p.result === "string" ? p.result : JSON.stringify(p.result, null, 2);
        if (resultText && resultText !== "{}") lines.push(`  result: ${resultText}`);
      }
      blocks.push(lines.join("\n"));
    }
  }
  return blocks.join("\n\n");
}

/**
 * Markdown-formatted variant of the chain of thought for file export.
 * Reasoning paragraphs render as plain markdown under an H2 heading;
 * tool calls become H2 sections with fenced ```json args/result blocks,
 * so the file is readable in any markdown viewer.
 */
function formatChainOfThoughtMarkdown(parts: readonly unknown[]): string {
  const ARTIFACT_TOOLS = new Set(["doc_created", "doc_edited", "doc_download"]);
  const blocks: string[] = ["# Chain of thought\n"];
  for (const raw of parts) {
    const p = raw as {
      type?: string;
      text?: string;
      toolName?: string;
      argsText?: string;
      result?: unknown;
    };
    if (p.type === "reasoning") {
      if (typeof p.text === "string" && p.text.length > 0) {
        blocks.push(`## Reasoning\n\n${p.text}`);
      }
      continue;
    }
    if (p.type === "tool-call") {
      const name = p.toolName ?? "tool";
      if (ARTIFACT_TOOLS.has(name)) continue;
      const sections: string[] = [`## Tool: \`${name}\``];
      const argsText = p.argsText && p.argsText !== "{}" ? p.argsText : null;
      if (argsText) {
        sections.push(`**Args**\n\n\`\`\`json\n${argsText}\n\`\`\``);
      }
      if (p.result !== undefined && p.result !== null) {
        const resultText =
          typeof p.result === "string" ? p.result : JSON.stringify(p.result, null, 2);
        if (resultText && resultText !== "{}") {
          sections.push(`**Result**\n\n\`\`\`json\n${resultText}\n\`\`\``);
        }
      }
      blocks.push(sections.join("\n\n"));
    }
  }
  return blocks.join("\n\n") + "\n";
}
