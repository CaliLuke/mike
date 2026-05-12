"use client";

import { createContext, useCallback, useContext } from "react";

import { ModelToggle } from "@/app/components/assistant/ModelToggle";
import { useSelectedModel } from "@/app/hooks/useSelectedModel";
import { useUserProfile } from "@/contexts/UserProfileContext";

import { aniEvent } from "./observability";

interface SelectedModelApi {
  model: string;
  setModel: (id: string) => void;
}

const SelectedModelContext = createContext<SelectedModelApi | null>(null);

export function SelectedModelProvider({ children }: { children: React.ReactNode }) {
  const [model, setModel] = useSelectedModel();
  return (
    <SelectedModelContext.Provider value={{ model, setModel }}>
      {children}
    </SelectedModelContext.Provider>
  );
}

export function useSelectedModelContext(): SelectedModelApi {
  const ctx = useContext(SelectedModelContext);
  if (!ctx) throw new Error("useSelectedModelContext must be used inside SelectedModelProvider");
  return ctx;
}

/** Slot inside the polished Composer's action row. */
export function ComposerModelToggle() {
  const { model, setModel } = useSelectedModelContext();
  const handleChange = useCallback(
    (next: string) => {
      aniEvent("model.change", { "model.from": model, "model.to": next });
      setModel(next);
    },
    [model, setModel],
  );
  const { profile } = useUserProfile();
  const apiKeys = profile
    ? {
        claudeApiKey: profile.claudeApiKey ?? null,
        geminiApiKey: profile.geminiApiKey ?? null,
      }
    : undefined;
  // Shrink the toggle a touch for the composer action row — the
  // existing component reads `max-w-[140px]` on its label span, so we
  // wrap with a constraint and let the underlying button collapse.
  return (
    <div className="[&_button]:!h-7 [&_button]:!text-xs [&_span]:!max-w-[100px]">
      <ModelToggle value={model} onChange={handleChange} apiKeys={apiKeys} />
    </div>
  );
}
