"use client";

import { Check } from "lucide-react";

import { Button } from "@/components/ui/button";

interface DeleteChatsModalProps {
  isOpen: boolean;
  onClose: () => void;
  onConfirm: () => void;
  chatCount: number;
  isDeleting: boolean;
  isSuccess?: boolean;
}

export function DeleteChatsModal({
  isOpen,
  onClose,
  onConfirm,
  chatCount,
  isDeleting,
  isSuccess = false,
}: DeleteChatsModalProps) {
  if (!isOpen) return null;

  return (
    <>
      {/* Backdrop */}
      <div
        className="fixed inset-0 z-199 bg-black/50"
        onClick={isDeleting || isSuccess ? undefined : onClose}
      />

      {/* Modal */}
      <div className="fixed top-1/2 left-1/2 z-200 w-full max-w-md -translate-x-1/2 -translate-y-1/2">
        <div className="rounded-2xl bg-white p-8 shadow-2xl">
          {isSuccess ? (
            <>
              {/* Success State */}
              <div className="text-center">
                <div className="mx-auto mb-4 flex h-16 w-16 items-center justify-center rounded-full bg-green-100">
                  <Check className="h-8 w-8 text-green-600" />
                </div>
                <h2 className="font-eb-garamond mb-2 text-3xl font-light text-gray-900">
                  All Chats Deleted
                </h2>
                <p className="text-sm text-gray-600">
                  Your chat history has been successfully deleted.
                </p>
              </div>
            </>
          ) : (
            <>
              {/* Header */}
              <div className="mb-6 flex items-center justify-between">
                <h2 className="font-eb-garamond text-4xl font-light text-red-700">
                  Delete All Chats
                </h2>
              </div>

              {/* Content */}
              <div className="space-y-4">
                <p className="text-sm leading-relaxed text-gray-600">
                  Are you sure you want to delete all {chatCount} chat
                  {chatCount !== 1 ? "s" : ""}? This action is permanent and cannot be undone.
                </p>

                <div className="space-y-3 pt-4">
                  <Button
                    onClick={onConfirm}
                    disabled={isDeleting}
                    variant="destructive"
                    className="w-full bg-red-600 text-white hover:bg-red-700"
                  >
                    {isDeleting ? "Deleting..." : "Delete All Chats"}
                  </Button>
                  <Button
                    onClick={onClose}
                    variant="outline"
                    disabled={isDeleting}
                    className="w-full border-gray-300 text-gray-700 hover:bg-gray-50"
                  >
                    Cancel
                  </Button>
                </div>
              </div>
            </>
          )}
        </div>
      </div>
    </>
  );
}
