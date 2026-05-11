"use client";

import { useMemo } from "react";
import ReactMarkdown from "react-markdown";
import remarkGfm from "remark-gfm";

interface Props {
  text: string;
  markdown?: boolean;
  rounded?: boolean;
  bordered?: boolean;
}

// Strip HTML comments (e.g. `<!-- markdownlint-disable MD036 -->`) so they
// don't surface as visible text. react-markdown's default `skipHtml: false`
// preserves them as raw HTML nodes which some renderer paths emit verbatim.
function stripHtmlComments(input: string): string {
  return input.replace(/<!--[\s\S]*?-->/g, "");
}

export function TextDocumentView({
  text,
  markdown = true,
  rounded = true,
  bordered = true,
}: Props) {
  const cleaned = useMemo(() => (markdown ? stripHtmlComments(text) : text), [text, markdown]);

  return (
    <div
      className={`relative flex flex-1 overflow-hidden bg-white ${bordered ? "border border-gray-200" : ""} ${rounded ? "rounded-xl" : ""}`}
    >
      <div className="flex-1 overflow-auto">
        {markdown ? (
          <article className="prose prose-neutral prose-headings:font-serif prose-headings:tracking-tight prose-h1:mt-0 prose-h1:mb-6 prose-h1:text-4xl prose-h2:mt-10 prose-h2:mb-4 prose-h2:text-2xl prose-h2:border-b prose-h2:border-gray-200 prose-h2:pb-2 prose-h3:mt-8 prose-h3:mb-3 prose-h3:text-xl prose-h4:mt-6 prose-h4:mb-2 prose-h4:text-lg prose-p:my-4 prose-p:leading-7 prose-ul:my-4 prose-ul:list-disc prose-ul:pl-6 prose-ol:my-4 prose-ol:list-decimal prose-ol:pl-6 prose-li:my-1 prose-li:marker:text-gray-400 prose-a:text-blue-600 prose-a:no-underline hover:prose-a:underline prose-blockquote:border-l-4 prose-blockquote:border-gray-300 prose-blockquote:pl-4 prose-blockquote:italic prose-blockquote:text-gray-600 prose-code:rounded prose-code:bg-gray-100 prose-code:px-1.5 prose-code:py-0.5 prose-code:text-[0.9em] prose-code:font-mono prose-code:before:content-none prose-code:after:content-none prose-pre:bg-gray-50 prose-pre:text-gray-800 prose-pre:rounded-lg prose-pre:p-4 prose-hr:my-8 prose-hr:border-gray-200 prose-table:my-6 prose-th:bg-gray-50 prose-th:px-3 prose-th:py-2 prose-td:px-3 prose-td:py-2 prose-th:border prose-th:border-gray-200 prose-td:border prose-td:border-gray-200 mx-auto max-w-3xl px-10 py-10">
            <ReactMarkdown remarkPlugins={[remarkGfm]}>{cleaned}</ReactMarkdown>
          </article>
        ) : (
          <pre className="mx-auto max-w-3xl px-10 py-10 font-mono text-sm leading-6 break-words whitespace-pre-wrap text-gray-700">
            {text}
          </pre>
        )}
      </div>
    </div>
  );
}
