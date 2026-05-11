"use client";

import { useForm } from "@tanstack/react-form";
import { X } from "lucide-react";
import { useEffect } from "react";

import type { LukeApplication } from "@/app/components/shared/types";
import { updateApplication } from "@/app/lib/lukeApi";

function validateName(value: string): string | undefined {
  if (!value.trim()) return "Name is required.";
  return undefined;
}

interface Props {
  open: boolean;
  application: LukeApplication | null;
  onClose: () => void;
  onUpdated: (application: LukeApplication) => void;
}

export function EditApplicationModal({ open, application, onClose, onUpdated }: Props) {
  const form = useForm({
    defaultValues: {
      name: application?.name ?? "",
      cm_number: application?.cm_number ?? "",
    },
    onSubmit: async ({ value }) => {
      if (!application) return;
      const trimmed = value.name.trim();
      const cm = value.cm_number.trim();
      const updated = await updateApplication(application.id, {
        name: trimmed,
        cm_number: cm || undefined,
      });
      onUpdated(updated);
      onClose();
    },
  });

  useEffect(() => {
    if (open && application) {
      form.reset({
        name: application.name ?? "",
        cm_number: application.cm_number ?? "",
      });
    }
  }, [open, application, form]);

  if (!open || !application) return null;

  return (
    <div className="fixed inset-0 z-101 flex items-center justify-center bg-black/20 backdrop-blur-xs">
      <div className="flex w-full max-w-md flex-col rounded-2xl bg-white shadow-2xl">
        <div className="flex items-center justify-between px-6 pt-5 pb-2">
          <div className="flex items-center gap-1.5 text-xs text-gray-400">
            <span>Applications</span>
            <span>›</span>
            <span>Edit</span>
          </div>
          <button
            onClick={onClose}
            className="rounded-lg p-1.5 text-gray-400 transition-colors hover:bg-gray-100 hover:text-gray-600"
            aria-label="Close"
          >
            <X className="h-4 w-4" />
          </button>
        </div>

        <form
          onSubmit={(e) => {
            e.preventDefault();
            e.stopPropagation();
            void form.handleSubmit();
          }}
          className="flex flex-col"
        >
          <div className="px-6 pt-3 pb-5">
            <form.Field name="name" validators={{ onChange: ({ value }) => validateName(value) }}>
              {(field) => (
                <div>
                  <input
                    id={field.name}
                    name={field.name}
                    type="text"
                    value={field.state.value}
                    onChange={(e) => field.handleChange(e.target.value)}
                    onBlur={field.handleBlur}
                    placeholder="Application name"
                    className="w-full bg-transparent font-serif text-2xl text-gray-800 placeholder-gray-300 focus:outline-none"
                    autoFocus
                  />
                  {field.state.meta.isTouched && field.state.meta.errors.length > 0 && (
                    <p className="mt-1 text-xs text-red-500">{field.state.meta.errors[0]}</p>
                  )}
                </div>
              )}
            </form.Field>

            <form.Field name="cm_number">
              {(field) => (
                <div className="mt-3">
                  <label
                    htmlFor={field.name}
                    className="mb-1 block text-xs font-medium text-gray-700"
                  >
                    CM number
                  </label>
                  <input
                    id={field.name}
                    name={field.name}
                    type="text"
                    value={field.state.value}
                    onChange={(e) => field.handleChange(e.target.value)}
                    onBlur={field.handleBlur}
                    placeholder="Optional"
                    className="w-full rounded-lg border border-gray-200 bg-white px-3 py-2 text-sm text-gray-700 outline-none placeholder:text-gray-300 focus:border-gray-400"
                  />
                </div>
              )}
            </form.Field>
          </div>

          <div className="flex items-center justify-end gap-2 border-t border-gray-100 px-6 py-4">
            <button
              type="button"
              onClick={onClose}
              className="rounded-lg px-4 py-2 text-sm text-gray-500 transition-colors hover:bg-gray-100"
            >
              Cancel
            </button>
            <form.Subscribe
              selector={(state) => ({
                canSubmit: state.canSubmit,
                isSubmitting: state.isSubmitting,
              })}
            >
              {({ canSubmit, isSubmitting }) => (
                <button
                  type="submit"
                  disabled={!canSubmit || isSubmitting}
                  className="rounded-lg bg-gray-900 px-5 py-2 text-sm font-medium text-white transition-colors hover:bg-gray-700 disabled:opacity-40"
                >
                  {isSubmitting ? "Saving…" : "Save"}
                </button>
              )}
            </form.Subscribe>
          </div>
        </form>
      </div>
    </div>
  );
}
