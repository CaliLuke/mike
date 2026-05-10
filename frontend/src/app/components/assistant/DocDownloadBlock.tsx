"use client";

import { Download, Loader2 } from "lucide-react";
import { useState } from "react";

import { API_BASE } from "@/app/lib/lukeApi";

export function DocDownloadBlock({
  filename,
  download_url,
  onOpen,
  isReloading = false,
  versionNumber,
}: {
  filename: string;
  download_url: string;
  onOpen?: () => void;
  isReloading?: boolean;
  versionNumber?: number | null;
}) {
  const hasVersion =
    typeof versionNumber === "number" && Number.isFinite(versionNumber) && versionNumber > 0;
  const extMatch = filename.match(/\.(\w+)$/);
  const ext = extMatch ? extMatch[1].toUpperCase() : "FILE";
  const rawBasename = extMatch ? filename.slice(0, -extMatch[0].length) : filename;
  const basename = rawBasename.replace(/\s*\[Edited V\d+\]\s*$/, "").trim();
  const isSafeHref = download_url.startsWith("/");
  const href = isSafeHref ? `${API_BASE}${download_url}` : null;
  const [busy, setBusy] = useState(false);

  const handleDownload = async (e?: {
    stopPropagation?: () => void;
    preventDefault?: () => void;
  }) => {
    e?.stopPropagation?.();
    e?.preventDefault?.();
    if (busy || isReloading || !href) return;
    setBusy(true);
    try {
      const resp = await fetch(href);
      if (!resp.ok) throw new Error(`HTTP ${resp.status}`);
      const blob = await resp.blob();
      const blobUrl = URL.createObjectURL(blob);
      const a = document.createElement("a");
      a.href = blobUrl;
      a.download = filename;
      document.body.appendChild(a);
      a.click();
      a.remove();
      setTimeout(() => URL.revokeObjectURL(blobUrl), 1000);
    } finally {
      setBusy(false);
    }
  };

  const spinning = busy || isReloading;

  const body = (
    <div className="flex min-w-0 flex-1 items-center gap-3 px-4 py-3">
      <div className="min-w-0 flex-1">
        <div className="flex min-w-0 items-center gap-2">
          <p className="font-serif text-base text-wrap text-gray-900">{basename}</p>
          {hasVersion && (
            <span className="inline-flex shrink-0 items-center rounded-md border border-gray-200 bg-white px-1.5 py-0.5 text-[10px] font-medium text-gray-500">
              V{versionNumber}
            </span>
          )}
        </div>
        <p className="mt-0.5 text-xs text-blue-500">{ext}</p>
      </div>
    </div>
  );

  const downloadIcon = spinning ? (
    <div
      aria-disabled
      className="flex shrink-0 cursor-not-allowed items-center border-l border-gray-200 bg-white px-6 text-gray-400"
    >
      <Loader2 size={13} className="animate-spin" />
    </div>
  ) : (
    <button
      type="button"
      onClick={handleDownload}
      className="flex shrink-0 cursor-pointer items-center border-l border-gray-200 bg-white px-6 text-gray-400 transition-colors hover:bg-gray-100 hover:text-gray-600"
    >
      <Download size={13} />
    </button>
  );

  if (onOpen) {
    return (
      <div className="flex w-full items-stretch overflow-hidden rounded-lg border border-gray-200 bg-gray-50 font-sans">
        <button
          type="button"
          onClick={onOpen}
          className="flex min-w-0 flex-1 cursor-pointer items-stretch text-left transition-colors hover:bg-gray-100"
        >
          {body}
        </button>
        {downloadIcon}
      </div>
    );
  }

  if (spinning) {
    return (
      <div className="flex w-full items-stretch overflow-hidden rounded-lg border border-gray-200 bg-gray-50 font-sans">
        {body}
        {downloadIcon}
      </div>
    );
  }

  return (
    <div className="flex w-full items-stretch overflow-hidden rounded-lg border border-gray-200 bg-gray-50 font-sans">
      <button
        type="button"
        onClick={handleDownload}
        className="flex min-w-0 flex-1 cursor-pointer items-stretch text-left transition-colors hover:bg-gray-100"
      >
        {body}
      </button>
      {downloadIcon}
    </div>
  );
}
