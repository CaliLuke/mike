"use client";

import "katex/dist/katex.min.css";

import type { RefObject } from "react";
import ReactMarkdown from "react-markdown";
import rehypeKatex from "rehype-katex";
import remarkGfm from "remark-gfm";
import remarkMath from "remark-math";

import type { LukeCitationAnnotation } from "../shared/types";
import { displayCitationQuote, formatCitationPage } from "../shared/types";

export function preprocessCitations(
  text: string,
  annotations: LukeCitationAnnotation[],
  citationsList: LukeCitationAnnotation[],
): string {
  return text.replace(/\[(\d+(?:,\s*\d+)*)\]/g, (full, refsStr) => {
    const refs = (refsStr as string).split(",").map((s: string) => parseInt(s.trim(), 10));
    const tokens = refs.flatMap((ref: number) => {
      const ann = annotations.find((a) => a.ref === ref);
      if (!ann) return [];
      const idx = citationsList.length;
      citationsList.push(ann);
      return [`\`§${idx}§\`\u200B`];
    });
    return tokens.length > 0 ? tokens.join("") : full;
  });
}

export function MarkdownContent({
  text,
  citationsList,
  onCitationClick,
  divRef,
}: {
  text: string;
  citationsList: LukeCitationAnnotation[];
  onCitationClick?: (c: LukeCitationAnnotation) => void;
  divRef?: RefObject<HTMLDivElement | null>;
}) {
  return (
    <div ref={divRef} className="prose prose-sm mb-4 max-w-none font-serif text-base text-gray-900">
      <ReactMarkdown
        remarkPlugins={[[remarkMath, { singleDollarTextMath: false }], remarkGfm]}
        rehypePlugins={[rehypeKatex]}
        components={{
          table: ({ node: _node, ...props }) => (
            <div className="my-4 overflow-x-auto">
              <table
                className="min-w-full divide-y divide-gray-300 overflow-hidden rounded-lg border border-gray-200"
                {...props}
              />
            </div>
          ),
          thead: ({ node: _node, ...props }) => <thead className="bg-gray-50" {...props} />,
          tbody: ({ node: _node, ...props }) => (
            <tbody className="divide-y divide-gray-200 bg-white" {...props} />
          ),
          tr: ({ node: _node, ...props }) => <tr {...props} />,
          th: ({ node: _node, ...props }) => (
            <th className="px-3 py-3.5 text-left text-sm font-semibold text-gray-900" {...props} />
          ),
          td: ({ node: _node, ...props }) => (
            <td className="px-3 py-4 text-sm whitespace-normal text-gray-900" {...props} />
          ),
          h1: ({ node: _node, ...props }) => (
            <h1 className="mt-6 mb-4 font-serif text-3xl font-semibold" {...props} />
          ),
          h2: ({ node: _node, ...props }) => (
            <h2 className="mt-5 mb-3 font-serif text-2xl font-semibold" {...props} />
          ),
          h3: ({ node: _node, ...props }) => (
            <h3 className="mt-4 mb-2 text-xl font-semibold" {...props} />
          ),
          h4: ({ node: _node, ...props }) => (
            <h4 className="mt-4 mb-2 text-lg font-semibold" {...props} />
          ),
          p: ({ node, ...props }) => {
            const parent = (node as { parent?: { type?: string } } | undefined)?.parent;
            if (parent?.type === "listItem") {
              return <p className="m-0 inline leading-7" {...props} />;
            }
            return <p className="mb-4 leading-7" {...props} />;
          },
          ul: ({ node: _node, ...props }) => (
            <ul className="mb-4 list-outside list-disc pl-6" {...props} />
          ),
          ol: ({ node: _node, ...props }) => (
            <ol className="mb-4 list-outside list-decimal pl-6" {...props} />
          ),
          li: ({ node: _node, ...props }) => <li className="mb-2 leading-7" {...props} />,
          strong: ({ node: _node, ...props }) => <strong className="font-semibold" {...props} />,
          em: ({ node: _node, ...props }) => <em className="italic" {...props} />,
          code: ({ node: _node, children, ...props }) => {
            const text = String(children);
            const citMatch = text.match(/^§(\d+)§$/);
            if (citMatch) {
              const idx = parseInt(citMatch[1]);
              const annotation = citationsList[idx];
              if (annotation) {
                const tooltipText = `${formatCitationPage(annotation)}: "${displayCitationQuote(annotation)}"`;
                return (
                  <button
                    onClick={() => {
                      onCitationClick?.(annotation);
                    }}
                    className="mx-0.5 inline-flex h-4 w-4 items-center justify-center rounded-full bg-gray-100 align-super text-[10px] font-medium text-gray-900 transition-colors hover:bg-gray-200"
                    title={tooltipText}
                  >
                    {idx + 1}
                  </button>
                );
              }
            }
            return (
              <code className="rounded bg-gray-100 px-1.5 py-0.5 font-serif text-sm" {...props}>
                {children}
              </code>
            );
          },
          blockquote: ({ node: _node, ...props }) => (
            <blockquote className="my-4 border-l-4 border-gray-300 pl-4 italic" {...props} />
          ),
          a: ({ node: _node, href, children, ...props }) => (
            <a
              href={href}
              className="text-blue-600 underline hover:text-blue-700"
              target="_blank"
              rel="noopener noreferrer"
              {...props}
            >
              {children}
            </a>
          ),
          hr: ({ node: _node, ...props }) => <hr className="my-6 border-gray-200" {...props} />,
        }}
      >
        {text}
      </ReactMarkdown>
    </div>
  );
}
