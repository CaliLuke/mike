import { Check, Link2, X } from "lucide-react";
import { useState } from "react";
import { createPortal } from "react-dom";

interface SimpleLinkDialogProps {
  isOpen: boolean;
  onClose: () => void;
  shareUrl: string | null;
}

export function SimpleLinkDialog({ isOpen, onClose, shareUrl }: SimpleLinkDialogProps) {
  const [linkCopied, setLinkCopied] = useState(false);

  if (!isOpen) return null;

  const handleCopyLink = async () => {
    if (!shareUrl) return;
    try {
      await navigator.clipboard.writeText(shareUrl);
      setLinkCopied(true);
      setTimeout(() => setLinkCopied(false), 2000);
    } catch {
      setLinkCopied(false);
    }
  };

  return createPortal(
    <>
      {/* Backdrop */}
      <div className="fixed inset-0 z-[199] bg-black/50" onClick={onClose} />

      {/* Dialog */}
      <div className="fixed top-1/2 left-1/2 z-[200] w-full max-w-md -translate-x-1/2 -translate-y-1/2 px-4">
        <div className="relative rounded-2xl bg-white p-6 shadow-2xl">
          {/* Close Button */}
          <button
            onClick={onClose}
            className="absolute top-4 right-4 text-gray-400 transition-colors hover:text-gray-600"
          >
            <X className="h-5 w-5" />
          </button>

          {/* Header */}
          <div className="mb-6 flex items-center justify-between">
            <h2 className="font-eb-garamond text-3xl font-light text-gray-900">Share Chat</h2>
          </div>

          {/* Content */}
          <div className="space-y-4">
            {/* Link display */}
            <div className="rounded-lg border border-gray-200 bg-gray-50 p-3">
              <p className="mb-2 text-sm font-medium text-gray-600">Share Link</p>
              <p className="font-mono text-sm break-all text-gray-800">{shareUrl}</p>
            </div>

            {/* Copy button */}
            <button
              onClick={handleCopyLink}
              className="flex w-full items-center justify-center gap-2 rounded-lg bg-blue-600 px-4 py-2.5 font-medium text-white transition-colors hover:bg-blue-700"
            >
              {linkCopied ? (
                <>
                  <Check className="h-5 w-5" />
                  Copied!
                </>
              ) : (
                <>
                  <Link2 className="h-5 w-5" />
                  Copy Link
                </>
              )}
            </button>
          </div>
        </div>
      </div>
    </>,
    document.body,
  );
}
