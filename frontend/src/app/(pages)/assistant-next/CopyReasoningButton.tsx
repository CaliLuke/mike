"use client";

import { useAuiState } from "@assistant-ui/react";
import { CheckIcon, CopyIcon } from "lucide-react";
import { useState } from "react";

import { TooltipIconButton } from "@/components/assistant-ui/tooltip-icon-button";

import { aniEvent } from "./observability";

/**
 * Tiny clipboard button rendered alongside the polished Reasoning
 * trigger. Reads the reasoning parts in `[startIndex..endIndex]` of
 * the current message off the assistant-ui store and joins their text
 * before copying. Sits next to the disclosure chevron so it's clear
 * it copies the thinking, not the message body (the message-level
 * action bar already has its own Copy).
 */
export function CopyReasoningButton({
  startIndex,
  endIndex,
}: {
  startIndex: number;
  endIndex: number;
}) {
  const text = useAuiState((s) => {
    const parts = s.message.parts;
    const chunks: string[] = [];
    for (let i = startIndex; i <= endIndex; i++) {
      const p = parts[i];
      if (p?.type === "reasoning" && typeof p.text === "string" && p.text.length > 0) {
        chunks.push(p.text);
      }
    }
    return chunks.join("\n\n");
  });
  const [copied, setCopied] = useState(false);

  const onClick = async (e: React.MouseEvent) => {
    // Prevent the surrounding CollapsibleTrigger from also reacting to
    // the click — we don't want copying to toggle the disclosure.
    e.stopPropagation();
    e.preventDefault();
    aniEvent("reasoning.copy", {
      "reasoning.chars": text.length,
      "reasoning.parts_span": endIndex - startIndex + 1,
    });
    try {
      await navigator.clipboard.writeText(text);
      setCopied(true);
      window.setTimeout(() => setCopied(false), 1500);
    } catch (err) {
      aniEvent("reasoning.copy.error", {
        "error.message": err instanceof Error ? err.message : String(err),
      });
    }
  };

  return (
    <TooltipIconButton
      tooltip="Copy reasoning"
      side="bottom"
      onClick={onClick}
      className="text-muted-foreground hover:text-foreground size-6"
      aria-label="Copy reasoning"
      disabled={text.length === 0}
    >
      {copied ? <CheckIcon className="size-3.5" /> : <CopyIcon className="size-3.5" />}
    </TooltipIconButton>
  );
}
