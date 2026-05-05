"use client";

import ReactMarkdown from "react-markdown";
import remarkGfm from "remark-gfm";

interface Props {
    text: string;
    markdown?: boolean;
    rounded?: boolean;
    bordered?: boolean;
}

export function TextDocumentView({
    text,
    markdown = true,
    rounded = true,
    bordered = true,
}: Props) {
    return (
        <div
            className={`relative flex flex-1 overflow-hidden bg-white ${bordered ? "border border-gray-200" : ""} ${rounded ? "rounded-xl" : ""}`}
        >
            <div className="flex-1 overflow-auto px-6 py-5">
                {markdown ? (
                    <div className="prose prose-sm max-w-none prose-headings:font-serif prose-headings:text-gray-900 prose-p:text-gray-700 prose-li:text-gray-700 prose-pre:bg-gray-50 prose-pre:text-gray-800">
                        <ReactMarkdown remarkPlugins={[remarkGfm]}>
                            {text}
                        </ReactMarkdown>
                    </div>
                ) : (
                    <pre className="whitespace-pre-wrap break-words font-mono text-sm leading-6 text-gray-700">
                        {text}
                    </pre>
                )}
            </div>
        </div>
    );
}
