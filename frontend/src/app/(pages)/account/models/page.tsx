"use client";

import { AlertCircle, Check, ChevronDown, Eye, EyeOff } from "lucide-react";
import { useState } from "react";

import { MODELS } from "@/app/components/assistant/ModelToggle";
import { isModelAvailable, modelGroupToProvider } from "@/app/lib/modelAvailability";
import { Button } from "@/components/ui/button";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { Input } from "@/components/ui/input";
import { useUserProfile } from "@/contexts/UserProfileContext";

export default function ModelsAndApiKeysPage() {
  const { profile, updateModelPreference, updateApiKey } = useUserProfile();

  return (
    <div className="space-y-4">
      {/* Model Preferences */}
      <div className="pb-6">
        <div className="mb-4 flex items-center gap-2">
          <h2 className="font-serif text-2xl font-medium">Model Preferences</h2>
        </div>
        <div className="max-w-md space-y-4">
          <div>
            <label className="mb-2 block text-sm text-gray-600">Tabular review model</label>
            <TabularModelDropdown
              value={profile?.tabularModel ?? "gemma4"}
              apiKeys={{
                claudeApiKey: profile?.claudeApiKey ?? null,
                geminiApiKey: profile?.geminiApiKey ?? null,
              }}
              onChange={(id) => updateModelPreference("tabularModel", id)}
            />
          </div>
        </div>
      </div>

      {/* API Keys */}
      <div className="py-6">
        <div className="mb-2 flex items-center gap-2">
          <h2 className="font-serif text-2xl font-medium">API Keys</h2>
        </div>
        <p className="mb-4 max-w-xl text-sm text-gray-500">
          Gemma 4 runs through Ollama using the backend OLLAMA_BASE_URL. Hosted Claude and Gemini
          models require provider API keys.
        </p>
        <p className="mb-4 max-w-xl text-xs text-gray-400">
          Title generation uses Gemma 4 by default, or a configured hosted provider when you select
          one that requires a key.
        </p>
        <div className="max-w-xl space-y-4">
          <ApiKeyField
            key={`claude-${profile?.claudeApiKey ?? ""}`}
            label="Anthropic (Claude) API Key"
            placeholder="sk-ant-…"
            initialValue={profile?.claudeApiKey ?? ""}
            onSave={(value) => updateApiKey("claude", value.trim() || null)}
          />
          <ApiKeyField
            key={`gemini-${profile?.geminiApiKey ?? ""}`}
            label="Google (Gemini) API Key"
            placeholder="AI…"
            initialValue={profile?.geminiApiKey ?? ""}
            onSave={(value) => updateApiKey("gemini", value.trim() || null)}
          />
        </div>
      </div>
    </div>
  );
}

function TabularModelDropdown({
  value,
  onChange,
  apiKeys,
}: {
  value: string;
  onChange: (id: string) => void;
  apiKeys: { claudeApiKey: string | null; geminiApiKey: string | null };
}) {
  const [isOpen, setIsOpen] = useState(false);
  const selected = MODELS.find((m) => m.id === value);
  const selectedAvailable = isModelAvailable(value, apiKeys);
  const groups: ("Ollama" | "Anthropic" | "Google")[] = ["Ollama", "Anthropic", "Google"];

  return (
    <DropdownMenu onOpenChange={setIsOpen}>
      <DropdownMenuTrigger asChild>
        <button
          type="button"
          className="flex h-9 w-full items-center justify-between gap-2 rounded-md border border-gray-300 bg-white px-3 text-sm shadow-sm hover:bg-gray-50 focus:ring-2 focus:ring-black/10 focus:outline-none"
        >
          <span className="flex min-w-0 items-center gap-2">
            {!selectedAvailable && <AlertCircle className="h-3.5 w-3.5 shrink-0 text-red-500" />}
            <span className="truncate text-gray-900">{selected?.label ?? "Select a model"}</span>
          </span>
          <ChevronDown
            className={`h-3.5 w-3.5 shrink-0 text-gray-500 transition-transform duration-200 ${isOpen ? "rotate-180" : ""}`}
          />
        </button>
      </DropdownMenuTrigger>
      <DropdownMenuContent
        className="z-50"
        style={{ width: "var(--radix-dropdown-menu-trigger-width)" }}
        align="start"
      >
        {groups.map((group, gi) => {
          const items = MODELS.filter((m) => m.group === group);
          if (items.length === 0) return null;
          return (
            <div key={group}>
              {gi > 0 && <DropdownMenuSeparator />}
              <DropdownMenuLabel className="text-[10px] tracking-wider text-gray-400 uppercase">
                {group}
              </DropdownMenuLabel>
              {items.map((m) => {
                const provider = modelGroupToProvider(m.group);
                const available = isModelAvailable(m.id, apiKeys);
                return (
                  <DropdownMenuItem
                    key={m.id}
                    className="cursor-pointer"
                    onSelect={() => onChange(m.id)}
                    title={
                      !available
                        ? `Add a ${provider === "claude" ? "Claude" : "Gemini"} API key to use this model`
                        : undefined
                    }
                  >
                    <span className={`flex-1 ${available ? "" : "text-gray-400"}`}>{m.label}</span>
                    {!available && <AlertCircle className="ml-1 h-3.5 w-3.5 text-red-500" />}
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

function ApiKeyField({
  label,
  placeholder,
  initialValue,
  onSave,
}: {
  label: string;
  placeholder: string;
  initialValue: string;
  onSave: (value: string) => Promise<boolean>;
}) {
  const [value, setValue] = useState(initialValue);
  const [reveal, setReveal] = useState(false);
  const [isSaving, setIsSaving] = useState(false);
  const [saved, setSaved] = useState(false);

  const dirty = value !== initialValue;
  const [error, setError] = useState<string | null>(null);

  const handleSave = async () => {
    setError(null);
    setIsSaving(true);
    const ok = await onSave(value);
    setIsSaving(false);
    if (ok) {
      setSaved(true);
      setTimeout(() => setSaved(false), 2000);
    } else {
      setError(`Failed to save ${label}.`);
    }
  };

  return (
    <div>
      <label className="mb-2 block text-sm text-gray-600">{label}</label>
      <div className="flex gap-2">
        <div className="relative flex-1">
          <Input
            type={reveal ? "text" : "password"}
            value={value}
            onChange={(e) => setValue(e.target.value)}
            placeholder={placeholder}
            className="pr-10"
            autoComplete="off"
            spellCheck={false}
          />
          <button
            type="button"
            onClick={() => setReveal((r) => !r)}
            className="absolute inset-y-0 right-2 flex items-center text-gray-400 hover:text-gray-600"
            aria-label={reveal ? "Hide key" : "Show key"}
          >
            {reveal ? <EyeOff className="h-4 w-4" /> : <Eye className="h-4 w-4" />}
          </button>
        </div>
        <Button
          onClick={handleSave}
          disabled={isSaving || !dirty || saved}
          className="min-w-[80px] bg-black text-white transition-all hover:bg-gray-900"
        >
          {isSaving ? (
            "Saving..."
          ) : saved ? (
            <>
              <Check className="h-4 w-3" />
              Saved
            </>
          ) : (
            "Save"
          )}
        </Button>
      </div>
      {error && <p className="mt-2 text-xs text-red-600">{error}</p>}
    </div>
  );
}
