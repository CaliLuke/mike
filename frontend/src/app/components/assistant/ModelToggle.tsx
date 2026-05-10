"use client";

import { AlertCircle, Check, ChevronDown } from "lucide-react";
import { useState } from "react";

import { isModelAvailable } from "@/app/lib/modelAvailability";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";

export interface ModelOption {
  id: string;
  label: string;
  group: "Anthropic" | "Google" | "Ollama";
}

export const MODELS: ModelOption[] = [
  { id: "gemma4", label: "Gemma 4", group: "Ollama" },
  { id: "claude-opus-4-7", label: "Claude Opus 4.7", group: "Anthropic" },
  { id: "claude-sonnet-4-6", label: "Claude Sonnet 4.6", group: "Anthropic" },
  { id: "gemini-3.1-pro-preview", label: "Gemini 3.1 Pro", group: "Google" },
  { id: "gemini-3-flash-preview", label: "Gemini 3 Flash", group: "Google" },
];

export const DEFAULT_MODEL_ID = "gemma4";

export const ALLOWED_MODEL_IDS = new Set(MODELS.map((m) => m.id));

const GROUP_ORDER: ModelOption["group"][] = ["Ollama", "Anthropic", "Google"];

interface Props {
  value: string;
  onChange: (id: string) => void;
  apiKeys?: {
    claudeApiKey: string | null;
    geminiApiKey: string | null;
  };
}

export function ModelToggle({ value, onChange, apiKeys }: Props) {
  const [isOpen, setIsOpen] = useState(false);
  const selected = MODELS.find((m) => m.id === value);
  const selectedLabel = selected?.label ?? "Model";
  const selectedAvailable = apiKeys ? isModelAvailable(value, apiKeys) : true;

  return (
    <DropdownMenu onOpenChange={setIsOpen}>
      <DropdownMenuTrigger asChild>
        <button
          type="button"
          className={`flex h-8 cursor-pointer items-center gap-1.5 rounded-lg px-2 text-sm text-gray-400 transition-colors hover:bg-gray-100 hover:text-gray-700 ${isOpen ? "bg-gray-100 text-gray-700" : ""}`}
          title={!selectedAvailable ? "API key missing for selected model" : "Choose model"}
        >
          {!selectedAvailable && <AlertCircle className="h-3 w-3 shrink-0 text-red-500" />}
          <span className="max-w-[140px] truncate">{selectedLabel}</span>
          <ChevronDown
            className={`h-3 w-3 shrink-0 transition-transform duration-200 ${isOpen ? "rotate-180" : ""}`}
          />
        </button>
      </DropdownMenuTrigger>
      <DropdownMenuContent className="z-50 w-56" side="top" align="start">
        {GROUP_ORDER.map((group, gi) => {
          const items = MODELS.filter((m) => m.group === group);
          if (items.length === 0) return null;
          return (
            <div key={group}>
              {gi > 0 && <DropdownMenuSeparator />}
              <DropdownMenuLabel className="text-[10px] tracking-wider text-gray-400 uppercase">
                {group}
              </DropdownMenuLabel>
              {items.map((m) => {
                const available = apiKeys ? isModelAvailable(m.id, apiKeys) : true;
                return (
                  <DropdownMenuItem
                    key={m.id}
                    className="cursor-pointer"
                    onSelect={() => onChange(m.id)}
                  >
                    <span className={`flex-1 ${available ? "" : "text-gray-400"}`}>{m.label}</span>
                    {!available && (
                      <AlertCircle
                        className="ml-1 h-3.5 w-3.5 text-red-500"
                        aria-label="API key missing"
                      />
                    )}
                    {m.id === value && available && (
                      <Check className="ml-1 h-3.5 w-3.5 text-gray-600" />
                    )}
                  </DropdownMenuItem>
                );
              })}
            </div>
          );
        })}
      </DropdownMenuContent>
    </DropdownMenu>
  );
}
