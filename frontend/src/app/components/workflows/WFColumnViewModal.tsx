"use client";

import {
  AlignLeft,
  Banknote,
  Calendar,
  DollarSign,
  Hash,
  List,
  Percent,
  Tag,
  ToggleLeft,
  X,
} from "lucide-react";
import { createPortal } from "react-dom";
import ReactMarkdown from "react-markdown";
import remarkGfm from "remark-gfm";

import type { ColumnConfig } from "../shared/types";
import { formatLabel } from "../tabular/columnFormat";

interface Props {
  col: ColumnConfig;
  onClose: () => void;
}

function FormatIconView({ format }: { format: ColumnConfig["format"] }) {
  const className = "h-3.5 w-3.5 text-gray-400";
  switch (format) {
    case "bulleted_list":
      return <List className={className} />;
    case "number":
      return <Hash className={className} />;
    case "percentage":
      return <Percent className={className} />;
    case "monetary_amount":
      return <Banknote className={className} />;
    case "currency":
      return <DollarSign className={className} />;
    case "yes_no":
      return <ToggleLeft className={className} />;
    case "date":
      return <Calendar className={className} />;
    case "tag":
      return <Tag className={className} />;
    default:
      return <AlignLeft className={className} />;
  }
}

export function WFColumnViewModal({ col, onClose }: Props) {
  return createPortal(
    <div className="fixed inset-0 z-[101] flex items-center justify-center bg-black/20 backdrop-blur-xs">
      <div className="flex h-[600px] w-full max-w-2xl flex-col rounded-2xl bg-white shadow-2xl">
        <div className="flex items-center justify-between px-6 pt-5 pb-2">
          <div className="flex items-center gap-1.5 text-xs text-gray-400">
            <span>Workflows</span>
            <span>›</span>
            <span className="max-w-[200px] truncate text-gray-600">{col.name}</span>
          </div>
          <button
            onClick={onClose}
            className="rounded-lg p-1.5 text-gray-400 hover:bg-gray-100 hover:text-gray-600"
          >
            <X className="h-4 w-4" />
          </button>
        </div>
        <div className="flex flex-1 flex-col gap-4 overflow-y-auto px-6 pt-3 pb-5">
          <div>
            <p className="mb-2 text-sm font-medium text-gray-500">Column Title</p>
            <p className="text-sm text-gray-800">{col.name}</p>
          </div>
          <div>
            <p className="mb-2 text-sm font-medium text-gray-500">Format</p>
            <span className="inline-flex items-center gap-1.5 text-sm text-gray-700">
              <FormatIconView format={col.format} />
              {formatLabel(col.format ?? "text")}
            </span>
          </div>
          {col.tags && col.tags.length > 0 && (
            <div>
              <p className="mb-2.5 text-sm font-medium text-gray-500">Tags</p>
              <div className="flex flex-wrap gap-1.5">
                {col.tags.map((tag) => (
                  <span
                    key={tag}
                    className="inline-block rounded-full bg-gray-100 px-2 py-0.5 text-xs text-gray-600"
                  >
                    {tag}
                  </span>
                ))}
              </div>
            </div>
          )}
          <div>
            <p className="mb-2 text-sm font-medium text-gray-500">Prompt</p>
            <div className="prose prose-base max-w-none font-serif text-base leading-relaxed text-gray-700">
              <ReactMarkdown remarkPlugins={[remarkGfm]}>
                {col.prompt || "_No prompt defined._"}
              </ReactMarkdown>
            </div>
          </div>
        </div>
        <div className="flex shrink-0 justify-end border-t border-gray-100 px-6 py-4">
          <button
            onClick={onClose}
            className="rounded-lg bg-gray-900 px-5 py-2 text-sm font-medium text-white hover:bg-gray-700"
          >
            Close
          </button>
        </div>
      </div>
    </div>,
    document.body,
  );
}
