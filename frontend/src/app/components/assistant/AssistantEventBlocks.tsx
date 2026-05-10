"use client";

import { ChevronDown } from "lucide-react";
import { useEffect, useRef, useState } from "react";
import ReactMarkdown from "react-markdown";
import remarkGfm from "remark-gfm";

import { LukeIcon } from "@/components/chat/luke-icon";

type StatusState = "active" | "error" | null;

export function ResponseStatus({ status }: { status: StatusState }) {
  const [showDone, setShowDone] = useState(false);
  const [doneVisible, setDoneVisible] = useState(false);
  const wasActiveRef = useRef(false);

  const isActive = status === "active";
  const isError = status === "error";

  useEffect(() => {
    if (wasActiveRef.current && !isActive) {
      queueMicrotask(() => {
        setShowDone(true);
        setDoneVisible(true);
      });
      const t = setTimeout(() => setDoneVisible(false), 1500);
      return () => clearTimeout(t);
    }
    if (!wasActiveRef.current && isActive) {
      queueMicrotask(() => {
        setShowDone(false);
        setDoneVisible(false);
      });
    }
    wasActiveRef.current = isActive;
  }, [isActive]);

  return (
    <div className="mb-2 flex h-9 w-full items-center">
      <LukeIcon
        spin={isActive}
        done={showDone && doneVisible}
        error={isError}
        luke={!isError && !(showDone && doneVisible)}
        size={22}
      />
    </div>
  );
}

const THINKING_PHRASES = [
  "Thinking...",
  "Pondering...",
  "Analyzing...",
  "Reviewing...",
  "Reasoning...",
];

export function ReasoningBlock({
  text,
  isStreaming,
  showConnector,
}: {
  text: string;
  isStreaming: boolean;
  showConnector?: boolean;
}) {
  const [isOpen, setIsOpen] = useState(false);
  const [thinkingIndex, setThinkingIndex] = useState(0);

  useEffect(() => {
    if (!isStreaming) return;
    const interval = setInterval(() => {
      setThinkingIndex((i) => (i + 1) % THINKING_PHRASES.length);
    }, 2000);
    return () => clearInterval(interval);
  }, [isStreaming]);

  const showContent = isOpen || isStreaming;

  return (
    <div className="relative">
      {showConnector && (
        <div className="absolute top-[13px] bottom-0 left-[2.5px] h-[calc(100%+11px)] w-[1px] bg-gray-300" />
      )}
      <button
        onClick={() => !isStreaming && setIsOpen((v) => !v)}
        className="flex items-center font-serif text-sm text-gray-500 transition-colors hover:text-gray-600"
      >
        {isStreaming ? (
          <div className="h-1.5 w-1.5 shrink-0 animate-spin rounded-full border border-gray-400 border-t-transparent" />
        ) : (
          <div className="h-1.5 w-1.5 shrink-0 rounded-full bg-gray-300" />
        )}
        <span className="ml-2 font-medium">
          {isStreaming ? THINKING_PHRASES[thinkingIndex] : "Thought process"}
        </span>
        {!isStreaming && (
          <ChevronDown
            size={10}
            className={`ml-1 self-center transition-transform duration-200 ${isOpen ? "" : "-rotate-90"}`}
          />
        )}
      </button>
      {showContent && (
        <div className="prose prose-sm mt-2 ml-[14px] max-w-none font-serif text-sm text-gray-400 [&>*]:text-sm [&>*]:text-gray-400">
          <ReactMarkdown
            remarkPlugins={[remarkGfm]}
            components={{
              code: ({ node: _node, ...props }) => (
                <code className="font-serif text-gray-600" {...props} />
              ),
            }}
          >
            {text}
          </ReactMarkdown>
        </div>
      )}
    </div>
  );
}

export function DocReadBlock({
  filename,
  onClick,
  showConnector,
  isStreaming,
}: {
  filename: string;
  onClick?: () => void;
  showConnector?: boolean;
  isStreaming?: boolean;
}) {
  return (
    <div className="relative flex items-start font-serif text-sm text-gray-500">
      {showConnector && (
        <div className="absolute top-[13px] bottom-0 left-[2.5px] h-[calc(100%+11px)] w-[1px] bg-gray-300" />
      )}
      {isStreaming ? (
        <div className="mt-2 h-1.5 w-1.5 shrink-0 animate-spin rounded-full border border-gray-400 border-t-transparent" />
      ) : (
        <div className="mt-2 h-1.5 w-1.5 shrink-0 rounded-full bg-green-400" />
      )}
      <div className="ml-2 min-w-0 flex-1 break-words whitespace-normal">
        <span className="font-medium">{isStreaming ? "Reading" : "Read"}</span>{" "}
        {isStreaming ? (
          <span>{filename}...</span>
        ) : onClick ? (
          <button
            onClick={onClick}
            className="cursor-pointer text-left transition-colors hover:text-gray-700"
          >
            {filename}
          </button>
        ) : (
          <span>{filename}</span>
        )}
      </div>
    </div>
  );
}

export function DocFindBlock({
  filename,
  query,
  totalMatches,
  isStreaming,
  showConnector,
}: {
  filename: string;
  query: string;
  totalMatches: number;
  isStreaming?: boolean;
  showConnector?: boolean;
}) {
  const label = isStreaming ? "Finding" : "Found";
  const matchSuffix = isStreaming
    ? ""
    : ` (${totalMatches} ${totalMatches === 1 ? "match" : "matches"})`;
  return (
    <div className="relative flex items-start font-serif text-sm text-gray-500">
      {showConnector && (
        <div className="absolute top-[13px] bottom-0 left-[2.5px] h-[calc(100%+11px)] w-[1px] bg-gray-300" />
      )}
      {isStreaming ? (
        <div className="mt-2 h-1.5 w-1.5 shrink-0 animate-spin rounded-full border border-gray-400 border-t-transparent" />
      ) : (
        <div
          className={`mt-2 h-1.5 w-1.5 shrink-0 rounded-full ${totalMatches > 0 ? "bg-green-400" : "bg-gray-300"}`}
        />
      )}
      <div className="ml-2 min-w-0 flex-1 break-words whitespace-normal">
        <span className="font-medium">{label}</span>{" "}
        <span>
          &ldquo;{query}&rdquo;{matchSuffix}
          <span className="ml-1 text-gray-400">in {filename}</span>
          {isStreaming && "..."}
        </span>
      </div>
    </div>
  );
}

export function DocCreatedBlock({
  filename,
  showConnector,
  isStreaming,
}: {
  filename: string;
  showConnector?: boolean;
  isStreaming?: boolean;
}) {
  return (
    <div className="relative flex items-start font-serif text-sm text-gray-500">
      {showConnector && (
        <div className="absolute top-[13px] bottom-0 left-[2.5px] h-[calc(100%+11px)] w-[1px] bg-gray-300" />
      )}
      {isStreaming ? (
        <div className="mt-2 h-1.5 w-1.5 shrink-0 animate-spin rounded-full border border-gray-400 border-t-transparent" />
      ) : (
        <div className="mt-2 h-1.5 w-1.5 shrink-0 rounded-full bg-green-400" />
      )}
      <div className="ml-2 min-w-0 flex-1 break-words whitespace-normal">
        <span className="font-medium">{isStreaming ? "Creating" : "Created"}</span>{" "}
        <span>{isStreaming ? `${filename}...` : filename}</span>
      </div>
    </div>
  );
}

export function DocReplicatedBlock({
  filename,
  count,
  showConnector,
  isStreaming,
  hasError,
}: {
  filename: string;
  count: number;
  showConnector?: boolean;
  isStreaming?: boolean;
  hasError?: boolean;
}) {
  const label = isStreaming ? "Replicating" : "Replicated";
  const suffix = !isStreaming && count > 1 ? ` ${count} times` : isStreaming ? "..." : "";
  return (
    <div className="relative flex items-start font-serif text-sm text-gray-500">
      {showConnector && (
        <div className="absolute top-[13px] bottom-0 left-[2.5px] h-[calc(100%+11px)] w-[1px] bg-gray-300" />
      )}
      {isStreaming ? (
        <div className="mt-2 h-1.5 w-1.5 shrink-0 animate-spin rounded-full border border-gray-400 border-t-transparent" />
      ) : (
        <div
          className={`mt-2 h-1.5 w-1.5 shrink-0 rounded-full ${hasError ? "bg-red-400" : "bg-green-400"}`}
        />
      )}
      <div className="ml-2 min-w-0 flex-1 break-words whitespace-normal">
        <span className="font-medium">{label}</span>{" "}
        <span>
          {filename}
          {suffix}
        </span>
      </div>
    </div>
  );
}

export function WorkflowAppliedBlock({
  title,
  showConnector,
  onClick,
}: {
  title: string;
  showConnector?: boolean;
  onClick?: () => void;
}) {
  return (
    <div className="relative flex items-start font-serif text-sm text-gray-500">
      {showConnector && (
        <div className="absolute top-[13px] bottom-0 left-[2.5px] h-[calc(100%+11px)] w-[1px] bg-gray-300" />
      )}
      <div className="mt-2 h-1.5 w-1.5 shrink-0 rounded-full bg-green-400" />
      <div className="ml-2 min-w-0 flex-1 break-words whitespace-normal">
        <span className="font-medium">Applied Workflow</span>{" "}
        {onClick ? (
          <button
            onClick={onClick}
            className="cursor-pointer text-left transition-colors hover:text-gray-700"
          >
            {title}
          </button>
        ) : (
          <span>{title}</span>
        )}
      </div>
    </div>
  );
}

export function CompanyCreatedBlock({
  name,
  reusedExisting,
  showConnector,
}: {
  name: string;
  reusedExisting?: boolean;
  showConnector?: boolean;
}) {
  return (
    <div className="relative flex items-start font-serif text-sm text-gray-500">
      {showConnector && (
        <div className="absolute top-[13px] bottom-0 left-[2.5px] h-[calc(100%+11px)] w-[1px] bg-gray-300" />
      )}
      <div className="mt-2 h-1.5 w-1.5 shrink-0 rounded-full bg-green-400" />
      <div className="ml-2 min-w-0 flex-1 break-words whitespace-normal">
        <span className="font-medium">{reusedExisting ? "Reused Company" : "Created Company"}</span>{" "}
        <span>{name}</span>
      </div>
    </div>
  );
}

export function CompanyMatchWarningBlock({
  requestedName,
  similarCompanyName,
  similarity,
  showConnector,
}: {
  requestedName: string;
  similarCompanyName: string;
  similarity?: number;
  showConnector?: boolean;
}) {
  const similarityText =
    typeof similarity === "number" && Number.isFinite(similarity)
      ? ` (${Math.round(similarity * 100)}% similar)`
      : "";
  return (
    <div className="relative flex items-start font-serif text-sm text-gray-500">
      {showConnector && (
        <div className="absolute top-[13px] bottom-0 left-[2.5px] h-[calc(100%+11px)] w-[1px] bg-gray-300" />
      )}
      <div className="mt-2 h-1.5 w-1.5 shrink-0 rounded-full bg-amber-400" />
      <div className="ml-2 min-w-0 flex-1 break-words whitespace-normal">
        <span className="font-medium">Found Similar Company</span>{" "}
        <span>
          {requestedName} -&gt; {similarCompanyName}
          {similarityText}
        </span>
      </div>
    </div>
  );
}

export function WebPageFetchedBlock({
  title,
  url,
  showConnector,
}: {
  title?: string;
  url: string;
  showConnector?: boolean;
}) {
  return (
    <div className="relative flex items-start font-serif text-sm text-gray-500">
      {showConnector && (
        <div className="absolute top-[13px] bottom-0 left-[2.5px] h-[calc(100%+11px)] w-[1px] bg-gray-300" />
      )}
      <div className="mt-2 h-1.5 w-1.5 shrink-0 rounded-full bg-green-400" />
      <div className="ml-2 min-w-0 flex-1 break-words whitespace-normal">
        <span className="font-medium">Fetched Web Page</span> <span>{title || url}</span>
      </div>
    </div>
  );
}

export function ApplicationCreatedBlock({
  name,
  savedJobDescription,
  showConnector,
}: {
  name: string;
  savedJobDescription?: boolean;
  showConnector?: boolean;
}) {
  return (
    <div className="relative flex items-start font-serif text-sm text-gray-500">
      {showConnector && (
        <div className="absolute top-[13px] bottom-0 left-[2.5px] h-[calc(100%+11px)] w-[1px] bg-gray-300" />
      )}
      <div className="mt-2 h-1.5 w-1.5 shrink-0 rounded-full bg-green-400" />
      <div className="ml-2 min-w-0 flex-1 break-words whitespace-normal">
        <span className="font-medium">Created Application</span>{" "}
        <span>
          {name}
          {savedJobDescription ? " with job description" : ""}
        </span>
      </div>
    </div>
  );
}

export function DocEditedBlock({
  filename,
  showConnector,
  isStreaming,
  hasError,
}: {
  filename: string;
  showConnector?: boolean;
  isStreaming?: boolean;
  hasError?: boolean;
}) {
  return (
    <div className="relative flex items-start font-serif text-sm text-gray-500">
      {showConnector && (
        <div className="absolute top-[13px] bottom-0 left-[2.5px] h-[calc(100%+11px)] w-[1px] bg-gray-300" />
      )}
      {isStreaming ? (
        <div className="mt-2 h-1.5 w-1.5 shrink-0 animate-spin rounded-full border border-gray-400 border-t-transparent" />
      ) : hasError ? (
        <div className="mt-2 h-1.5 w-1.5 shrink-0 rounded-full bg-red-500" />
      ) : (
        <div className="mt-2 h-1.5 w-1.5 shrink-0 rounded-full bg-green-400" />
      )}
      <div className="ml-2 min-w-0 flex-1 break-words whitespace-normal">
        <span className="font-medium">
          {isStreaming ? "Editing" : hasError ? "Edit failed" : "Edited"}
        </span>{" "}
        <span>{isStreaming ? `${filename}...` : filename}</span>
      </div>
    </div>
  );
}
