"use client";

import { useForm } from "@tanstack/react-form";
import { ChevronDown, Plus, X } from "lucide-react";
import { useEffect, useRef, useState } from "react";
import { createPortal } from "react-dom";

import { generateTabularColumnPrompt } from "@/app/lib/lukeApi";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuRadioGroup,
  DropdownMenuRadioItem,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";

import type { ColumnConfig, ColumnFormat } from "../shared/types";
import { FORMAT_OPTIONS, formatIcon, formatLabel } from "./columnFormat";
import { getPresetConfig, PROMPT_PRESETS } from "./columnPresets";
import { TAG_COLORS } from "./pillUtils";

interface ColumnDraft {
  name: string;
  prompt: string;
  format: ColumnFormat;
  tags: string[];
}

const EMPTY_DRAFT: ColumnDraft = {
  name: "",
  prompt: "",
  format: "text",
  tags: [],
};

function draftFromColumn(col: ColumnConfig): ColumnDraft {
  return {
    name: col.name,
    prompt: col.prompt,
    format: col.format ?? "text",
    tags: col.tags ?? [],
  };
}

interface FormValues {
  columns: ColumnDraft[];
}

interface Props {
  open: boolean;
  existingCount: number;
  onClose: () => void;
  onAdd: (cols: ColumnConfig[]) => void;
  editingColumn?: ColumnConfig;
  onSave?: (col: ColumnConfig) => void;
  onDelete?: () => void;
}

export function AddColumnModal({
  open,
  existingCount,
  onClose,
  onAdd,
  editingColumn,
  onSave,
  onDelete,
}: Props) {
  const isEditing = !!editingColumn;
  const initialColumns: ColumnDraft[] = editingColumn
    ? [draftFromColumn(editingColumn)]
    : [{ ...EMPTY_DRAFT }];

  // Per-column state that's local to the form UI (not part of the persisted
  // ColumnConfig): the in-flight tag input, and the prompt-generator's
  // async loading flag. Keyed by array index.
  const [tagInputs, setTagInputs] = useState<string[]>([""]);
  const [generatingIndices, setGeneratingIndices] = useState<number[]>([]);
  const [presetsOpenIndex, setPresetsOpenIndex] = useState<number | null>(null);
  const presetsRef = useRef<HTMLDivElement>(null);

  const form = useForm({
    defaultValues: { columns: initialColumns } as FormValues,
    onSubmit: ({ value }) => {
      const trimmed = value.columns.map((col, i) => ({
        index: editingColumn ? editingColumn.index : existingCount + i,
        name: col.name.trim(),
        prompt: col.prompt.trim(),
        format: col.format,
        tags: col.format === "tag" ? col.tags : undefined,
      }));
      if (isEditing && onSave && editingColumn && trimmed[0]) {
        onSave(trimmed[0]);
      } else {
        onAdd(trimmed);
      }
      handleClose();
    },
  });

  // Reset form values when the modal opens, mirrors the prior useEffect that
  // re-hydrated `columns` from `editingColumn`. TanStack Form's reset takes
  // optional new defaults.
  useEffect(() => {
    if (!open) return;
    const next: ColumnDraft[] = editingColumn
      ? [draftFromColumn(editingColumn)]
      : [{ ...EMPTY_DRAFT }];
    form.reset({ columns: next });
    // eslint-disable-next-line react-hooks/set-state-in-effect -- syncing transient UI buffers to modal-open trigger
    setTagInputs(next.map(() => ""));
    setGeneratingIndices([]);
    setPresetsOpenIndex(null);
  }, [editingColumn, open, form]);

  useEffect(() => {
    if (presetsOpenIndex === null) return;
    function handleClickOutside(e: MouseEvent) {
      if (presetsRef.current && !presetsRef.current.contains(e.target as Node)) {
        setPresetsOpenIndex(null);
      }
    }
    document.addEventListener("mousedown", handleClickOutside);
    return () => document.removeEventListener("mousedown", handleClickOutside);
  }, [presetsOpenIndex]);

  if (!open) return null;

  function handleClose() {
    setTagInputs([""]);
    setGeneratingIndices([]);
    setPresetsOpenIndex(null);
    onClose();
  }

  function setTagInput(index: number, value: string) {
    setTagInputs((prev) => {
      const next = [...prev];
      next[index] = value;
      return next;
    });
  }

  function applyPresetAt(index: number, draft: ColumnDraft) {
    form.setFieldValue(`columns[${index}].name`, draft.name);
    form.setFieldValue(`columns[${index}].prompt`, draft.prompt);
    form.setFieldValue(`columns[${index}].format`, draft.format);
    form.setFieldValue(`columns[${index}].tags`, draft.tags);
    setTagInput(index, "");
  }

  function commitTag(index: number) {
    const tag = (tagInputs[index] ?? "").trim();
    if (!tag) return;
    const existing = (form.getFieldValue(`columns[${index}].tags`) as string[]) ?? [];
    if (existing.includes(tag)) {
      setTagInput(index, "");
      return;
    }
    form.setFieldValue(`columns[${index}].tags`, [...existing, tag]);
    setTagInput(index, "");
  }

  function removeTagAt(index: number, tag: string) {
    const existing = (form.getFieldValue(`columns[${index}].tags`) as string[]) ?? [];
    form.setFieldValue(
      `columns[${index}].tags`,
      existing.filter((t) => t !== tag),
    );
  }

  function handleTagKeyDown(e: React.KeyboardEvent<HTMLInputElement>, index: number) {
    if (e.key === "Enter" || e.key === ",") {
      e.preventDefault();
      commitTag(index);
    } else if (e.key === "Backspace" && (tagInputs[index] ?? "") === "") {
      const existing = (form.getFieldValue(`columns[${index}].tags`) as string[]) ?? [];
      if (existing.length > 0) {
        form.setFieldValue(`columns[${index}].tags`, existing.slice(0, -1));
      }
    }
  }

  async function autoGeneratePrompt(index: number) {
    const name = ((form.getFieldValue(`columns[${index}].name`) as string) ?? "").trim();
    if (!name) return;
    const format = (form.getFieldValue(`columns[${index}].format`) as ColumnFormat) ?? "text";
    const tags = (form.getFieldValue(`columns[${index}].tags`) as string[]) ?? [];
    setGeneratingIndices((prev) => [...prev, index]);
    try {
      const { prompt } = await generateTabularColumnPrompt(name, {
        format,
        tags: format === "tag" ? tags : undefined,
      });
      form.setFieldValue(`columns[${index}].prompt`, prompt);
    } finally {
      setGeneratingIndices((prev) => prev.filter((v) => v !== index));
    }
  }

  return createPortal(
    <div className="fixed inset-0 z-[101] flex items-center justify-center bg-black/20 backdrop-blur-xs">
      <div className="flex h-[600px] w-full max-w-2xl flex-col rounded-2xl bg-white shadow-2xl">
        {/* Header */}
        <div className="flex items-center justify-between px-6 pt-5 pb-2">
          <div className="flex items-center gap-1.5 text-xs text-gray-400">
            <span>Tabular Review</span>
            <span>›</span>
            <span>{isEditing ? "Edit column" : "New column"}</span>
          </div>
          <button
            onClick={handleClose}
            className="rounded-lg p-1.5 text-gray-400 transition-colors hover:bg-gray-100 hover:text-gray-600"
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
          className="flex min-h-0 flex-1 flex-col"
        >
          {/* Body */}
          <div className="flex-1 space-y-5 overflow-y-auto px-6 pt-3 pb-5">
            <form.Field name="columns" mode="array">
              {(arrayField) => (
                <>
                  {arrayField.state.value.map((_, index) => (
                    <div key={index} className="rounded-xl border border-gray-200 p-4">
                      {/* Name row */}
                      <div className="flex items-start gap-2">
                        <div
                          className="relative flex flex-1 items-start"
                          ref={presetsOpenIndex === index ? presetsRef : null}
                        >
                          <form.Field name={`columns[${index}].name`}>
                            {(nameField) => (
                              <input
                                type="text"
                                value={nameField.state.value}
                                onChange={(e) => {
                                  const value = e.target.value;
                                  nameField.handleChange(value);
                                  const preset = getPresetConfig(value);
                                  if (preset) {
                                    form.setFieldValue(`columns[${index}].prompt`, preset.prompt);
                                    form.setFieldValue(`columns[${index}].format`, preset.format);
                                    form.setFieldValue(`columns[${index}].tags`, preset.tags ?? []);
                                    setTagInput(index, "");
                                  }
                                }}
                                onBlur={nameField.handleBlur}
                                placeholder="Column name"
                                className="flex-1 bg-transparent font-serif text-2xl text-gray-800 placeholder-gray-400 focus:outline-none"
                                autoFocus={index === 0}
                              />
                            )}
                          </form.Field>
                          <button
                            type="button"
                            onClick={() =>
                              setPresetsOpenIndex(presetsOpenIndex === index ? null : index)
                            }
                            title="Column presets"
                            className="mt-1.5 rounded-lg p-1.5 text-gray-500 transition-colors hover:bg-gray-100 hover:text-gray-700"
                          >
                            <ChevronDown
                              className={`h-4 w-4 transition-transform ${
                                presetsOpenIndex === index ? "rotate-180" : ""
                              }`}
                            />
                          </button>
                          {presetsOpenIndex === index && (
                            <div className="absolute top-full right-0 left-0 z-50 mt-1 max-h-64 overflow-y-auto rounded-xl border border-gray-100 bg-white shadow-lg">
                              <button
                                type="button"
                                onClick={() => {
                                  applyPresetAt(index, { ...EMPTY_DRAFT });
                                  setPresetsOpenIndex(null);
                                }}
                                className="w-full border-b border-gray-100 px-3 py-2 text-left text-sm text-gray-400 transition-colors hover:bg-gray-50"
                              >
                                No Preset
                              </button>
                              {PROMPT_PRESETS.map((preset) => (
                                <button
                                  key={preset.name}
                                  type="button"
                                  onClick={() => {
                                    applyPresetAt(index, {
                                      name: preset.name,
                                      prompt: preset.prompt,
                                      format: preset.format,
                                      tags: preset.tags ?? [],
                                    });
                                    setPresetsOpenIndex(null);
                                  }}
                                  className="w-full px-3 py-2 text-left text-sm text-gray-700 transition-colors hover:bg-gray-50"
                                >
                                  {preset.name}
                                </button>
                              ))}
                            </div>
                          )}
                        </div>
                        {arrayField.state.value.length > 1 && (
                          <button
                            type="button"
                            onClick={() => {
                              arrayField.removeValue(index);
                              setTagInputs((prev) => prev.filter((_, i) => i !== index));
                              setGeneratingIndices((prev) =>
                                prev.filter((v) => v !== index).map((v) => (v > index ? v - 1 : v)),
                              );
                            }}
                            className="mt-1.5 rounded-lg p-1.5 text-gray-300 transition-colors hover:bg-gray-100 hover:text-gray-500"
                          >
                            <X className="h-4 w-4" />
                          </button>
                        )}
                      </div>

                      {/* Format */}
                      <div className="mt-4">
                        <label className="text-sm font-medium text-gray-500">Format</label>
                        <form.Field name={`columns[${index}].format`}>
                          {(formatField) => (
                            <DropdownMenu>
                              <DropdownMenuTrigger asChild>
                                <button className="mt-1 flex items-center justify-between rounded-md border border-gray-200 bg-white px-2 py-1.5 text-sm text-gray-700 hover:border-gray-400 focus:outline-none">
                                  <span className="flex items-center gap-2">
                                    {(() => {
                                      const Icon = formatIcon(formatField.state.value);
                                      return <Icon className="h-3.5 w-3.5 text-gray-400" />;
                                    })()}
                                    {formatLabel(formatField.state.value)}
                                  </span>
                                  <ChevronDown className="h-3.5 w-3.5 text-gray-400" />
                                </button>
                              </DropdownMenuTrigger>
                              <DropdownMenuContent align="start" className="z-[200]">
                                <DropdownMenuRadioGroup
                                  value={formatField.state.value}
                                  onValueChange={(v) => {
                                    formatField.handleChange(v as ColumnFormat);
                                    // Tag arrays only make sense for the
                                    // "tag" format; clear when switching out.
                                    if (v !== "tag") {
                                      form.setFieldValue(`columns[${index}].tags`, []);
                                      setTagInput(index, "");
                                    }
                                  }}
                                >
                                  {FORMAT_OPTIONS.map((o) => (
                                    <DropdownMenuRadioItem key={o.value} value={o.value}>
                                      <o.icon className="h-3.5 w-3.5 text-gray-400" />
                                      {o.label}
                                    </DropdownMenuRadioItem>
                                  ))}
                                </DropdownMenuRadioGroup>
                              </DropdownMenuContent>
                            </DropdownMenu>
                          )}
                        </form.Field>
                      </div>

                      {/* Tag input (only when format == "tag") */}
                      <form.Subscribe selector={(state) => state.values.columns[index]?.format}>
                        {(currentFormat) =>
                          currentFormat === "tag" ? (
                            <form.Field name={`columns[${index}].tags`}>
                              {(tagsField) => (
                                <div className="mt-3">
                                  <label className="text-sm font-medium text-gray-500">Tags</label>
                                  <div className="mt-1 flex flex-wrap gap-1.5 rounded-md border border-gray-200 px-2 py-1.5 focus-within:border-gray-400">
                                    {(tagsField.state.value as string[]).map((tag, tagIdx) => (
                                      <span
                                        key={tag}
                                        className={`inline-flex items-center gap-1 rounded-full px-2 py-0.5 text-xs ${TAG_COLORS[tagIdx % TAG_COLORS.length]}`}
                                      >
                                        {tag}
                                        <button
                                          type="button"
                                          onClick={() => removeTagAt(index, tag)}
                                          className="text-gray-400 hover:text-gray-600"
                                        >
                                          <X className="h-2.5 w-2.5" />
                                        </button>
                                      </span>
                                    ))}
                                    <input
                                      type="text"
                                      value={tagInputs[index] ?? ""}
                                      onChange={(e) => setTagInput(index, e.target.value)}
                                      onKeyDown={(e) => handleTagKeyDown(e, index)}
                                      onBlur={() => commitTag(index)}
                                      placeholder="Add tag…"
                                      className="min-w-[80px] flex-1 bg-transparent text-sm text-gray-700 placeholder-gray-400 focus:outline-none"
                                    />
                                  </div>
                                  <p className="mt-1 text-xs text-gray-400">
                                    Press Enter or comma to add a tag.
                                  </p>
                                </div>
                              )}
                            </form.Field>
                          ) : null
                        }
                      </form.Subscribe>

                      {/* Prompt */}
                      <div className="mt-4 flex items-center justify-between">
                        <label className="text-sm font-medium text-gray-500">Prompt</label>
                        <form.Subscribe
                          selector={(state) => state.values.columns[index]?.name ?? ""}
                        >
                          {(name) => (
                            <button
                              type="button"
                              onClick={() => autoGeneratePrompt(index)}
                              disabled={!name.trim() || generatingIndices.includes(index)}
                              className="inline-flex items-center gap-1.5 text-sm text-gray-500 transition-colors hover:text-gray-900 disabled:text-gray-300"
                            >
                              {generatingIndices.includes(index) ? (
                                <span className="block h-4 w-4 animate-spin rounded-full border-2 border-gray-300 border-t-gray-600" />
                              ) : (
                                <Plus className="h-4 w-4" />
                              )}
                              Auto-Generate Prompt
                            </button>
                          )}
                        </form.Subscribe>
                      </div>
                      <form.Field name={`columns[${index}].prompt`}>
                        {(promptField) => (
                          <textarea
                            rows={6}
                            value={promptField.state.value}
                            onChange={(e) => promptField.handleChange(e.target.value)}
                            onBlur={promptField.handleBlur}
                            placeholder="Write the analysis prompt — describe what Luke should extract from each document for this column…"
                            className="mt-2 w-full resize-none rounded-md border border-gray-200 bg-transparent px-3 py-2 text-sm leading-relaxed text-gray-700 placeholder-gray-400 focus:border-gray-400 focus:outline-none"
                          />
                        )}
                      </form.Field>
                    </div>
                  ))}

                  {!isEditing && (
                    <button
                      type="button"
                      onClick={() => {
                        arrayField.pushValue({ ...EMPTY_DRAFT });
                        setTagInputs((prev) => [...prev, ""]);
                      }}
                      className="inline-flex items-center gap-1.5 text-sm text-gray-500 transition-colors hover:text-gray-900"
                    >
                      <Plus className="h-4 w-4" />
                      Add another column
                    </button>
                  )}
                </>
              )}
            </form.Field>
          </div>

          {/* Footer */}
          <div className="flex items-center justify-between border-t border-gray-100 px-6 py-4">
            <div>
              {isEditing && onDelete && (
                <button
                  type="button"
                  onClick={onDelete}
                  className="rounded-lg px-4 py-2 text-sm text-red-500 transition-colors hover:bg-red-50"
                >
                  Delete
                </button>
              )}
            </div>
            <div className="flex items-center gap-2">
              <button
                type="button"
                onClick={handleClose}
                className="rounded-lg px-4 py-2 text-sm text-gray-500 transition-colors hover:bg-gray-100"
              >
                Cancel
              </button>
              <form.Subscribe
                selector={(state) => ({
                  columns: state.values.columns,
                  isSubmitting: state.isSubmitting,
                })}
              >
                {({ columns, isSubmitting }) => {
                  const valid = columns.every(
                    (col) => col.name.trim() !== "" && col.prompt.trim() !== "",
                  );
                  return (
                    <button
                      type="submit"
                      disabled={!valid || isSubmitting}
                      className="rounded-lg bg-gray-900 px-5 py-2 text-sm font-medium text-white transition-colors hover:bg-gray-700 disabled:opacity-40"
                    >
                      {isEditing ? "Save changes" : "Add columns"}
                    </button>
                  );
                }}
              </form.Subscribe>
            </div>
          </div>
        </form>
      </div>
    </div>,
    document.body,
  );
}
