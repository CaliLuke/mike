"use client";

import { useAuiState } from "@assistant-ui/react";
import { useMemo } from "react";

import {
  MarkdownContent,
  preprocessCitations,
} from "@/app/components/assistant/AssistantMarkdownContent";
import type { LukeCitationAnnotation } from "@/app/components/shared/types";
import { MarkdownText } from "@/components/assistant-ui/markdown-text";

import { aniEvent } from "./observability";
import { useSidePanelOptional } from "./sidePanel";

/**
 * Text-part renderer for assistant messages. When the message carries
 * Luke citations on metadata.custom.luke_citations, we route the text
 * through preprocessCitations + MarkdownContent so the inline `[1]`
 * markers become clickable pills that open the side panel at the
 * citation. Otherwise we fall back to the polished MarkdownText.
 */
export function CitedText({ text }: { text: string }) {
  const annotations = useAuiState((s) => {
    const custom = s.message.metadata.custom as
      | { luke_citations?: LukeCitationAnnotation[] }
      | undefined;
    return custom?.luke_citations ?? [];
  });
  const panel = useSidePanelOptional();

  const { processed, citationsList } = useMemo(() => {
    if (!annotations.length || !text)
      return { processed: text, citationsList: [] as LukeCitationAnnotation[] };
    const list: LukeCitationAnnotation[] = [];
    const out = preprocessCitations(text, annotations, list);
    return { processed: out, citationsList: list };
  }, [text, annotations]);

  // No citations on this message — use the polished markdown renderer
  // (`MarkdownText` from the assistant-ui shadcn install, which wraps
  // `MarkdownTextPrimitive` + GFM). The headless `MessagePartPrimitive.Text`
  // emits raw text and was producing unformatted output for every
  // message that hadn't had a `citations` SSE event yet (which is most
  // of them during streaming).
  if (!annotations.length) {
    return <MarkdownText />;
  }
  return (
    <MarkdownContent
      text={processed}
      citationsList={citationsList}
      onCitationClick={
        panel
          ? (c) => {
              aniEvent("citation.click", {
                "doc.id": c.document_id,
                "doc.filename": c.filename,
                "citation.page": typeof c.page === "number" ? c.page : String(c.page ?? ""),
              });
              panel.openCitation(c);
            }
          : undefined
      }
    />
  );
}
