import { createPortal } from "react-dom";

interface CreditsExhaustedModalProps {
  isOpen: boolean;
  onClose: () => void;
  resetDate: string;
}

export function CreditsExhaustedModal({ isOpen, onClose, resetDate }: CreditsExhaustedModalProps) {
  if (!isOpen) return null;

  // Format the reset date
  const formatResetDate = (dateString: string) => {
    const date = new Date(dateString);
    return date.toLocaleDateString("en-US", {
      month: "long",
      day: "numeric",
      year: "numeric",
    });
  };

  return createPortal(
    <>
      {/* Backdrop */}
      <div className="fixed inset-0 z-[200] bg-black/50" onClick={onClose} />

      {/* Modal */}
      <div className="fixed top-1/2 left-1/2 z-[201] w-full max-w-md -translate-x-1/2 -translate-y-1/2 px-4">
        <div className="relative rounded-2xl bg-white p-6 shadow-2xl">
          {/* Header */}
          <div className="mb-4 flex items-start justify-between">
            <h2 className="font-eb-garamond text-3xl font-light text-gray-900">
              Message Limit Reached
            </h2>
          </div>

          {/* Content */}
          <div className="space-y-4">
            <p className="text-gray-600">
              Local mode is configured with non-blocking message credits.
            </p>

            <div className="rounded-lg border border-blue-200 bg-blue-50 p-4">
              <p className="mb-1 text-sm font-medium text-blue-900">Your credits will reset on:</p>
              <p className="text-lg font-semibold text-blue-700">{formatResetDate(resetDate)}</p>
            </div>

            <p className="text-sm text-gray-500">
              Your message credits automatically reset on the first day of each month.
            </p>
          </div>

          {/* Actions */}
          <div className="mt-6 flex gap-3">
            <button
              onClick={onClose}
              className="flex-1 rounded-lg bg-gray-100 px-4 py-2.5 font-medium text-gray-700 transition-colors hover:bg-gray-200"
            >
              Close
            </button>
          </div>
        </div>
      </div>
    </>,
    document.body,
  );
}
